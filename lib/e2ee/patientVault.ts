// lib/e2ee/patientVault.ts
"use client";

import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";
import {
  wrapVaultKeyForRecipient,
  unwrapVaultKeyForMe,
  type WrappedKeyV1,
} from "@/lib/e2ee/vaultShares";

type VaultShareRow = {
  id: string;
  patient_id: string;
  user_id: string;
  wrapped_key: WrappedKeyV1; // jsonb stored as this object
  created_at: string;
};

type PatientMemberRow = { user_id: string };

type UserPublicKeyRow = {
  user_id: string;
  public_key: string; // base64 raw bytes (your existing convention)
  algorithm: string | null;
};

// -----------------------------
// Helpers (stable, no drift)
// -----------------------------

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Local cache of unwrapped vault key.
// Provider also caches; this makes loadMyPatientVaultKey stable on its own too.
function localVaultKeyKey(pid: string, uid: string) {
  return `cc:vault:${pid}:${uid}`;
}
function localVaultKeyTs(pid: string, uid: string) {
  return `cc:vault_ts:${pid}:${uid}`;
}
const TTL_DAYS = 30;

function tryGetCachedVaultKey(pid: string, uid: string): Uint8Array | null {
  try {
    const b64 = localStorage.getItem(localVaultKeyKey(pid, uid));
    const ts = localStorage.getItem(localVaultKeyTs(pid, uid));
    if (!b64 || !ts) return null;

    const ageMs = Date.now() - new Date(ts).getTime();
    const ttlMs = TTL_DAYS * 24 * 60 * 60 * 1000;
    if (Number.isFinite(ageMs) && ageMs > ttlMs) {
      localStorage.removeItem(localVaultKeyKey(pid, uid));
      localStorage.removeItem(localVaultKeyTs(pid, uid));
      return null;
    }

    return b64ToBytes(b64);
  } catch {
    return null;
  }
}

function setCachedVaultKey(pid: string, uid: string, key: Uint8Array | null) {
  try {
    if (!key) {
      localStorage.removeItem(localVaultKeyKey(pid, uid));
      localStorage.removeItem(localVaultKeyTs(pid, uid));
      return;
    }
    localStorage.setItem(localVaultKeyKey(pid, uid), bytesToB64(key));
    localStorage.setItem(localVaultKeyTs(pid, uid), new Date().toISOString());
  } catch {
    // ignore
  }
}

// -----------------------------
// Public API
// -----------------------------

/**
 * Load + unwrap MY vault key for a patient.
 * Returns null if no share row exists for this user (RLS: auth.uid() = user_id).
 */
export async function loadMyPatientVaultKey(patientId: string): Promise<Uint8Array | null> {
  if (!patientId || !isUuid(patientId)) throw new Error("invalid_patient_id");

  const supabase = supabaseBrowser();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const uid = auth.user?.id;
  if (!uid) throw new Error("not_authenticated");

  // 0) cache first
  const cached = tryGetCachedVaultKey(patientId, uid);
  if (cached) return cached;

  // 1) ensure device keypair exists (must be persisted by deviceKeys.ts)
  const { publicKey, privateKey } = await getOrCreateDeviceKeypair();

  // 2) fetch my share (RLS allows reading own row)
  const { data: rows, error } = await supabase
    .from("patient_vault_shares")
    .select("id, patient_id, user_id, wrapped_key, created_at")
    .eq("patient_id", patientId)
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const row = (rows?.[0] ?? null) as VaultShareRow | null;
  if (!row) return null;

  // 3) unwrap using your shared helper (label-consistent)
  const vaultKey = await unwrapVaultKeyForMe({
    wrapped: row.wrapped_key,
    myPublicKey: publicKey,
    myPrivateKey: privateKey,
  });

  if (!vaultKey || vaultKey.length !== 32) throw new Error("vault_key_unwrap_failed");

  // 4) cache locally
  setCachedVaultKey(patientId, uid, vaultKey);

  return vaultKey;
}

/**
 * Controller-only: generate a vault key and create shares for all members.
 *
 * Writes: patient_vault_shares(patient_id, user_id, wrapped_key)
 * Reads:  patient_members(patient_id)
 * Reads:  user_public_keys(user_id, public_key)
 *
 * IMPORTANT: uses RPC is_patient_controller(pid uuid) with param name 'pid'
 */
export async function initialiseVaultForPatient(patientId: string): Promise<void> {
  if (!patientId || !isUuid(patientId)) throw new Error("invalid_patient_id");

  const supabase = supabaseBrowser();

  // auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const uid = auth.user?.id;
  if (!uid) throw new Error("not_authenticated");

  // controller check (no overload ambiguity)
  const { data: ctl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid: patientId });
  if (ctlErr) throw ctlErr;
  if (!ctl) throw new Error("not_controller");

  // 1) members
  const { data: members, error: memErr } = await supabase
    .from("patient_members")
    .select("user_id")
    .eq("patient_id", patientId);

  if (memErr) throw memErr;

  const userIds = ((members ?? []) as PatientMemberRow[]).map((m) => m.user_id);
  if (userIds.length === 0) throw new Error("no_members_found");

  // 2) pubkeys
  const { data: pubKeys, error: pkErr } = await supabase
    .from("user_public_keys")
    .select("user_id, public_key, algorithm")
    .in("user_id", userIds);

  if (pkErr) throw pkErr;

  const pkRows = (pubKeys ?? []) as UserPublicKeyRow[];

  // Ensure everyone has a pubkey
  const missing = userIds.filter((id) => !pkRows.some((p) => p.user_id === id));
  if (missing.length > 0) throw new Error(`missing_public_keys_for_${missing.length}_members`);

  // 3) generate 32-byte vault key
  const sodium = await getSodium();
  const vaultKey = sodium.randombytes_buf(32) as Uint8Array;

  // 4) clean existing shares for those users (controller-only by policy)
  const { error: delErr } = await supabase
    .from("patient_vault_shares")
    .delete()
    .eq("patient_id", patientId)
    .in("user_id", userIds);

  if (delErr) throw delErr;

  // 5) wrap + insert
  const rows = await Promise.all(
    pkRows.map(async (p) => {
      const recipientPk = b64ToBytes(p.public_key);

      const wrapped = await wrapVaultKeyForRecipient({
        vaultKey,
        recipientPublicKey: recipientPk,
      });

      return {
        patient_id: patientId,
        user_id: p.user_id,
        wrapped_key: wrapped, // WrappedKeyV1
      };
    })
  );

  const { error: insErr } = await supabase.from("patient_vault_shares").insert(rows);
  if (insErr) throw insErr;

  // 6) cache locally for controller user (if they are in the circle)
  if (userIds.includes(uid)) {
    setCachedVaultKey(patientId, uid, vaultKey);
  }
}

/**
 * Optional: allow UI to forget local cache explicitly.
 */
export async function forgetMyCachedVaultKey(patientId: string): Promise<void> {
  if (!patientId || !isUuid(patientId)) return;

  const supabase = supabaseBrowser();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;

  setCachedVaultKey(patientId, uid, null);
}