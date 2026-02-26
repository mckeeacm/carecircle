import type { CipherEnvelopeV1 } from "./envelope";
import { getSodium } from "./sodium";

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

/**
 * Encrypt plaintext using patient vault key (32 bytes) with XChaCha20-Poly1305 IETF.
 * AAD (optional) binds context but is not secret.
 */
export async function vaultEncryptString(params: {
  vaultKey: Uint8Array; // 32 bytes
  plaintext: string;
  aad?: Record<string, unknown>;
}): Promise<CipherEnvelopeV1> {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const msg = new TextEncoder().encode(params.plaintext);
  const aadBytes = params.aad ? new TextEncoder().encode(JSON.stringify(params.aad)) : null;

  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    msg,
    aadBytes,
    null,
    nonce,
    params.vaultKey
  );

  return {
    v: 1,
    alg: "xchacha20poly1305_ietf",
    nonce_b64: bytesToB64(nonce),
    ct_b64: bytesToB64(ct),
    aad: params.aad,
  };
}

export async function vaultDecryptString(params: {
  vaultKey: Uint8Array;
  env: CipherEnvelopeV1;
}): Promise<string> {
  const sodium = await getSodium();
  const nonce = b64ToBytes(params.env.nonce_b64);
  const ct = b64ToBytes(params.env.ct_b64);
  const aadBytes = params.env.aad ? new TextEncoder().encode(JSON.stringify(params.env.aad)) : null;

  const pt = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ct,
    aadBytes,
    nonce,
    params.vaultKey
  );

  return new TextDecoder().decode(pt);
}