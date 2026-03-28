"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";
import {
  unwrapVaultKeyForMe,
  wrapVaultKeyForRecipient,
  type WrappedKeyV1,
} from "@/lib/e2ee/vaultShares";
import MobileShell from "@/app/components/MobileShell";
import { useUserLanguage } from "@/app/components/UserLanguageProvider";
import { getPageUi } from "@/lib/pageUi";

type CacheRecord = {
  v: 1;
  createdAt: number;
  expiresAt: number;
  vaultKeyB64: string;
};

type StatusKind = "idle" | "loading" | "ready" | "working" | "waiting" | "error";

function isUuid(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

function normaliseId(raw: unknown): string {
  if (!raw) return "";
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw);
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
  } catch {}
}

function forgetCachedVaultKey(pid: string, uid: string) {
  try {
    localStorage.removeItem(cacheKey(pid, uid));
  } catch {}
}

function pickUint8(kp: any, keys: string[]): Uint8Array | null {
  for (const k of keys) {
    const v = kp?.[k];
    if (v instanceof Uint8Array) return v;
  }
  return null;
}

function normaliseSecretKey(sk: Uint8Array): Uint8Array {
  if (sk.length === 32) return sk;
  if (sk.length >= 32) return sk.slice(0, 32);
  return sk;
}

async function getMatchedBoxKeypairOrThrow(): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  const kp: any = await getOrCreateDeviceKeypair();

  const rawSk =
    pickUint8(kp, ["secretKey", "secret_key", "sk", "privateKey", "private_key"]) ?? null;

  if (!(rawSk instanceof Uint8Array)) {
    throw new Error("device_keypair_missing_keys");
  }

  const privateKey = normaliseSecretKey(rawSk);
  const sodium = await getSodium();
  const publicKey = sodium.crypto_scalarmult_base(privateKey);

  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) {
    throw new Error("device_keypair_missing_public_key");
  }

  return { publicKey, privateKey };
}

