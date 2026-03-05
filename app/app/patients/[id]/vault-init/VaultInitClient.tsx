"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { wrapVaultKeyForRecipient } from "@/lib/e2ee/vaultShares";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";

type Props = { pid: string };

type Status =
  | "checking"
  | "need_signin"
  | "need_keys"
  | "ready"
  | "initialising"
  | "sharing"
  | "done"
  | "error";

type CacheRecord = {
  v: 1;
  createdAt: number;
  expiresAt: number;
  vaultKeyB64: string; // base64 raw bytes
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
  } catch {
    // ignore
  }
}

export default function VaultInitClient({ pid }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [uid, setUid] = useState<string>("");
  const [email, setEmail] = useState<string>("");

  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");

  const [isController, setIsController] = useState<boolean>(false);
  const [hasPublicKey, setHasPublicKey] = useState<boolean>(false);
  const [myAlg, setMyAlg] = useState<string>("");

  const [hasCachedVaultKey, setHasCachedVaultKey] = useState<boolean>(false);

  async function loadAuth() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    const user = data.session?.user;
    if (!user?.id) {
      setUid("");
      setEmail("");
      return null;
    }

    setUid(user.id);
    setEmail(user.email ?? "");
    return user.id;
  }

  async function loadMyPublicKeyState(userId: string) {
    const { data, error } = await supabase
      .from("user_public_keys")
      .select("user_id, algorithm")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;

    setHasPublicKey(!!data?.user_id);
    setMyAlg((data as any)?.algorithm ?? "");
    return !!data?.user_id;
  }

  async function loadControllerState() {
    const { data, error } = await supabase.rpc("is_patient_controller", { pid });
    if (error) throw error;

    const ok = data === true;
    setIsController(ok);
    return ok;
  }

  async function refresh() {
    setMsg("");
    setStatus("checking");

    try {
      if (!pid) {
        setStatus("error");
        setMsg("Missing circle ID.");
        return;
      }

      const userId = await loadAuth();
      if (!userId) {
        setStatus("need_signin");
        setMsg("Please sign in to continue.");
        return;
      }

      await loadControllerState();

      const hasKey = await loadMyPublicKeyState(userId);
      if (!hasKey) {
        setStatus("need_keys");
      } else if (myAlg && myAlg !== "crypto_box_seal") {
        setStatus("need_keys");
        setMsg(
          `Your device key is registered as "${myAlg}". CareCircle vault sharing expects "crypto_box_seal". Click “Re-enable E2EE” to replace it.`
        );
      } else {
        setStatus("ready");
      }

      const cached = readCachedVaultKey(pid, userId);
      setHasCachedVaultKey(!!cached);
    } catch (e: any) {
      setStatus("error");
      setMsg(e?.message ?? "Failed to load vault setup.");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  async function enableE2EEOnThisDevice() {
    setBusy("keys");
    setMsg("");

    try {
      const userId = uid || (await loadAuth());
      if (!userId) {
        setStatus("need_signin");
        setMsg("Please sign in to enable E2EE.");
        return;
      }

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

      setHasPublicKey(true);
      setMyAlg("crypto_box_seal");
      setStatus("ready");
      setMsg("E2EE enabled on this device (public key registered).");
    } catch (e: any) {
      setStatus("error");
      setMsg(e?.message ?? "Failed to enable E2EE.");
    } finally {
      setBusy(null);
    }
  }

  // ⚠️ Regenerates a new vault key and overwrites shares.
  async function initialiseNewVault() {
    setBusy("init");
    setMsg("");
    setStatus("initialising");

    try {
      if (!pid) throw new Error("missing_pid");
      const userId = uid || (await loadAuth());
      if (!userId) throw new Error("not_authenticated");

      const { data: isCtl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid });
      if (ctlErr) throw ctlErr;
      if (!isCtl) throw new Error("Only a circle controller can initialise the vault.");

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

      const missing = userIds.filter((u) => !(pubKeys ?? []).some((p: any) => p.user_id === u));
      if (missing.length) {
        throw new Error(
          `${missing.length} member(s) must enable E2EE (Account → Enable E2EE) before you can initialise vault sharing.`
        );
      }

      const incompatible = (pubKeys ?? []).filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (incompatible.length) {
        throw new Error("Some members have incompatible key algorithms. Ask them to re-enable E2EE.");
      }

      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      // cache the key for the controller device so "share to new members" works immediately
      writeCachedVaultKey(pid, userId, vaultKey);
      setHasCachedVaultKey(true);

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

      // Requires unique constraint on (patient_id, user_id). If missing, upsert will error.
      const { error: upErr } = await supabase
        .from("patient_vault_shares")
        .upsert(rows, { onConflict: "patient_id,user_id" });

      if (upErr) throw upErr;

      setStatus("done");
      setMsg("Vault initialised successfully. Members can now open Vault to unlock on their devices.");

      router.push(`/app/patients/${pid}/vault`);
      router.refresh();
    } catch (e: any) {
      setStatus("error");
      setMsg(e?.message ?? "Vault initialisation failed.");
    } finally {
      setBusy(null);
    }
  }

  // ✅ Uses EXISTING cached key (does NOT regenerate)
  async function shareKeyToNewMembers() {
    setBusy("share");
    setMsg("");
    setStatus("sharing");

    try {
      if (!pid) throw new Error("missing_pid");
      const userId = uid || (await loadAuth());
      if (!userId) throw new Error("not_authenticated");

      const { data: isCtl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid });
      if (ctlErr) throw ctlErr;
      if (!isCtl) throw new Error("Only a circle controller can share the vault key.");

      const vaultKey = readCachedVaultKey(pid, userId);
      if (!vaultKey) {
        throw new Error(
          "This device does not have the vault key cached. Open Vault for this circle and unlock it first, then return here to share to new members."
        );
      }

      // All members
      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", pid);

      if (memErr) throw memErr;

      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
      if (userIds.length === 0) throw new Error("No circle members found.");

      // Their public keys
      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);

      if (pkErr) throw pkErr;

      const missingPk = userIds.filter((u) => !(pubKeys ?? []).some((p: any) => p.user_id === u));
      if (missingPk.length) {
        throw new Error(
          `${missingPk.length} member(s) still need to enable E2EE (Account → Enable E2EE) before you can share the vault key to them.`
        );
      }

      const incompatible = (pubKeys ?? []).filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (incompatible.length) {
        throw new Error("Some members have incompatible key algorithms. Ask them to re-enable E2EE.");
      }

      // Existing shares (to avoid rewriting everyone unless you want that)
      const { data: existingShares, error: shErr } = await supabase
        .from("patient_vault_shares")
        .select("user_id")
        .eq("patient_id", pid);

      if (shErr) throw shErr;

      const existing = new Set((existingShares ?? []).map((r: any) => r.user_id).filter(Boolean));
      const targets = (pubKeys ?? []).filter((p: any) => !existing.has(p.user_id));

      if (targets.length === 0) {
        setStatus("done");
        setMsg("No new members found who need a share. Everyone already has a vault share.");
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

      setStatus("done");
      setMsg(
        `Shared vault key to ${rows.length} new member(s). Ask them to open Vault for this circle to unlock on their devices.`
      );
    } catch (e: any) {
      setStatus("error");
      setMsg(e?.message ?? "Sharing failed.");
    } finally {
      setBusy(null);
    }
  }

  const showSignin = status === "need_signin";
  const showNeedKeys = status === "need_keys";
  const canInit = isController && hasPublicKey && (myAlg === "" || myAlg === "crypto_box_seal") && !busy;
  const canShare = isController && hasCachedVaultKey && !busy;

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Vault setup</h1>
            <div className="cc-subtle">Controller tools for E2EE vault sharing.</div>
            <div className="cc-small cc-subtle cc-wrap">Circle: {pid}</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">Hub</Link>
            <Link className="cc-btn" href="/app/account">Account</Link>
            <Link className="cc-btn cc-btn-secondary" href={`/app/patients/${pid}/vault`}>Vault</Link>
          </div>
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">
              {status === "error" ? "Error" : "Message"}
            </div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">Status</div>

          <div className="cc-row">
            <span className={`cc-pill ${uid ? "cc-pill-primary" : ""}`}>
              Sign-in: {uid ? "OK" : "missing"}
            </span>

            <span className={`cc-pill ${hasPublicKey ? "cc-pill-primary" : ""}`}>
              Device key: {hasPublicKey ? "OK" : "missing"}
            </span>

            <span className={`cc-pill ${isController ? "cc-pill-primary" : ""}`}>
              Controller: {isController ? "true" : "false"}
            </span>

            <span className="cc-pill">Alg: {myAlg || "—"}</span>

            <span className={`cc-pill ${hasCachedVaultKey ? "cc-pill-primary" : ""}`}>
              Vault key cached: {hasCachedVaultKey ? "yes" : "no"}
            </span>
          </div>

          {email ? <div className="cc-small cc-subtle cc-wrap">Signed in as: {email}</div> : null}

          <div className="cc-row">
            <button className="cc-btn" onClick={refresh} disabled={!!busy}>
              Refresh
            </button>

            {showSignin ? (
              <Link
                className="cc-btn cc-btn-primary"
                href={`/?next=${encodeURIComponent(`/app/patients/${pid}/vault-init`)}`}
              >
                Sign in
              </Link>
            ) : null}
          </div>
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">1) Device encryption keys</div>
          <div className="cc-subtle">
            Each member must enable E2EE so they have a <code>user_public_keys</code> row. We register <b>crypto_box_seal</b>.
          </div>

          {showNeedKeys ? (
            <div className="cc-panel">
              <div className="cc-strong">Keys required</div>
              <div className="cc-subtle">
                Your account needs device keys registered before you can initialise or share a vault.
              </div>
            </div>
          ) : null}

          <div className="cc-row">
            <button
              className="cc-btn cc-btn-primary"
              onClick={enableE2EEOnThisDevice}
              disabled={busy === "keys"}
            >
              {busy === "keys" ? "Enabling…" : hasPublicKey ? "Re-enable E2EE (replace key)" : "Enable E2EE on this device"}
            </button>

            <Link className="cc-btn" href="/app/account">
              Open Account
            </Link>
          </div>

          <div className="cc-small cc-subtle">
            If you previously registered a different algorithm (e.g. x25519-xsalsa20-poly1305), “Re-enable E2EE” overwrites it to match vault sharing.
          </div>
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">2) Initialise (creates a NEW vault key)</div>
          <div className="cc-subtle">
            This generates a new vault key on this device and shares it to all members with registered public keys.
            <b> Only do this if you understand it can break decryption of old encrypted data.</b>
          </div>

          {!isController ? (
            <div className="cc-panel">
              <div className="cc-strong">Controller required</div>
              <div className="cc-subtle">Only controllers can initialise or share vault keys.</div>
            </div>
          ) : null}

          <div className="cc-row">
            <button
              className="cc-btn cc-btn-secondary"
              onClick={initialiseNewVault}
              disabled={!canInit || busy === "init"}
            >
              {busy === "init" || status === "initialising" ? "Initialising…" : "Initialise (new vault key)"}
            </button>

            <Link className="cc-btn" href={`/app/patients/${pid}/vault`}>
              Open Vault
            </Link>
          </div>
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">3) Share key to new members (does NOT regenerate)</div>
          <div className="cc-subtle">
            This uses the vault key cached on <b>this device</b> and creates shares only for members who don’t already have one.
            If “Vault key cached” is <b>no</b>, open Vault and unlock first.
          </div>

          {!hasCachedVaultKey ? (
            <div className="cc-panel">
              <div className="cc-strong">Vault key not cached here</div>
              <div className="cc-subtle">
                Open <b>Vault</b> for this circle and unlock to cache the key on this device, then return here to share to new members.
              </div>
            </div>
          ) : null}

          <div className="cc-row">
            <button
              className="cc-btn cc-btn-primary"
              onClick={shareKeyToNewMembers}
              disabled={!canShare || busy === "share"}
            >
              {busy === "share" || status === "sharing" ? "Sharing…" : "Share key to new members"}
            </button>

            <Link className="cc-btn" href={`/app/patients/${pid}/vault`}>
              Go to Vault
            </Link>
          </div>

          <div className="cc-small cc-subtle">
            Note: if upsert fails, you likely don’t have a unique constraint on <code>(patient_id, user_id)</code> in <code>patient_vault_shares</code>.
            If that happens, paste the error and I’ll give you the exact SQL (copy/paste) to fix it.
          </div>
        </div>
      </div>
    </div>
  );
}