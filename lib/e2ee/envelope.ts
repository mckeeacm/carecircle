export type CipherEnvelopeV1 = {
  v: 1;
  alg: "xchacha20poly1305_ietf";
  nonce_b64: string;
  ct_b64: string;
  aad?: Record<string, unknown>;
};

export function isCipherEnvelopeV1(x: any): x is CipherEnvelopeV1 {
  return (
    x &&
    x.v === 1 &&
    x.alg === "xchacha20poly1305_ietf" &&
    typeof x.nonce_b64 === "string" &&
    typeof x.ct_b64 === "string"
  );
}