export default function VaultInitClient() {
  const params = useParams();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const pid = normaliseId((params as any)?.id);
  const { languageCode } = useUserLanguage();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [uid, setUid] = useState<string>("");
  const [email, setEmail] = useState<string>("");

  const [statusKind, setStatusKind] = useState<StatusKind>("idle");
  const [statusTitle, setStatusTitle] = useState<string>("Checking secure access");
  const [statusText, setStatusText] = useState<string>("");

  const [msg, setMsg] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  const [hasPublicKey, setHasPublicKey] = useState<boolean | null>(null);
  const [myAlg, setMyAlg] = useState<string>("");
  const [hasShareRow, setHasShareRow] = useState<boolean | null>(null);
  const [hasCached, setHasCached] = useState(false);
  const [isController, setIsController] = useState<boolean | null>(null);

  const ui = getPageUi("vaultInit", languageCode);

  async function getSessionUser() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.user ?? null;
  }

  async function refreshState(userOverride?: { id: string; email?: string | null }) {
    setMsg(null);

    if (!pid || !isUuid(pid)) {
      setUid("");
      setEmail("");
      setHasPublicKey(null);
      setMyAlg("");
      setHasShareRow(null);
      setHasCached(false);
      setIsController(null);
      setStatusKind("error");
      setStatusTitle("Circle link is invalid");
      setStatusText("This secure access page needs a valid circle route.");
      return;
    }

    const user = userOverride ?? (await getSessionUser());

    if (!user?.id) {
      setUid("");
      setEmail("");
      setHasPublicKey(null);
      setMyAlg("");
      setHasShareRow(null);
      setHasCached(false);
      setIsController(null);
      setStatusKind("waiting");
      setStatusTitle("Sign in needed");
      setStatusText("Please sign in first, then reopen this page.");
      return;
    }

    setUid(user.id);
    setEmail(user.email ?? "");

    const cached = readCachedVaultKey(pid, user.id);
    setHasCached(!!cached);

    const { data: ctl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid });
    if (ctlErr) throw ctlErr;
    setIsController(ctl === true);

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

    const { data: share, error: shareErr } = await supabase
      .from("patient_vault_shares")
      .select("wrapped_key")
      .eq("patient_id", pid)
      .eq("user_id", user.id)
      .maybeSingle();

    if (shareErr) setHasShareRow(null);
    else setHasShareRow(!!share?.wrapped_key);

    if (cached) {
      setStatusKind("ready");
      setStatusTitle("Secure access is ready");
      setStatusText("This device can now open encrypted content for this circle.");
      return;
    }

    if (share?.wrapped_key) {
      setStatusKind("idle");
      setStatusTitle("Secure access is almost ready");
      setStatusText("This device has a secure share. Tap the button below to finish setup.");
      return;
    }

    if (ctl === true) {
      setStatusKind("idle");
      setStatusTitle("Set up secure access for this circle");
      setStatusText("As circle owner, you can set up secure access for yourself and share it to members.");
      return;
    }

    setStatusKind("waiting");
    setStatusTitle("Waiting for circle owner");
    setStatusText(
      "Your device key is ready, but the circle owner still needs to share secure access to you."
    );
  }

  async function registerMyPublicKeyIfNeeded(userId: string) {
    const { publicKey } = await getMatchedBoxKeypairOrThrow();

    const { error } = await supabase.from("user_public_keys").upsert(
      {
        user_id: userId,
        public_key: bytesToBase64(publicKey),
        algorithm: "crypto_box_seal",
      },
      { onConflict: "user_id" }
    );
    if (error) throw error;
  }

  async function tryUnlockForCurrentUser(userId: string) {
    const { data: share, error: shareErr } = await supabase
      .from("patient_vault_shares")
      .select("wrapped_key")
      .eq("patient_id", pid)
      .eq("user_id", userId)
      .maybeSingle();

    if (shareErr) throw shareErr;
    if (!share?.wrapped_key) return false;

    const wrapped = share.wrapped_key as WrappedKeyV1;
    const { publicKey: myPublicKey, privateKey: myPrivateKey } = await getMatchedBoxKeypairOrThrow();

    const vaultKey = await unwrapVaultKeyForMe({
      wrapped,
      myPublicKey,
      myPrivateKey,
    });

    writeCachedVaultKey(pid, userId, vaultKey);
    return true;
  }

  async function shareOrInitialiseAsController(userId: string): Promise<number> {
    const cachedVault = readCachedVaultKey(pid, userId);

    if (cachedVault) {
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

      const compatible = (pubKeys ?? []).filter((p: any) => p.algorithm === "crypto_box_seal");

      console.log("vault share userIds", userIds);
      console.log("vault share pubKeys", pubKeys);
      console.log("vault share compatible", compatible);

      if (compatible.length === 0) return 0;

      const { data: existing, error: exErr } = await supabase
        .from("patient_vault_shares")
        .select("user_id")
        .eq("patient_id", pid);
      if (exErr) throw exErr;

      const existingSet = new Set((existing ?? []).map((r: any) => r.user_id).filter(Boolean));
      const targets = compatible.filter((p: any) => !existingSet.has(p.user_id));

      console.log("vault share existing", existing);
      console.log("vault share existingSet", Array.from(existingSet));
      console.log("vault share targets", targets);

      if (targets.length === 0) return 0;

      const rows = await Promise.all(
        targets.map(async (p: any) => {
          const recipientPk = base64ToBytes(p.public_key);
          const wrapped = await wrapVaultKeyForRecipient({
            vaultKey: cachedVault,
            recipientPublicKey: recipientPk,
          });
          return { patient_id: pid, user_id: p.user_id, wrapped_key: wrapped };
        })
      );

      console.log("vault share rows to upsert", rows);

      const { error: upErr } = await supabase
        .from("patient_vault_shares")
        .upsert(rows, { onConflict: "patient_id,user_id" });

      console.log("vault share upsert error", upErr);

      if (upErr) throw upErr;

      return rows.length;
    }

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

    const compatible = (pubKeys ?? []).filter((p: any) => p.algorithm === "crypto_box_seal");

    console.log("vault init members", userIds);
    console.log("vault init pubKeys", pubKeys);
    console.log("vault init compatible", compatible);

    if (compatible.length === 0) return 0;

    const sodium = await getSodium();
    const vaultKey = sodium.randombytes_buf(32);

    writeCachedVaultKey(pid, userId, vaultKey);

    const rows = await Promise.all(
      compatible.map(async (p: any) => {
        const recipientPk = base64ToBytes(p.public_key);
        const wrapped = await wrapVaultKeyForRecipient({
          vaultKey,
          recipientPublicKey: recipientPk,
        });
        return { patient_id: pid, user_id: p.user_id, wrapped_key: wrapped };
      })
    );

    console.log("vault init rows to upsert", rows);

    const { error: upErr } = await supabase
      .from("patient_vault_shares")
      .upsert(rows, { onConflict: "patient_id,user_id" });

    console.log("vault init upsert error", upErr);

    if (upErr) throw upErr;

    return rows.length;
  }

  async function fixSecureAccess() {
    setBusy("fix");
    setMsg(null);
    setStatusKind("working");
    setStatusTitle("Fixing secure access");
    setStatusText("Please keep this page open for a moment.");

    try {
      if (!pid || !isUuid(pid)) throw new Error("invalid_circle_id");

      const user = await getSessionUser();
      if (!user?.id) throw new Error("not_authenticated");

      setUid(user.id);
      setEmail(user.email ?? "");

      setStatusText("Checking this device key…");
      await registerMyPublicKeyIfNeeded(user.id);

      setStatusText("Checking circle access…");
      const { data: ctl, error: ctlErr } = await supabase.rpc("is_patient_controller", { pid });
      if (ctlErr) throw ctlErr;
      const controller = ctl === true;
      setIsController(controller);

      setStatusText("Checking for a secure share…");
      const { data: share, error: shareErr } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", pid)
        .eq("user_id", user.id)
        .maybeSingle();
      if (shareErr) throw shareErr;

      if (!share?.wrapped_key && controller) {
        setStatusText("Creating or sharing secure access…");
        await shareOrInitialiseAsController(user.id);
      }

      setStatusText("Refreshing secure share status…");
      const { data: shareAfter, error: shareAfterErr } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", pid)
        .eq("user_id", user.id)
        .maybeSingle();
      if (shareAfterErr) throw shareAfterErr;

      if (!shareAfter?.wrapped_key && !controller) {
        await refreshState({ id: user.id, email: user.email });
        setStatusKind("waiting");
        setStatusTitle("Waiting for circle owner");
        setStatusText(
          "Your device is ready, but the circle owner still needs to share secure access to you."
        );
        return;
      }

      setStatusText("Unlocking this circle on your device…");
      const unlocked = await tryUnlockForCurrentUser(user.id);

      if (!unlocked) {
        throw new Error("share_still_missing_after_setup");
      }

      await refreshState({ id: user.id, email: user.email });
      setStatusKind("ready");
      setStatusTitle("Secure access is ready");
      setStatusText("You can now open encrypted content for this circle on this device.");
    } catch (e: any) {
      const text = e?.message ?? "failed_to_fix_secure_access";

      if (typeof text === "string" && text.toLowerCase().includes("incorrect key pair")) {
        setStatusKind("error");
        setStatusTitle("This device needs a secure refresh");
        setStatusText(
          "This circle share was tied to an older device key. Use Advanced troubleshooting to reset this device, then try again."
        );
        setMsg(
          "This share was encrypted for a different device keypair. Reset this device key and re-share secure access."
        );
      } else {
        setStatusKind("error");
        setStatusTitle("Secure access could not be completed");
        setStatusText("Please try again. If this keeps happening, use Advanced troubleshooting below.");
        setMsg(text);
      }

      await refreshState().catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  async function resetThisDeviceAndForgetVault() {
    setBusy("reset");
    setMsg(null);

    try {
      const user = await getSessionUser();
      if (!user?.id) throw new Error("not_authenticated");

      forgetCachedVaultKey(pid, user.id);
      await registerMyPublicKeyIfNeeded(user.id);
      await refreshState({ id: user.id, email: user.email });
      setStatusKind("idle");
      setStatusTitle("This device was reset");
      setStatusText("Now run Fix secure access again.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_reset_device");
    } finally {
      setBusy(null);
    }
  }

  async function shareKeyToNewMembers() {
    setBusy("share");
    setMsg(null);

    try {
      const user = await getSessionUser();
      if (!user?.id) throw new Error("not_authenticated");
      if (isController !== true) throw new Error("Only a controller can share secure access.");

      const sharedCount = await shareOrInitialiseAsController(user.id);
      await refreshState({ id: user.id, email: user.email });

      setMsg(
        sharedCount > 0
          ? `Secure access shared to ${sharedCount} member${sharedCount === 1 ? "" : "s"}.`
          : "No ready members were missing a secure share."
      );
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_share");
    } finally {
      setBusy(null);
    }
  }

  async function initialiseNewVaultKey() {
    setBusy("rekey");
    setMsg(null);

    try {
      const user = await getSessionUser();
      if (!user?.id) throw new Error("not_authenticated");
      if (isController !== true) throw new Error("Only a controller can rekey this circle.");

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

      const compatible = (pubKeys ?? []).filter((p: any) => p.algorithm === "crypto_box_seal");
      if (compatible.length === 0) throw new Error("No members are ready for secure access.");

      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);
      writeCachedVaultKey(pid, user.id, vaultKey);

      const rows = await Promise.all(
        compatible.map(async (p: any) => {
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

      await refreshState({ id: user.id, email: user.email });
      setMsg("A NEW secure key was created and shared. Older encrypted items may still need the previous key.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_rekey");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        await refreshState();
      } catch (e: any) {
        if (!alive) return;
        setMsg(e?.message ?? "failed_to_load");
        setStatusKind("error");
        setStatusTitle("Could not load secure access");
        setStatusText("Please refresh this page.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const u = session?.user;
      refreshState(u ? { id: u.id, email: u.email } : undefined).catch(() => {});
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  if (loading) {
    return (
      <MobileShell
        title={ui.title}
        subtitle={ui.loadingTitle}
        patientId={isUuid(pid) ? pid : undefined}
        rightSlot={
          <Link className="cc-btn" href="/app/account">
            {ui.account}
          </Link>
        }
      >
        <div className="cc-card cc-card-pad">{ui.loadingCard}</div>
      </MobileShell>
    );
  }

  return (
    <MobileShell
      title={ui.title}
      subtitle={email ? `${ui.signedInAs} ${email}` : pid || ui.secureAccess}
      patientId={isUuid(pid) ? pid : undefined}
      rightSlot={
        <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link className="cc-btn" href="/app/hub">
            {ui.hub}
          </Link>
          <Link className="cc-btn" href="/app/account">
            {ui.account}
          </Link>
        </div>
      }
    >
      {msg ? (
        <div className="cc-status cc-status-error">
          <div className="cc-status-error-title">{ui.message}</div>
          <div className="cc-wrap">{msg}</div>
        </div>
      ) : null}

      <div
        className={`cc-card cc-card-pad cc-stack ${
          statusKind === "ready"
            ? "cc-panel-green"
            : statusKind === "waiting"
            ? "cc-panel-blue"
            : statusKind === "error"
            ? "cc-status cc-status-error"
            : ""
        }`}
      >
        <div className="cc-strong" style={{ fontSize: 28 }}>
          {statusTitle}
        </div>
        <div className="cc-subtle cc-wrap">{statusText}</div>

        <div className="cc-row">
          <button
            className="cc-btn cc-btn-primary"
            onClick={fixSecureAccess}
            disabled={busy === "fix"}
          >
            {busy === "fix" ? ui.fixingAction : ui.fixAction}
          </button>

          {hasCached && isUuid(pid) ? (
            <Link className="cc-btn" href={`/app/patients/${pid}/today`}>
              {ui.continueToday}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-strong">{ui.whatThisDoes}</div>
        <div className="cc-small cc-subtle">
          {ui.whatThisDoesText}
        </div>
      </div>

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div className="cc-strong">{ui.advanced}</div>
          <button className="cc-btn" onClick={() => setDebugOpen((v) => !v)}>
            {debugOpen ? ui.hide : ui.show}
          </button>
        </div>

        {debugOpen ? (
          <>
            <div className="cc-row" style={{ flexWrap: "wrap" }}>
              <span className={`cc-pill ${hasPublicKey ? "cc-pill-primary" : ""}`}>
                {ui.deviceKey}: {hasPublicKey ? ui.ok : hasPublicKey === null ? ui.unknown : ui.missing}
              </span>
              <span className={`cc-pill ${hasShareRow ? "cc-pill-primary" : ""}`}>
                {ui.shareRow}: {hasShareRow === null ? ui.unknown : hasShareRow ? ui.present : ui.missing}
              </span>
              <span className={`cc-pill ${hasCached ? "cc-pill-primary" : ""}`}>
                {ui.cachedVault}: {hasCached ? ui.present : ui.missing}
              </span>
              <span className={`cc-pill ${isController ? "cc-pill-primary" : ""}`}>
                {ui.controller}: {isController === null ? ui.unknown : isController ? ui.trueLabel : ui.falseLabel}
              </span>
              <span className="cc-pill">{myAlg || "-"}</span>
            </div>

            <div className="cc-row">
              <button className="cc-btn" onClick={() => refreshState()} disabled={!!busy}>
                {ui.refreshStatus}
              </button>

              <button
                className="cc-btn"
                onClick={resetThisDeviceAndForgetVault}
                disabled={busy === "reset" || !uid}
              >
                {busy === "reset" ? ui.resetting : ui.resetDevice}
              </button>

              {isController ? (
                <button
                  className="cc-btn"
                  onClick={shareKeyToNewMembers}
                  disabled={busy === "share"}
                >
                  {busy === "share" ? ui.sharing : ui.shareReady}
                </button>
              ) : null}
            </div>

            {isController ? (
              <div className="cc-panel">
                <div className="cc-strong">{ui.dangerZone}</div>
                <div className="cc-small cc-subtle">
                  {ui.dangerText}
                </div>
                <div className="cc-spacer-12" />
                <button
                  className="cc-btn cc-btn-danger"
                  onClick={initialiseNewVaultKey}
                  disabled={busy === "rekey"}
                >
                  {busy === "rekey" ? ui.rekeying : ui.newKey}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </MobileShell>
  );
}
