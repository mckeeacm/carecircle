"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";
import { wrapVaultKeyForRecipient } from "@/lib/e2ee/vaultShares";
import { getSodium } from "@/lib/e2ee/sodium";

type Props = { patientId: string };

export default function VaultInitButton({ patientId }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function initVault() {
    setBusy(true);
    setMsg(null);

    const supabase = supabaseBrowser();

    try {
      // 1) Must be controller
      const { data: isCtl, error: ctlErr } = await supabase.rpc("is_patient_controller", {
        pid: patientId,
      });
      if (ctlErr) throw ctlErr;
      if (!isCtl) throw new Error("not_controller");

      // 2) Fetch members
      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", patientId);
      if (memErr) throw memErr;
      const userIds = (members ?? []).map((m: any) => m.user_id);

      if (userIds.length === 0) throw new Error("no_members_found");

      // 3) Fetch public keys for members
      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);
      if (pkErr) throw pkErr;

      // Ensure everyone has a pubkey
      const missing = userIds.filter(
        (uid) => !(pubKeys ?? []).some((p: any) => p.user_id === uid)
      );
      if (missing.length > 0) {
        throw new Error(`missing_public_keys_for_${missing.length}_members`);
      }

      // 4) Create vault key
      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      // 5) Wrap vault key for each member and write shares
      // First delete existing shares for these users (clean)
      const { error: delErr } = await supabase
        .from("patient_vault_shares")
        .delete()
        .eq("patient_id", patientId)
        .in("user_id", userIds);
      if (delErr) throw delErr;

      const rows = await Promise.all(
        (pubKeys ?? []).map(async (p: any) => {
          // public_key is text (we store base64)
          const recipientPk = Uint8Array.from(atob(p.public_key), (c) => c.charCodeAt(0));
          const wrapped = await wrapVaultKeyForRecipient({
            vaultKey,
            recipientPublicKey: recipientPk,
          });

          return {
            patient_id: patientId,
            user_id: p.user_id,
            wrapped_key: wrapped, // jsonb
          };
        })
      );

      const { error: insErr } = await supabase.from("patient_vault_shares").insert(rows);
      if (insErr) throw insErr;

      setMsg("Vault initialised. Members can now decrypt encrypted content.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_initialise_vault");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={initVault}
        disabled={busy}
        style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
      >
        {busy ? "Initialising…" : "Initialise encrypted vault for this patient"}
      </button>
      {msg && <p style={{ marginTop: 8 }}>{msg}</p>}
    </div>
  );
}