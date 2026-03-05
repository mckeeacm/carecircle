"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";

type PatientRow = { id: string; display_name: string };

function isUuid(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function VaultClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const vault = usePatientVault();

  const [msg, setMsg] = useState<string | null>(null);
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [loadingPatient, setLoadingPatient] = useState(false);

  useEffect(() => {
    (async () => {
      setMsg(null);
      setPatient(null);

      try {
        if (!isUuid(patientId)) throw new Error(`invalid_patientId:${String(patientId)}`);

        setLoadingPatient(true);
        const { data, error } = await supabase
          .from("patients")
          .select("id, display_name")
          .eq("id", patientId)
          .single();

        if (error) throw error;
        setPatient(data as PatientRow);
      } catch (e: any) {
        setMsg(e?.message ?? "failed_to_load_patient");
      } finally {
        setLoadingPatient(false);
      }
    })();
  }, [patientId, supabase]);

  async function doRefresh() {
    setMsg(null);
    try {
      await vault.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "vault_refresh_failed");
    }
  }

  async function doInitIfController() {
    setMsg(null);
    try {
      await vault.initialiseIfController();
    } catch (e: any) {
      setMsg(e?.message ?? "vault_init_failed");
    }
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Vault</h1>
            <div className="cc-subtle">
              {loadingPatient ? "Loading…" : patient?.display_name ?? patientId}
            </div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href={`/app/patients/${patientId}/today`}>
              Today
            </Link>
            <Link className="cc-btn" href={`/app/patients/${patientId}/summary`}>
              Summary
            </Link>
            <Link className="cc-btn" href="/app/hub">
              Hub
            </Link>
          </div>
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Error</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        {/* Vault status */}
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Vault access on this device</h2>
              <div className="cc-subtle">
                This page ensures your device has the decrypted vault key cached locally (never stored in DB plaintext).
              </div>
            </div>

            <div className="cc-row">
              <button className="cc-btn" onClick={doRefresh} disabled={vault.loading}>
                {vault.loading ? "Refreshing…" : "Refresh"}
              </button>

              <button className="cc-btn cc-btn-danger" onClick={vault.forgetOnThisDevice} disabled={!vault.vaultKey}>
                Forget on this device
              </button>

              {vault.isController ? (
                <button className="cc-btn cc-btn-secondary" onClick={doInitIfController} disabled={vault.loading}>
                  {vault.loading ? "…" : "Initialise / re-share (controller)"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="cc-grid-3">
            <div className="cc-panel-soft">
              <div className="cc-kicker">Controller</div>
              <div className="cc-strong">{vault.isController ? "Yes" : "No"}</div>
            </div>

            <div className="cc-panel-soft">
              <div className="cc-kicker">Vault key</div>
              <div className="cc-strong">{vault.vaultKey ? "Loaded" : "Not loaded"}</div>
              <div className="cc-small cc-subtle">Stored locally with TTL.</div>
            </div>

            <div className="cc-panel-soft">
              <div className="cc-kicker">Status</div>
              <div className="cc-small cc-wrap">{vault.error ? vault.error : "ok"}</div>
            </div>
          </div>

          {!vault.vaultKey ? (
            <div className="cc-status cc-status-loading">
              <div className="cc-strong">Vault key not available on this device</div>
              <div className="cc-subtle">
                If you’re a member but not a controller, the controller must create your share in{" "}
                <code>patient_vault_shares</code>. Then press Refresh.
              </div>
            </div>
          ) : (
            <div className="cc-status cc-status-ok">
              <div className="cc-strong">Vault ready</div>
              <div className="cc-subtle">You can decrypt journals/DMs/notes and create new encrypted content.</div>
            </div>
          )}
        </div>

        {/* Next steps */}
        <div className="cc-card cc-card-pad cc-stack">
          <h2 className="cc-h2">What this enables</h2>
          <div className="cc-grid-2">
            <div className="cc-panel">
              <div className="cc-strong">Encrypted features</div>
              <div className="cc-small cc-subtle">
                Journals, DMs, sobriety notes, appointment notes, and patient profile sensitive fields are stored as encrypted
                JSON envelopes.
              </div>
            </div>

            <div className="cc-panel">
              <div className="cc-strong">Security note</div>
              <div className="cc-small cc-subtle">
                CareCircle never stores decrypted content in the database. Decryption happens locally using the vault key on
                this device.
              </div>
            </div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn cc-btn-primary" href={`/app/patients/${patientId}/today`}>
              Go to Today
            </Link>
            <Link className="cc-btn" href={`/app/patients/${patientId}/journals`}>
              Journals
            </Link>
            <Link className="cc-btn" href={`/app/patients/${patientId}/dm`}>
              DMs
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}