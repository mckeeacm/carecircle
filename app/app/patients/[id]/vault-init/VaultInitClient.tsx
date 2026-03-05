"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";
import {
  wrapVaultKeyForRecipient,
  unwrapVaultKeyForMe,
  type WrappedKeyV1,
} from "@/lib/e2ee/vaultShares";
import { getSodium } from "@/lib/e2ee/sodium";

type Props = { pid: string };

type CacheRecord = {
  v: 1;
  createdAt: number;
  expiresAt: number;
  vaultKeyB64: string;
};

function isUuid(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

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
  } catch {
    // ignore
  }
}

function forgetCachedVaultKey(pid: string, uid: string) {
  try {
    localStorage.removeItem(cacheKey(pid, uid));
  } catch {
    // ignore
  }
}

/**
 * Robustly extract device keys from whatever shape your deviceKeys helper returns.
 * This fixes your: device_keypair_missing_keys
 */
async function getDeviceKeysOrThrow(): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  const kp: any = await getOrCreateDeviceKeypair();

  const publicKey: Uint8Array =
    kp?.publicKey ?? kp?.public_key ?? kp?.pk ?? kp?.public ?? null;

  const secretKey: Uint8Array =
    kp?.secretKey ?? kp?.secret_key ?? kp?.sk ?? kp?.privateKey ?? kp?.private_key ?? null;

  if (!(publicKey instanceof Uint8Array)) {
    throw new Error("device_keypair_missing_public_key");
  }
  if (!(secretKey instanceof Uint8Array)) {
    throw new Error("device_keypair_missing_keys");
  }

  return { publicKey, secretKey };
}

