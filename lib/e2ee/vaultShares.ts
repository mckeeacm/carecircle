import { getSodium } from "./sodium";

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type WrappedKeyV1 = {
  v: 1;
  alg: "crypto_box_seal";
  wrapped_key_b64: string;
};

export async function wrapVaultKeyForRecipient(params: {
  vaultKey: Uint8Array;        // 32 bytes
  recipientPublicKey: Uint8Array;
}): Promise<WrappedKeyV1> {
  const sodium = await getSodium();
  const wrapped = sodium.crypto_box_seal(params.vaultKey, params.recipientPublicKey);
  return { v: 1, alg: "crypto_box_seal", wrapped_key_b64: bytesToB64(wrapped) };
}

export async function unwrapVaultKeyForMe(params: {
  wrapped: WrappedKeyV1;
  myPublicKey: Uint8Array;
  myPrivateKey: Uint8Array;
}): Promise<Uint8Array> {
  const sodium = await getSodium();
  if (params.wrapped.v !== 1 || params.wrapped.alg !== "crypto_box_seal") {
    throw new Error("unsupported_wrapped_key_format");
  }
  const ct = b64ToBytes(params.wrapped.wrapped_key_b64);
  const pt = sodium.crypto_box_seal_open(ct, params.myPublicKey, params.myPrivateKey);
  return pt; // 32-byte vault key
}