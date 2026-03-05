"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { wrapVaultKeyForRecipient } from "@/lib/e2ee/vaultShares";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";

type Props = {
  pid: string;
  disabled?: boolean;
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export default function VaultInitButton({ pid, disabled }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<
    "checking" | "needs_keys" | "ready" | "initialising" | "done" | "error"
  >("checking");

  const [uid, setUid] = useState("");
  const [message, setMessage] = useState("");

  async function hasPublicKey(userId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("user_public_keys")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    return !!data;
  }

  async function registerPublicKey(userId: string) {
    const kp: any = await getOrCreateDeviceKeypair();

    const publicKeyBytes: Uint8Array = kp?.publicKey ?? kp?.public_key ?? kp?.pk;

    if (!publicKeyBytes || !(publicKeyBytes instanceof Uint8Array)) {
      throw new Error("device_keypair_missing_public_key");
    }

    const public_key = bytesToBase64(publicKeyBytes);

    const { error } = await supabase.from("user_public_keys").upsert(
      {
        user_id: userId,
        public_key,
        algorithm: "crypto_box_seal",
      },
      { onConflict: "user_id" }
    );

    if (error) throw error;
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        // IMPORTANT: do NOT hard-error if pid is temporarily missing.
        // Wait for pid to exist (common during hydration / suspense boundaries).
        if (disabled) {
          setStatus("error");
          setMessage("This action is currently disabled.");
          return;
        }

        if (!pid) {
          setStatus("checking");
          setMessage("");
          return;
        }

        setStatus("checking");
        setMessage("");

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const user = data.session?.user;
        if (!user?.id) {
          setStatus("error");
          setMessage("Please sign in.");
          return;
        }

        if (cancelled) return;

        setUid(user.id);

        const ok = await hasPublicKey(user.id);
        if (cancelled) return;

        setStatus(ok ? "ready" : "needs_keys");
      } catch (e: any) {
        if (cancelled) return;
        setStatus("error");
        setMessage(e?.message ?? "Vault setup failed.");
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, [pid, disabled, supabase]);

  async function onSetupKeys() {
    setBusy(true);
    setMessage("");

    try {
      if (!pid) throw new Error("missing_pid");
      if (!uid) throw new Error("not_authenticated");

      await registerPublicKey(uid);

      setStatus("ready");
      setMessage("Device keys set up successfully.");
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message ?? "Failed to set up keys.");
    } finally {
      setBusy(false);
    }
  }

  async function onInitialiseVault() {
    setBusy(true);
    setStatus("initialising");
    setMessage("");

    try {
      if (!pid) throw new Error("missing_pid");

      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;

      const me = sessionData.session?.user;
      if (!me?.id) throw new Error("not_authenticated");
      setUid(me.id);

      const { data: isCtl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid });
      if (ctlErr) throw ctlErr;

      if (!isCtl) throw new Error("Only a controller can initialise the vault.");

      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      if (memErr) throw memErr;

      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
      if (userIds.length === 0) throw new Error("No circle members found.");

      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) throw pkErr;

      const missing = userIds.filter((u) => !pubKeys?.some((p: any) => p.user_id === u));
      if (missing.length) {
        throw new Error(`${missing.length} member(s) must enable E2EE before vault sharing.`);
      }

      const incompatible = (pubKeys ?? []).filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (incompatible.length) {
        throw new Error("Some members have incompatible key algorithms. Ask them to re-enable E2EE.");
      }

      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      const rows = await Promise.all(
        (pubKeys ?? []).map(async (p: any) => {
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

      const { error: upErr } = await supabase
        .from("patient_vault_shares")
        .upsert(rows, { onConflict: "patient_id,user_id" });

      if (upErr) throw upErr;

      setStatus("done");
      setMessage("Vault initialised successfully.");

      router.push(`/app/patients/${pid}/vault`);
      router.refresh();
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message ?? "Vault init failed.");
    } finally {
      setBusy(false);
    }
  }

  const showSetup = status === "needs_keys";
  const canInit = status === "ready" && !busy && !!pid;

  return (
    <div className="cc-stack">
      <div className="cc-panel-soft cc-stack">
        <div className="cc-strong">Circle ID</div>
        <div className="cc-small cc-wrap">{pid || "—"}</div>
        {!pid ? (
          <div className="cc-small cc-subtle">
            Waiting for circle context… If this never appears, you’re not on a route like{" "}
            <code>/app/patients/&lt;id&gt;/vault-init</code>.
          </div>
        ) : null}
      </div>

      <div className="cc-panel-soft cc-stack">
        <div className="cc-strong">1) Device encryption keys</div>
        <div className="cc-subtle">
          Your device generates encryption keys locally. Only the public key is uploaded.
        </div>

        {showSetup ? (
          <button className="cc-btn cc-btn-primary" onClick={onSetupKeys} disabled={busy || !pid}>
            {busy ? "Enabling…" : "Enable E2EE on this device"}
          </button>
        ) : (
          <div className={`cc-pill ${status === "ready" || status === "initialising" || status === "done" ? "cc-pill-primary" : ""}`}>
            {status === "checking"
              ? "Checking…"
              : status === "ready" || status === "initialising" || status === "done"
              ? "Device keys ready"
              : status === "error"
              ? "Needs attention"
              : "Device keys"}
          </div>
        )}
      </div>

      <div className="cc-panel-soft cc-stack">
        <div className="cc-strong">2) Create / share vault</div>
        <div className="cc-subtle">
          Creates a vault key on your device and shares it to circle members who have enabled E2EE.
        </div>

        <button className="cc-btn cc-btn-secondary" onClick={onInitialiseVault} disabled={!canInit}>
          {status === "initialising" ? "Initialising…" : "Initialise / re-share vault"}
        </button>

        {status === "error" && message ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Error</div>
            <div className="cc-wrap">{message}</div>
          </div>
        ) : null}

        {status !== "error" && message ? (
          <div className="cc-status cc-status-ok">
            <div className="cc-wrap">{message}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}