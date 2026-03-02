"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { wrapVaultKeyForRecipient } from "@/lib/e2ee/vaultShares";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";

type Props = {
  pid: string; // circle context id (patients.id)
  disabled?: boolean;
};

// Base64 helpers (explicit and stable)
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function onboardingVaultFlagKey(pid: string) {
  return `carecircle:onboarding:vault_initialized:${pid}`;
}

export default function VaultInitButton({ pid, disabled }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<
    | "idle"
    | "checking"
    | "needs_keys"
    | "ready"
    | "initialising"
    | "done"
    | "error"
  >("checking");

  const [uid, setUid] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  // --- Secure prerequisites (no plaintext, no server-side key gen) ---
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
    // Generates/loads local keypair (secret stays local), uploads ONLY public key
    const kp: any = await getOrCreateDeviceKeypair();
    const publicKeyBytes: Uint8Array =
      kp?.publicKey ?? kp?.public_key ?? kp?.public ?? kp?.pk;

    if (!publicKeyBytes || !(publicKeyBytes instanceof Uint8Array)) {
      throw new Error("device_keypair_missing_public_key");
    }

    const public_key = bytesToBase64(publicKeyBytes);

    const { error } = await supabase.from("user_public_keys").upsert(
      {
        user_id: userId,
        public_key,
        algorithm: "x25519-xsalsa20-poly1305",
      },
      { onConflict: "user_id" }
    );

    if (error) throw error;
  }

  // --- Boot: auth + public key check ---
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        setStatus("checking");
        setMessage("");

        if (!pid || disabled) {
          setStatus("error");
          setMessage("Missing circle ID. Please go back and open this page from a circle.");
          return;
        }

        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;

        const currentUid = data?.user?.id ?? "";
        if (!currentUid) {
          setStatus("error");
          setMessage("Please sign in to continue.");
          return;
        }

        if (cancelled) return;
        setUid(currentUid);

        const ok = await hasPublicKey(currentUid);
        if (cancelled) return;

        if (!ok) {
          setStatus("needs_keys");
          setMessage("You need to set up device keys before the vault can be created.");
        } else {
          setStatus("ready");
          setMessage("");
        }
      } catch (e: any) {
        if (cancelled) return;
        setStatus("error");
        setMessage(e?.message ?? "Something went wrong while preparing the vault setup.");
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
      const { data: isCtl, error: ctlErr } = await supabase.rpc(
        "is_patient_controller",
        { pid } // ✅ payload key matches SQL param name exactly
      );
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

      // Public keys for all members (strict: no skipping)
      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) throw pkErr;

      const pubKeyRows = pubKeys ?? [];
      const missing = userIds.filter(
        (memberId) => !pubKeyRows.some((p: any) => p.user_id === memberId)
      );

      if (missing.length > 0) {
        throw new Error(
          `Waiting for ${missing.length} member(s) to set up device keys. Ask them to sign in and complete key setup.`
        );
      }

      // Create vault key locally (32 bytes)
      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      // Replace shares (kept as your current behaviour)
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
            patient_id: pid, // ✅ DB column stays patient_id
            user_id: p.user_id,
            wrapped_key: wrapped, // jsonb envelope
          };
        })
      );

      const { error: insErr } = await supabase.from("patient_vault_shares").insert(rows);
      if (insErr) throw insErr;

      // Mark onboarding step as completed (stable key, per circle)
      try {
        localStorage.setItem(onboardingVaultFlagKey(pid), "1");
      } catch {
        // ignore (kiosk/private mode)
      }

      setStatus("done");
      setMessage("Vault created successfully. Returning to onboarding…");

      // Redirect back to onboarding (your current /app/... structure)
      // - query param helps onboarding tick UI immediately
      // - localStorage flag provides persistence
      const qs = new URLSearchParams({
        pid,
        vault: "1",
      }).toString();

      // your current structure uses /app/onboarding in URL
      router.push(`/app/onboarding?${qs}`);
      router.refresh();
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message ?? "Failed to initialise the vault.");
    } finally {
      setBusy(false);
    }
  }

  const showSetupKeys = status === "needs_keys";
  const canInit = status === "ready" && !busy && !disabled;

  return (
    <div>
      {/* Simple step cards */}
      <div
        style={{
          display: "grid",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            border: "1px solid #e5e5e5",
            borderRadius: 12,
            padding: 12,
            background: "rgba(0,0,0,0.02)",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>1) Device keys</div>
          <div style={{ opacity: 0.85, fontSize: 13 }}>
            Your device generates encryption keys locally. Only the public key is uploaded.
          </div>

          {showSetupKeys ? (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={onSetupKeys}
                disabled={busy || !uid}
                style={{
                  padding: 10,
                  border: "1px solid #ccc",
                  borderRadius: 10,
                  cursor: busy || !uid ? "not-allowed" : "pointer",
                  opacity: busy || !uid ? 0.6 : 1,
                }}
              >
                {busy ? "Setting up…" : "Set up device keys"}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              Status:{" "}
              <strong>
                {status === "checking"
                  ? "Checking…"
                  : status === "ready" || status === "initialising" || status === "done"
                  ? "Ready"
                  : status === "error"
                  ? "Needs attention"
                  : "Ready"}
              </strong>
            </div>
          )}
        </div>

        <div
          style={{
            border: "1px solid #e5e5e5",
            borderRadius: 12,
            padding: 12,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>2) Create vault</div>
          <div style={{ opacity: 0.85, fontSize: 13, marginBottom: 10 }}>
            A vault key is created on your device and securely shared with circle members using their public keys.
          </div>

          <button
            type="button"
            onClick={onInitialiseVault}
            disabled={!canInit}
            style={{
              padding: 10,
              border: "1px solid #ccc",
              borderRadius: 10,
              cursor: !canInit ? "not-allowed" : "pointer",
              opacity: !canInit ? 0.6 : 1,
            }}
          >
            {status === "initialising" ? "Initialising…" : "Initialise encrypted vault"}
          </button>
        </div>
      </div>

      {/* Friendly messaging */}
      {message && (
        <div
          style={{
            marginTop: 10,
            border: "1px solid #e5e5e5",
            borderRadius: 12,
            padding: 12,
            background:
              status === "error"
                ? "rgba(255, 0, 0, 0.05)"
                : status === "done"
                ? "rgba(0, 200, 0, 0.06)"
                : "rgba(0,0,0,0.02)",
          }}
        >
          {message}
        </div>
      )}

      {/* Back link (optional, non-breaking) */}
      <div style={{ marginTop: 14, fontSize: 13, opacity: 0.85 }}>
        <button
          type="button"
          onClick={() => {
            const qs = new URLSearchParams({ pid }).toString();
            router.push(`/app/onboarding?${qs}`);
          }}
          style={{
            padding: 0,
            border: "none",
            background: "transparent",
            textDecoration: "underline",
            cursor: "pointer",
            color: "inherit",
          }}
        >
          Back to onboarding
        </button>
      </div>
    </div>
  );
}