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

export default function VaultInitClient({ pid }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  // shared identity + state
  const [uid, setUid] = useState<string>("");
  const [email, setEmail] = useState<string>("");

  // UI states
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // vault status
  const [hasCached, setHasCached] = useState(false);
  const [hasShareRow, setHasShareRow] = useState<boolean | null>(null);
  const [isController, setIsController] = useState(false);

  // device key status
  const [hasPublicKey, setHasPublicKey] = useState<boolean | null>(null);
  const [myAlg, setMyAlg] = useState<string>("");

  async function refresh() {
    setLoading(true);
    setMsg(null);

    try {
      if (!pid) {
        setMsg("Missing circle ID.");
        return;
      }

      const { data: sessionData, error } = await supabase.auth.getSession();
      if (error) throw error;

      const me = sessionData.session?.user;
      if (!me?.id) {
        setUid("");
        setEmail("");
        setMsg("Please sign in.");
        return;
      }

      setUid(me.id);
      setEmail(me.email ?? "");

      // cache
      const cached = readCachedVaultKey(pid, me.id);
      setHasCached(!!cached);

      // share row (own)
      const { data: share, error: shareErr } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", pid)
        .eq("user_id", me.id)
        .maybeSingle();

      if (shareErr) {
        setHasShareRow(null);
      } else {
        setHasShareRow(!!share?.wrapped_key);
      }

      // controller status
      const { data: mem, error: memErr } = await supabase
        .from("patient_members")
        .select("is_controller")
        .eq("patient_id", pid)
        .eq("user_id", me.id)
        .maybeSingle();

      if (memErr) throw memErr;
      setIsController(mem?.is_controller === true);

      // public key status
      const { data: pk, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, algorithm")
        .eq("user_id", me.id)
        .maybeSingle();

      if (pkErr) {
        setHasPublicKey(null);
        setMyAlg("");
      } else {
        setHasPublicKey(!!pk?.user_id);
        setMyAlg((pk as any)?.algorithm ?? "");
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_vault_init");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  // --- 1) Device keys (register public key as crypto_box_seal) ---
  async function enableE2EEOnThisDevice() {
    setBusy("keys");
    setMsg(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const me = sessionData.session?.user;
      if (!me?.id) throw new Error("not_authenticated");

      const kp: any = await getOrCreateDeviceKeypair();
      const publicKeyBytes: Uint8Array = kp?.publicKey ?? kp?.public_key ?? kp?.pk;

      if (!publicKeyBytes || !(publicKeyBytes instanceof Uint8Array)) {
        throw new Error("device_keypair_missing_public_key");
      }

      const { error } = await supabase.from("user_public_keys").upsert(
        {
          user_id: me.id,
          public_key: bytesToBase64(publicKeyBytes),
          algorithm: "crypto_box_seal",
        },
        { onConflict: "user_id" }
      );

      if (error) throw error;

      setHasPublicKey(true);
      setMyAlg("crypto_box_seal");
      setMsg("E2EE enabled on this device (public key registered).");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_enable_e2ee");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  // --- Vault unlock (cache key locally from my share) ---
  async function unlockVaultOnThisDevice() {
    setBusy("unlock");
    setMsg(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const me = sessionData.session?.user;
      if (!me?.id) throw new Error("not_authenticated");

      const { data: share, error: shareErr } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", pid)
        .eq("user_id", me.id)
        .maybeSingle();

      if (shareErr) throw shareErr;

      if (!share?.wrapped_key) {
        throw new Error("No vault share found for you. Ask the controller to share the vault key.");
      }

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

      writeCachedVaultKey(pid, me.id, vaultKey);
      setHasCached(true);
      setMsg("Vault unlocked on this device.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_unlock_vault");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function forgetVaultOnThisDevice() {
    if (!uid) return;

    setBusy("forget");
    setMsg(null);

    try {
      forgetCachedVaultKey(pid, uid);
      setHasCached(false);
      setMsg("Vault key removed from this device.");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  // --- 2) Initialise NEW vault (regen + share to all) ---
  async function initialiseNewVault() {
    setBusy("init");
    setMsg(null);

    try {
      if (!pid) throw new Error("missing_pid");
      if (!uid) throw new Error("not_authenticated");
      if (!isController) throw new Error("Only a controller can initialise the vault.");

      // members
      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      if (memErr) throw memErr;

      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
      if (userIds.length === 0) throw new Error("No circle members found.");

      // public keys
      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) throw pkErr;

      const missing = userIds.filter((u) => !(pubKeys ?? []).some((p: any) => p.user_id === u));
      if (missing.length) throw new Error(`${missing.length} member(s) must enable E2EE first.`);

      const incompatible = (pubKeys ?? []).filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (incompatible.length) throw new Error("Some members have incompatible key algorithms. Ask them to re-enable E2EE.");

      // create NEW vault key locally (controller device)
      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      // cache for controller so "share to new members" works
      writeCachedVaultKey(pid, uid, vaultKey);

      // wrap for all
      const rows = await Promise.all(
        (pubKeys ?? []).map(async (p: any) => {
          const recipientPk = base64ToBytes(p.public_key);
          const wrapped = await wrapVaultKeyForRecipient({
            vaultKey,
            recipientPublicKey: recipientPk,
          });
          return { patient_id: pid, user_id: p.user_id, wrapped_key: wrapped };
        })
      );

      const { error: upErr } = await supabase
        .from("patient_vault_shares")
        .upsert(rows, { onConflict: "patient_id,user_id" });

      if (upErr) throw upErr;

      setMsg("Vault initialised (new key) and shared to all members with E2EE enabled.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_initialise_vault");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  // --- 3) Share EXISTING key to NEW members only (no regen) ---
  async function shareKeyToNewMembers() {
    setBusy("share");
    setMsg(null);

    try {
      if (!pid) throw new Error("missing_pid");
      if (!uid) throw new Error("not_authenticated");
      if (!isController) throw new Error("Only a controller can share the vault key.");

      const vaultKey = readCachedVaultKey(pid, uid);
      if (!vaultKey) {
        throw new Error("Vault key is not cached on this device. Unlock Vault on this device first.");
      }

      // members
      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      if (memErr) throw memErr;

      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
      if (userIds.length === 0) throw new Error("No circle members found.");

      // public keys
      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) throw pkErr;

      const missing = userIds.filter((u) => !(pubKeys ?? []).some((p: any) => p.user_id === u));
      if (missing.length) throw new Error(`${missing.length} member(s) must enable E2EE first.`);

      const incompatible = (pubKeys ?? []).filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (incompatible.length) throw new Error("Some members have incompatible key algorithms. Ask them to re-enable E2EE.");

      // existing shares
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
          return { patient_id: pid, user_id: p.user_id, wrapped_key: wrapped };
        })
      );

      const { error: upErr } = await supabase
        .from("patient_vault_shares")
        .upsert(rows, { onConflict: "patient_id,user_id" });

      if (upErr) throw upErr;

      setMsg(`Shared vault key to ${rows.length} new member(s).`);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_share_to_new_members");
    } finally {
      setBusy(null);
      await refresh();
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
            <div className="cc-subtle cc-wrap">Circle: {pid}</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">Hub</Link>
            <Link className="cc-btn" href="/app/account">Account</Link>
            <Link className="cc-btn cc-btn-secondary" href={`/app/patients/${pid}/vault`}>Vault</Link>
          </div>
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Message</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        {/* Vault status (formerly VaultClient) */}
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">Vault status</div>

          <div className="cc-row">
            <span className={`cc-pill ${hasCached ? "cc-pill-primary" : ""}`}>Cache: {hasCached ? "present" : "missing"}</span>
            <span className={`cc-pill ${hasShareRow ? "cc-pill-primary" : ""}`}>
              Share: {hasShareRow === null ? "unknown" : hasShareRow ? "present" : "missing"}
            </span>
            <span className={`cc-pill ${isController ? "cc-pill-primary" : ""}`}>Controller: {isController ? "true" : "false"}</span>
            <span className={`cc-pill ${keyOk ? "cc-pill-primary" : ""}`}>Device key: {keyOk ? "OK" : "missing/invalid"}</span>
          </div>

          <div className="cc-row">
            <button className="cc-btn cc-btn-primary" onClick={unlockVaultOnThisDevice} disabled={busy === "unlock"}>
              {busy === "unlock" ? "Unlocking…" : "Unlock vault on this device"}
            </button>

            <button className="cc-btn cc-btn-danger" onClick={forgetVaultOnThisDevice} disabled={busy === "forget" || !hasCached}>
              {busy === "forget" ? "Forgetting…" : "Forget vault on this device"}
            </button>

            <button className="cc-btn" onClick={refresh} disabled={!!busy}>
              Refresh
            </button>
          </div>

          {!hasCached ? (
            <div className="cc-panel">
              <div className="cc-strong">Tip</div>
              <div className="cc-subtle">
                If you’re a controller and want to share to new members, you must first unlock the vault on this device so the key is cached.
              </div>
            </div>
          ) : null}
        </div>

        {/* Device keys */}
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">1) Device encryption keys</div>
          <div className="cc-subtle">
            This registers your public key in <code>user_public_keys</code> using <b>crypto_box_seal</b>.
          </div>

          {hasPublicKey === true ? (
            <div className="cc-panel-soft">
              <div className="cc-small cc-subtle">Public key: OK</div>
              <div className="cc-small cc-subtle">Algorithm: {myAlg || "—"}</div>
            </div>
          ) : (
            <div className="cc-panel">
              <div className="cc-strong">Missing public key</div>
              <div className="cc-subtle">Enable E2EE on this device to participate in vault sharing.</div>
            </div>
          )}

          <div className="cc-row">
            <button className="cc-btn cc-btn-secondary" onClick={enableE2EEOnThisDevice} disabled={busy === "keys"}>
              {busy === "keys" ? "Enabling…" : hasPublicKey ? "Re-enable E2EE (replace)" : "Enable E2EE on this device"}
            </button>
            <Link className="cc-btn" href="/app/account">Open Account</Link>
          </div>
        </div>

        {/* Controller tools */}
        {isController ? (
          <>
            <div className="cc-card cc-card-pad cc-stack">
              <div className="cc-strong">2) Share key to new members (recommended)</div>
              <div className="cc-subtle">
                Uses the vault key cached on <b>this device</b> (does NOT regenerate). Creates shares only for members who don’t already have one.
              </div>

              <div className="cc-row">
                <button className="cc-btn cc-btn-primary" onClick={shareKeyToNewMembers} disabled={busy === "share" || !hasCached || !keyOk}>
                  {busy === "share" ? "Sharing…" : "Share key to new members"}
                </button>
              </div>

              {!hasCached ? (
                <div className="cc-small cc-subtle">
                  You must unlock the vault on this device first (so the key is cached) before you can share to new members.
                </div>
              ) : null}
              {!keyOk ? (
                <div className="cc-small cc-subtle">
                  Your device key must be registered as <b>crypto_box_seal</b> to share.
                </div>
              ) : null}
            </div>

            <div className="cc-card cc-card-pad cc-stack">
              <div className="cc-strong">3) Initialise NEW vault key (advanced / destructive)</div>
              <div className="cc-subtle">
                Generates a brand new vault key and shares it to all members. This can break decryption of older encrypted data.
              </div>

              <div className="cc-row">
                <button className="cc-btn cc-btn-danger" onClick={initialiseNewVault} disabled={busy === "init" || !keyOk}>
                  {busy === "init" ? "Initialising…" : "Initialise NEW vault key"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="cc-card cc-card-pad cc-stack">
            <div className="cc-strong">Controller tools</div>
            <div className="cc-subtle">You are not a controller for this circle.</div>
          </div>
        )}
      </div>
    </div>
  );
}