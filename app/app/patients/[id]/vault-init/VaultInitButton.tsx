"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { wrapVaultKeyForRecipient } from "@/lib/e2ee/vaultShares";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";

type Props = {
  pid: string; // circle context id
  disabled?: boolean;
};

// Base64 helpers (stable, explicit)
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export default function VaultInitButton({ pid, disabled }: Props) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const [clicks, setClicks] = useState(0);

  const [uid, setUid] = useState<string>("");
  const [hasMyPublicKey, setHasMyPublicKey] = useState<boolean | null>(null);

  function debugLog(line: string) {
    setDebug((prev) => [...prev, `[${new Date().toISOString()}] ${line}`]);
  }

  // Most secure behaviour: explicitly ensure current user has a registered public key
  // before allowing vault operations. We DO NOT generate server-side. We generate local.
  async function checkMyPublicKey(currentUserId: string) {
    const { data, error } = await supabase
      .from("user_public_keys")
      .select("user_id")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (error) throw error;
    return !!data;
  }

  async function registerMyPublicKey(currentUserId: string) {
    // Generate / load local device keypair (secret stays local in your decrypt store)
    // Assumption: getOrCreateDeviceKeypair returns { publicKey: Uint8Array, secretKey: Uint8Array }
    // If your lib returns a different shape, adjust *inside this function only*.
    const kp: any = await getOrCreateDeviceKeypair();

    const publicKeyBytes: Uint8Array =
      kp?.publicKey ?? kp?.public_key ?? kp?.public ?? kp?.pk;

    if (!publicKeyBytes || !(publicKeyBytes instanceof Uint8Array)) {
      throw new Error("device_keypair_missing_public_key");
    }

    const public_key = bytesToBase64(publicKeyBytes);

    // Write ONLY the public key. Upsert is safest to avoid duplicates.
    // Keep labels: user_id, public_key, algorithm
    const { error } = await supabase.from("user_public_keys").upsert(
      {
        user_id: currentUserId,
        public_key,
        algorithm: "x25519-xsalsa20-poly1305",
      },
      { onConflict: "user_id" }
    );

    if (error) throw error;
  }

  // On mount: get auth user + check if public key exists
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setMsg(null);
      setDebug([]);
      try {
        debugLog("Boot: fetching auth user...");
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;

        const id = data?.user?.id ?? "";
        if (!id) {
          if (!cancelled) {
            setUid("");
            setHasMyPublicKey(false);
          }
          debugLog("Boot: not authenticated");
          return;
        }

        if (!cancelled) setUid(id);

        debugLog("Boot: checking if user_public_keys exists for current user...");
        const ok = await checkMyPublicKey(id);
        if (!cancelled) setHasMyPublicKey(ok);

        debugLog(`Boot: my public key present = ${String(ok)}`);
      } catch (e: any) {
        debugLog(`Boot FAILED: ${e?.message ?? "boot_failed"}`);
        if (!cancelled) setHasMyPublicKey(false);
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function setupMyKeys() {
    setBusy(true);
    setMsg(null);
    setDebug([]);
    debugLog("CLICKED: setup device keys / register public key");

    try {
      if (!uid) throw new Error("not_authenticated");

      debugLog("Registering public key in user_public_keys (local keypair)...");
      await registerMyPublicKey(uid);

      debugLog("Re-checking public key presence...");
      const ok = await checkMyPublicKey(uid);
      setHasMyPublicKey(ok);

      if (!ok) throw new Error("public_key_registration_failed");
      setMsg("Device keys set up. Public key registered.");
      debugLog("SUCCESS: public key registered");
    } catch (e: any) {
      const m = e?.message ?? "failed_to_setup_device_keys";
      setMsg(m);
      debugLog(`FAILED: ${m}`);
    } finally {
      setBusy(false);
    }
  }

  async function initVault() {
    setClicks((c) => c + 1);
    setBusy(true);
    setMsg(null);
    setDebug([]);
    debugLog("CLICKED: initialise vault");

    try {
      if (!pid) throw new Error("missing_pid");
      if (!uid) throw new Error("not_authenticated");

      // Security gate: must have my public key registered
      if (hasMyPublicKey !== true) {
        throw new Error("missing_my_public_key_setup");
      }

      // 1) Must be controller (RPC key MUST be pid)
      debugLog(`RPC is_patient_controller payload: {"pid":"${pid}"}`);
      const { data: isCtl, error: ctlErr } = await supabase.rpc("is_patient_controller", {
        pid,
      });
      if (ctlErr) throw ctlErr;
      debugLog(`Controller check result: ${String(isCtl)}`);
      if (!isCtl) throw new Error("not_controller");

      // 2) Fetch members in this circle
      debugLog("Fetching patient_members...");
      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      if (memErr) throw memErr;

      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
      debugLog(`Found members: ${userIds.length}`);
      if (userIds.length === 0) throw new Error("no_members_found");

      // 3) Fetch public keys for all members
      debugLog("Fetching user_public_keys for members...");
      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) throw pkErr;

      const pubKeyRows = pubKeys ?? [];
      debugLog(`Found public keys: ${pubKeyRows.length}`);

      // Security gate: everyone must have a public key (no skipping)
      const missing = userIds.filter(
        (memberId) => !pubKeyRows.some((p: any) => p.user_id === memberId)
      );
      if (missing.length > 0) {
        debugLog(`FAILED: missing_public_keys_for_${missing.length}_members`);
        throw new Error(`missing_public_keys_for_${missing.length}_members`);
      }

      // 4) Create vault key (32 bytes)
      debugLog("Generating vault key (32 bytes)...");
      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      // 5) Replace shares for these users (your current behaviour)
      // Security note: destructive. We keep it because you already use it.
      debugLog("Deleting existing patient_vault_shares for these users...");
      const { error: delErr } = await supabase
        .from("patient_vault_shares")
        .delete()
        .eq("patient_id", pid)
        .in("user_id", userIds);
      if (delErr) throw delErr;

      // 6) Wrap vault key for each member
      debugLog("Wrapping vault key for each member...");
      const rows = await Promise.all(
        pubKeyRows.map(async (p: any) => {
          const recipientPk = base64ToBytes(p.public_key);

          const wrapped = await wrapVaultKeyForRecipient({
            vaultKey,
            recipientPublicKey: recipientPk,
          });

          return {
            patient_id: pid,
            user_id: p.user_id,
            wrapped_key: wrapped,
          };
        })
      );

      debugLog(`Inserting ${rows.length} patient_vault_shares row(s)...`);
      const { error: insErr } = await supabase.from("patient_vault_shares").insert(rows);
      if (insErr) throw insErr;

      setMsg("Vault initialised. Members can now decrypt encrypted content.");
      debugLog("SUCCESS: vault initialised");
    } catch (e: any) {
      const m = e?.message ?? "failed_to_initialise_vault";
      setMsg(m);
      debugLog(`FAILED: ${m}`);
    } finally {
      setBusy(false);
    }
  }

  const canInit =
    !disabled &&
    !!pid &&
    !!uid &&
    hasMyPublicKey === true &&
    !busy;

  return (
    <div>
      <div style={{ marginBottom: 10, fontSize: 13, opacity: 0.9 }}>
        <div>
          Current user: <code>{uid || "(not authenticated)"}</code>
        </div>
        <div>
          Public key registered:{" "}
          <code>
            {hasMyPublicKey === null ? "checking…" : hasMyPublicKey ? "yes" : "no"}
          </code>
        </div>
      </div>

      {hasMyPublicKey === false && (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid #e5e5e5",
            background: "rgba(255, 200, 0, 0.08)",
            marginBottom: 12,
          }}
        >
          <div style={{ marginBottom: 8, fontWeight: 700 }}>
            Device keys required
          </div>
          <div style={{ marginBottom: 10, fontSize: 13 }}>
            To keep end-to-end encryption intact, your device must generate keys locally and
            register a public key before vault access can be granted.
          </div>
          <button
            type="button"
            onClick={setupMyKeys}
            disabled={busy || !uid}
            style={{
              padding: 10,
              border: "1px solid #ccc",
              borderRadius: 8,
              opacity: busy || !uid ? 0.6 : 1,
              cursor: busy || !uid ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Setting up…" : "Set up device keys"}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={initVault}
        disabled={!canInit}
        style={{
          padding: 10,
          border: "1px solid #ccc",
          borderRadius: 8,
          opacity: !canInit ? 0.6 : 1,
          cursor: !canInit ? "not-allowed" : "pointer",
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
          maxHeight: 300,
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {debug.length ? debug.join("\n") : "Debug log will appear here."}
      </div>
    </div>
  );
}