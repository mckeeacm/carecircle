"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";

type Props = { pid: string };

type CacheRecord = {
  v: 1;
  createdAt: number;
  expiresAt: number;
  vaultKeyB64: string; // base64 raw bytes
};

function cacheKey(pid: string, uid: string) {
  return `carecircle:vaultkey:v1:${pid}:${uid}`;
}

// Base64 helpers (explicit and stable)
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function readCachedVaultKey(pid: string, uid: string): Uint8Array | null {
  try {
    const raw = localStorage.getItem(cacheKey(pid, uid));
    if (!raw) return null;
    const rec = JSON.parse(raw) as CacheRecord;
    if (!rec || rec.v !== 1) return null;
    if (!rec.expiresAt || Date.now() > rec.expiresAt) {
      localStorage.removeItem(cacheKey(pid, uid));
      return null;
    }
    return base64ToBytes(rec.vaultKeyB64);
  } catch {
    return null;
  }
}

function writeCachedVaultKey(pid: string, uid: string, vaultKey: Uint8Array) {
  const now = Date.now();
  const ttlDays = 30;
  const expiresAt = now + ttlDays * 24 * 60 * 60 * 1000;

  const rec: CacheRecord = {
    v: 1,
    createdAt: now,
    expiresAt,
    vaultKeyB64: bytesToBase64(vaultKey),
  };

  try {
    localStorage.setItem(cacheKey(pid, uid), JSON.stringify(rec));
  } catch {
    // ignore (private mode / kiosk restrictions)
  }
}

function forgetCachedVaultKey(pid: string, uid: string) {
  try {
    localStorage.removeItem(cacheKey(pid, uid));
  } catch {
    // ignore
  }
}

function extractCiphertextB64(env: any): string | null {
  // Your wrapVaultKeyForRecipient() envelope key may differ.
  // We support a few common variants so it works immediately.
  const v =
    env?.ciphertext ??
    env?.ct ??
    env?.data ??
    env?.sealed ??
    env?.ciphertext_b64 ??
    env?.ciphertextB64 ??
    null;

  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export default function VaultClient({ pid }: Props) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [uid, setUid] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [hasCached, setHasCached] = useState(false);
  const [hasShareRow, setHasShareRow] = useState<boolean | null>(null);

  async function refresh() {
    setLoading(true);
    setMsg(null);

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      const me = data.session?.user;
      if (!me?.id) {
        setUid("");
        setHasCached(false);
        setHasShareRow(null);
        setMsg("Please sign in to access the vault.");
        return;
      }

      setUid(me.id);

      // Local cache status
      const cached = readCachedVaultKey(pid, me.id);
      setHasCached(!!cached);

      // Share status (own share only; policy is auth.uid() = user_id)
      const { data: share, error: shareErr } = await supabase
        .from("patient_vault_shares")
        .select("id")
        .eq("patient_id", pid)
        .eq("user_id", me.id)
        .maybeSingle();

      if (shareErr) {
        // If policy misconfigured, we won't crash; just show unknown.
        setHasShareRow(null);
      } else {
        setHasShareRow(!!share?.id);
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_vault");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  async function unlockFromShare() {
    setBusy("unlock");
    setMsg(null);

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      const me = data.session?.user;
      if (!me?.id) throw new Error("not_authenticated");
      setUid(me.id);

      // Load my share row
      const { data: share, error: shareErr } = await supabase
        .from("patient_vault_shares")
        .select("id, wrapped_key")
        .eq("patient_id", pid)
        .eq("user_id", me.id)
        .maybeSingle();

      if (shareErr) throw shareErr;

      if (!share?.wrapped_key) {
        setHasShareRow(false);
        throw new Error(
          "No vault share found for your account in this circle. Ask the controller to run Vault init (after you enable E2EE on this device)."
        );
      }

      // Unwrap locally using device keypair
      const sodium = await getSodium();
      const kp: any = await getOrCreateDeviceKeypair();

      const publicKey: Uint8Array =
        kp?.publicKey ?? kp?.public_key ?? kp?.pk;

      const secretKey: Uint8Array =
        kp?.secretKey ?? kp?.secret_key ?? kp?.sk;

      if (!publicKey || !secretKey) {
        throw new Error("device_keypair_missing_keys");
      }

      // Your wrapped_key is a jsonb envelope produced by wrapVaultKeyForRecipient().
      const env: any = share.wrapped_key;
      const ciphertextB64 = extractCiphertextB64(env);

      if (!ciphertextB64) {
        throw new Error("wrapped_key_envelope_missing_ciphertext");
      }

      const ciphertext = base64ToBytes(ciphertextB64);

      // libsodium: crypto_box_seal_open(ciphertext, recipient_pk, recipient_sk)
      const vaultKey = sodium.crypto_box_seal_open(ciphertext, publicKey, secretKey);

      if (!(vaultKey instanceof Uint8Array) || vaultKey.length === 0) {
        throw new Error("failed_to_unwrap_vault_key");
      }

      writeCachedVaultKey(pid, me.id, vaultKey);

      setHasCached(true);
      setHasShareRow(true);
      setMsg("Vault key unlocked and stored on this device (30 day cache).");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_unlock_vault");
    } finally {
      setBusy(null);
    }
  }

  async function forgetOnDevice() {
    if (!uid) return;
    setBusy("forget");
    setMsg(null);
    try {
      forgetCachedVaultKey(pid, uid);
      setHasCached(false);
      setMsg("Vault key removed from this device.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="cc-page">
        <div className="cc-container cc-card cc-card-pad">Loading vault…</div>
      </div>
    );
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Vault</h1>
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

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Message</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <div className="cc-strong">Vault status</div>
              <div className="cc-subtle">
                This device can decrypt encrypted fields only if the vault key is cached locally.
              </div>
            </div>

            <div className="cc-row">
              <span className={`cc-pill ${hasCached ? "cc-pill-primary" : ""}`}>
                Cache: {hasCached ? "present" : "missing"}
              </span>
              <span className={`cc-pill ${hasShareRow ? "cc-pill-primary" : ""}`}>
                Share: {hasShareRow === null ? "unknown" : hasShareRow ? "present" : "missing"}
              </span>
            </div>
          </div>

          <div className="cc-row">
            <button className="cc-btn cc-btn-primary" onClick={unlockFromShare} disabled={busy === "unlock" || !pid}>
              {busy === "unlock" ? "Unlocking…" : "Unlock vault on this device"}
            </button>

            <button className="cc-btn cc-btn-danger" onClick={forgetOnDevice} disabled={busy === "forget" || !uid || !hasCached}>
              {busy === "forget" ? "Forgetting…" : "Forget vault on this device"}
            </button>

            <button className="cc-btn" onClick={refresh} disabled={!!busy}>
              Refresh
            </button>
          </div>

          {!hasCached ? (
            <div className="cc-panel">
              <div className="cc-strong">If you can’t unlock</div>
              <div className="cc-subtle">
                Ask the circle controller to run <b>Vault init</b> after you’ve enabled E2EE in Account (public key registered).
                Your database currently shows only the controller has a vault share.
              </div>
            </div>
          ) : null}

          <div className="cc-small cc-subtle">
            The vault key is stored only on this device (localStorage). Deleting browser storage or using a new device will require unlocking again.
          </div>
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">Controller tools</div>
          <div className="cc-subtle">
            If you are a controller in this circle, use Vault init to regenerate and share vault shares.
          </div>
          <div className="cc-row">
            <Link className="cc-btn" href={`/app/patients/${pid}/vault-init`}>
              Open Vault init
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}