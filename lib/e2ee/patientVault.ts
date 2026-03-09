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
  wrapped_key: WrappedKeyV1;
  created_at: string;
};

type PatientMemberRow = { user_id: string };

type UserPublicKeyRow = {
  user_id: string;
  public_key: string;
  algorithm: string | null;
};

type CacheRecord = {
  v: 1;
  createdAt: number;
  expiresAt: number;
  vaultKeyB64: string;
};

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

function cacheKey(pid: string, uid: string) {
  return `carecircle:vaultkey:v1:${pid}:${uid}`;
}

const TTL_DAYS = 30;

function readCachedVaultRecord(pid: string, uid: string): CacheRecord | null {
  try {
    const raw = localStorage.getItem(cacheKey(pid, uid));
    if (!raw) return null;

    const rec = JSON.parse(raw) as CacheRecord;
    if (!rec || rec.v !== 1) return null;

    if (!rec.expiresAt || Date.now() > rec.expiresAt) {
      localStorage.removeItem(cacheKey(pid, uid));
      return null;
    }

    return rec;
  } catch {
    return null;
  }
}

function readCachedVaultKey(pid: string, uid: string): Uint8Array | null {
  const rec = readCachedVaultRecord(pid, uid);
  if (!rec) return null;

  try {
    return b64ToBytes(rec.vaultKeyB64);
  } catch {
    return null;
  }
}

function writeCachedVaultKey(pid: string, uid: string, key: Uint8Array | null) {
  try {
    if (!key) {
      localStorage.removeItem(cacheKey(pid, uid));
      return;
    }

    const now = Date.now();
    const rec: CacheRecord = {
      v: 1,
      createdAt: now,
      expiresAt: now + TTL_DAYS * 24 * 60 * 60 * 1000,
      vaultKeyB64: bytesToB64(key),
    };

    localStorage.setItem(cacheKey(pid, uid), JSON.stringify(rec));
  } catch {
    // ignore
  }
}

function isCacheFreshEnoughForShare(cacheRec: CacheRecord | null, shareCreatedAt: string | null | undefined) {
  if (!cacheRec) return false;
  if (!shareCreatedAt) return true;

  const shareMs = new Date(shareCreatedAt).getTime();
  if (!Number.isFinite(shareMs)) return true;

  return cacheRec.createdAt >= shareMs;
}

/**
 * Load + unwrap MY vault key for a patient.
 * Important: we fetch the latest share row first, then only trust cache
 * if the cache is at least as new as that share row.
 */
export async function loadMyPatientVaultKey(patientId: string): Promise<Uint8Array | null> {
  if (!patientId || !isUuid(patientId)) throw new Error("invalid_patient_id");

  const supabase = supabaseBrowser();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const uid = auth.user?.id;
  if (!uid) throw new Error("not_authenticated");

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
    writeCachedVaultKey(patientId, uid, null);
    return null;
  }

  const cacheRec = readCachedVaultRecord(patientId, uid);
  if (isCacheFreshEnoughForShare(cacheRec, row.created_at)) {
    const cached = readCachedVaultKey(patientId, uid);
    if (cached) return cached;
  }

  const { publicKey, privateKey } = await getOrCreateDeviceKeypair();

  const vaultKey = await unwrapVaultKeyForMe({
    wrapped: row.wrapped_key,
    myPublicKey: publicKey,
    myPrivateKey: privateKey,
  });

  if (!vaultKey || vaultKey.length !== 32) {
    throw new Error("vault_key_unwrap_failed");
  }

  writeCachedVaultKey(patientId, uid, vaultKey);
  return vaultKey;
}

/**
 * Controller-only: generate a vault key and create shares for all members.
 */
export async function initialiseVaultForPatient(patientId: string): Promise<void> {
  if (!patientId || !isUuid(patientId)) throw new Error("invalid_patient_id");

  const supabase = supabaseBrowser();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const uid = auth.user?.id;
  if (!uid) throw new Error("not_authenticated");

  const { data: ctl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid: patientId });
  if (ctlErr) throw ctlErr;
  if (!ctl) throw new Error("not_controller");

  const { data: members, error: memErr } = await supabase
    .from("patient_members")
    .select("user_id")
    .eq("patient_id", patientId);

  if (memErr) throw memErr;

  const userIds = ((members ?? []) as PatientMemberRow[]).map((m) => m.user_id);
  if (userIds.length === 0) throw new Error("no_members_found");

  const { data: pubKeys, error: pkErr } = await supabase
    .from("user_public_keys")
    .select("user_id, public_key, algorithm")
    .in("user_id", userIds);

  if (pkErr) throw pkErr;

  const pkRows = (pubKeys ?? []) as UserPublicKeyRow[];

  const missing = userIds.filter((id) => !pkRows.some((p) => p.user_id === id));
  if (missing.length > 0) throw new Error(`missing_public_keys_for_${missing.length}_members`);

  const incompatible = pkRows.filter((p) => p.algorithm !== "crypto_box_seal");
  if (incompatible.length > 0) throw new Error(`incompatible_public_keys_for_${incompatible.length}_members`);

  const sodium = await getSodium();
  const vaultKey = sodium.randombytes_buf(32) as Uint8Array;

  const { error: delErr } = await supabase
    .from("patient_vault_shares")
    .delete()
    .eq("patient_id", patientId)
    .in("user_id", userIds);

  if (delErr) throw delErr;

  const rowsToInsert = await Promise.all(
    pkRows.map(async (p) => {
      const recipientPk = b64ToBytes(p.public_key);

      const wrapped = await wrapVaultKeyForRecipient({
        vaultKey,
        recipientPublicKey: recipientPk,
      });

      return {
        patient_id: patientId,
        user_id: p.user_id,
        wrapped_key: wrapped,
      };
    })
  );

  const { error: insErr } = await supabase.from("patient_vault_shares").insert(rowsToInsert);
  if (insErr) throw insErr;

  if (userIds.includes(uid)) {
    writeCachedVaultKey(patientId, uid, vaultKey);
  }
}

export async function forgetMyCachedVaultKey(patientId: string): Promise<void> {
  if (!patientId || !isUuid(patientId)) return;

  const supabase = supabaseBrowser();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;

  writeCachedVaultKey(patientId, uid, null);
}