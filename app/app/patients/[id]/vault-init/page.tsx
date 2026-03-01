// /app/patients/[id]/vault-init/page.tsx
"use client";

import { useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { wrapVaultKeyForRecipient } from "@/lib/e2ee/vaultShares";

type PageProps = {
  params: { id: string };
};

export default function VaultInitPage({ params }: PageProps) {
  // Route is /patients/[id]/vault-init, and [id] is your circle context id.
  // We keep DB column names as-is (patient_id) but RPC payload key MUST match SQL param name (pid).
  const pid = useMemo(() => params?.id ?? "", [params?.id]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);

  function debugLog(line: string) {
    setDebug((prev) => [...prev, `[${new Date().toISOString()}] ${line}`]);
  }

  async function initVault() {
    setBusy(true);
    setMsg(null);
    setDebug([]);

    const supabase = supabaseBrowser();

    try {
      if (!pid) throw new Error("missing_pid_from_route");
      debugLog(`Starting vault init for pid=${pid}`);

      // 1) Must be controller (RPC key MUST be "pid" to match SQL param name exactly)
      debugLog(`RPC is_patient_controller payload: {"pid":"${pid}"}`);
      const { data: isCtl, error: ctlErr } = await supabase.rpc("is_patient_controller", {
        pid, // ✅ DO NOT change this key. This must match the SQL function parameter name.
      });

      if (ctlErr) {
        debugLog(`Controller check error: ${ctlErr.message}`);
        // Helpful details if available
        // ts-expect-error Supabase error often has details/hint/code
        debugLog(`Controller check meta: code=${ctlErr.code ?? "n/a"} details=${ctlErr.details ?? "n/a"} hint=${ctlErr.hint ?? "n/a"}`);
        throw ctlErr;
      }

      debugLog(`Controller check result: ${String(isCtl)}`);
      if (!isCtl) throw new Error("not_controller");

      // 2) Fetch members in this circle
      debugLog("Fetching patient_members...");
      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

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

      // Ensure everyone has a pubkey
      const missing = userIds.filter((uid) => !pubKeyRows.some((p: any) => p.user_id === uid));
      if (missing.length > 0) {
        debugLog(`Missing public keys for ${missing.length} member(s)`);
        throw new Error(`missing_public_keys_for_${missing.length}_members`);
      }

      // 4) Create vault key (32 bytes)
      debugLog("Generating vault key (32 bytes)...");
      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      // 5) Wrap vault key for each member and write shares
      // NOTE: This delete+insert is your current behaviour. It’s stable but destructive.
      // If you later want a safer approach (upsert per member / only if no shares), do it deliberately.
      debugLog("Deleting existing patient_vault_shares for these users...");
      const { error: delErr } = await supabase
        .from("patient_vault_shares")
        .delete()
        .eq("patient_id", pid)
        .in("user_id", userIds);

      if (delErr) {
        debugLog(`Delete shares error: ${delErr.message}`);
        throw delErr;
      }

      debugLog("Wrapping vault key for each member...");
      const rows = await Promise.all(
        pubKeyRows.map(async (p: any) => {
          // public_key stored base64 -> Uint8Array
          const recipientPk = Uint8Array.from(atob(p.public_key), (c) => c.charCodeAt(0));

          const wrapped = await wrapVaultKeyForRecipient({
            vaultKey,
            recipientPublicKey: recipientPk,
          });

          return {
            patient_id: pid, // DB column stays patient_id (no drift)
            user_id: p.user_id,
            wrapped_key: wrapped, // jsonb envelope (your existing shape)
          };
        })
      );

      debugLog(`Inserting ${rows.length} vault share row(s)...`);
      const { error: insErr } = await supabase.from("patient_vault_shares").insert(rows);
      if (insErr) {
        debugLog(`Insert shares error: ${insErr.message}`);
        throw insErr;
      }

      setMsg("Vault initialised. Members can now decrypt encrypted content.");
      debugLog("Vault init complete.");
    } catch (e: any) {
      const message = e?.message ?? "failed_to_initialise_vault";
      setMsg(message);
      debugLog(`FAILED: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Vault Initialisation</h1>

      <p style={{ marginBottom: 12, opacity: 0.85 }}>
        Circle ID (pid): <code>{pid}</code>
      </p>

      <button
        onClick={initVault}
        disabled={busy || !pid}
        style={{
          padding: "10px 12px",
          border: "1px solid #ccc",
          borderRadius: 10,
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Initialising…" : "Initialise encrypted vault for this circle"}
      </button>

      {msg && (
        <p style={{ marginTop: 12, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}>
          {msg}
        </p>
      )}

      {/* Visible debug area (kiosk-friendly) */}
      <div
        id="debug"
        style={{
          marginTop: 16,
          padding: 12,
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          background: "rgba(0,0,0,0.02)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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