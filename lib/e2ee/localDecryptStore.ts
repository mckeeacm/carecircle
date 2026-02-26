import { idbGet, idbSet, idbDel } from "./idb";
import type { CipherEnvelopeV1 } from "./envelope";

const LOCAL_AES_KEY_IDB_KEY = "cc_local_cache_aes_key_raw_v1";

type LocalCacheBlobV1 = {
  v: 1;
  alg: "aes-gcm";
  iv_b64: string;
  ct_b64: string;
};

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

// Force a real ArrayBuffer (copy) to avoid ArrayBufferLike/SharedArrayBuffer typing issues
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getOrCreateLocalAesKey(): Promise<CryptoKey> {
  const existing = await idbGet<string>(LOCAL_AES_KEY_IDB_KEY);
  if (existing) {
    const raw = b64ToBytes(existing);
    return crypto.subtle.importKey("raw", toArrayBuffer(raw), { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }

  const raw = crypto.getRandomValues(new Uint8Array(32)); // 256-bit
  await idbSet(LOCAL_AES_KEY_IDB_KEY, bytesToB64(raw));
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function localEncryptString(plaintext: string): Promise<LocalCacheBlobV1> {
  const key = await getOrCreateLocalAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ptBytes = new TextEncoder().encode(plaintext);

  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ptBytes)
  );

  return {
    v: 1,
    alg: "aes-gcm",
    iv_b64: bytesToB64(iv),
    ct_b64: bytesToB64(new Uint8Array(ct)),
  };
}

async function localDecryptString(blob: LocalCacheBlobV1): Promise<string> {
  const key = await getOrCreateLocalAesKey();
  const iv = b64ToBytes(blob.iv_b64);
  const ct = b64ToBytes(blob.ct_b64);

  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ct)
  );

  return new TextDecoder().decode(new Uint8Array(pt));
}

/**
 * Cache key is derived from the ciphertext, so it is automatically invalidated
 * when the encrypted payload changes.
 */
export async function makeCacheKey(params: {
  patientId: string;
  table: string;
  rowId: string;
  column: string;
  env: CipherEnvelopeV1;
}): Promise<string> {
  const h = await sha256Hex(`${params.env.nonce_b64}.${params.env.ct_b64}`);
  return `cc_cache_v1:${params.patientId}:${params.table}:${params.rowId}:${params.column}:${h}`;
}

export async function cacheGetPlaintext(cacheKey: string): Promise<string | null> {
  const blob = await idbGet<LocalCacheBlobV1>(cacheKey);
  if (!blob) return null;
  if (blob.v !== 1 || blob.alg !== "aes-gcm") return null;
  try {
    return await localDecryptString(blob);
  } catch {
    await idbDel(cacheKey);
    return null;
  }
}

export async function cacheSetPlaintext(cacheKey: string, plaintext: string): Promise<void> {
  const blob = await localEncryptString(plaintext);
  await idbSet(cacheKey, blob);
}

export async function cacheDel(cacheKey: string): Promise<void> {
  await idbDel(cacheKey);
}

export async function wipeLocalDecryptStore(): Promise<void> {
  await idbDel(LOCAL_AES_KEY_IDB_KEY);
}