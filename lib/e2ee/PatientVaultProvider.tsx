"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { initialiseVaultForPatient, loadMyPatientVaultKey } from "@/lib/e2ee/patientVault";

type VaultState = {
  patientId: string;
  loading: boolean;
  vaultKey: Uint8Array | null;
  error: string | null;

  // controller-related
  isController: boolean;
  refresh: () => Promise<void>;
  initialiseIfController: () => Promise<void>;
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

  async function refresh() {
    setLoading(true);
    setError(null);

    try {
      // Guard: never call RPC with undefined / invalid UUID
      if (!isUuid(patientId)) {
        throw new Error(`invalid_patientId:${String(patientId)}`);
      }

      // 1) controller check — IMPORTANT: function args are (pid uuid)
      const { data: ctl, error: ctlErr } = await supabase.rpc("is_patient_controller", {
        pid: patientId, // ✅ label-stable with DB signature
      });
      if (ctlErr) throw ctlErr;
      setIsController(Boolean(ctl));

      // 2) try to unwrap my vault key
      const vk = await loadMyPatientVaultKey(patientId);
      setVaultKey(vk);
      setError(null);
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
      if (!isUuid(patientId)) {
        throw new Error(`invalid_patientId:${String(patientId)}`);
      }

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
  }, [patientId]);

  const value: VaultState = {
    patientId,
    loading,
    vaultKey,
    error,
    isController,
    refresh,
    initialiseIfController,
  };

  return <PatientVaultContext.Provider value={value}>{children}</PatientVaultContext.Provider>;
}

/**
 * Optional helper: wraps encrypted pages/components and shows a clean UI until vault is ready.
 */
export function PatientVaultGate({ children }: { children: React.ReactNode }) {
  const { loading, vaultKey, error, isController, initialiseIfController, refresh } = usePatientVault();

  if (loading) {
    return <div style={{ padding: 16 }}>Loading encrypted vault…</div>;
  }

  if (vaultKey) {
    return <>{children}</>;
  }

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
                <li>You haven’t enabled E2EE on this device (no local keypair)</li>
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

        {isController ? (
          <button onClick={initialiseIfController} style={{ padding: "8px 10px", borderRadius: 10 }}>
            Initialise vault (controller)
          </button>
        ) : (
          <div style={{ fontSize: 13, opacity: 0.85, paddingTop: 6 }}>
            Ask the patient controller to initialise the vault (or share access).
          </div>
        )}
      </div>
    </div>
  );
}