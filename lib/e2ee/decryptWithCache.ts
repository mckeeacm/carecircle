import type { CipherEnvelopeV1 } from "./envelope";
import { makeCacheKey, cacheGetPlaintext, cacheSetPlaintext } from "./localDecryptStore";
import { vaultDecryptString } from "./vaultCrypto";

export async function decryptStringWithLocalCache(params: {
  patientId: string;
  table: string;
  rowId: string;
  column: string;
  env: CipherEnvelopeV1;
  vaultKey: Uint8Array; // from patient_vault_shares unwrap
}): Promise<string> {
  const cacheKey = await makeCacheKey({
    patientId: params.patientId,
    table: params.table,
    rowId: params.rowId,
    column: params.column,
    env: params.env,
  });

  const cached = await cacheGetPlaintext(cacheKey);
  if (cached !== null) return cached;

  const plaintext = await vaultDecryptString({ vaultKey: params.vaultKey, env: params.env });
  await cacheSetPlaintext(cacheKey, plaintext);
  return plaintext;
}