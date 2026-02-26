"use client";

import { useEffect, useState } from "react";
import type { CipherEnvelopeV1 } from "./envelope";
import { decryptStringWithLocalCache } from "./decryptWithCache";

export function useDecryptedField(params: {
  patientId: string;
  table: string;
  rowId: string;
  column: string;
  env: CipherEnvelopeV1 | null | undefined;
  vaultKey: Uint8Array | null; // provide from your vault key resolver
}) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setError(null);

      if (!params.env) {
        setValue(null);
        return;
      }
      if (!params.vaultKey) {
        setValue(null);
        setError("missing_vault_key");
        return;
      }

      setLoading(true);
      try {
        const pt = await decryptStringWithLocalCache({
          patientId: params.patientId,
          table: params.table,
          rowId: params.rowId,
          column: params.column,
          env: params.env,
          vaultKey: params.vaultKey,
        });
        if (!cancelled) setValue(pt);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "decrypt_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // We intentionally key off ciphertext; if it changes, hook re-runs automatically.
  }, [params.patientId, params.table, params.rowId, params.column, params.env?.nonce_b64, params.env?.ct_b64, params.vaultKey]);

  return { value, error, loading };
}