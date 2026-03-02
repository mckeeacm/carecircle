// app/app/patients/[id]/profile/ProfileClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type PatientRow = { id: string; display_name: string };

type PatientProfileRow = {
  patient_id: string;
  created_at: string;
  updated_at: string;

  communication_notes_encrypted: CipherEnvelopeV1 | null;
  allergies_encrypted: CipherEnvelopeV1 | null;
  safety_notes_encrypted: CipherEnvelopeV1 | null;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function ProfileClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [profile, setProfile] = useState<PatientProfileRow | null>(null);

  // plaintext fields (what user edits)
  const [communicationNotes, setCommunicationNotes] = useState("");
  const [allergies, setAllergies] = useState("");
  const [safetyNotes, setSafetyNotes] = useState("");

  async function load() {
    setLoading(true);
    setMsg(null);

    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      // patient label
      const { data: p, error: pErr } = await supabase
        .from("patients")
        .select("id, display_name")
        .eq("id", patientId)
        .single();
      if (pErr) throw pErr;
      setPatient(p as PatientRow);

      // profile row (may not exist yet)
      const { data: pr, error: prErr } = await supabase
        .from("patient_profiles")
        .select(
          "patient_id, created_at, updated_at, communication_notes_encrypted, allergies_encrypted, safety_notes_encrypted"
        )
        .eq("patient_id", patientId)
        .maybeSingle();

      if (prErr) throw prErr;

      const row = (pr ?? null) as PatientProfileRow | null;
      setProfile(row);

      // If we have a vault key, decrypt into form fields
      if (row && vaultKey) {
        const cn = row.communication_notes_encrypted
          ? await decryptStringWithLocalCache({
              patientId,
              table: "patient_profiles",
              rowId: patientId, // stable cache key for 1-row-per-patient table
              column: "communication_notes_encrypted",
              env: row.communication_notes_encrypted,
              vaultKey,
            })
          : "";

        const al = row.allergies_encrypted
          ? await decryptStringWithLocalCache({
              patientId,
              table: "patient_profiles",
              rowId: patientId,
              column: "allergies_encrypted",
              env: row.allergies_encrypted,
              vaultKey,
            })
          : "";

        const sn = row.safety_notes_encrypted
          ? await decryptStringWithLocalCache({
              patientId,
              table: "patient_profiles",
              rowId: patientId,
              column: "safety_notes_encrypted",
              env: row.safety_notes_encrypted,
              vaultKey,
            })
          : "";

        setCommunicationNotes(cn || "");
        setAllergies(al || "");
        setSafetyNotes(sn || "");
      } else {
        // no vaultKey → keep whatever is in form (usually empty)
        if (!row) {
          setCommunicationNotes("");
          setAllergies("");
          setSafetyNotes("");
        }
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_profile");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, !!vaultKey]);

  async function save() {
    setSaving(true);
    setMsg(null);

    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);
      if (!vaultKey) throw new Error("no_vault_share");

      const cnEnv = await vaultEncryptString({
        vaultKey,
        plaintext: communicationNotes,
        aad: { table: "patient_profiles", column: "communication_notes_encrypted", patient_id: patientId },
      });

      const alEnv = await vaultEncryptString({
        vaultKey,
        plaintext: allergies,
        aad: { table: "patient_profiles", column: "allergies_encrypted", patient_id: patientId },
      });

      const snEnv = await vaultEncryptString({
        vaultKey,
        plaintext: safetyNotes,
        aad: { table: "patient_profiles", column: "safety_notes_encrypted", patient_id: patientId },
      });

      // upsert 1-row-per-patient
      const { error } = await supabase.from("patient_profiles").upsert(
        {
          patient_id: patientId,
          communication_notes_encrypted: cnEnv,
          allergies_encrypted: alEnv,
          safety_notes_encrypted: snEnv,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "patient_id" }
      );

      if (error) throw error;

      await load();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_save_profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Patient profile</h1>
            <div className="cc-subtle">{patient?.display_name ?? patientId}</div>
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

        {!vaultKey ? (
          <div className="cc-status cc-status-loading">
            <div className="cc-strong">Vault key not available on this device</div>
            <div className="cc-subtle">You can’t decrypt or save encrypted profile fields.</div>
          </div>
        ) : null}

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-grid-2">
            <div className="cc-field">
              <div className="cc-label">Communication notes (E2EE)</div>
              <textarea
                className="cc-textarea"
                value={communicationNotes}
                onChange={(e) => setCommunicationNotes(e.target.value)}
                placeholder={vaultKey ? "Encrypted notes…" : "Encrypted notes (vault needed)…"}
                disabled={!vaultKey}
              />
            </div>

            <div className="cc-field">
              <div className="cc-label">Allergies (E2EE)</div>
              <textarea
                className="cc-textarea"
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder={vaultKey ? "Encrypted allergies…" : "Encrypted allergies (vault needed)…"}
                disabled={!vaultKey}
              />
            </div>
          </div>

          <div className="cc-field">
            <div className="cc-label">Safety notes (E2EE)</div>
            <textarea
              className="cc-textarea"
              value={safetyNotes}
              onChange={(e) => setSafetyNotes(e.target.value)}
              placeholder={vaultKey ? "Encrypted safety notes…" : "Encrypted safety notes (vault needed)…"}
              disabled={!vaultKey}
            />
          </div>

          <div className="cc-row">
            <button className="cc-btn cc-btn-primary" onClick={save} disabled={!vaultKey || saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="cc-btn" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>

            {profile?.updated_at ? (
              <span className="cc-small">Last updated: {new Date(profile.updated_at).toLocaleString()}</span>
            ) : (
              <span className="cc-small">No profile record yet.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}