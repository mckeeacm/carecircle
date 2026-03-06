"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSodium } from "@/lib/e2ee/sodium";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";
import {
  unwrapVaultKeyForMe,
  wrapVaultKeyForRecipient,
  type WrappedKeyV1,
} from "@/lib/e2ee/vaultShares";

type CircleMembership = {
  patient_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
  created_at: string;
};

type PatientRow = {
  id: string;
  display_name: string | null;
  created_by: string;
  created_at: string;
};

type InviteAcceptResult = {
  patient_id: string;
  role: string;
  already_member: boolean;
};

type StepId = "invite" | "circle" | "vault" | "permissions" | "finish";

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

function safeBool(v: unknown) {
  return v === true;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function cacheKey(pid: string, uid: string) {
  return `carecircle:vaultkey:v1:${pid}:${uid}`;
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

async function getMatchedBoxKeypairOrThrow(): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
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

function StepRow({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div
      className={`cc-panel-soft cc-row ${active ? "cc-panel-blue" : ""}`}
      style={{ justifyContent: "flex-start" }}
    >
      <span
        className={`cc-pill ${done ? "cc-pill-primary" : ""}`}
        style={{ minWidth: 34, textAlign: "center" }}
      >
        {done ? "✓" : "•"}
      </span>
      <div style={{ fontWeight: active ? 900 : 800, opacity: done ? 0.9 : 0.85 }}>
        {label}
      </div>
    </div>
  );
}

export default function OnboardingClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const sp = useSearchParams();

  const inviteToken = (sp.get("invite") ?? "").trim();

  const [uid, setUid] = useState<string>("");
  const [email, setEmail] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [memberships, setMemberships] = useState<CircleMembership[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, PatientRow>>({});
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");

  const [hasPublicKey, setHasPublicKey] = useState<boolean | null>(null);
  const [myAlg, setMyAlg] = useState<string>("");
  const [hasVaultShare, setHasVaultShare] = useState<boolean>(false);
  const [hasCachedVault, setHasCachedVault] = useState<boolean>(false);

  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "checking" | "need_auth" | "accepting" | "accepted" | "error"
  >("idle");
  const [inviteResult, setInviteResult] = useState<InviteAcceptResult | null>(null);

  const [newCircleName, setNewCircleName] = useState<string>("");

  const [inviteNickname, setInviteNickname] = useState<string>("");
  const [inviteEmailDraft, setInviteEmailDraft] = useState<string>("");
  const [nicknameApplied, setNicknameApplied] = useState<boolean>(false);

  const selectedMembership =
    memberships.find((m) => m.patient_id === selectedPatientId) ?? null;
  const selectedPatient = selectedPatientId ? patientsById[selectedPatientId] : null;
  const isController = safeBool(selectedMembership?.is_controller);
  const keyOk = hasPublicKey === true && (myAlg === "" || myAlg === "crypto_box_seal");

  const currentStep: StepId = useMemo(() => {
    if (inviteToken && inviteStatus !== "accepted") return "invite";
    if (!selectedPatientId) return "circle";
    if (!keyOk || !hasCachedVault) return "vault";
    if (isController) return "permissions";
    return "finish";
  }, [inviteToken, inviteStatus, selectedPatientId, keyOk, hasCachedVault, isController]);

  async function getSessionUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user ?? null;
  }

  async function refreshPublicKey(userId: string) {
    try {
      const { data, error } = await supabase
        .from("user_public_keys")
        .select("user_id, algorithm")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw error;
      setHasPublicKey(!!data?.user_id);
      setMyAlg((data as any)?.algorithm ?? "");
    } catch {
      setHasPublicKey(null);
      setMyAlg("");
    }
  }

  async function refreshVaultStatus(patientId: string, userId: string) {
    setHasVaultShare(false);
    setHasCachedVault(!!readCachedVaultKey(patientId, userId));

    try {
      const { data, error } = await supabase
        .from("patient_vault_shares")
        .select("user_id")
        .eq("patient_id", patientId)
        .eq("user_id", userId)
        .limit(1);

      if (error) throw error;
      setHasVaultShare((data ?? []).length > 0);
    } catch {
      setHasVaultShare(false);
    }
  }

  async function applyInviteNickname(patientId: string, userId: string, nickname: string) {
    const clean = nickname.trim();
    if (!clean) return;
    try {
      const { error } = await supabase
        .from("patient_members")
        .update({ nickname: clean })
        .eq("patient_id", patientId)
        .eq("user_id", userId);

      if (!error) setNicknameApplied(true);
    } catch {}
  }

  async function refreshAll(preferredPid?: string) {
    setLoading(true);
    setMsg(null);

    try {
      const user = await getSessionUser();

      if (!user?.id) {
        setUid("");
        setEmail("");
        setMemberships([]);
        setPatientsById({});
        setSelectedPatientId("");
        setHasPublicKey(null);
        setMyAlg("");
        setHasVaultShare(false);
        setHasCachedVault(false);
        if (inviteToken) setInviteStatus("need_auth");
        return;
      }

      setUid(user.id);
      setEmail(user.email ?? "");
      setInviteEmailDraft(user.email ?? "");

      const metaNickname =
        typeof user.user_metadata?.circle_nickname === "string"
          ? user.user_metadata.circle_nickname
          : "";
      setInviteNickname((prev) => prev || metaNickname || "");

      await refreshPublicKey(user.id);

      const { data: mem, error: memErr } = await supabase
        .from("patient_members")
        .select("patient_id, role, nickname, is_controller, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (memErr) throw memErr;

      const ms = (mem ?? []) as CircleMembership[];
      setMemberships(ms);

      const ids = Array.from(new Set(ms.map((m) => m.patient_id))).filter(isUuid);

      if (ids.length === 0) {
        setPatientsById({});
        setSelectedPatientId("");
        setHasVaultShare(false);
        setHasCachedVault(false);
        return;
      }

      const { data: pts, error: ptsErr } = await supabase
        .from("patients")
        .select("id, display_name, created_by, created_at")
        .in("id", ids);

      if (ptsErr) throw ptsErr;

      const map: Record<string, PatientRow> = {};
      for (const p of (pts ?? []) as PatientRow[]) map[p.id] = p;
      setPatientsById(map);

      const nextPid =
        preferredPid && ids.includes(preferredPid)
          ? preferredPid
          : selectedPatientId && ids.includes(selectedPatientId)
          ? selectedPatientId
          : ms.find((m) => safeBool(m.is_controller))?.patient_id ?? ids[0];

      setSelectedPatientId(nextPid);

      if (nextPid) {
        await refreshVaultStatus(nextPid, user.id);

        const myMembership = ms.find((m) => m.patient_id === nextPid);
        if (!myMembership?.nickname && inviteNickname.trim() && !nicknameApplied) {
          await applyInviteNickname(nextPid, user.id, inviteNickname);
        }
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_onboarding");
    } finally {
      setLoading(false);
    }
  }

  async function acceptInviteIfPresent() {
    if (!inviteToken) return;

    setMsg(null);
    setInviteResult(null);
    setInviteStatus("checking");

    try {
      const user = await getSessionUser();
      if (!user?.id) {
        setInviteStatus("need_auth");
        return;
      }

      setInviteStatus("accepting");

      const { data, error } = await supabase.rpc("patient_invite_accept", {
        p_token: inviteToken,
      });

      if (error) throw error;

      const res = data as InviteAcceptResult;
      setInviteResult(res);
      setInviteStatus("accepted");

      const metaNickname =
        typeof user.user_metadata?.circle_nickname === "string"
          ? user.user_metadata.circle_nickname
          : "";
      if (metaNickname) setInviteNickname(metaNickname);

      await refreshAll(res.patient_id);

      if (metaNickname) {
        await applyInviteNickname(res.patient_id, user.id, metaNickname);
        await refreshAll(res.patient_id);
      }

      try {
        window.history.replaceState({}, "", "/app/onboarding");
      } catch {}
    } catch (e: any) {
      setInviteStatus("error");
      setMsg(e?.message ?? "failed_to_accept_invite");
    }
  }

  useEffect(() => {
    (async () => {
      await refreshAll();
      if (inviteToken) await acceptInviteIfPresent();
    })().catch((e: any) => setMsg(e?.message ?? "failed_to_boot_onboarding"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!uid || !selectedPatientId) return;
    refreshVaultStatus(selectedPatientId, uid).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, selectedPatientId]);

  async function createCircle() {
    if (!uid) return setMsg("Please sign in first.");

    const name = newCircleName.trim();
    if (!name) return setMsg("Please enter a circle name.");

    setBusy("create-circle");
    setMsg(null);

    try {
      const pid = crypto.randomUUID();
      const now = new Date().toISOString();

      const { error: pErr } = await supabase.from("patients").insert({
        id: pid,
        display_name: name,
        created_by: uid,
        created_at: now,
      });
      if (pErr) throw pErr;

      const { error: mErr } = await supabase.from("patient_members").insert({
        patient_id: pid,
        user_id: uid,
        role: "patient",
        nickname: null,
        is_controller: true,
        created_at: now,
      });
      if (mErr) throw mErr;

      const { error: seedErr } = await supabase.rpc("permissions_seed_defaults", { pid });
      if (seedErr) throw seedErr;

      setNewCircleName("");
      await refreshAll(pid);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_circle");
    } finally {
      setBusy(null);
    }
  }

  async function updateEmailDraft() {
    const clean = inviteEmailDraft.trim();
    if (!clean) return setMsg("Please enter your email address.");

    setBusy("email");
    setMsg(null);

    try {
      const { error } = await supabase.auth.updateUser({
        email: clean,
      });
      if (error) throw error;

      setMsg("Email update requested. Please check your inbox if confirmation is required.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_update_email");
    } finally {
      setBusy(null);
    }
  }

  async function enableE2EEOnThisDevice() {
    setBusy("keys");
    setMsg(null);

    try {
      const user = await getSessionUser();
      if (!user?.id) throw new Error("not_authenticated");

      const { publicKey } = await getMatchedBoxKeypairOrThrow();

      const { error } = await supabase.from("user_public_keys").upsert(
        {
          user_id: user.id,
          public_key: bytesToBase64(publicKey),
          algorithm: "crypto_box_seal",
        },
        { onConflict: "user_id" }
      );

      if (error) throw error;

      await refreshAll(selectedPatientId || undefined);
      setMsg("E2EE is enabled on this device.");
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
      if (!selectedPatientId) throw new Error("select_circle_first");
      const user = await getSessionUser();
      if (!user?.id) throw new Error("not_authenticated");

      const { data: share, error: shareErr } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", selectedPatientId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (shareErr) throw shareErr;
      if (!share?.wrapped_key) {
        throw new Error("No vault share found yet. Enable E2EE on this device, then ask the controller to share the vault key.");
      }

      const wrapped = share.wrapped_key as WrappedKeyV1;
      const { publicKey: myPublicKey, privateKey: myPrivateKey } =
        await getMatchedBoxKeypairOrThrow();

      const vaultKey = await unwrapVaultKeyForMe({
        wrapped,
        myPublicKey,
        myPrivateKey,
      });

      writeCachedVaultKey(selectedPatientId, user.id, vaultKey);
      await refreshVaultStatus(selectedPatientId, user.id);
      setMsg("Vault unlocked on this device.");
    } catch (e: any) {
      const text = e?.message ?? "failed_to_unlock_vault";
      if (typeof text === "string" && text.toLowerCase().includes("incorrect key pair")) {
        setMsg(
          "This share was encrypted for an older device keypair. Re-enable E2EE on this device, then ask the controller to share the key again."
        );
      } else {
        setMsg(text);
      }
    } finally {
      setBusy(null);
    }
  }

  async function forgetVaultOnThisDevice() {
    if (!uid || !selectedPatientId) return;

    setBusy("forget");
    setMsg(null);

    try {
      forgetCachedVaultKey(selectedPatientId, uid);
      await refreshVaultStatus(selectedPatientId, uid);
      setMsg("Vault key removed from this device.");
    } finally {
      setBusy(null);
    }
  }

  async function shareKeyToNewMembers() {
    setBusy("share");
    setMsg(null);

    try {
      if (!selectedPatientId) throw new Error("select_circle_first");
      if (!uid) throw new Error("not_authenticated");
      if (!isController) throw new Error("Only a controller can share the vault key.");

      const vaultKey = readCachedVaultKey(selectedPatientId, uid);
      if (!vaultKey) {
        throw new Error("Unlock vault on this device first.");
      }

      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", selectedPatientId);
      if (memErr) throw memErr;

      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);

      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);
      if (pkErr) throw pkErr;

      const missing = userIds.filter((u) => !(pubKeys ?? []).some((p: any) => p.user_id === u));
      if (missing.length) {
        throw new Error(`${missing.length} member(s) must enable E2EE first.`);
      }

      const incompatible = (pubKeys ?? []).filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (incompatible.length) {
        throw new Error("Some members have incompatible device keys. Ask them to re-enable E2EE.");
      }

      const { data: existing, error: exErr } = await supabase
        .from("patient_vault_shares")
        .select("user_id")
        .eq("patient_id", selectedPatientId);
      if (exErr) throw exErr;

      const existingSet = new Set((existing ?? []).map((r: any) => r.user_id).filter(Boolean));
      const targets = (pubKeys ?? []).filter((p: any) => !existingSet.has(p.user_id));

      if (targets.length === 0) {
        setMsg("No new members need a share.");
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
            patient_id: selectedPatientId,
            user_id: p.user_id,
            wrapped_key: wrapped,
          };
        })
      );

      const { error: upErr } = await supabase
        .from("patient_vault_shares")
        .upsert(rows, { onConflict: "patient_id,user_id" });

      if (upErr) throw upErr;

      await refreshVaultStatus(selectedPatientId, uid);
      setMsg(`Shared vault key to ${rows.length} new member(s).`);
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
      if (!selectedPatientId) throw new Error("select_circle_first");
      if (!uid) throw new Error("not_authenticated");
      if (!isController) throw new Error("Only a controller can initialise a new vault key.");
      if (!keyOk) throw new Error("Enable E2EE on this device first.");

      const { data: members, error: memErr } = await supabase
        .from("patient_members")
        .select("user_id")
        .eq("patient_id", selectedPatientId);
      if (memErr) throw memErr;

      const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);

      const { data: pubKeys, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .in("user_id", userIds);
      if (pkErr) throw pkErr;

      const missing = userIds.filter((u) => !(pubKeys ?? []).some((p: any) => p.user_id === u));
      if (missing.length) {
        throw new Error(`${missing.length} member(s) must enable E2EE first.`);
      }

      const incompatible = (pubKeys ?? []).filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (incompatible.length) {
        throw new Error("Some members have incompatible device keys.");
      }

      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      writeCachedVaultKey(selectedPatientId, uid, vaultKey);

      const rows = await Promise.all(
        (pubKeys ?? []).map(async (p: any) => {
          const recipientPk = base64ToBytes(p.public_key);
          const wrapped = await wrapVaultKeyForRecipient({
            vaultKey,
            recipientPublicKey: recipientPk,
          });

          return {
            patient_id: selectedPatientId,
            user_id: p.user_id,
            wrapped_key: wrapped,
          };
        })
      );

      const { error: upErr } = await supabase
        .from("patient_vault_shares")
        .upsert(rows, { onConflict: "patient_id,user_id" });

      if (upErr) throw upErr;

      await refreshVaultStatus(selectedPatientId, uid);
      setMsg("Created a new vault key and shared it to all current circle members.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_initialise_vault");
    } finally {
      setBusy(null);
    }
  }

  async function seedDefaults() {
    if (!selectedPatientId) return;

    setBusy("seed");
    setMsg(null);

    try {
      const { error } = await supabase.rpc("permissions_seed_defaults", {
        pid: selectedPatientId,
      });
      if (error) throw error;
      setMsg("Permissions defaults seeded.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_seed_defaults");
    } finally {
      setBusy(null);
    }
  }

  const greetingName =
    selectedMembership?.nickname?.trim() ||
    inviteNickname.trim() ||
    "there";

  const doneInvite = !inviteToken || inviteStatus === "accepted";
  const doneCircle = !!selectedPatientId;
  const doneVault = !!selectedPatientId && keyOk && hasCachedVault;
  const donePermissions = !isController || (doneVault && isController);

  if (loading) {
    return (
      <div className="cc-page">
        <div className="cc-container cc-stack">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Onboarding</h1>
            <div className="cc-subtle">Loading…</div>
          </div>

          <div className="cc-card cc-card-pad">
            <div className="cc-subtle">Loading onboarding…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div>
          <div className="cc-kicker">CareCircle</div>
          <h1 className="cc-h1">Welcome, {greetingName}</h1>
          <div className="cc-subtle">
            Let’s get this device set up properly for your circle.
          </div>
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Message</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        <div className="cc-grid-2-125">
          <div className="cc-card cc-card-pad cc-stack">
            <div className="cc-strong">Setup steps</div>

            {inviteToken ? (
              <StepRow label="Join circle from invite" active={currentStep === "invite"} done={doneInvite} />
            ) : null}

            <StepRow label="Create or select a circle" active={currentStep === "circle"} done={doneCircle} />
            <StepRow label="Fix device keys and vault access" active={currentStep === "vault"} done={doneVault} />
            <StepRow label="Permissions defaults" active={currentStep === "permissions"} done={donePermissions} />
            <StepRow label="Finish" active={currentStep === "finish"} done={false} />

            {selectedPatientId ? (
              <div className="cc-panel">
                <div className="cc-small cc-subtle">Selected circle</div>
                <div className="cc-strong">{selectedPatient?.display_name ?? selectedPatientId}</div>
                <div className="cc-small cc-wrap">{selectedPatientId}</div>
                <div className="cc-small">
                  Role: <b>{selectedMembership?.role ?? "—"}</b>
                  {isController ? " • controller" : ""}
                </div>
              </div>
            ) : null}

            <div className="cc-row" style={{ flexWrap: "wrap" }}>
              <span className={`cc-pill ${hasPublicKey ? "cc-pill-primary" : ""}`}>
                Device key: {hasPublicKey ? "OK" : "missing"}
              </span>
              <span className={`cc-pill ${hasVaultShare ? "cc-pill-primary" : ""}`}>
                Share row: {hasVaultShare ? "present" : "missing"}
              </span>
              <span className={`cc-pill ${hasCachedVault ? "cc-pill-primary" : ""}`}>
                Cached vault: {hasCachedVault ? "present" : "missing"}
              </span>
              <span className={`cc-pill ${isController ? "cc-pill-primary" : ""}`}>
                Controller: {isController ? "true" : "false"}
              </span>
            </div>
          </div>

          <div className="cc-card cc-card-pad cc-stack">
            {currentStep === "invite" ? (
              <>
                <h2 className="cc-h2">Joining your circle</h2>
                <div className="cc-subtle">
                  We’ll accept the invite, confirm your details, then fix device key and vault access on this page.
                </div>

                {inviteStatus === "checking" || inviteStatus === "accepting" ? (
                  <div className="cc-status cc-status-loading">
                    <div className="cc-strong">
                      {inviteStatus === "checking" ? "Checking sign-in…" : "Accepting invite…"}
                    </div>
                    <div className="cc-subtle">Please keep this page open.</div>
                  </div>
                ) : null}

                {inviteStatus === "need_auth" ? (
                  <div className="cc-status cc-status-error">
                    <div className="cc-status-error-title">Sign in required</div>
                    <div className="cc-subtle">
                      Sign in first, then open the invite link again.
                    </div>
                  </div>
                ) : null}

                {inviteStatus === "error" ? (
                  <div className="cc-stack">
                    <div className="cc-status cc-status-error">
                      <div className="cc-status-error-title">Invite could not be accepted</div>
                      <div className="cc-wrap">{msg ?? "unknown_error"}</div>
                    </div>

                    <div className="cc-row">
                      <button className="cc-btn cc-btn-primary" onClick={acceptInviteIfPresent}>
                        Try again
                      </button>
                    </div>
                  </div>
                ) : null}

                {inviteStatus === "accepted" && inviteResult ? (
                  <>
                    <div className="cc-status cc-status-ok">
                      <div className="cc-strong">
                        {inviteResult.already_member
                          ? "You’re already in this circle."
                          : "You’ve joined the circle."}
                      </div>
                      <div className="cc-subtle">
                        role: <b>{inviteResult.role}</b>
                      </div>
                    </div>

                    <div className="cc-panel-blue cc-stack">
                      <div className="cc-strong">Please confirm your details</div>

                      <div className="cc-field">
                        <div className="cc-label">Name shown in this circle</div>
                        <input
                          className="cc-input"
                          value={inviteNickname}
                          onChange={(e) => setInviteNickname(e.target.value)}
                          placeholder="Your display name in this circle"
                        />
                      </div>

                      <div className="cc-field">
                        <div className="cc-label">Email address</div>
                        <input
                          className="cc-input"
                          type="email"
                          value={inviteEmailDraft}
                          onChange={(e) => setInviteEmailDraft(e.target.value)}
                          placeholder="you@example.com"
                        />
                      </div>

                      <div className="cc-row">
                        <button
                          className="cc-btn"
                          onClick={updateEmailDraft}
                          disabled={busy === "email"}
                        >
                          {busy === "email" ? "Saving…" : "Update email if needed"}
                        </button>
                      </div>

                      <div className="cc-small cc-subtle">
                        Your name will be saved into this circle membership automatically.
                      </div>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}

            {currentStep === "circle" ? (
              <>
                <h2 className="cc-h2">Create or select a circle</h2>
                <div className="cc-subtle">
                  Pick an existing circle or create a new one here.
                </div>

                {memberships.length > 0 ? (
                  <>
                    <div className="cc-field">
                      <div className="cc-label">Existing circles</div>
                      <select
                        className="cc-select"
                        value={selectedPatientId}
                        onChange={(e) => setSelectedPatientId(e.target.value)}
                      >
                        <option value="" disabled>
                          Select…
                        </option>
                        {memberships.map((m) => (
                          <option key={m.patient_id} value={m.patient_id}>
                            {(patientsById[m.patient_id]?.display_name ?? m.patient_id) +
                              (safeBool(m.is_controller) ? " (controller)" : "")}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="cc-small cc-subtle">Or create a new circle below.</div>
                  </>
                ) : (
                  <div className="cc-small cc-subtle">
                    You don’t belong to any circles yet, so create your first one below.
                  </div>
                )}

                <div className="cc-panel-soft cc-stack">
                  <div className="cc-strong">Create new circle</div>
                  <div className="cc-row">
                    <input
                      className="cc-input"
                      value={newCircleName}
                      onChange={(e) => setNewCircleName(e.target.value)}
                      placeholder="Circle name"
                    />
                    <button
                      className="cc-btn cc-btn-primary"
                      onClick={createCircle}
                      disabled={busy === "create-circle"}
                    >
                      {busy === "create-circle" ? "Creating…" : "Create"}
                    </button>
                  </div>
                  <div className="cc-small cc-subtle">
                    You’ll be set as controller for the new circle.
                  </div>
                </div>
              </>
            ) : null}

            {currentStep === "vault" ? (
              <>
                <h2 className="cc-h2">Fix device keys and vault access</h2>
                <div className="cc-subtle">
                  This is the step that usually causes trouble for invited members, so we fix it here first.
                </div>

                <div className="cc-card cc-card-pad cc-stack">
                  <div className="cc-strong">1) Enable E2EE on this device</div>
                  <div className="cc-subtle">
                    Your public key must be registered before a controller can share the vault key to this device.
                  </div>

                  <div className="cc-row">
                    <button
                      className="cc-btn cc-btn-primary"
                      onClick={enableE2EEOnThisDevice}
                      disabled={busy === "keys" || !uid}
                    >
                      {busy === "keys"
                        ? "Enabling…"
                        : hasPublicKey
                        ? "Re-enable E2EE on this device"
                        : "Enable E2EE on this device"}
                    </button>

                    <span className="cc-pill">{myAlg || "—"}</span>
                  </div>
                </div>

                <div className="cc-card cc-card-pad cc-stack">
                  <div className="cc-strong">2) Unlock vault on this device</div>
                  <div className="cc-subtle">
                    Once a share exists for you, unlock it here so this device can read encrypted content.
                  </div>

                  <div className="cc-row">
                    <button
                      className="cc-btn cc-btn-primary"
                      onClick={unlockVaultOnThisDevice}
                      disabled={busy === "unlock" || !uid || !selectedPatientId}
                    >
                      {busy === "unlock" ? "Unlocking…" : "Unlock vault on this device"}
                    </button>

                    <button
                      className="cc-btn cc-btn-danger"
                      onClick={forgetVaultOnThisDevice}
                      disabled={busy === "forget" || !uid || !selectedPatientId || !hasCachedVault}
                    >
                      {busy === "forget" ? "Forgetting…" : "Forget vault on this device"}
                    </button>

                    <button
                      className="cc-btn"
                      onClick={() => uid && selectedPatientId && refreshVaultStatus(selectedPatientId, uid)}
                      disabled={!uid || !selectedPatientId}
                    >
                      Recheck
                    </button>
                  </div>

                  {!hasVaultShare ? (
                    <div className="cc-small cc-subtle">
                      No share row detected yet. If you are not the controller, enable E2EE on this device and ask the controller to share the vault key.
                    </div>
                  ) : null}
                </div>

                {isController ? (
                  <div className="cc-card cc-card-pad cc-stack">
                    <div className="cc-strong">3) Controller tools</div>
                    <div className="cc-subtle">
                      You can handle member vault access from here too.
                    </div>

                    <div className="cc-row">
                      <button
                        className="cc-btn cc-btn-primary"
                        onClick={shareKeyToNewMembers}
                        disabled={busy === "share" || !selectedPatientId || !uid || !keyOk || !hasCachedVault}
                      >
                        {busy === "share" ? "Sharing…" : "Share key to new members"}
                      </button>

                      <button
                        className="cc-btn cc-btn-danger"
                        onClick={initialiseNewVaultKey}
                        disabled={busy === "init" || !selectedPatientId || !uid || !keyOk}
                      >
                        {busy === "init" ? "Initialising…" : "Initialise NEW vault key"}
                      </button>
                    </div>

                    <div className="cc-small cc-subtle">
                      Recommended: unlock or initialise the vault on your controller device, then share the key to new members.
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {currentStep === "permissions" ? (
              <>
                <h2 className="cc-h2">Permissions defaults</h2>
                <div className="cc-subtle">
                  As controller, seed default permissions so the circle starts cleanly.
                </div>

                <div className="cc-row">
                  <button
                    className="cc-btn cc-btn-primary"
                    onClick={seedDefaults}
                    disabled={busy === "seed" || !selectedPatientId}
                  >
                    {busy === "seed" ? "Seeding…" : "Seed defaults"}
                  </button>
                </div>

                <div className="cc-panel-blue">
                  <div className="cc-strong">That’s enough for onboarding</div>
                  <div className="cc-subtle">
                    Fine-tune permissions later from Account if needed.
                  </div>
                </div>
              </>
            ) : null}

            {currentStep === "finish" ? (
              <>
                <h2 className="cc-h2">All set</h2>
                <div className="cc-subtle">
                  This device is ready for your selected circle.
                </div>

                <div className="cc-status cc-status-ok">
                  <div className="cc-strong">Setup complete</div>
                  <div className="cc-subtle">
                    Circle selected, device key registered, vault unlocked, and ready to use.
                  </div>
                </div>

                <div className="cc-row">
                  <Link className="cc-btn cc-btn-primary" href="/app/hub">
                    Go to Hub
                  </Link>
                  {selectedPatientId ? (
                    <Link className="cc-btn" href={`/app/patients/${selectedPatientId}/today`}>
                      Open Today
                    </Link>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="cc-small cc-subtle">
          Everything needed for onboarding is handled here: invite acceptance, name confirmation, device key setup, vault access and permissions defaults.
        </div>
      </div>
    </div>
  );
}