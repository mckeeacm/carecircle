"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { initialiseVaultForPatient, loadMyPatientVaultKey } from "@/lib/e2ee/patientVault";

type VaultState = {
  patientId: string;
  loading: boolean;
  vaultKey: Uint8Array | null;
  error: string | null;
  isController: boolean;
  refresh: () => Promise<void>;
  initialiseIfController: () => Promise<void>;
  forgetOnThisDevice: () => void;
};

type CacheRecord = {
  v: 1;
  createdAt: number;
  expiresAt: number;
  vaultKeyB64: string;
};

const PatientVaultContext = createContext<VaultState | null>(null);

export function usePatientVault() {
  const ctx = useContext(PatientVaultContext);
  if (!ctx) throw new Error("usePatientVault must be used inside <PatientVaultProvider />");
  return ctx;
}

function isUuid(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function b64FromBytes(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function bytesFromB64(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function cacheKey(pid: string, uid: string) {
  return `carecircle:vaultkey:v1:${pid}:${uid}`;
}

const TTL_DAYS = 30;

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

    return bytesFromB64(rec.vaultKeyB64);
  } catch {
    return null;
  }
}

function writeCachedVaultKey(pid: string, uid: string, vaultKey: Uint8Array | null) {
  try {
    if (!vaultKey) {
      localStorage.removeItem(cacheKey(pid, uid));
      return;
    }

    const now = Date.now();
    const rec: CacheRecord = {
      v: 1,
      createdAt: now,
      expiresAt: now + TTL_DAYS * 24 * 60 * 60 * 1000,
      vaultKeyB64: b64FromBytes(vaultKey),
    };

    localStorage.setItem(cacheKey(pid, uid), JSON.stringify(rec));
  } catch {
    // ignore
  }
}

export function PatientVaultProvider({
  patientId,
  children,
}: {
  patientId: string;
  children: React.ReactNode;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [loading, setLoading] = useState(true);
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isController, setIsController] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      setUid(data.user?.id ?? null);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUid = session?.user?.id ?? null;
      setUid(nextUid);

      if (!nextUid) {
        setVaultKey(null);
        setIsController(false);
        setError(null);
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  function forgetOnThisDevice() {
    if (!uid || !isUuid(patientId)) return;
    writeCachedVaultKey(patientId, uid, null);
    setVaultKey(null);
  }

  async function refresh() {
    setLoading(true);
    setError(null);

    try {
      if (!isUuid(patientId)) throw new Error(`invalid_patientId:${String(patientId)}`);

      if (!uid) {
        setVaultKey(null);
        setIsController(false);
        setLoading(false);
        return;
      }

      const cached = readCachedVaultKey(patientId, uid);
      if (cached) {
        setVaultKey(cached);
      } else {
        setVaultKey(null);
      }

      const { data: ctl, error: ctlErr } = await supabase.rpc("is_patient_controller", {
        pid: patientId,
      });
      if (ctlErr) throw ctlErr;
      setIsController(Boolean(ctl));

      const vk = await loadMyPatientVaultKey(patientId);
      setVaultKey(vk);
      writeCachedVaultKey(patientId, uid, vk);
    } catch (e: any) {
      setVaultKey(null);
      const msg =
        e?.message ||
        e?.error_description ||
        (typeof e === "string" ? e : "vault_unavailable");
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function initialiseIfController() {
    setLoading(true);
    setError(null);

    try {
      if (!isUuid(patientId)) throw new Error(`invalid_patientId:${String(patientId)}`);
      await initialiseVaultForPatient(patientId);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "init_failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, uid]);

  const value: VaultState = {
    patientId,
    loading,
    vaultKey,
    error,
    isController,
    refresh,
    initialiseIfController,
    forgetOnThisDevice,
  };

  return <PatientVaultContext.Provider value={value}>{children}</PatientVaultContext.Provider>;
}

export function PatientVaultGate({ children }: { children: React.ReactNode }) {
  const { loading, vaultKey, error, isController, initialiseIfController, refresh, forgetOnThisDevice } =
    usePatientVault();

  if (loading) return <div style={{ padding: 16 }}>Loading encrypted vault…</div>;
  if (vaultKey) return <>{children}</>;

  return (
    <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12 }}>
      <h3 style={{ marginTop: 0 }}>Encrypted vault not available</h3>

      <div style={{ fontSize: 13, opacity: 0.85 }}>
        {error ? (
          <>
            <div>
              <b>Reason:</b> {error}
            </div>
            <div style={{ marginTop: 6 }}>
              Most common causes:
              <ul style={{ margin: "6px 0 0 18px" }}>
                <li>Vault not initialised for this patient yet</li>
                <li>You don’t have a vault share</li>
                <li>You haven’t enabled E2EE on this device</li>
              </ul>
            </div>
          </>
        ) : (
          <div>No vault share found.</div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={refresh} style={{ padding: "8px 10px", borderRadius: 10 }}>
          Retry
        </button>

        <button onClick={forgetOnThisDevice} style={{ padding: "8px 10px", borderRadius: 10 }}>
          Forget vault on this device
        </button>

        {isController ? (
          <button onClick={initialiseIfController} style={{ padding: "8px 10px", borderRadius: 10 }}>
            Initialise vault (controller)
          </button>
        ) : (
          <div style={{ fontSize: 13, opacity: 0.85, paddingTop: 6 }}>
            Ask the patient controller to initialise the vault or share access.
          </div>
        )}
      </div>
    </div>
  );
}