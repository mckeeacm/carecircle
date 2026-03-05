"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";
import { unwrapVaultKeyForMe, wrapVaultKeyForRecipient, type WrappedKeyV1 } from "@/lib/e2ee/vaultShares";

type Props = { pid: string };

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

function isUuid(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function VaultInitClient({ pid }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [uid, setUid] = useState<string>("");
  const [email, setEmail] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [hasCached, setHasCached] = useState(false);
  const [hasShareRow, setHasShareRow] = useState<boolean | null>(null);
  const [isController, setIsController] = useState<boolean | null>(null);

  const [hasPublicKey, setHasPublicKey] = useState<boolean | null>(null);
  const [myAlg, setMyAlg] = useState<string>("");

  async function getSessionUser() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.user ?? null;
  }

  async function refreshWithUser(userOverride?: { id: string; email?: string | null }) {
    setMsg(null);

    if (!pid || !isUuid(pid)) {
      setUid("");
      setEmail("");
      setHasCached(false);
      setHasShareRow(null);
      setIsController(null);
      setHasPublicKey(null);
      setMyAlg("");
      setLoading(false);
      setMsg("Missing or invalid circle ID. This page must be opened from a circle route.");
      return;
    }

    const user = userOverride ?? (await getSessionUser());
    if (!user?.id) {
      setUid("");
      setEmail("");
      setHasCached(false);
      setHasShareRow(null);
      setIsController(null);
      setHasPublicKey(null);
      setMyAlg("");
      setLoading(false);
      setMsg("Please sign in to continue.");
      return;
    }

    setUid(user.id);
    setEmail(user.email ?? "");

    // local cache
    const cached = readCachedVaultKey(pid, user.id);
    setHasCached(!!cached);

    // my share row
    const { data: share, error: shareErr } = await supabase
      .from("patient_vault_shares")
      .select("wrapped_key")
      .eq("patient_id", pid)
      .eq("user_id", user.id)
      .maybeSingle();

    if (shareErr) setHasShareRow(null);
    else setHasShareRow(!!share?.wrapped_key);

    // controller: authoritative RPC (uses correct arg name pid)
    const { data: ctl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid });
    if (ctlErr) throw ctlErr;
    setIsController(ctl === true);

    // device public key status
    const { data: pk, error: pkErr } = await supabase
      .from("user_public_keys")
      .select("user_id, algorithm")
      .eq("user_id", user.id)
      .maybeSingle();

    if (pkErr) {
      setHasPublicKey(null);
      setMyAlg("");
    } else {
      setHasPublicKey(!!pk?.user_id);
      setMyAlg((pk as any)?.algorithm ?? "");
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      await refreshWithUser();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_refresh_vault_init");
    } finally {
      setLoading(false);
    }
  }

  // IMPORTANT: vault-init was flaky because it ran before session restored.
  // Fix: subscribe to auth changes and refresh when session arrives.
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        const user = await getSessionUser();
        if (!alive) return;
        await refreshWithUser(user ? { id: user.id, email: user.email } : undefined);
      } catch (e: any) {
        if (!alive) return;
        setMsg(e?.message ?? "failed_to_boot_vault_init");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      refreshWithUser(u ? { id: u.id, email: u.email } : undefined).catch(() => {});
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  async function enableE2EEOnThisDevice() {
    setBusy("keys");
    setMsg(null);

    try {
      const user = await getSessionUser();
      if (!user?.id) throw new Error("not_authenticated");

      const kp: any = await getOrCreateDeviceKeypair();
      const publicKeyBytes: Uint8Array = kp?.publicKey ?? kp?.public_key ?? kp?.pk;

      if (!publicKeyBytes || !(publicKeyBytes instanceof Uint8Array)) {
        throw new Error("device_keypair_missing_public_key");
      }

      const { error } = await supabase.from("user_public_keys").upsert(
        {
          user_id: user.id,
          public_key: bytesToBase64(publicKeyBytes),
          algorithm: "crypto_box_seal",
        },
        { onConflict: "user_id" }
      );

      if (error) throw error;

      setMsg("E2EE enabled on this device (public key registered).");
      await refreshWithUser({ id: user.id, email: user.email });
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_enable_e2ee");
    } finally {
      setBusy(null);
    }
  }

  async function unlockVaultOnThisDevice() {
    setBusy("unlock");
    setMsg(null);

    try {
      const user = await getSessionUser();
      if (!user?.id) throw new Error("not_authenticated");

      const { data: share, error: shareErr } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", pid)
        .eq("user_id", user.id)
        .maybeSingle();

      if (shareErr) throw shareErr;
      if (!share?.wrapped_key) throw new Error("No vault share found. Ask the controller to share the vault key.");

      const wrapped = share.wrapped_key as WrappedKeyV1;

      const kp: any = await getOrCreateDeviceKeypair();
      const myPublicKey: Uint8Array = kp?.publicKey ?? kp?.public_key ?? kp?.pk;
      const myPrivateKey: Uint8Array = kp?.secretKey ?? kp?.secret_key ?? kp?.sk;

      if (!myPublicKey || !myPrivateKey) throw new Error("device_keypair_missing_keys");

      const vaultKey = await unwrapVaultKeyForMe({
        wrapped,
        myPublicKey,
        myPrivateKey,
      });

      writeCachedVaultKey(pid, user.id, vaultKey);
      setMsg("Vault unlocked on this device.");
      await refreshWithUser({ id: user.id, email: user.email });
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_unlock_vault");
    } finally {
      setBusy(null);
    }
  }

  async function forgetVaultOnThisDevice() {
    if (!uid) return;
    setBusy("forget");
    setMsg(null);
    try {
      forgetCachedVaultKey(pid, uid);
      setMsg("Vault key removed from this device.");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function shareKeyToNewMembers() {
    setBusy("share");
    setMsg(null);

    try {
      if (isController !== true) throw new Error("Only a controller can share the vault key.");
      if (!uid) throw new Error("not_authenticated");

      const vaultKey = readCachedVaultKey(pid, uid);
      if (!vaultKey) throw new Error("Vault key is not cached on this device. Unlock vault on this device first.");

      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      if (memErr) throw memErr;

      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);

      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) throw pkErr;

      const missing = userIds.filter((u) => !(pubKeys ?? []).some((p: any) => p.user_id === u));
      if (missing.length) throw new Error(`${missing.length} member(s) must enable E2EE first.`);

      const incompatible = (pubKeys ?? []).filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (incompatible.length) throw new Error("Some members have incompatible key algorithms. Ask them to re-enable E2EE.");

      const { data: existing, error: exErr } = await supabase
        .from("patient_vault_shares")
        .select("user_id")
        .eq("patient_id", pid);

      if (exErr) throw exErr;

      const existingSet = new Set((existing ?? []).map((r: any) => r.user_id).filter(Boolean));
      const targets = (pubKeys ?? []).filter((p: any) => !existingSet.has(p.user_id));

      if (targets.length === 0) {
        setMsg("No new members need a share. Everyone already has one.");
        return;
      }

      const rows = await Promise.all(
        targets.map(async (p: any) => {
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

      setMsg(`Shared vault key to ${rows.length} new member(s).`);
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_share_key");
    } finally {
      setBusy(null);
    }
  }

  async function initialiseNewVaultKey() {
    setBusy("init");
    setMsg(null);

    try {
      if (isController !== true) throw new Error("Only a controller can initialise a new vault key.");
      if (!uid) throw new Error("not_authenticated");

      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      if (memErr) throw memErr;

      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);

      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) throw pkErr;

      const missing = userIds.filter((u) => !(pubKeys ?? []).some((p: any) => p.user_id === u));
      if (missing.length) throw new Error(`${missing.length} member(s) must enable E2EE first.`);

      const incompatible = (pubKeys ?? []).filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (incompatible.length) throw new Error("Some members have incompatible key algorithms. Ask them to re-enable E2EE.");

      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      // cache for controller
      writeCachedVaultKey(pid, uid, vaultKey);

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

      setMsg("Initialised a NEW vault key and shared it to all members with E2EE enabled.");
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_init_new_vault");
    } finally {
      setBusy(null);
    }
  }

  const keyOk = hasPublicKey === true && (myAlg === "" || myAlg === "crypto_box_seal");

  if (loading) {
    return (
      <div className="cc-page">
        <div className="cc-container cc-card cc-card-pad">Loading vault setup…</div>
      </div>
    );
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Vault setup</h1>
            <div className="cc-subtle cc-wrap">Circle: {pid || "—"}</div>
            {email ? <div className="cc-small cc-subtle cc-wrap">Signed in as: {email}</div> : null}
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">Hub</Link>
            <Link className="cc-btn" href="/app/account">Account</Link>
            {pid ? <Link className="cc-btn cc-btn-secondary" href={`/app/patients/${pid}/vault`}>Vault</Link> : null}
          </div>
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Message</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        {/* These buttons always exist (you said they vanished) */}
        <div className="cc-row">
          <button className="cc-btn" onClick={refresh} disabled={!!busy}>
            Refresh
          </button>

          <button className="cc-btn" onClick={() => router.refresh()} disabled={!!busy}>
            Hard refresh (Next.js)
          </button>

          {!uid ? (
            <Link className="cc-btn cc-btn-primary" href={`/?next=${encodeURIComponent(`/app/patients/${pid}/vault-init`)}`}>
              Sign in
            </Link>
          ) : null}
        </div>

        {/* Vault controls */}
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">Vault controls</div>

          <div className="cc-row">
            <span className={`cc-pill ${hasCached ? "cc-pill-primary" : ""}`}>Cache: {hasCached ? "present" : "missing"}</span>
            <span className={`cc-pill ${hasShareRow ? "cc-pill-primary" : ""}`}>
              Share: {hasShareRow === null ? "unknown" : hasShareRow ? "present" : "missing"}
            </span>
            <span className={`cc-pill ${isController ? "cc-pill-primary" : ""}`}>
              Controller: {isController === null ? "unknown" : isController ? "true" : "false"}
            </span>
            <span className={`cc-pill ${keyOk ? "cc-pill-primary" : ""}`}>
              Device key: {keyOk ? "OK" : hasPublicKey === null ? "unknown" : "missing/invalid"}
            </span>
          </div>

          <div className="cc-row">
            <button className="cc-btn cc-btn-primary" onClick={unlockVaultOnThisDevice} disabled={busy === "unlock" || !uid}>
              {busy === "unlock" ? "Unlocking…" : "Unlock vault on this device"}
            </button>

            <button className="cc-btn cc-btn-danger" onClick={forgetVaultOnThisDevice} disabled={busy === "forget" || !hasCached}>
              {busy === "forget" ? "Forgetting…" : "Forget vault on this device"}
            </button>
          </div>
        </div>

        {/* Device keys */}
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">Device keys (E2EE)</div>
          <div className="cc-subtle">
            Registers your public key in <code>user_public_keys</code> using <b>crypto_box_seal</b> to match vault shares.
          </div>

          <div className="cc-row">
            <button className="cc-btn cc-btn-secondary" onClick={enableE2EEOnThisDevice} disabled={busy === "keys" || !uid}>
              {busy === "keys" ? "Enabling…" : hasPublicKey ? "Re-enable E2EE (replace)" : "Enable E2EE on this device"}
            </button>
            <span className="cc-pill">{myAlg || "—"}</span>
          </div>
        </div>

        {/* Controller actions */}
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">Controller actions</div>
          <div className="cc-subtle">
            Share the existing key to new members (recommended), or initialise a new key (advanced).
          </div>

          <div className="cc-row">
            <button
              className="cc-btn cc-btn-primary"
              onClick={shareKeyToNewMembers}
              disabled={busy === "share" || isController !== true || !keyOk || !hasCached}
            >
              {busy === "share" ? "Sharing…" : "Share key to new members"}
            </button>

            <button
              className="cc-btn cc-btn-danger"
              onClick={initialiseNewVaultKey}
              disabled={busy === "init" || isController !== true || !keyOk}
            >
              {busy === "init" ? "Initialising…" : "Initialise NEW vault key"}
            </button>
          </div>

          {isController !== true ? (
            <div className="cc-panel">
              <div className="cc-strong">Why are buttons disabled?</div>
              <div className="cc-subtle">
                Controller status is determined via <code>is_patient_controller(pid)</code>. If that returns false in the app,
                you are not signed in properly at the time it runs, or the request lacks a session.
              </div>
            </div>
          ) : null}

          {!hasCached ? (
            <div className="cc-small cc-subtle">
              To share to new members without regenerating, unlock vault on this device first (so the vault key is cached).
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}