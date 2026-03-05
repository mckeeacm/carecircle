"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";
import {
  wrapVaultKeyForRecipient,
  unwrapVaultKeyForMe,
  type WrappedKeyV1,
} from "@/lib/e2ee/vaultShares";

type Props = { pid: string };

type CacheRecord = {
  v: 1;
  createdAt: number;
  expiresAt: number;
  vaultKeyB64: string; // base64 raw 32 bytes
};

type MemberRow = {
  user_id: string;
  role: string | null;
  is_controller: boolean | null;
};

type PublicKeyRow = {
  user_id: string;
  public_key: string;
  algorithm: string | null;
};

type ShareRow = {
  user_id: string;
  wrapped_key: any;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
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

/** Accept many shapes, but require Uint8Array at the end. */
function pickUint8Key(k: any): Uint8Array | null {
  if (!k) return null;
  if (k instanceof Uint8Array) return k;
  if (ArrayBuffer.isView(k) && (k as any).buffer) return new Uint8Array((k as any).buffer);
  if (k instanceof ArrayBuffer) return new Uint8Array(k);
  return null;
}

function extractDeviceKeys(kp: any): { pk: Uint8Array; sk: Uint8Array } {
  const pk =
    pickUint8Key(kp?.publicKey) ??
    pickUint8Key(kp?.public_key) ??
    pickUint8Key(kp?.pk) ??
    pickUint8Key(kp?.keys?.publicKey) ??
    pickUint8Key(kp?.keys?.pk);

  const sk =
    pickUint8Key(kp?.secretKey) ??
    pickUint8Key(kp?.secret_key) ??
    pickUint8Key(kp?.privateKey) ??
    pickUint8Key(kp?.private_key) ??
    pickUint8Key(kp?.sk) ??
    pickUint8Key(kp?.keys?.secretKey) ??
    pickUint8Key(kp?.keys?.sk) ??
    pickUint8Key(kp?.keys?.privateKey);

  if (!pk || !sk) {
    const present = Object.keys(kp ?? {}).join(", ");
    throw new Error(`device_keypair_missing_keys (present fields: ${present || "none"})`);
  }

  return { pk, sk };
}

export default function VaultInitClient({ pid }: Props) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();

  const [uid, setUid] = useState<string>("");
  const [email, setEmail] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // device + vault status
  const [deviceKeyStatus, setDeviceKeyStatus] = useState<
    "unknown" | "present" | "missing"
  >("unknown");

  const [hasCached, setHasCached] = useState(false);
  const [hasShareRow, setHasShareRow] = useState<boolean | null>(null);

  // membership/controller
  const [isController, setIsController] = useState<boolean | null>(null);
  const [role, setRole] = useState<string | null>(null);

  // controller data
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [pubKeys, setPubKeys] = useState<PublicKeyRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);

  const pidOk = isUuid(pid);

  async function hardRefreshNext() {
    router.refresh();
  }

  async function refreshAll() {
    setLoading(true);
    setMsg(null);

    try {
      if (!pidOk) {
        setMsg("Missing or invalid circle ID. This page must be opened from a circle route.");
        setLoading(false);
        return;
      }

      // Session
      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;

      const me = sessionData.session?.user;
      if (!me?.id) {
        // Don’t show a sign-in button; just explain.
        setUid("");
        setEmail("");
        setIsController(null);
        setRole(null);
        setHasCached(false);
        setHasShareRow(null);
        setDeviceKeyStatus("unknown");
        setMembers([]);
        setPubKeys([]);
        setShares([]);
        setMsg("No active session. Please sign in via the main app, then return to this page.");
        setLoading(false);
        return;
      }

      setUid(me.id);
      setEmail(me.email ?? "");

      // Cached vault key?
      const cached = readCachedVaultKey(pid, me.id);
      setHasCached(!!cached);

      // Share row exists?
      const { data: share } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", pid)
        .eq("user_id", me.id)
        .maybeSingle();

      setHasShareRow(!!(share as any)?.wrapped_key);

      // Membership role + controller from table (more reliable than RPC output)
      const { data: mem, error: memErr } = await supabase
        .from("patient_members")
        .select("role, is_controller")
        .eq("patient_id", pid)
        .eq("user_id", me.id)
        .maybeSingle();

      if (memErr) throw memErr;

      setRole((mem as any)?.role ?? null);
      setIsController((mem as any)?.is_controller === true);

      // Device key presence (row in user_public_keys with correct algorithm)
      const { data: pkRow } = await supabase
        .from("user_public_keys")
        .select("user_id, algorithm")
        .eq("user_id", me.id)
        .maybeSingle();

      if (!pkRow?.user_id) {
        setDeviceKeyStatus("missing");
      } else {
        // We strongly prefer crypto_box_seal here
        setDeviceKeyStatus("present");
      }

      // Controller: load members, public keys, shares
      if ((mem as any)?.is_controller === true) {
        const { data: mems, error: memsErr } = await supabase
          .from("patient_members")
          .select("user_id, role, is_controller")
          .eq("patient_id", pid)
          .order("created_at", { ascending: true });

        if (memsErr) throw memsErr;
        setMembers((mems ?? []) as any);

        const userIds = (mems ?? []).map((m: any) => m.user_id).filter(Boolean);
        if (userIds.length > 0) {
          const { data: pks, error: pksErr } = await supabase
            .from("user_public_keys")
            .select("user_id, public_key, algorithm")
            .in("user_id", userIds);

          if (pksErr) throw pksErr;
          setPubKeys((pks ?? []) as any);

          const { data: shr, error: shrErr } = await supabase
            .from("patient_vault_shares")
            .select("user_id, wrapped_key")
            .eq("patient_id", pid)
            .in("user_id", userIds);

          if (shrErr) throw shrErr;
          setShares((shr ?? []) as any);
        } else {
          setPubKeys([]);
          setShares([]);
        }
      } else {
        setMembers([]);
        setPubKeys([]);
        setShares([]);
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

  async function enableE2EEOnThisDevice() {
    setBusy("device-keys");
    setMsg(null);

    try {
      if (!uid) throw new Error("not_authenticated");

      const kp: any = await getOrCreateDeviceKeypair();
      const { pk } = extractDeviceKeys(kp);

      const public_key = bytesToBase64(pk);

      const { error } = await supabase.from("user_public_keys").upsert(
        {
          user_id: uid,
          public_key,
          algorithm: "crypto_box_seal",
        },
        { onConflict: "user_id" }
      );

      if (error) throw error;

      setDeviceKeyStatus("present");
      setMsg("E2EE enabled on this device (public key registered).");
      await refreshAll();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_register_public_key");
    } finally {
      setBusy(null);
    }
  }

  async function unlockVaultOnThisDevice() {
    setBusy("unlock");
    setMsg(null);

    try {
      if (!uid) throw new Error("not_authenticated");

      const { data: share } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", pid)
        .eq("user_id", uid)
        .maybeSingle();

      if (!(share as any)?.wrapped_key) {
        setHasShareRow(false);
        throw new Error("No vault share found for your account. Ask the controller to share the vault key.");
      }

      const wrapped = (share as any).wrapped_key as WrappedKeyV1;

      const kp: any = await getOrCreateDeviceKeypair();
      const { pk: myPublicKey, sk: myPrivateKey } = extractDeviceKeys(kp);

      const vaultKey = await unwrapVaultKeyForMe({
        wrapped,
        myPublicKey,
        myPrivateKey,
      });

      writeCachedVaultKey(pid, uid, vaultKey);

      setHasCached(true);
      setHasShareRow(true);
      setMsg("Vault unlocked on this device (cached for 30 days).");
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

  function controllerSummary() {
    const memberIds = new Set(members.map((m) => m.user_id));
    const pkByUid = new Map(pubKeys.map((p) => [p.user_id, p]));
    const shareByUid = new Map(shares.map((s) => [s.user_id, s]));

    const missingPublicKeys: string[] = [];
    const wrongAlg: string[] = [];
    const missingShares: string[] = [];

    for (const uid of memberIds) {
      const pk = pkByUid.get(uid);
      const sh = shareByUid.get(uid);

      if (!pk) missingPublicKeys.push(uid);
      else if ((pk.algorithm ?? "").trim() !== "crypto_box_seal") wrongAlg.push(uid);

      if (!sh?.wrapped_key) missingShares.push(uid);
    }

    return { missingPublicKeys, wrongAlg, missingShares };
  }

  async function recreateVaultAndShareToAll() {
    setBusy("recreate-all");
    setMsg(null);

    try {
      if (!uid) throw new Error("not_authenticated");
      if (!pidOk) throw new Error("missing_or_invalid_pid");

      // Must be controller (client check; RLS will enforce anyway)
      if (isController !== true) throw new Error("Only a controller can initialise/recreate the vault.");

      // Members
      const { data: mems, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      if (memErr) throw memErr;

      const userIds = (mems ?? []).map((m: any) => m.user_id).filter(Boolean);
      if (userIds.length === 0) throw new Error("No circle members found.");

      // Public keys
      const { data: pks, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) throw pkErr;

      const pkRows = (pks ?? []) as any[];

      const missing = userIds.filter((id) => !pkRows.some((p) => p.user_id === id));
      if (missing.length) {
        throw new Error(`${missing.length} member(s) are missing device keys. Ask them to enable E2EE in Account.`);
      }

      const incompatible = pkRows.filter((p) => (p.algorithm ?? "").trim() !== "crypto_box_seal");
      if (incompatible.length) {
        throw new Error("Some members have incompatible key algorithms. They must re-enable E2EE (crypto_box_seal).");
      }

      // Create new vault key locally
      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      // Cache it for controller (this device)
      writeCachedVaultKey(pid, uid, vaultKey);
      setHasCached(true);

      // Replace shares (delete then insert) – keeps it simple + avoids drift
      const { error: delErr } = await supabase
        .from("patient_vault_shares")
        .delete()
        .eq("patient_id", pid)
        .in("user_id", userIds);

      if (delErr) throw delErr;

      const rows = await Promise.all(
        pkRows.map(async (p) => {
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

      const { error: insErr } = await supabase.from("patient_vault_shares").insert(rows);
      if (insErr) throw insErr;

      setMsg("Vault recreated and shared to all circle members (vault key rotated).");
      await refreshAll();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_recreate_vault");
    } finally {
      setBusy(null);
    }
  }

  async function shareExistingVaultToNewMembers() {
    setBusy("share-new");
    setMsg(null);

    try {
      if (!uid) throw new Error("not_authenticated");
      if (!pidOk) throw new Error("missing_or_invalid_pid");

      if (isController !== true) throw new Error("Only a controller can share vault keys.");

      // Need an existing vault key on THIS device
      const vaultKey = readCachedVaultKey(pid, uid);
      if (!vaultKey) {
        throw new Error(
          "No cached vault key found on this device. Unlock the vault first (or recreate vault) before sharing to new members."
        );
      }

      const { data: mems, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      if (memErr) throw memErr;

      const userIds = (mems ?? []).map((m: any) => m.user_id).filter(Boolean);

      // Public keys for all members
      const { data: pks, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) throw pkErr;

      const pkRows = (pks ?? []) as any[];

      const missing = userIds.filter((id) => !pkRows.some((p) => p.user_id === id));
      if (missing.length) {
        throw new Error(`${missing.length} member(s) are missing device keys. Ask them to enable E2EE in Account.`);
      }

      const incompatible = pkRows.filter((p) => (p.algorithm ?? "").trim() !== "crypto_box_seal");
      if (incompatible.length) {
        throw new Error("Some members have incompatible key algorithms. They must re-enable E2EE (crypto_box_seal).");
      }

      // Existing shares for patient
      const { data: existingShares, error: shErr } = await supabase
        .from("patient_vault_shares")
        .select("user_id")
        .eq("patient_id", pid)
        .in("user_id", userIds);

      if (shErr) throw shErr;

      const have = new Set((existingShares ?? []).map((s: any) => s.user_id));
      const missingShareUids = userIds.filter((u) => !have.has(u));

      if (missingShareUids.length === 0) {
        setMsg("Everyone already has a vault share. Nothing to do.");
        return;
      }

      const targets = pkRows.filter((p) => missingShareUids.includes(p.user_id));

      const rows = await Promise.all(
        targets.map(async (p) => {
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

      const { error: insErr } = await supabase.from("patient_vault_shares").insert(rows);
      if (insErr) throw insErr;

      setMsg(`Shared existing vault key to ${rows.length} new member(s).`);
      await refreshAll();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_share_to_new_members");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="cc-page">
        <div className="cc-container cc-card cc-card-pad">Loading vault setup…</div>
      </div>
    );
  }

  const ctl = controllerSummary();

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Vault setup</h1>
            <div className="cc-subtle cc-wrap">Circle: {pidOk ? pid : "—"}</div>
            <div className="cc-small cc-subtle cc-wrap">
              Signed in as: {email || uid || "—"} {role ? `• role: ${role}` : ""}
              {isController === true ? " • controller: true" : isController === false ? " • controller: false" : ""}
            </div>
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

        {/* Top controls */}
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row">
            <button className="cc-btn" onClick={refreshAll} disabled={!!busy}>
              Refresh
            </button>
            <button className="cc-btn" onClick={hardRefreshNext} disabled={!!busy}>
              Hard refresh (Next.js)
            </button>
          </div>

          <div className="cc-strong">Vault controls</div>

          <div className="cc-row" style={{ flexWrap: "wrap" }}>
            <span className={`cc-pill ${hasCached ? "cc-pill-primary" : ""}`}>
              Cache: {hasCached ? "present" : "missing"}
            </span>

            <span className={`cc-pill ${hasShareRow ? "cc-pill-primary" : ""}`}>
              Share: {hasShareRow === null ? "unknown" : hasShareRow ? "present" : "missing"}
            </span>

            <span className={`cc-pill ${isController ? "cc-pill-primary" : ""}`}>
              Controller: {isController === null ? "unknown" : isController ? "true" : "false"}
            </span>

            <span className={`cc-pill ${deviceKeyStatus === "present" ? "cc-pill-primary" : ""}`}>
              Device key: {deviceKeyStatus}
            </span>
          </div>

          <div className="cc-row" style={{ flexWrap: "wrap" }}>
            <button
              className="cc-btn cc-btn-primary"
              onClick={unlockVaultOnThisDevice}
              disabled={busy === "unlock" || !pidOk || !uid}
            >
              {busy === "unlock" ? "Unlocking…" : "Unlock vault on this device"}
            </button>

            <button
              className="cc-btn cc-btn-danger"
              onClick={forgetVaultOnThisDevice}
              disabled={busy === "forget" || !pidOk || !uid || !hasCached}
            >
              {busy === "forget" ? "Forgetting…" : "Forget vault on this device"}
            </button>

            <button
              className="cc-btn cc-btn-secondary"
              onClick={enableE2EEOnThisDevice}
              disabled={busy === "device-keys" || !uid}
            >
              {busy === "device-keys" ? "Enabling…" : "Enable E2EE on this device (public key)"}
            </button>
          </div>

          <div className="cc-small cc-subtle">
            The vault key stays client-side and is cached in localStorage for 30 days. Clearing browser data means you must unlock again.
          </div>
        </div>

        {/* Controller tools */}
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">Controller tools</div>
          <div className="cc-subtle">
            These actions require you to be a controller. RLS will enforce this even if the UI lies.
          </div>

          {isController !== true ? (
            <div className="cc-panel">
              <div className="cc-strong">Not a controller (or not detected)</div>
              <div className="cc-subtle">
                If you believe you are a controller, click Refresh. Controller detection here is read from <code>patient_members.is_controller</code>.
              </div>
            </div>
          ) : (
            <>
              <div className="cc-panel-soft cc-stack">
                <div className="cc-strong">Recreate vault (rotates key)</div>
                <div className="cc-subtle">
                  Generates a brand-new vault key on this device and shares it to <b>all</b> members. Existing shares are replaced.
                </div>
                <button
                  className="cc-btn cc-btn-primary"
                  onClick={recreateVaultAndShareToAll}
                  disabled={busy === "recreate-all" || !pidOk || !uid}
                >
                  {busy === "recreate-all" ? "Working…" : "Recreate vault and share to all members"}
                </button>
              </div>

              <div className="cc-panel-soft cc-stack">
                <div className="cc-strong">Share existing vault key to new members</div>
                <div className="cc-subtle">
                  Does <b>not</b> rotate the vault key. Uses the cached vault key on this device, and only creates shares for members who don’t have one.
                </div>
                <button
                  className="cc-btn"
                  onClick={shareExistingVaultToNewMembers}
                  disabled={busy === "share-new" || !pidOk || !uid}
                >
                  {busy === "share-new" ? "Sharing…" : "Share existing vault key to new members"}
                </button>
              </div>

              <div className="cc-panel">
                <div className="cc-strong">Circle health</div>
                <div className="cc-small cc-subtle">
                  Missing public keys: <b>{ctl.missingPublicKeys.length}</b> • Wrong algorithm: <b>{ctl.wrongAlg.length}</b> • Missing shares:{" "}
                  <b>{ctl.missingShares.length}</b>
                </div>
              </div>

              {members.length ? (
                <div className="cc-panel-soft cc-stack">
                  <div className="cc-strong">Members</div>
                  <div className="cc-small cc-subtle">
                    Public keys must be <code>crypto_box_seal</code> for vault sharing. Shares are stored in <code>patient_vault_shares</code>.
                  </div>

                  <div className="cc-stack">
                    {members.map((m) => {
                      const pk = pubKeys.find((p) => p.user_id === m.user_id) ?? null;
                      const sh = shares.find((s) => s.user_id === m.user_id) ?? null;

                      const pkOk = pk?.algorithm?.trim() === "crypto_box_seal";
                      const hasPk = !!pk?.public_key;
                      const hasSh = !!sh?.wrapped_key;

                      return (
                        <div key={m.user_id} className="cc-row-between cc-panel" style={{ alignItems: "flex-start" }}>
                          <div className="cc-wrap">
                            <div className="cc-strong">
                              {m.user_id} {m.is_controller ? " (controller)" : ""}
                            </div>
                            <div className="cc-small">
                              role: <b>{m.role ?? "—"}</b>
                            </div>
                            <div className="cc-small">
                              public key:{" "}
                              <b>{hasPk ? (pkOk ? "OK" : `wrong (${pk?.algorithm ?? "unknown"})`) : "missing"}</b> • share:{" "}
                              <b>{hasSh ? "present" : "missing"}</b>
                            </div>
                          </div>

                          <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <span className={`cc-pill ${hasPk && pkOk ? "cc-pill-primary" : ""}`}>
                              PK
                            </span>
                            <span className={`cc-pill ${hasSh ? "cc-pill-primary" : ""}`}>
                              Share
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="cc-small cc-subtle">No member list loaded.</div>
              )}
            </>
          )}
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">Back to vault</div>
          <div className="cc-row">
            <Link className="cc-btn cc-btn-secondary" href={`/app/patients/${pid}/vault`}>
              Open Vault page
            </Link>
          </div>
        </div>

        <div className="cc-small cc-subtle">
          This page is secure: vault key generation + caching happens client-side; the server stores only wrapped shares (jsonb ciphertext).
        </div>
      </div>
    </div>
  );
}