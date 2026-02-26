"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getOrCreateDeviceKeypair } from "./deviceKeys";
import { unwrapVaultKeyForMe } from "./vaultShares";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function usePatientVaultKey(patientId: string) {
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const supabase = supabaseBrowser();
        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;
        if (!user) throw new Error("not_authenticated");

        const { data: share, error: shareErr } = await supabase
          .from("patient_vault_shares")
          .select("wrapped_key")
          .eq("patient_id", patientId)
          .eq("user_id", user.id)
          .single();

        if (shareErr) throw shareErr;
        if (!share?.wrapped_key) throw new Error("no_vault_share");

        const { publicKey, privateKey } = await getOrCreateDeviceKeypair();

        const vk = await unwrapVaultKeyForMe({
          wrapped: share.wrapped_key,
          myPublicKey: publicKey,
          myPrivateKey: privateKey,
        });

        if (!cancelled) setVaultKey(vk);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "vault_error");
      }
    }

    load();
    return () => { cancelled = true; };
  }, [patientId]);

  return { vaultKey, error };
}