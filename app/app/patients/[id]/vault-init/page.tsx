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
  const pid = useMemo(() => params?.id ?? "", [params?.id]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const [clicks, setClicks] = useState(0);

  function debugLog(line: string) {
    setDebug((prev) => [...prev, `[${new Date().toISOString()}] ${line}`]);
  }

  async function initVaultCore() {
    const supabase = supabaseBrowser();

    if (!pid) throw new Error("missing_pid_from_route");

    // 1) Must be controller — RPC payload key MUST be "pid"
    debugLog(`RPC is_patient_controller payload: {"pid":"${pid}"}`);
    const { data: isCtl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid });

    if (ctlErr) {
      debugLog(`Controller check error: ${ctlErr.message}`);
      // ts-expect-error supabase error may have extra fields
      debugLog(
        `Controller meta: code=${ctlErr.code ?? "n/a"} details=${ctlErr.details ?? "n/a"} hint=${ctlErr.hint ?? "n/a"}`
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
      .eq("patient_id", pid);

    if (memErr) {
      debugLog(`patient_members error: ${memErr.message}`);
      throw memErr;
    }

    const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
    debugLog(`Found members: ${userIds.length}`);
    if (userIds.length === 0) throw new Error("no_members_found");

    // 3) Fetch public keys
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

    const missing = userIds.filter((uid) => !pubKeyRows.some((p: any) => p.user_id === uid));
    if (missing.length > 0) throw new Error(`missing_public_keys_for_${missing.length}_members`);

    // 4) Create vault key
    debugLog("Generating vault key (32 bytes)...");
    const sodium = await getSodium();
    const vaultKey = sodium.randombytes_buf(32);

    // 5) Delete existing shares for these users (your current behaviour)
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
        const recipientPk = Uint8Array.from(atob(p.public_key), (c) => c.charCodeAt(0));
        const wrapped = await wrapVaultKeyForRecipient({
          vaultKey,
          recipientPublicKey: recipientPk,
        });

        return {
          patient_id: pid, // DB column stays patient_id
          user_id: p.user_id,
          wrapped_key: wrapped, // jsonb
        };
      })
    );

    debugLog(`Inserting ${rows.length} patient_vault_shares row(s)...`);
    const { error: insErr } = await supabase.from("patient_vault_shares").insert(rows);
    if (insErr) {
      debugLog(`Insert shares error: ${insErr.message}`);
      throw insErr;
    }

    debugLog("Vault init complete.");
  }

  async function onInitClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault(); // protects against accidental form submit contexts
    setClicks((c) => c + 1);

    // These should appear even if everything else fails
    setMsg(null);
    setDebug([]);
    debugLog("CLICKED initialise button");
    debugLog(`pid from route params.id = "${pid || ""}"`);

    if (busy) {
      debugLog("Ignored click: already busy");
      return;
    }

    // If pid missing, show it clearly (this is the #1 reason “nothing happens”)
    if (!pid) {
      setMsg("missing_pid_from_route (route param [id] not detected)");
      debugLog("Button would be disabled in normal mode because pid is empty.");
      return;
    }

    setBusy(true);
    try {
      await initVaultCore();
      setMsg("Vault initialised. Members can now decrypt encrypted content.");
    } catch (err: any) {
      const message = err?.message ?? "failed_to_initialise_vault";
      setMsg(message);
      debugLog(`FAILED: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  const disabledReason = busy ? "busy" : !pid ? "missing pid" : null;

  return (
    <div style={{ padding: 16, maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Vault Initialisation</h1>

      <div style={{ marginBottom: 12, opacity: 0.9 }}>
        <div>
          Route pid: <code>{pid || "(empty)"}</code>
        </div>
        <div>
          Clicks registered: <code>{clicks}</code>
        </div>
        <div>
          Button state:{" "}
          <code>{disabledReason ? `disabled (${disabledReason})` : "enabled"}</code>
        </div>
      </div>

      <button
        type="button"
        onClick={onInitClick}
        disabled={!!disabledReason}
        style={{
          padding: "10px 12px",
          border: "1px solid #ccc",
          borderRadius: 10,
          cursor: disabledReason ? "not-allowed" : "pointer",
          opacity: disabledReason ? 0.6 : 1,
        }}
      >
        {busy ? "Initialising…" : "Initialise encrypted vault for this circle"}
      </button>

      {msg && (
        <p style={{ marginTop: 12, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}>
          {msg}
        </p>
      )}

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
          maxHeight: 320,
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {debug.length ? debug.join("\n") : "Debug log will appear here."}
      </div>
    </div>
  );
}