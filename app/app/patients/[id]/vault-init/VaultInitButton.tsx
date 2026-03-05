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

    const publicKeyBytes: Uint8Array =
      kp?.publicKey ?? kp?.public_key ?? kp?.pk;

    if (!publicKeyBytes) {
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
        if (!pid || disabled) {
          setStatus("error");
          setMessage("Missing circle ID.");
          return;
        }

        const { data } = await supabase.auth.getSession();

        const user = data.session?.user;
        if (!user) {
          setStatus("error");
          setMessage("Please sign in.");
          return;
        }

        if (cancelled) return;

        setUid(user.id);

        const ok = await hasPublicKey(user.id);

        if (ok) {
          setStatus("ready");
        } else {
          setStatus("needs_keys");
        }
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.message ?? "vault setup failed");
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

      const { data: isCtl } = await supabase.rpc("is_patient_controller", {
        pid,
      });

      if (!isCtl) {
        throw new Error("Only a controller can initialise vault.");
      }

      const { data: members } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      const userIds = (members ?? []).map((m: any) => m.user_id);

      const { data: pubKeys } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      const missing = userIds.filter(
        (u) => !pubKeys?.some((p) => p.user_id === u)
      );

      if (missing.length) {
        throw new Error(
          `${missing.length} member(s) must enable E2EE before vault sharing.`
        );
      }

      const incompatible = pubKeys?.filter(
        (p) => p.algorithm !== "crypto_box_seal"
      );

      if (incompatible?.length) {
        throw new Error(
          "Some members have incompatible key algorithms. Ask them to re-enable E2EE."
        );
      }

      const sodium = await getSodium();

      const vaultKey = sodium.randombytes_buf(32);

      const rows = await Promise.all(
        pubKeys!.map(async (p: any) => {
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

      const { error } = await supabase
        .from("patient_vault_shares")
        .upsert(rows, { onConflict: "patient_id,user_id" });

      if (error) throw error;

      setStatus("done");
      setMessage("Vault initialised successfully.");

      router.push(`/app/patients/${pid}/vault`);
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message ?? "Vault init failed");
    } finally {
      setBusy(false);
    }
  }

  const showSetup = status === "needs_keys";
  const canInit = status === "ready" && !busy;

  return (
    <div className="cc-card cc-card-pad cc-stack">

      <div className="cc-strong">1. Device encryption keys</div>

      {showSetup ? (
        <button
          className="cc-btn cc-btn-primary"
          onClick={onSetupKeys}
          disabled={busy}
        >
          Enable E2EE on this device
        </button>
      ) : (
        <div className="cc-pill cc-pill-primary">Device keys ready</div>
      )}

      <div className="cc-strong">2. Create vault</div>

      <button
        className="cc-btn"
        onClick={onInitialiseVault}
        disabled={!canInit}
      >
        {status === "initialising"
          ? "Initialising vault..."
          : "Initialise encrypted vault"}
      </button>

      {message && (
        <div className="cc-panel">
          {message}
        </div>
      )}
    </div>
  );
}