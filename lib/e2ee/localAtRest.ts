import { idbGet, idbSet, idbDel } from "./idb";

const LOCAL_AES_KEY_IDB_KEY = "cc_local_aes_key_raw_v1";

export type LocalAesBlobV1 = {
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

// force a real ArrayBuffer (copy; avoids ArrayBufferLike/SharedArrayBuffer typing issues)
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

async function getOrCreateLocalAesKey(): Promise<CryptoKey> {
  const existing = await idbGet<string>(LOCAL_AES_KEY_IDB_KEY);
  if (existing) {
    const raw = b64ToBytes(existing);
    return crypto.subtle.importKey(
      "raw",
      toArrayBuffer(raw),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
  }
  const raw = crypto.getRandomValues(new Uint8Array(32));
  await idbSet(LOCAL_AES_KEY_IDB_KEY, bytesToB64(raw));
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(raw),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function localEncryptStringAtRest(plaintext: string): Promise<LocalAesBlobV1> {
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

export async function localDecryptStringAtRest(blob: LocalAesBlobV1): Promise<string> {
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

export async function wipeLocalAtRestKey(): Promise<void> {
  await idbDel(LOCAL_AES_KEY_IDB_KEY);
}