import { getSodium } from "./sodium";
import { idbGet, idbSet } from "./idb";

const DEVICE_KEYPAIR_ID = "cc_device_keypair_v1";

type StoredKeypairV1 = {
  v: 1;
  alg: "curve25519";
  public_key_b64: string;
  private_key_b64: string; // encrypted at rest is better; but we’ll keep it local and wrap with local AES next
};

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

export async function getOrCreateDeviceKeypair(): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  const existing = await idbGet<StoredKeypairV1>(DEVICE_KEYPAIR_ID);
  if (existing?.v === 1 && existing.alg === "curve25519") {
    return {
      publicKey: b64ToBytes(existing.public_key_b64),
      privateKey: b64ToBytes(existing.private_key_b64),
    };
  }

  const sodium = await getSodium();
  const kp = sodium.crypto_box_keypair(); // Curve25519 keypair for crypto_box / crypto_box_seal

  const stored: StoredKeypairV1 = {
    v: 1,
    alg: "curve25519",
    public_key_b64: bytesToB64(kp.publicKey),
    private_key_b64: bytesToB64(kp.privateKey),
  };

  await idbSet(DEVICE_KEYPAIR_ID, stored);

  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}