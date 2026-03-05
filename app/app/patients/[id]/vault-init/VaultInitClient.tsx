"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { wrapVaultKeyForRecipient } from "@/lib/e2ee/vaultShares";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";

type Props = {
  pid: string; // patients.id
};

type Status =
  | "checking"
  | "needs_keys"
  | "ready"
  | "initialising"
  | "done"
  | "error";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export default function VaultInitClient({ pid }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [uid, setUid] = useState<string>("");
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");

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
    const publicKeyBytes: Uint8Array =
      kp?.publicKey ?? kp?.public_key ?? kp?.public ?? kp?.pk;

    if (!publicKeyBytes || !(publicKeyBytes instanceof Uint8Array)) {
      throw new Error("device_keypair_missing_public_key");
    }

    const { error } = await supabase.from("user_public_keys").upsert(
      {
        user_id: userId,
        public_key: bytesToBase64(publicKeyBytes),
        algorithm: "crypto_box_seal",
      },
      { onConflict: "user_id" }
    );

    if (error) throw error;
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setMessage("");
      setStatus("checking");

      if (!pid) {
        setStatus("error");
        setMessage("Missing circle ID.");
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }

      const me = data.session?.user;
      if (!me?.id) {
        setStatus("error");
        setMessage("Please sign in to continue.");
        return;
      }

      if (cancelled) return;
      setUid(me.id);

      const ok = await hasPublicKey(me.id);
      if (cancelled) return;

      if (!ok) {
        setStatus("needs_keys");
        setMessage("You need to set up device keys before the vault can be created.");
      } else {
        setStatus("ready");
        setMessage("");
      }
    })().catch((e: any) => {
      if (cancelled) return;
      setStatus("error");
      setMessage(e?.message ?? "Failed to prepare vault init.");
    });

    return () => {
      cancelled = true;
    };
  }, [pid, supabase]);

  async function onSetupKeys() {
    setBusy(true);
    setMessage("");
    try {
      if (!uid) throw new Error("not_authenticated");
      setStatus("checking");

      await registerPublicKey(uid);

      const ok = await hasPublicKey(uid);
      if (!ok) throw new Error("public_key_registration_failed");

      setStatus("ready");
      setMessage("Device keys set up successfully.");
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message ?? "Failed to set up device keys.");
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
      if (!uid) throw new Error("not_authenticated");

      // Gate: controller
      const { data: isCtl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid });
      if (ctlErr) throw ctlErr;
      if (!isCtl) throw new Error("Only a circle controller can initialise the vault.");

      // Members in circle
      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      if (memErr) throw memErr;

      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
      if (userIds.length === 0) throw new Error("No circle members found.");

      // Public keys for all members (strict)
      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) throw pkErr;

      const pubKeyRows = pubKeys ?? [];
      const missing = userIds.filter((memberId) => !pubKeyRows.some((p: any) => p.user_id === memberId));
      if (missing.length > 0) {
        throw new Error(
          `Waiting for ${missing.length} member(s) to enable E2EE (public key missing). Ask them to open Account → “Enable E2EE on this device”.`
        );
      }

      // Create vault key locally (32 bytes)
      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      // Replace shares (your current behaviour)
      const { error: delErr } = await supabase
        .from("patient_vault_shares")
        .delete()
        .eq("patient_id", pid)
        .in("user_id", userIds);

      if (delErr) throw delErr;

      // Wrap key to each member’s public key and insert shares
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
            wrapped_key: wrapped, // jsonb envelope
          };
        })
      );

      const { error: insErr } = await supabase.from("patient_vault_shares").insert(rows);
      if (insErr) throw insErr;

      setStatus("done");
      setMessage("Vault created successfully. Members can now open Vault to unwrap and cache the key on their devices.");

      // Take controller to Vault
      router.push(`/app/patients/${pid}/vault`);
      router.refresh();
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message ?? "Failed to initialise the vault.");
    } finally {
      setBusy(false);
    }
  }

  const showSetupKeys = status === "needs_keys";
  const canInit = status === "ready" && !busy;

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Vault init</h1>
            <div className="cc-subtle cc-wrap">Circle: {pid}</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">
              Hub
            </Link>
            <Link className="cc-btn" href="/app/account">
              Account
            </Link>
          </div>
        </div>

        {message ? (
          <div className={`cc-status ${status === "error" ? "cc-status-error" : status === "done" ? "cc-status-ok" : "cc-status-loading"}`}>
            <div className={status === "error" ? "cc-status-error-title" : "cc-strong"}>
              {status === "error" ? "Error" : status === "done" ? "Done" : "Message"}
            </div>
            <div className="cc-wrap">{message}</div>
          </div>
        ) : null}

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">1) Device keys</div>
          <div className="cc-subtle">
            Your device generates encryption keys locally. Only the public key is uploaded (to <code>user_public_keys</code>).
          </div>

          {showSetupKeys ? (
            <div className="cc-row">
              <button className="cc-btn cc-btn-primary" onClick={onSetupKeys} disabled={busy || !uid}>
                {busy ? "Setting up…" : "Set up device keys"}
              </button>
            </div>
          ) : (
            <div className="cc-small cc-subtle">
              Status: <b>{status === "ready" || status === "initialising" || status === "done" ? "Ready" : status}</b>
            </div>
          )}
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">2) Create vault</div>
          <div className="cc-subtle">
            A vault key is created on your device and shared securely with circle members using their public keys. No plaintext is stored server-side.
          </div>

          <div className="cc-row">
            <button className="cc-btn cc-btn-primary" onClick={onInitialiseVault} disabled={!canInit}>
              {status === "initialising" ? "Initialising…" : "Initialise encrypted vault"}
            </button>

            <Link className="cc-btn" href={`/app/onboarding`}>
              Back to onboarding
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}