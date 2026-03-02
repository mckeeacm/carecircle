"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { wrapVaultKeyForRecipient } from "@/lib/e2ee/vaultShares";
import { getSodium } from "@/lib/e2ee/sodium";

type Props = {
  patientId: string;
  disabled?: boolean;
};

export default function VaultInitButton({ patientId, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const [clicks, setClicks] = useState(0);

  function debugLog(line: string) {
    setDebug((prev) => [...prev, `[${new Date().toISOString()}] ${line}`]);
  }

  async function initVault() {
    setClicks((c) => c + 1);
    setBusy(true);
    setMsg(null);
    setDebug([]);
    debugLog("CLICKED initialise");

    const supabase = supabaseBrowser();

    try {
      if (!patientId) throw new Error("missing_patient_id");

      // ✅ Controller check: use the 1-arg function ONLY
      // ✅ RPC payload key MUST match SQL param name exactly: pid
      debugLog(`RPC is_patient_controller payload: {"pid":"${patientId}"}`);
      const { data: isCtl, error: ctlErr } = await supabase.rpc(
        "is_patient_controller",
        { pid: patientId }
      );

      if (ctlErr) {
        debugLog(`Controller check error: ${ctlErr.message}`);
        // ts-expect-error supabase may include extra error fields
        debugLog(
          `Meta: code=${ctlErr.code ?? "n/a"} details=${ctlErr.details ?? "n/a"} hint=${ctlErr.hint ?? "n/a"}`
        );
        throw ctlErr;
      }

      debugLog(`Controller check result: ${String(isCtl)}`);
      if (!isCtl) throw new Error("not_controller");

      // 2) Fetch members
      debugLog("Fetching patient_members...");
      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", patientId);

      if (memErr) {
        debugLog(`patient_members error: ${memErr.message}`);
        throw memErr;
      }

      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
      debugLog(`Found members: ${userIds.length}`);
      if (userIds.length === 0) throw new Error("no_members_found");

      // 3) Fetch public keys for members
      debugLog("Fetching user_public_keys...");
      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) {
        debugLog(`user_public_keys error: ${pkErr.message}`);
        throw pkErr;
      }

      const pubKeyRows = pubKeys ?? [];
      debugLog(`Found public keys: ${pubKeyRows.length}`);

      const missing = userIds.filter(
        (uid) => !pubKeyRows.some((p: any) => p.user_id === uid)
      );
      if (missing.length > 0) {
        throw new Error(`missing_public_keys_for_${missing.length}_members`);
      }

      // 4) Create vault key (32 bytes)
      debugLog("Generating vault key (32 bytes)...");
      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      // 5) Replace shares for these users (your current behaviour)
      debugLog("Deleting existing patient_vault_shares for these users...");
      const { error: delErr } = await supabase
        .from("patient_vault_shares")
        .delete()
        .eq("patient_id", patientId)
        .in("user_id", userIds);

      if (delErr) {
        debugLog(`Delete shares error: ${delErr.message}`);
        throw delErr;
      }

      debugLog("Wrapping vault key for each member...");
      const rows = await Promise.all(
        pubKeyRows.map(async (p: any) => {
          const recipientPk = Uint8Array.from(atob(p.public_key), (c) =>
            c.charCodeAt(0)
          );

          const wrapped = await wrapVaultKeyForRecipient({
            vaultKey,
            recipientPublicKey: recipientPk,
          });

          return {
            patient_id: patientId,
            user_id: p.user_id,
            wrapped_key: wrapped, // jsonb envelope
          };
        })
      );

      debugLog(`Inserting ${rows.length} vault shares...`);
      const { error: insErr } = await supabase
        .from("patient_vault_shares")
        .insert(rows);

      if (insErr) {
        debugLog(`Insert shares error: ${insErr.message}`);
        throw insErr;
      }

      setMsg("Vault initialised. Members can now decrypt encrypted content.");
      debugLog("SUCCESS");
    } catch (e: any) {
      const m = e?.message ?? "failed_to_initialise_vault";
      setMsg(m);
      debugLog(`FAILED: ${m}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={initVault}
        disabled={disabled || busy}
        style={{
          padding: 10,
          border: "1px solid #ccc",
          borderRadius: 8,
          opacity: disabled || busy ? 0.6 : 1,
          cursor: disabled || busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Initialising…" : "Initialise encrypted vault for this circle"}
      </button>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
        Clicks registered: <code>{clicks}</code>
      </div>

      {msg && <p style={{ marginTop: 8 }}>{msg}</p>}

      <div
        id="debug"
        style={{
          marginTop: 12,
          padding: 12,
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          background: "rgba(0,0,0,0.02)",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          maxHeight: 280,
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {debug.length ? debug.join("\n") : "Debug log will appear here."}
      </div>
    </div>
  );
}