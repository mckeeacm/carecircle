// lib/crypto.ts
const enc = new TextEncoder();
const dec = new TextDecoder();

type NumArray = number[];
type B64 = string;

type PayloadLike =
  | { iv: NumArray; data: NumArray }
  | { iv: NumArray; ct: NumArray }
  | { iv: B64; data: B64 }
  | { iv: B64; ct: B64 }
  | string
  | null
  | undefined;

const ENC_PREFIX = "enc:v1:";

// --- WebCrypto TS typing helper ---
// Ensures we pass a REAL ArrayBuffer (not ArrayBufferLike / SharedArrayBuffer typing)
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// --- base64 helpers (browser) ---
function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function isNumArray(v: any): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

function isB64String(v: any): v is string {
  return typeof v === "string" && v.length > 0;
}

export async function derivePatientKey(patientId: string, serverSalt: string): Promise<CryptoKey> {
  const saltBytes = enc.encode(serverSalt);
  const patientBytes = enc.encode(patientId);
  const infoBytes = enc.encode("carecircle-patient-v1");

  const baseKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(saltBytes),
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(patientBytes),
      info: toArrayBuffer(infoBytes),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts to the SAME object shape you had before:
 * { iv: number[], data: number[] }
 *
 * (Optional helper) If you want to store as a string, call encryptTextEnvelope().
 */
export async function encryptText(key: CryptoKey, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plainBytes = enc.encode(text);

  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    toArrayBuffer(plainBytes)
  );

  return {
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(cipher)),
  };
}

/**
 * Optional: encrypt into a compact string envelope: "enc:v1:<b64(json)>"
 * This is easier to store in text columns.
 */
export async function encryptTextEnvelope(key: CryptoKey, text: string): Promise<string> {
  const obj = await encryptText(key, text);
  const json = JSON.stringify({
    v: 1,
    iv: bytesToB64(new Uint8Array(obj.iv)),
    data: bytesToB64(new Uint8Array(obj.data)),
  });
  const packed = bytesToB64(enc.encode(json));
  return `${ENC_PREFIX}${packed}`;
}

/**
 * Decrypts multiple payload shapes safely.
 * - Accepts your original {iv:number[], data:number[]}
 * - Accepts base64 forms {iv:string, data:string} or {iv:string, ct:string}
 * - Accepts "enc:v1:<b64json>" envelope string
 * - Accepts plaintext string/null/undefined (returns as-is)
 *
 * It will NOT throw (so UI won't crash).
 */
export async function decryptText(key: CryptoKey, payload: PayloadLike): Promise<string | null> {
  if (payload === null || payload === undefined) return null;

  // Plain string: could be envelope OR plaintext
  if (typeof payload === "string") {
    if (!payload.startsWith(ENC_PREFIX)) return payload;

    const b64 = payload.slice(ENC_PREFIX.length);
    const json = dec.decode(b64ToBytes(b64));
    const parsed = safeJsonParse<any>(json);
    if (!parsed) return payload;

    // normalize envelope payload into object handling below
    payload = parsed;
  }

  // At this point payload should be an object-like
  const any = payload as any;

  // Allow either "data" or "ct"
  const dataField = any?.data ?? any?.ct;
  const ivField = any?.iv;

  let ivBytes: Uint8Array | null = null;
  let dataBytes: Uint8Array | null = null;

  // iv
  if (isNumArray(ivField)) ivBytes = new Uint8Array(ivField);
  else if (isB64String(ivField)) ivBytes = b64ToBytes(ivField);

  // ciphertext
  if (isNumArray(dataField)) dataBytes = new Uint8Array(dataField);
  else if (isB64String(dataField)) dataBytes = b64ToBytes(dataField);

  // If we couldn't normalize, return something safe
  if (!ivBytes || !dataBytes) {
    try {
      return typeof payload === "object" ? JSON.stringify(payload) : String(payload);
    } catch {
      return null;
    }
  }

  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(ivBytes) },
      key,
      toArrayBuffer(dataBytes)
    );
    return dec.decode(plain);
  } catch {
    // key mismatch, corrupted data, or different derived key
    // return the original (best-effort) without crashing UI
    try {
      return typeof payload === "object" ? JSON.stringify(payload) : String(payload);
    } catch {
      return null;
    }
  }
}
