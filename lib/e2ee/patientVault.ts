// lib/e2ee/patientVault.ts
"use client";

import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";
import { wrapVaultKeyForRecipient } from "@/lib/e2ee/vaultShares";

type VaultShareRow = {
  id: string;
  patient_id: string;
  user_id: string;
  wrapped_key: any; // jsonb (cipher envelope)
  created_at: string;
};

type PatientMemberRow = { user_id: string };

type UserPublicKeyRow = {
  user_id: string;
  public_key: string; // base64 raw bytes (as per your earlier code)
  algorithm: string | null;
};

// -----------------------------
// Helpers
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

// Local cache of unwrapped vault key (provider also caches; this makes load() stable)
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
    // ignore storage errors
  }
}

/**
 * IMPORTANT:
 * We do NOT guess your wrapped_key envelope format.
 * Your wrapVaultKeyForRecipient() already produces the correct structure.
 * So we require that your unwrap side is implemented in vaultShares too.
 *
 * If you already have unwrap logic elsewhere, import it here and replace this.
 */
async function unwrapVaultKeyForMe(args: { wrapped_key: any }): Promise<Uint8Array> {
  const sodium = await getSodium();
  const { publicKey, privateKey } = await getOrCreateDeviceKeypair();

  const wrapped_key = args.wrapped_key;

  // --- Supported minimal formats ---
  // If your wrapVaultKeyForRecipient returns something else, paste it and I’ll match it exactly.

  // Format 1: crypto_box_seal
  if (wrapped_key?.alg === "crypto_box_seal" && typeof wrapped_key?.sealed_key_b64 === "string") {
    const sealed = b64ToBytes(wrapped_key.sealed_key_b64);
    const opened = sodium.crypto_box_seal_open(sealed, publicKey, privateKey);
    if (!opened || opened.length !== 32) throw new Error("vault_key_unwrap_failed");
    return opened;
  }

  // Format 2: crypto_box_easy
  if (
    wrapped_key?.alg === "crypto_box_easy" &&
    typeof wrapped_key?.nonce_b64 === "string" &&
    typeof wrapped_key?.ciphertext_b64 === "string" &&
    typeof wrapped_key?.sender_pk_b64 === "string"
  ) {
    const nonce = b64ToBytes(wrapped_key.nonce_b64);
    const cipher = b64ToBytes(wrapped_key.ciphertext_b64);
    const senderPk = b64ToBytes(wrapped_key.sender_pk_b64);
    const opened = sodium.crypto_box_open_easy(cipher, nonce, senderPk, privateKey);
    if (!opened || opened.length !== 32) throw new Error("vault_key_unwrap_failed");
    return opened;
  }

  // If your wrapped_key is something else, we can't safely guess.
  throw new Error("wrapped_key_format_unrecognised");
}

// -----------------------------
// Public API
// -----------------------------

/**
 * Loads and unwraps the current user's vault key share for a patient.
 * Returns null if no share exists for this user.
 */
export async function loadMyPatientVaultKey(patientId: string): Promise<Uint8Array | null> {
  if (!patientId || !isUuid(patientId)) throw new Error("invalid_patient_id");

  const supabase = supabaseBrowser();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;

  const uid = auth.user?.id;
  if (!uid) throw new Error("not_authenticated");

  // 0) cache
  const cached = tryGetCachedVaultKey(patientId, uid);
  if (cached) return cached;

  // 1) ensure device keypair exists (MUST be persisted by deviceKeys.ts)
  await getOrCreateDeviceKeypair();

  // 2) fetch my share (RLS: auth.uid() = user_id)
  const { data: rows, error } = await supabase
    .from("patient_vault_shares")
    .select("id, patient_id, user_id, wrapped_key, created_at")
    .eq("patient_id", patientId)
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const row = (rows?.[0] ?? null) as VaultShareRow | null;
  if (!row) {
    // No share exists for this user
    return null;
  }

  // 3) unwrap
  const vaultKey = await unwrapVaultKeyForMe({ wrapped_key: row.wrapped_key });

  // 4) cache
  setCachedVaultKey(patientId, uid, vaultKey);

  return vaultKey;
}

/**
 * Controller-only: generate a vault key and write shares for all members.
 *
 * Uses:
 * - patient_members(patient_id) to get member user_ids
 * - user_public_keys(user_id) to get public keys
 * - patient_vault_shares(wrapped_key) to store wrapped key per member
 *
 * IMPORTANT label stability:
 * - patient_id, user_id, wrapped_key (DO NOT CHANGE)
 */
export async function initialiseVaultForPatient(patientId: string): Promise<void> {
  if (!patientId || !isUuid(patientId)) throw new Error("invalid_patient_id");

  const supabase = supabaseBrowser();

  // auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const uid = auth.user?.id;
  if (!uid) throw new Error("not_authenticated");

  // controller check: is_patient_controller(pid uuid)
  const { data: ctl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid: patientId });
  if (ctlErr) throw ctlErr;
  if (!ctl) throw new Error("not_controller");

  // 1) load members
  const { data: members, error: memErr } = await supabase
    .from("patient_members")
    .select("user_id")
    .eq("patient_id", patientId);

  if (memErr) throw memErr;

  const userIds = ((members ?? []) as PatientMemberRow[]).map((m) => m.user_id);
  if (userIds.length === 0) throw new Error("no_members_found");

  // 2) load pubkeys
  const { data: pubKeys, error: pkErr } = await supabase
    .from("user_public_keys")
    .select("user_id, public_key, algorithm")
    .in("user_id", userIds);

  if (pkErr) throw pkErr;

  const pkRows = (pubKeys ?? []) as UserPublicKeyRow[];

  const missing = userIds.filter((id) => !pkRows.some((p) => p.user_id === id));
  if (missing.length > 0) throw new Error(`missing_public_keys_for_${missing.length}_members`);

  // 3) generate 32-byte vault key
  const sodium = await getSodium();
  const vaultKey = sodium.randombytes_buf(32) as Uint8Array;

  // 4) delete existing shares for these users (clean slate)
  const { error: delErr } = await supabase
    .from("patient_vault_shares")
    .delete()
    .eq("patient_id", patientId)
    .in("user_id", userIds);

  if (delErr) throw delErr;

  // 5) create shares
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
        wrapped_key: wrapped, // jsonb envelope
      };
    })
  );

  const { error: insErr } = await supabase.from("patient_vault_shares").insert(rows);
  if (insErr) throw insErr;

  // 6) if this user is among the members, cache locally immediately
  if (userIds.includes(uid)) {
    setCachedVaultKey(patientId, uid, vaultKey);
  }
}