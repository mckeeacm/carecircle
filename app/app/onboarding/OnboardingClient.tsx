"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUserLanguage } from "@/app/components/UserLanguageProvider";
import { getPageUi } from "@/lib/pageUi";
import { getSodium } from "@/lib/e2ee/sodium";
import {
  getOrCreateDeviceKeypair,
  resetDeviceKeypair,
} from "@/lib/e2ee/deviceKeys";
import {
  unwrapVaultKeyForMe,
  wrapVaultKeyForRecipient,
  type WrappedKeyV1,
} from "@/lib/e2ee/vaultShares";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";

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

type StepId = "invite" | "circle" | "vault" | "profile" | "permissions" | "finish";

type InviteAcceptResult = {
  patient_id: string;
  role: string;
  already_member: boolean;
};

type CacheRecord = {
  v: 1;
  createdAt: number;
  expiresAt: number;
  vaultKeyB64: string;
};

const PENDING_INVITE_KEY = "carecircle:pending-invite-token:v1";

function safeBool(v: unknown) {
  return v === true;
}

function isUuid(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function bytesToBase64(bytes: Uint8Array) {
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

function readPendingInviteToken() {
  try {
    return (localStorage.getItem(PENDING_INVITE_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

function writePendingInviteToken(token: string) {
  try {
    if (token.trim()) localStorage.setItem(PENDING_INVITE_KEY, token.trim());
  } catch {}
}

function clearPendingInviteToken() {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
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

function isKeyMismatchError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("incorrect key pair") ||
    m.includes("incorrect keypair") ||
    m.includes("ciphertext") ||
    m.includes("cannot be decrypted")
  );
}

function StepRow({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div
      className={`cc-panel-soft cc-row ${active ? "cc-panel-blue" : ""}`}
      style={{ justifyContent: "flex-start" }}
    >
      <span className={`cc-pill ${done ? "cc-pill-primary" : ""}`} style={{ minWidth: 34, textAlign: "center" }}>
        {done ? "âœ“" : "â€¢"}
      </span>
      <div style={{ fontWeight: active ? 900 : 800, opacity: done ? 0.9 : 0.85 }}>{label}</div>
    </div>
  );
}

export default function OnboardingClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();
  const sp = useSearchParams();
  const { languageCode } = useUserLanguage();

  const inviteTokenFromUrl = (sp.get("invite") ?? "").trim();
  const preferredPatientIdFromUrl = (sp.get("pid") ?? "").trim();

  const [resolvedInviteToken, setResolvedInviteToken] = useState<string>("");
  const [uid, setUid] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [displayGreeting, setDisplayGreeting] = useState<string>("there");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [memberships, setMemberships] = useState<CircleMembership[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, PatientRow>>({});
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");

  const [deviceKeyOk, setDeviceKeyOk] = useState(false);
  const [deviceKeyMatchesServer, setDeviceKeyMatchesServer] = useState<boolean | null>(null);
  const [hasVaultShare, setHasVaultShare] = useState<boolean>(false);
  const [hasCachedVault, setHasCachedVault] = useState<boolean>(false);
  const [vaultUnlockNeedsReshare, setVaultUnlockNeedsReshare] = useState(false);

  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "checking" | "need_auth" | "accepting" | "accepted" | "error"
  >("idle");
  const [inviteResult, setInviteResult] = useState<InviteAcceptResult | null>(null);

  const [newCircleName, setNewCircleName] = useState<string>("");

  const [hasProfile, setHasProfile] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [communicationNotes, setCommunicationNotes] = useState("");
  const [allergies, setAllergies] = useState("");
  const [safetyNotes, setSafetyNotes] = useState("");
  const [diagnoses, setDiagnoses] = useState("");
  const [languagesSpoken, setLanguagesSpoken] = useState("");

  const selectedMembership = memberships.find((m) => m.patient_id === selectedPatientId) ?? null;
  const selectedPatient = selectedPatientId ? patientsById[selectedPatientId] : null;
  const isController = safeBool(selectedMembership?.is_controller);
  const ui = getPageUi("onboarding", languageCode);
  const currentStep: StepId = useMemo(() => {
    if (resolvedInviteToken && inviteStatus !== "accepted") return "invite";
    if (!selectedPatientId) return "circle";
    if (!deviceKeyOk || !hasVaultShare || !hasCachedVault) return "vault";
    if (!hasProfile) return "profile";
    if (isController) return "permissions";
    return "finish";
  }, [
    resolvedInviteToken,
    inviteStatus,
    selectedPatientId,
    deviceKeyOk,
    hasVaultShare,
    hasCachedVault,
    hasProfile,
    isController,
  ]);

  useEffect(() => {
    const token = inviteTokenFromUrl || readPendingInviteToken();
    if (token) {
      writePendingInviteToken(token);
      setResolvedInviteToken(token);
    } else {
      setResolvedInviteToken("");
    }
  }, [inviteTokenFromUrl]);

  async function refreshDeviceKey(userId?: string | null) {
    try {
      const realUid = userId ?? uid;
      if (!realUid) {
        setDeviceKeyOk(false);
        setDeviceKeyMatchesServer(null);
        return false;
      }

      const local = await getMatchedBoxKeypairOrThrow();

      const { data, error } = await supabase
        .from("user_public_keys")
        .select("user_id, public_key, algorithm")
        .eq("user_id", realUid)
        .maybeSingle();

      if (error) throw error;

      if (!data?.user_id) {
        setDeviceKeyOk(false);
        setDeviceKeyMatchesServer(null);
        return false;
      }

      const alg = (data as any)?.algorithm ?? "";
      const serverPublicKey = String((data as any)?.public_key ?? "").trim();
      const localPublicKey = bytesToBase64(local.publicKey);
      const matches = alg === "crypto_box_seal" && !!serverPublicKey && serverPublicKey === localPublicKey;

      setDeviceKeyOk(matches);
      setDeviceKeyMatchesServer(matches);
      return matches;
    } catch {
      setDeviceKeyOk(false);
      setDeviceKeyMatchesServer(null);
      return false;
    }
  }

  async function refreshVaultState(patientId: string, userId: string) {
    setHasVaultShare(false);
    setHasCachedVault(false);

    try {
      const cached = readCachedVaultKey(patientId, userId);
      setHasCachedVault(!!cached);

      const { data, error } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", patientId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw error;
      setHasVaultShare(!!data?.wrapped_key);
    } catch {
      setHasVaultShare(false);
    }
  }

  async function refreshProfileStep(patientId: string) {
    try {
      const { data, error } = await supabase
        .from("patient_profiles")
        .select("patient_id")
        .eq("patient_id", patientId)
        .maybeSingle();

      if (error) throw error;
      setHasProfile(!!data);
    } catch {
      setHasProfile(false);
    }
  }

  async function determinePreferredCircle(params: {
    userId: string;
    membershipsList: CircleMembership[];
    inviteAcceptedPid?: string;
    preferredPidFromUrl?: string;
    deviceKeyReady: boolean;
  }) {
    const ids = Array.from(new Set(params.membershipsList.map((m) => m.patient_id))).filter(isUuid);
    if (ids.length === 0) return { preferredPid: "", allComplete: false };

    const { data: shares, error: shareErr } = await supabase
      .from("patient_vault_shares")
      .select("patient_id")
      .eq("user_id", params.userId)
      .in("patient_id", ids);

    if (shareErr) throw shareErr;

    const { data: profiles, error: profileErr } = await supabase
      .from("patient_profiles")
      .select("patient_id")
      .in("patient_id", ids);

    if (profileErr) throw profileErr;

    const shareSet = new Set(((shares ?? []) as { patient_id: string }[]).map((r) => r.patient_id));
    const profileSet = new Set(((profiles ?? []) as { patient_id: string }[]).map((r) => r.patient_id));

    const firstIncompletePid =
      !params.deviceKeyReady
        ? ids[0]
        : ids.find((pid) => !shareSet.has(pid)) ||
          ids.find((pid) => !readCachedVaultKey(pid, params.userId)) ||
          ids.find((pid) => !profileSet.has(pid)) ||
          "";

    const preferredPid =
      (params.inviteAcceptedPid && isUuid(params.inviteAcceptedPid) ? params.inviteAcceptedPid : "") ||
      (params.preferredPidFromUrl && isUuid(params.preferredPidFromUrl) ? params.preferredPidFromUrl : "") ||
      firstIncompletePid ||
      (params.membershipsList.find((m) => safeBool(m.is_controller))?.patient_id ?? "") ||
      ids[0];

    return {
      preferredPid,
      allComplete: !!params.deviceKeyReady && !firstIncompletePid,
    };
  }

  async function refresh() {
    setLoading(true);
    setMsg(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;

      const me = auth.user;
      if (!me) {
        setUid(null);
        setUserEmail("");
        setInviteStatus(resolvedInviteToken ? "need_auth" : "idle");
        setMemberships([]);
        setPatientsById({});
        setSelectedPatientId("");
        setHasVaultShare(false);
        setHasCachedVault(false);
        setDeviceKeyOk(false);
        setDeviceKeyMatchesServer(null);
        setHasProfile(false);
        setLoading(false);
        return;
      }

      setUid(me.id);
      setUserEmail(me.email ?? "");

      const { data: pm, error: memErr } = await supabase
        .from("patient_members")
        .select("patient_id, role, nickname, is_controller, created_at")
        .eq("user_id", me.id)
        .order("created_at", { ascending: true });

      if (memErr) throw memErr;

      const ms = (pm ?? []) as CircleMembership[];
      setMemberships(ms);

      const nickname = ms.find((m) => (m.nickname ?? "").trim())?.nickname?.trim();
      setDisplayGreeting(nickname || (me.email ? me.email.split("@")[0] : "there"));

      const ids = Array.from(new Set(ms.map((m) => m.patient_id))).filter(isUuid);

      if (ids.length === 0) {
        setPatientsById({});
        setSelectedPatientId("");
        setHasVaultShare(false);
        setHasCachedVault(false);
        setHasProfile(false);
        await refreshDeviceKey(me.id);
        return;
      }

      const { data: pts, error: pErr } = await supabase
        .from("patients")
        .select("id, display_name, created_by, created_at")
        .in("id", ids);

      if (pErr) throw pErr;

      const map: Record<string, PatientRow> = {};
      (pts ?? []).forEach((p: any) => {
        map[p.id] = p as PatientRow;
      });
      setPatientsById(map);

      const deviceKeyReady = await refreshDeviceKey(me.id);

      const { preferredPid, allComplete } = await determinePreferredCircle({
        userId: me.id,
        membershipsList: ms,
        inviteAcceptedPid: inviteResult?.patient_id,
        preferredPidFromUrl: preferredPatientIdFromUrl,
        deviceKeyReady,
      });

      setSelectedPatientId(preferredPid);

      if (!resolvedInviteToken && allComplete) {
        router.replace("/app/hub");
        return;
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_onboarding");
    } finally {
      setLoading(false);
    }
  }

  async function acceptInviteIfPresent() {
    if (!resolvedInviteToken) return;

    setMsg(null);
    setInviteResult(null);
    setInviteStatus("checking");

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;

      if (!auth.user?.id) {
        setInviteStatus("need_auth");
        return;
      }

      setInviteStatus("accepting");

      const { data, error } = await supabase.rpc("patient_invite_accept", {
        p_token: resolvedInviteToken,
      });

      if (error) throw error;

      const res = data as InviteAcceptResult;
      setInviteResult(res);
      setInviteStatus("accepted");
      clearPendingInviteToken();
      setResolvedInviteToken("");

      await refresh();
      setSelectedPatientId(res.patient_id);
      await refreshVaultState(res.patient_id, auth.user.id);

      router.replace(`/app/onboarding?pid=${encodeURIComponent(res.patient_id)}`);
    } catch (e: any) {
      setInviteStatus("error");
      setMsg(e?.message ?? "failed_to_accept_invite");
    }
  }

  useEffect(() => {
    refresh().catch((e: any) => setMsg(e?.message ?? "failed_to_load_onboarding"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedInviteToken]);

  useEffect(() => {
    if (!resolvedInviteToken) return;
    acceptInviteIfPresent().catch((e: any) => setMsg(e?.message ?? "failed_to_accept_invite"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedInviteToken]);

  useEffect(() => {
    if (!uid || !selectedPatientId) return;
    refreshVaultState(selectedPatientId, uid);
    refreshProfileStep(selectedPatientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, selectedPatientId]);

  async function createCircle() {
    if (!uid) return;
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
      await refresh();
      setSelectedPatientId(pid);
      setMsg("Circle created. Next, set up secure access on this device.");
      router.replace(`/app/onboarding?pid=${encodeURIComponent(pid)}`);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_circle");
    } finally {
      setBusy(null);
    }
  }

  async function enableE2EEOnThisDevice() {
    setBusy("enable-e2ee");
    setMsg(null);
    setVaultUnlockNeedsReshare(false);

    try {
      if (!uid) throw new Error("not_authenticated");

      const { publicKey } = await getMatchedBoxKeypairOrThrow();

      const { error } = await supabase.from("user_public_keys").upsert(
        {
          user_id: uid,
          public_key: bytesToBase64(publicKey),
          algorithm: "crypto_box_seal",
        },
        { onConflict: "user_id" }
      );
      if (error) throw error;

      setDeviceKeyOk(true);
      setDeviceKeyMatchesServer(true);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_enable_e2ee");
    } finally {
      setBusy(null);
    }
  }

  async function resetSecureDeviceOnThisDevice() {
    setBusy("reset-device");
    setMsg(null);
    setVaultUnlockNeedsReshare(false);

    try {
      if (!uid) throw new Error("not_authenticated");

      if (selectedPatientId) {
        forgetCachedVaultKey(selectedPatientId, uid);
      }

      const { publicKey } = await resetDeviceKeypair();

      const { error } = await supabase.from("user_public_keys").upsert(
        {
          user_id: uid,
          public_key: bytesToBase64(publicKey),
          algorithm: "crypto_box_seal",
        },
        { onConflict: "user_id" }
      );
      if (error) throw error;

      setDeviceKeyOk(true);
      setDeviceKeyMatchesServer(true);
      setHasCachedVault(false);
      setMsg("This device now has a fresh secure key. The controller must now share secure access again.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_reset_secure_device");
    } finally {
      setBusy(null);
    }
  }

  async function unlockVaultOnThisDevice() {
    setBusy("unlock-vault");
    setMsg(null);
    setVaultUnlockNeedsReshare(false);

    try {
      if (!uid || !selectedPatientId) throw new Error("missing_circle_or_user");

      const { data: share, error: shareErr } = await supabase
        .from("patient_vault_shares")
        .select("wrapped_key")
        .eq("patient_id", selectedPatientId)
        .eq("user_id", uid)
        .maybeSingle();

      if (shareErr) throw shareErr;
      if (!share?.wrapped_key) throw new Error("No vault share found yet.");

      const wrapped = share.wrapped_key as WrappedKeyV1;
      const { publicKey: myPublicKey, privateKey: myPrivateKey } = await getMatchedBoxKeypairOrThrow();
      const vaultKey = await unwrapVaultKeyForMe({ wrapped, myPublicKey, myPrivateKey });

      writeCachedVaultKey(selectedPatientId, uid, vaultKey);
      setHasCachedVault(true);
    } catch (e: any) {
      const text = e?.message ?? "failed_to_unlock_vault";
      if (isKeyMismatchError(text)) {
        setVaultUnlockNeedsReshare(true);
        setHasCachedVault(false);
        setMsg(
          "This secure share was created for an older device key. Reset this secure device, then ask the controller to share access again."
        );
      } else {
        setMsg(text);
      }
    } finally {
      setBusy(null);
    }
  }

  async function initialiseNewVaultKey() {
    setBusy("init-vault");
    setMsg(null);

    try {
      if (!uid || !selectedPatientId) throw new Error("missing_circle_or_user");
      if (!isController) throw new Error("Only a controller can initialise a vault key.");

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
      if (missing.length) throw new Error(`${missing.length} member(s) must enable E2EE first.`);

      const incompatible = (pubKeys ?? []).filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (incompatible.length) throw new Error("Some members have incompatible keys.");

      const sodium = await getSodium();
      const vaultKey = sodium.randombytes_buf(32);

      writeCachedVaultKey(selectedPatientId, uid, vaultKey);

      const rows = await Promise.all(
        (pubKeys ?? []).map(async (p: any) => {
          const recipientPk = base64ToBytes(p.public_key);
          const wrapped2 = await wrapVaultKeyForRecipient({ vaultKey, recipientPublicKey: recipientPk });
          return { patient_id: selectedPatientId, user_id: p.user_id, wrapped_key: wrapped2 };
        })
      );

      const { error: upErr } = await supabase
        .from("patient_vault_shares")
        .upsert(rows, { onConflict: "patient_id,user_id" });
      if (upErr) throw upErr;

      setHasVaultShare(true);
      setHasCachedVault(true);
      setVaultUnlockNeedsReshare(false);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_init_new_vault");
    } finally {
      setBusy(null);
    }
  }

  async function shareKeyToMembers() {
    setBusy("share-vault");
    setMsg(null);

    try {
      if (!uid || !selectedPatientId) throw new Error("missing_circle_or_user");
      if (!isController) throw new Error("Only a controller can share the vault key.");

      const vaultKey = readCachedVaultKey(selectedPatientId, uid);
      if (!vaultKey) throw new Error("Unlock or initialise vault on this device first.");

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
      if (missing.length) throw new Error(`${missing.length} member(s) must enable E2EE first.`);

      const incompatible = (pubKeys ?? []).filter((p: any) => p.algorithm !== "crypto_box_seal");
      if (incompatible.length) throw new Error("Some members have incompatible keys.");

      const rows = await Promise.all(
        (pubKeys ?? []).map(async (p: any) => {
          const recipientPk = base64ToBytes(p.public_key);
          const wrapped2 = await wrapVaultKeyForRecipient({ vaultKey, recipientPublicKey: recipientPk });
          return { patient_id: selectedPatientId, user_id: p.user_id, wrapped_key: wrapped2 };
        })
      );

      const { error: upErr } = await supabase
        .from("patient_vault_shares")
        .upsert(rows, { onConflict: "patient_id,user_id" });
      if (upErr) throw upErr;

      setHasVaultShare(true);
      setMsg("Vault access shared to ready members.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_share_vault");
    } finally {
      setBusy(null);
    }
  }

  async function saveProfileInline() {
    if (!selectedPatientId) return;
    if (!uid) return setMsg("not_authenticated");

    const vaultKey = readCachedVaultKey(selectedPatientId, uid);
    if (!vaultKey) {
      setMsg("Please finish secure access first.");
      return;
    }

    setProfileBusy(true);
    setMsg(null);

    try {
      const communicationEnv = await vaultEncryptString({
        vaultKey,
        plaintext: communicationNotes,
        aad: {
          table: "patient_profiles",
          column: "communication_notes_encrypted",
          patient_id: selectedPatientId,
        },
      });

      const allergiesEnv = await vaultEncryptString({
        vaultKey,
        plaintext: allergies,
        aad: {
          table: "patient_profiles",
          column: "allergies_encrypted",
          patient_id: selectedPatientId,
        },
      });

      const safetyEnv = await vaultEncryptString({
        vaultKey,
        plaintext: safetyNotes,
        aad: {
          table: "patient_profiles",
          column: "safety_notes_encrypted",
          patient_id: selectedPatientId,
        },
      });

      const diagnosesEnv = await vaultEncryptString({
        vaultKey,
        plaintext: diagnoses,
        aad: {
          table: "patient_profiles",
          column: "diagnoses_encrypted",
          patient_id: selectedPatientId,
        },
      });

      const languagesEnv = await vaultEncryptString({
        vaultKey,
        plaintext: languagesSpoken,
        aad: {
          table: "patient_profiles",
          column: "languages_spoken_encrypted",
          patient_id: selectedPatientId,
        },
      });

      const { error } = await supabase.from("patient_profiles").upsert(
        {
          patient_id: selectedPatientId,
          communication_notes_encrypted: communicationEnv,
          allergies_encrypted: allergiesEnv,
          safety_notes_encrypted: safetyEnv,
          diagnoses_encrypted: diagnosesEnv,
          languages_spoken_encrypted: languagesEnv,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "patient_id" }
      );

      if (error) throw error;

      setHasProfile(true);
      setMsg("Profile saved.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_save_profile");
    } finally {
      setProfileBusy(false);
    }
  }

  async function seedDefaults() {
    if (!selectedPatientId) return;
    setBusy("seed");
    setMsg(null);

    try {
      const { error } = await supabase.rpc("permissions_seed_defaults", { pid: selectedPatientId });
      if (error) throw error;
      setMsg("Permissions defaults seeded.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_seed_defaults");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="cc-page">
        <div className="cc-container cc-stack">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">{ui.welcome}</h1>
            <div className="cc-subtle">{ui.loadingSetup}</div>
          </div>
          <div className="cc-card cc-card-pad">
            <div className="cc-subtle">{ui.loadingOnboarding}</div>
          </div>
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
            <h1 className="cc-h1">{ui.welcome}, {displayGreeting}</h1>
            <div className="cc-subtle">{ui.intro}</div>
            {userEmail ? <div className="cc-small cc-subtle cc-wrap">{userEmail}</div> : null}
          </div>

          {currentStep === "finish" ? (
            <div className="cc-row">
              <Link className="cc-btn cc-btn-primary" href="/app/hub">
                {ui.hub}
              </Link>
            </div>
          ) : null}
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">{ui.message}</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        <div className="cc-grid-2-125">
          <div className="cc-card cc-card-pad cc-stack">
            <div className="cc-strong">{ui.setupSteps}</div>

            {resolvedInviteToken ? (
              <StepRow
                label={ui.joinFromInvite}
                active={currentStep === "invite"}
                done={inviteStatus === "accepted"}
              />
            ) : null}

            <StepRow label={ui.chooseCircleStep} active={currentStep === "circle"} done={!!selectedPatientId} />

            <StepRow
              label={ui.secureAccessStep}
              active={currentStep === "vault"}
              done={!!selectedPatientId && deviceKeyOk && hasVaultShare && hasCachedVault}
            />

            <StepRow
              label={ui.profileStep}
              active={currentStep === "profile"}
              done={!!selectedPatientId && deviceKeyOk && hasVaultShare && hasCachedVault && hasProfile}
            />

            <StepRow
              label={ui.permissionsStep}
              active={currentStep === "permissions"}
              done={!!selectedPatientId && deviceKeyOk && hasVaultShare && hasCachedVault && hasProfile && !isController}
            />

            <StepRow label={ui.finish} active={currentStep === "finish"} done={currentStep === "finish"} />

            {selectedPatientId ? (
              <div className="cc-panel">
                <div className="cc-small cc-subtle">{ui.selectedCircle}</div>
                <div className="cc-strong">{selectedPatient?.display_name ?? selectedPatientId}</div>
                <div className="cc-small cc-wrap">{selectedPatientId}</div>
                <div className="cc-small">
                  {ui.role}: <b>{selectedMembership?.role ?? "-"}</b>
                  {isController ? ` • ${ui.controller}` : ""}
                </div>
              </div>
            ) : null}

            <div className="cc-row">
              <span className={`cc-pill ${deviceKeyOk ? "cc-pill-primary" : ""}`}>
                {ui.deviceKey}: {deviceKeyOk ? ui.ok : ui.needsAttention}
              </span>
              <span className={`cc-pill ${hasVaultShare ? "cc-pill-primary" : ""}`}>
                {ui.shareRow}: {hasVaultShare ? ui.present : ui.missing}
              </span>
            </div>

            <div className="cc-row">
              <span className={`cc-pill ${hasCachedVault ? "cc-pill-primary" : ""}`}>
                {ui.cachedVault}: {hasCachedVault ? ui.present : ui.missing}
              </span>
              <span className={`cc-pill ${isController ? "cc-pill-primary" : ""}`}>
                {ui.controllerLabel}: {isController ? ui.trueText : ui.falseText}
              </span>
            </div>
          </div>

          <div className="cc-card cc-card-pad cc-stack">
            {currentStep === "invite" ? (
              <>
                <h2 className="cc-h2">{ui.joiningCircle}</h2>
                <div className="cc-subtle">{ui.joiningDesc}</div>

                {inviteStatus === "checking" || inviteStatus === "accepting" ? (
                  <div className="cc-status cc-status-loading">
                    <div className="cc-strong">
                      {inviteStatus === "checking" ? ui.checkingSignIn : ui.acceptingInvite}
                    </div>
                    <div className="cc-subtle">{ui.keepOpen}</div>
                  </div>
                ) : null}

                {inviteStatus === "need_auth" ? (
                  <div className="cc-status cc-status-error">
                    <div className="cc-status-error-title">{ui.signInRequired}</div>
                    <div className="cc-subtle">{ui.signInRequiredDesc}</div>
                  </div>
                ) : null}

                {inviteStatus === "error" ? (
                  <div className="cc-row">
                    <button className="cc-btn cc-btn-primary" onClick={acceptInviteIfPresent}>
                      {ui.tryAgain}
                    </button>
                  </div>
                ) : null}

                {inviteStatus === "accepted" && inviteResult ? (
                  <div className="cc-status cc-status-ok">
                    <div className="cc-strong">
                      {inviteResult.already_member ? ui.alreadyLinked : ui.joinedCircle}
                    </div>
                    <div className="cc-subtle">
                      Role: <b>{inviteResult.role}</b>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {currentStep === "circle" ? (
              <>
                <h2 className="cc-h2">{ui.chooseCircle}</h2>
                <div className="cc-subtle">{ui.chooseCircleDesc}</div>

                {memberships.length > 0 ? (
                  <>
                    <div className="cc-field">
                      <div className="cc-label">{ui.yourCircles}</div>
                      <select className="cc-select" value={selectedPatientId} onChange={(e) => setSelectedPatientId(e.target.value)}>
                        <option value="" disabled>
                          Selectâ€¦
                        </option>
                        {memberships.map((m) => (
                          <option key={m.patient_id} value={m.patient_id}>
                            {(patientsById[m.patient_id]?.display_name ?? m.patient_id) +
                              (safeBool(m.is_controller) ? " (controller)" : "")}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="cc-small cc-subtle">{ui.orCreateBelow}</div>
                  </>
                ) : null}

                <div className="cc-field">
                  <div className="cc-label">{ui.newCircleName}</div>
                  <input
                    className="cc-input"
                    value={newCircleName}
                    onChange={(e) => setNewCircleName(e.target.value)}
                    placeholder={ui.circleNamePlaceholder}
                  />
                </div>

                <div className="cc-row">
                  <button className="cc-btn cc-btn-primary" onClick={createCircle} disabled={busy === "create-circle"}>
                    {busy === "create-circle" ? ui.creating : ui.createCircle}
                  </button>
                </div>
              </>
            ) : null}

            {currentStep === "vault" ? (
              <>
                <h2 className="cc-h2">{ui.secureAccessTitle}</h2>
                <div className="cc-subtle">{ui.secureAccessDesc}</div>

                <div className="cc-panel-blue">
                  <div className="cc-strong">{ui.whatHappensHere}</div>
                  <div className="cc-subtle">{ui.whatHappensHereDesc}</div>
                </div>

                {deviceKeyMatchesServer === false ? (
                  <div className="cc-status cc-status-error">
                    <div className="cc-status-error-title">This device needs secure setup again</div>
                    <div className="cc-subtle">
                      This device's local secure setup does not match the one registered for your account. Reset secure access on this device, then continue.
                    </div>
                  </div>
                ) : null}

                {vaultUnlockNeedsReshare ? (
                  <div className="cc-status cc-status-error">
                    <div className="cc-status-error-title">Secure access needs refreshing</div>
                    <div className="cc-subtle">
                      This circle share was created for an older device setup. Reset secure access on this device, then ask the circle owner to share access again.
                    </div>
                  </div>
                ) : null}

                <div className="cc-row">
                  <button
                    className="cc-btn cc-btn-secondary"
                    onClick={enableE2EEOnThisDevice}
                    disabled={busy === "enable-e2ee" || deviceKeyOk}
                  >
                    {deviceKeyOk ? ui.deviceReady : busy === "enable-e2ee" ? ui.settingUp : ui.setUpSecureAccessDevice}
                  </button>

                  <button
                    className="cc-btn"
                    onClick={resetSecureDeviceOnThisDevice}
                    disabled={busy === "reset-device" || !uid}
                  >
                    {busy === "reset-device" ? ui.resetting : ui.resetSecureAccessDevice}
                  </button>

                  {isController ? (
                    <button
                      className="cc-btn cc-btn-primary"
                      onClick={initialiseNewVaultKey}
                      disabled={busy === "init-vault" || !deviceKeyOk}
                    >
                      {busy === "init-vault" ? ui.settingUp : ui.setUpSecureAccessCircle}
                    </button>
                  ) : null}
                </div>

                {isController ? (
                  <div className="cc-row">
                    <button
                      className="cc-btn"
                      onClick={shareKeyToMembers}
                      disabled={busy === "share-vault" || !deviceKeyOk}
                    >
                      {busy === "share-vault" ? ui.sharing : ui.shareSecureAccessMembers}
                    </button>
                  </div>
                ) : null}

                {!isController ? (
                  <div className="cc-small cc-subtle">
                    {ui.nonControllerReshareHelp}
                  </div>
                ) : null}

                <div className="cc-row">
                  <button
                    className="cc-btn cc-btn-primary"
                    onClick={unlockVaultOnThisDevice}
                    disabled={busy === "unlock-vault" || !deviceKeyOk || !hasVaultShare}
                  >
                    {busy === "unlock-vault" ? ui.finishingSetup : ui.finishSecureSetupDevice}
                  </button>
                </div>

                <div className="cc-small cc-subtle">
                  {ui.stayHereUntilReady}
                </div>
              </>
            ) : null}

            {currentStep === "profile" ? (
              <>
                <h2 className="cc-h2">{ui.profileTitle}</h2>
                <div className="cc-subtle">{ui.profileDesc}</div>

                <div className="cc-grid-2">
                  <div className="cc-field">
                    <div className="cc-label">{ui.communicationNotes}</div>
                    <textarea
                      className="cc-textarea"
                      value={communicationNotes}
                      onChange={(e) => setCommunicationNotes(e.target.value)}
                      placeholder={ui.communicationPlaceholder}
                    />
                  </div>

                  <div className="cc-field">
                    <div className="cc-label">{ui.allergies}</div>
                    <textarea
                      className="cc-textarea"
                      value={allergies}
                      onChange={(e) => setAllergies(e.target.value)}
                      placeholder={ui.allergiesPlaceholder}
                    />
                  </div>
                </div>

                <div className="cc-grid-2">
                  <div className="cc-field">
                    <div className="cc-label">{ui.diagnoses}</div>
                    <textarea
                      className="cc-textarea"
                      value={diagnoses}
                      onChange={(e) => setDiagnoses(e.target.value)}
                      placeholder={ui.diagnosesPlaceholder}
                    />
                  </div>

                  <div className="cc-field">
                    <div className="cc-label">{ui.languagesSpoken}</div>
                    <textarea
                      className="cc-textarea"
                      value={languagesSpoken}
                      onChange={(e) => setLanguagesSpoken(e.target.value)}
                      placeholder={ui.languagesSpokenPlaceholder}
                    />
                  </div>
                </div>

                <div className="cc-field">
                  <div className="cc-label">{ui.safetyNotes}</div>
                  <textarea
                    className="cc-textarea"
                    value={safetyNotes}
                    onChange={(e) => setSafetyNotes(e.target.value)}
                    placeholder={ui.safetyPlaceholder}
                  />
                </div>

                <div className="cc-row">
                  <button className="cc-btn cc-btn-primary" onClick={saveProfileInline} disabled={profileBusy}>
                    {profileBusy ? ui.saving : ui.saveContinue}
                  </button>
                </div>
              </>
            ) : null}

            {currentStep === "permissions" ? (
              <>
                <h2 className="cc-h2">{ui.permissionsTitle}</h2>
                <div className="cc-subtle">{ui.permissionsDesc}</div>

                <div className="cc-row">
                  <button className="cc-btn cc-btn-primary" onClick={seedDefaults} disabled={busy === "seed"}>
                    {busy === "seed" ? ui.seeding : ui.seedDefaults}
                  </button>

                  <Link className="cc-btn" href={`/app/account/permissions?pid=${selectedPatientId}`}>
                    {ui.openPermissionsPage}
                  </Link>
                </div>

                <div className="cc-small cc-subtle">{ui.onboardingComplete}</div>
              </>
            ) : null}

            {currentStep === "finish" ? (
              <>
                <h2 className="cc-h2">{ui.readyTitle}</h2>
                <div className="cc-subtle">{ui.readyDesc}</div>

                <div className="cc-row">
                  <Link className="cc-btn cc-btn-primary" href="/app/hub">
                    {ui.goToHub}
                  </Link>
                </div>

                {!isController ? (
                  <div className="cc-small cc-subtle">
                    {ui.permissionsManaged}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
