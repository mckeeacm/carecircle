"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";
import { unwrapVaultKeyForMe, type WrappedKeyV1 } from "@/lib/e2ee/vaultShares";

type Props = {
  pid: string;
};

type CacheRecord = {
  v: 1;
  createdAt: number;
  expiresAt: number;
  vaultKeyB64: string;
};

function cacheKey(pid: string, uid: string) {
  return `carecircle:vaultkey:v1:${pid}:${uid}`;
}

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

    if (Date.now() > rec.expiresAt) {
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

  const rec: CacheRecord = {
    v: 1,
    createdAt: now,
    expiresAt: now + ttlDays * 24 * 60 * 60 * 1000,
    vaultKeyB64: bytesToBase64(vaultKey),
  };

  try {
    localStorage.setItem(cacheKey(pid, uid), JSON.stringify(rec));
  } catch {}
}

function forgetCachedVaultKey(pid: string, uid: string) {
  try {
    localStorage.removeItem(cacheKey(pid, uid));
  } catch {}
}

export default function VaultClient({ pid }: Props) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [uid, setUid] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [hasCached, setHasCached] = useState(false);
  const [hasShareRow, setHasShareRow] = useState<boolean | null>(null);
  const [isController, setIsController] = useState(false);

  async function refresh() {
    setLoading(true);
    setMsg(null);

    try {
      const { data: sessionData, error } = await supabase.auth.getSession();
      if (error) throw error;

      const me = sessionData.session?.user;

      if (!me?.id) {
        setUid("");
        setMsg("Please sign in to access the vault.");
        return;
      }

      setUid(me.id);

      const cached = readCachedVaultKey(pid, me.id);
      setHasCached(!!cached);

      // check vault share
      const { data: share } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", pid)
        .eq("user_id", me.id)
        .maybeSingle();

      setHasShareRow(!!share?.wrapped_key);

      // check controller role
      const { data: mem } = await supabase
        .from("patient_members")
        .select("is_controller")
        .eq("patient_id", pid)
        .eq("user_id", me.id)
        .maybeSingle();

      setIsController(mem?.is_controller === true);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_vault");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [pid]);

  async function unlockFromShare() {
    setBusy("unlock");
    setMsg(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const me = sessionData.session?.user;

      if (!me?.id) throw new Error("not_authenticated");

      const { data: share } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", pid)
        .eq("user_id", me.id)
        .maybeSingle();

      if (!share?.wrapped_key) {
        throw new Error(
          "No vault share found. Ask the controller to share the vault key."
        );
      }

      const wrapped = share.wrapped_key as WrappedKeyV1;

      const kp: any = await getOrCreateDeviceKeypair();

      const myPublicKey =
        kp?.publicKey ?? kp?.public_key ?? kp?.pk;

      const myPrivateKey =
        kp?.secretKey ?? kp?.secret_key ?? kp?.sk;

      if (!myPublicKey || !myPrivateKey) {
        throw new Error("device_keypair_missing_keys");
      }

      const vaultKey = await unwrapVaultKeyForMe({
        wrapped,
        myPublicKey,
        myPrivateKey,
      });

      writeCachedVaultKey(pid, me.id, vaultKey);

      setHasCached(true);
      setMsg("Vault unlocked on this device.");
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

    forgetCachedVaultKey(pid, uid);

    setHasCached(false);
    setBusy(null);
  }

  if (loading) {
    return (
      <div className="cc-page">
        <div className="cc-container cc-card cc-card-pad">
          Loading vault…
        </div>
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
            <div className="cc-subtle">Circle: {pid}</div>
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

        {msg && (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Message</div>
            <div>{msg}</div>
          </div>
        )}

        {/* Vault controls */}

        <div className="cc-card cc-card-pad cc-stack">

          <div className="cc-strong">Vault status</div>

          <div className="cc-row">
            <span className="cc-pill">
              Cache: {hasCached ? "present" : "missing"}
            </span>

            <span className="cc-pill">
              Share: {hasShareRow ? "present" : "missing"}
            </span>
          </div>

          <div className="cc-row">

            <button
              className="cc-btn cc-btn-primary"
              onClick={unlockFromShare}
              disabled={busy === "unlock"}
            >
              {busy === "unlock" ? "Unlocking…" : "Unlock vault"}
            </button>

            <button
              className="cc-btn cc-btn-danger"
              onClick={forgetOnDevice}
              disabled={busy === "forget" || !hasCached}
            >
              Forget vault on this device
            </button>

            <button className="cc-btn" onClick={refresh}>
              Refresh
            </button>

          </div>

        </div>

        {/* Controller sharing panel */}

        {isController && (
          <div className="cc-card cc-card-pad cc-stack">

            <div className="cc-strong">Controller tools</div>

            <div className="cc-subtle">
              Share the vault key with circle members who have enabled E2EE.
            </div>

            <div className="cc-row">

              <Link
                className="cc-btn cc-btn-primary"
                href={`/app/patients/${pid}/vault-share`}
              >
                Share vault to members
              </Link>

              <Link
                className="cc-btn"
                href={`/app/patients/${pid}/vault-init`}
              >
                Recreate vault
              </Link>

            </div>

          </div>
        )}

      </div>
    </div>
  );
}