export default function VaultInitClient({ pid }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [uid, setUid] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [hasCached, setHasCached] = useState(false);
  const [hasShareRow, setHasShareRow] = useState<boolean | null>(null);

  const [isControllerRpc, setIsControllerRpc] = useState<boolean | null>(null);
  const [isControllerMembership, setIsControllerMembership] = useState<boolean | null>(null);

  const [hasDeviceKeys, setHasDeviceKeys] = useState<boolean | null>(null);
  const [myPublicKeyAlg, setMyPublicKeyAlg] = useState<string | null>(null);

  // For controller panels
  const [membersTotal, setMembersTotal] = useState<number | null>(null);
  const [membersMissingShares, setMembersMissingShares] = useState<number | null>(null);
  const [membersMissingKeys, setMembersMissingKeys] = useState<number | null>(null);
  const [membersWrongAlg, setMembersWrongAlg] = useState<number | null>(null);

  async function refreshAll() {
    setLoading(true);
    setMsg(null);

    try {
      if (!isUuid(pid)) {
        setMsg("Missing or invalid circle ID. This page must be opened from a circle route.");
        return;
      }

      const { data: sessionData, error: sErr } = await supabase.auth.getSession();
      if (sErr) throw sErr;

      const me = sessionData.session?.user;
      if (!me?.id) {
        setUid("");
        setMsg("Please sign in to continue.");
        return;
      }
      setUid(me.id);

      // Device key presence (local)
      try {
        await getDeviceKeysOrThrow();
        setHasDeviceKeys(true);
      } catch {
        setHasDeviceKeys(false);
      }

      // My public key row (server)
      {
        const { data, error } = await supabase
          .from("user_public_keys")
          .select("algorithm")
          .eq("user_id", me.id)
          .maybeSingle();

        if (!error) setMyPublicKeyAlg(data?.algorithm ?? null);
      }

      // Cache
      setHasCached(!!readCachedVaultKey(pid, me.id));

      // My share row (RLS: should be allowed for own row)
      {
        const { data, error } = await supabase
          .from("patient_vault_shares")
          .select("id")
          .eq("patient_id", pid)
          .eq("user_id", me.id)
          .maybeSingle();

        if (error) {
          setHasShareRow(null);
        } else {
          setHasShareRow(!!data?.id);
        }
      }

      // Controller status (membership table)
      {
        const { data, error } = await supabase
          .from("patient_members")
          .select("is_controller")
          .eq("patient_id", pid)
          .eq("user_id", me.id)
          .maybeSingle();

        if (error) {
          setIsControllerMembership(null);
        } else {
          setIsControllerMembership(data?.is_controller === true);
        }
      }

      // Controller status (RPC) — must be CLIENT-side, using browser session
      {
        const { data, error } = await supabase.rpc("is_patient_controller", { pid });
        if (error) {
          setIsControllerRpc(null);
        } else {
          setIsControllerRpc(data === true);
        }
      }

      // Controller panel stats (best-effort)
      // Only run if controller membership true-ish (don’t block on RPC)
      const controllerMaybe = (isControllerMembership ?? false) || (isControllerRpc ?? false);
      if (controllerMaybe) {
        const { data: members, error: memErr } = await supabase
          .from("patient_members")
          .select("user_id")
          .eq("patient_id", pid);

        if (!memErr) {
          const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
          setMembersTotal(userIds.length);

          // Which members have public keys?
          const { data: keys } = await supabase
            .from("user_public_keys")
            .select("user_id, algorithm")
            .in("user_id", userIds);

          const keyRows = keys ?? [];
          const missingKeys = userIds.filter((u) => !keyRows.some((k: any) => k.user_id === u));
          const wrongAlg = keyRows.filter((k: any) => k.algorithm !== "crypto_box_seal");

          setMembersMissingKeys(missingKeys.length);
          setMembersWrongAlg(wrongAlg.length);

          // Which members are missing vault shares?
          const { data: shares } = await supabase
            .from("patient_vault_shares")
            .select("user_id")
            .eq("patient_id", pid)
            .in("user_id", userIds);

          const shareRows = shares ?? [];
          const missingShares = userIds.filter((u) => !shareRows.some((s: any) => s.user_id === u));
          setMembersMissingShares(missingShares.length);
        }
      } else {
        setMembersTotal(null);
        setMembersMissingKeys(null);
        setMembersWrongAlg(null);
        setMembersMissingShares(null);
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_vault_setup");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  async function ensureMyPublicKeyRowCryptoBoxSeal() {
    setBusy("device-keys");
    setMsg(null);
    try {
      if (!uid) throw new Error("not_authenticated");

      const { publicKey } = await getDeviceKeysOrThrow();

      const { error } = await supabase.from("user_public_keys").upsert(
        {
          user_id: uid,
          public_key: bytesToBase64(publicKey),
          algorithm: "crypto_box_seal",
        },
        { onConflict: "user_id" }
      );

      if (error) throw error;

      setMsg("Device keys are enabled for E2EE on this device (crypto_box_seal).");
      await refreshAll();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_enable_device_keys");
    } finally {
      setBusy(null);
    }
  }

  async function unlockVaultOnThisDevice() {
    setBusy("unlock");
    setMsg(null);

    try {
      if (!isUuid(pid)) throw new Error("missing_or_invalid_pid");

      const { data: sessionData, error: sErr } = await supabase.auth.getSession();
      if (sErr) throw sErr;
      const me = sessionData.session?.user;
      if (!me?.id) throw new Error("not_authenticated");

      // Load my share
      const { data: share, error: shareErr } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", pid)
        .eq("user_id", me.id)
        .maybeSingle();

      if (shareErr) throw shareErr;

      if (!share?.wrapped_key) {
        throw new Error("No vault share found for your account. Ask the controller to share the vault key.");
      }

      const wrapped = share.wrapped_key as WrappedKeyV1;

      const { publicKey: myPublicKey, secretKey: myPrivateKey } = await getDeviceKeysOrThrow();

      const vaultKey = await unwrapVaultKeyForMe({
        wrapped,
        myPublicKey,
        myPrivateKey,
      });

      writeCachedVaultKey(pid, me.id, vaultKey);
      setHasCached(true);
      setHasShareRow(true);

      setMsg("Vault unlocked and cached on this device (30 days).");
      await refreshAll();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_unlock_vault");
    } finally {
      setBusy(null);
    }
  }

  async function forgetVaultOnThisDevice() {
    setBusy("forget");
    setMsg(null);

    try {
      if (!uid) throw new Error("not_authenticated");
      forgetCachedVaultKey(pid, uid);
      setHasCached(false);
      setMsg("Vault key removed from this device.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_forget_vault");
    } finally {
      setBusy(null);
    }
  }

  async function controllerInitialiseOrRecreateVault() {
    setBusy("init");
    setMsg(null);

    try {
      if (!isUuid(pid)) throw new Error("missing_or_invalid_pid");

      const { data: sessionData, error: sErr } = await supabase.auth.getSession();
      if (sErr) throw sErr;

      const me = sessionData.session?.user;
      if (!me?.id) throw new Error("not_authenticated");

      // Must be controller (RPC)
      const { data: isCtl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid });
      if (ctlErr) throw ctlErr;
      if (!isCtl) throw new Error("Only a circle controller can initialise the vault.");

      // Load members
      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      if (memErr) throw memErr;

      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
      if (userIds.length === 0) throw new Error("No circle members found.");

      // Load public keys
      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) throw pkErr;

      const pubKeyRows = pubKeys ?? [];

      const missingKeys = userIds.filter((u) => !pubKeyRows.some((p: any) => p.user_id === u));
      if (missingKeys.length > 0) {
        throw new Error(
          `Waiting for ${missingKeys.length} member(s) to enable E2EE (user_public_keys missing).`
        );
      }

      const wrongAlg = pubKeyRows.filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (wrongAlg.length > 0) {
        throw new Error(
          `Some members have incompatible key algorithms. They must re-enable E2EE so algorithm becomes crypto_box_seal.`
        );
      }

      // Generate new vault key locally
      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      // Wrap to all members, upsert shares
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

      const { error: upErr } = await supabase
        .from("patient_vault_shares")
        .upsert(rows, { onConflict: "patient_id,user_id" });

      if (upErr) throw upErr;

      // Also cache for controller on this device
      writeCachedVaultKey(pid, me.id, vaultKey);
      setHasCached(true);

      setMsg("Vault initialised/recreated and shared to all members. Vault key cached on this device.");
      await refreshAll();

      // Optional: take them to the Vault view after success
      router.push(`/app/patients/${pid}/vault`);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_initialise_vault");
    } finally {
      setBusy(null);
    }
  }

  async function controllerShareToNewMembers() {
    setBusy("share-new");
    setMsg(null);

    try {
      if (!isUuid(pid)) throw new Error("missing_or_invalid_pid");

      const { data: sessionData, error: sErr } = await supabase.auth.getSession();
      if (sErr) throw sErr;
      const me = sessionData.session?.user;
      if (!me?.id) throw new Error("not_authenticated");

      // Must be controller
      const { data: isCtl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid });
      if (ctlErr) throw ctlErr;
      if (!isCtl) throw new Error("Only a circle controller can share the vault.");

      // Need vault key cached locally to share without recreating
      const cached = readCachedVaultKey(pid, me.id);
      if (!cached) {
        throw new Error("Vault key is not cached on this device. Unlock vault first (or initialise/recreate).");
      }

      // Members
      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      if (memErr) throw memErr;
      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);

      // Existing shares
      const { data: shares, error: shErr } = await supabase
        .from("patient_vault_shares")
        .select("user_id")
        .eq("patient_id", pid)
        .in("user_id", userIds);

      if (shErr) throw shErr;
      const shareRows = shares ?? [];
      const missingShareUserIds = userIds.filter((u) => !shareRows.some((s: any) => s.user_id === u));

      if (missingShareUserIds.length === 0) {
        setMsg("No new members need a vault share right now.");
        await refreshAll();
        return;
      }

      // Public keys for missing-share members
      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", missingShareUserIds);

      if (pkErr) throw pkErr;
      const pubKeyRows = pubKeys ?? [];

      const missingKeys = missingShareUserIds.filter((u) => !pubKeyRows.some((p: any) => p.user_id === u));
      if (missingKeys.length > 0) {
        throw new Error(`Some new members haven’t enabled E2EE yet (${missingKeys.length} missing keys).`);
      }

      const wrongAlg = pubKeyRows.filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (wrongAlg.length > 0) {
        throw new Error("Some new members have incompatible E2EE algorithm. They must re-enable E2EE (crypto_box_seal).");
      }

      const rows = await Promise.all(
        pubKeyRows.map(async (p: any) => {
          const recipientPk = base64ToBytes(p.public_key);

          const wrapped = await wrapVaultKeyForRecipient({
            vaultKey: cached,
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

      setMsg(`Shared vault key to ${missingShareUserIds.length} new member(s).`);
      await refreshAll();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_share_to_new_members");
    } finally {
      setBusy(null);
    }
  }

  const controller =
    (isControllerMembership === true) || (isControllerRpc === true);

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
            <div className="cc-subtle cc-wrap">Circle: {isUuid(pid) ? pid : "—"}</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">Hub</Link>
            <Link className="cc-btn" href="/app/account">Account</Link>
          </div>
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Message</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        {/* Vault controls (always visible) */}
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">Vault controls</div>

          <div className="cc-row" style={{ flexWrap: "wrap" }}>
            <span className={`cc-pill ${hasCached ? "cc-pill-primary" : ""}`}>Cache: {hasCached ? "present" : "missing"}</span>
            <span className={`cc-pill ${hasShareRow ? "cc-pill-primary" : ""}`}>
              Share: {hasShareRow === null ? "unknown" : hasShareRow ? "present" : "missing"}
            </span>
            <span className={`cc-pill ${controller ? "cc-pill-primary" : ""}`}>
              Controller: {controller ? "true" : "false"}
            </span>
            <span className={`cc-pill ${hasDeviceKeys ? "cc-pill-primary" : ""}`}>
              Device key: {hasDeviceKeys === null ? "unknown" : hasDeviceKeys ? "ready" : "missing"}
            </span>
            <span className="cc-pill">
              Public key alg: {myPublicKeyAlg ?? "unknown"}
            </span>
          </div>

          <div className="cc-row" style={{ flexWrap: "wrap" }}>
            <button
              className="cc-btn"
              onClick={refreshAll}
              disabled={!!busy}
            >
              Refresh
            </button>

            <button
              className="cc-btn cc-btn-primary"
              onClick={unlockVaultOnThisDevice}
              disabled={busy === "unlock" || !isUuid(pid)}
            >
              {busy === "unlock" ? "Unlocking…" : "Unlock vault on this device"}
            </button>

            <button
              className="cc-btn cc-btn-danger"
              onClick={forgetVaultOnThisDevice}
              disabled={busy === "forget" || !uid || !hasCached}
            >
              {busy === "forget" ? "Forgetting…" : "Forget vault on this device"}
            </button>

            <button
              className="cc-btn cc-btn-secondary"
              onClick={ensureMyPublicKeyRowCryptoBoxSeal}
              disabled={busy === "device-keys" || !uid}
            >
              {busy === "device-keys" ? "Enabling…" : "Enable E2EE on this device"}
            </button>
          </div>

          <div className="cc-small cc-subtle">
            “Enable E2EE” creates/loads device keys locally and uploads only your public key to <code>user_public_keys</code> with algorithm <code>crypto_box_seal</code>.
          </div>
        </div>

        {/* Controller-only tools */}
        {controller ? (
          <div className="cc-card cc-card-pad cc-stack">
            <div className="cc-strong">Controller tools</div>
            <div className="cc-subtle">
              Initialise/recreate generates a brand new vault key and shares it to all members with compatible public keys.
              “Share to new members” keeps the same vault key and only creates shares for members who don’t have one yet.
            </div>

            <div className="cc-row" style={{ flexWrap: "wrap" }}>
              <span className="cc-pill">Members: {membersTotal ?? "—"}</span>
              <span className="cc-pill">Missing keys: {membersMissingKeys ?? "—"}</span>
              <span className="cc-pill">Wrong alg: {membersWrongAlg ?? "—"}</span>
              <span className="cc-pill">Missing shares: {membersMissingShares ?? "—"}</span>
            </div>

            <div className="cc-row" style={{ flexWrap: "wrap" }}>
              <button
                className="cc-btn cc-btn-primary"
                onClick={controllerInitialiseOrRecreateVault}
                disabled={busy === "init" || !isUuid(pid)}
              >
                {busy === "init" ? "Initialising…" : "Initialise / recreate vault"}
              </button>

              <button
                className="cc-btn"
                onClick={controllerShareToNewMembers}
                disabled={busy === "share-new" || !isUuid(pid)}
              >
                {busy === "share-new" ? "Sharing…" : "Share key to new members"}
              </button>

              <Link className="cc-btn" href={`/app/patients/${pid}/vault`}>
                Open Vault page
              </Link>
            </div>

            {!hasCached ? (
              <div className="cc-panel">
                <div className="cc-strong">Tip</div>
                <div className="cc-subtle">
                  To use “Share key to new members”, first click <b>Unlock vault on this device</b> (so the vault key is cached locally).
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="cc-card cc-card-pad cc-stack">
            <div className="cc-strong">Controller-only</div>
            <div className="cc-subtle">
              You’re not recognised as a controller here. If you are a controller in <code>patient_members</code> but the RPC says false,
              that means the call is not seeing your browser auth session. This page keeps all Supabase calls client-side to avoid that.
            </div>

            <div className="cc-row" style={{ flexWrap: "wrap" }}>
              <span className="cc-pill">is_controller (table): {isControllerMembership === null ? "unknown" : isControllerMembership ? "true" : "false"}</span>
              <span className="cc-pill">is_patient_controller(pid): {isControllerRpc === null ? "unknown" : isControllerRpc ? "true" : "false"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}