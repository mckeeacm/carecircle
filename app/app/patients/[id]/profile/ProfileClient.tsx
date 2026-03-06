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
  diagnoses_encrypted: CipherEnvelopeV1 | null;
  languages_spoken_encrypted: CipherEnvelopeV1 | null;
};

type MedicationRow = {
  id: string;
  patient_id: string;
  name: string;
  dosage: string | null;
  schedule_text: string | null;
  active: boolean;
  created_by: string;
  created_at: string;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function isDecryptMismatchError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("ciphertext cannot be decrypted using that key") ||
    m.includes("incorrect key pair") ||
    m.includes("failed to decrypt") ||
    m.includes("decrypt")
  );
}

export default function ProfileClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [msg, setMsg] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [profile, setProfile] = useState<PatientProfileRow | null>(null);

  const [communicationNotes, setCommunicationNotes] = useState("");
  const [allergies, setAllergies] = useState("");
  const [safetyNotes, setSafetyNotes] = useState("");
  const [diagnoses, setDiagnoses] = useState("");
  const [languagesSpoken, setLanguagesSpoken] = useState("");

  const [medsLoading, setMedsLoading] = useState(false);
  const [medsSaving, setMedsSaving] = useState<string | null>(null);
  const [meds, setMeds] = useState<MedicationRow[]>([]);

  const [newName, setNewName] = useState("");
  const [newDosage, setNewDosage] = useState("");
  const [newScheduleText, setNewScheduleText] = useState("");

  async function decryptProfileField(params: {
    env: CipherEnvelopeV1 | null;
    column:
      | "communication_notes_encrypted"
      | "allergies_encrypted"
      | "safety_notes_encrypted"
      | "diagnoses_encrypted"
      | "languages_spoken_encrypted";
  }) {
    if (!params.env || !vaultKey) return "";

    try {
      return await decryptStringWithLocalCache({
        patientId,
        table: "patient_profiles",
        rowId: patientId,
        column: params.column,
        env: params.env,
        vaultKey,
      });
    } catch (e: any) {
      const text = e?.message ?? String(e);
      if (isDecryptMismatchError(text)) return "";
      throw e;
    }
  }

  async function loadProfile() {
    setLoading(true);
    setMsg(null);

    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      const { data: p, error: pErr } = await supabase
        .from("patients")
        .select("id, display_name")
        .eq("id", patientId)
        .single();
      if (pErr) throw pErr;
      setPatient(p as PatientRow);

      const { data: pr, error: prErr } = await supabase
        .from("patient_profiles")
        .select(
          "patient_id, created_at, updated_at, communication_notes_encrypted, allergies_encrypted, safety_notes_encrypted, diagnoses_encrypted, languages_spoken_encrypted"
        )
        .eq("patient_id", patientId)
        .maybeSingle();

      if (prErr) throw prErr;

      const row = (pr ?? null) as PatientProfileRow | null;
      setProfile(row);

      if (row && vaultKey) {
        const [cn, al, sn, dg, ls] = await Promise.all([
          decryptProfileField({
            env: row.communication_notes_encrypted,
            column: "communication_notes_encrypted",
          }),
          decryptProfileField({
            env: row.allergies_encrypted,
            column: "allergies_encrypted",
          }),
          decryptProfileField({
            env: row.safety_notes_encrypted,
            column: "safety_notes_encrypted",
          }),
          decryptProfileField({
            env: row.diagnoses_encrypted,
            column: "diagnoses_encrypted",
          }),
          decryptProfileField({
            env: row.languages_spoken_encrypted,
            column: "languages_spoken_encrypted",
          }),
        ]);

        setCommunicationNotes(cn || "");
        setAllergies(al || "");
        setSafetyNotes(sn || "");
        setDiagnoses(dg || "");
        setLanguagesSpoken(ls || "");
      } else if (!row) {
        setCommunicationNotes("");
        setAllergies("");
        setSafetyNotes("");
        setDiagnoses("");
        setLanguagesSpoken("");
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_profile");
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    setSavingProfile(true);
    setMsg(null);

    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);
      if (!vaultKey) throw new Error("no_vault_share");

      const [cnEnv, alEnv, snEnv, dgEnv, lsEnv] = await Promise.all([
        vaultEncryptString({
          vaultKey,
          plaintext: communicationNotes,
          aad: { table: "patient_profiles", column: "communication_notes_encrypted", patient_id: patientId },
        }),
        vaultEncryptString({
          vaultKey,
          plaintext: allergies,
          aad: { table: "patient_profiles", column: "allergies_encrypted", patient_id: patientId },
        }),
        vaultEncryptString({
          vaultKey,
          plaintext: safetyNotes,
          aad: { table: "patient_profiles", column: "safety_notes_encrypted", patient_id: patientId },
        }),
        vaultEncryptString({
          vaultKey,
          plaintext: diagnoses,
          aad: { table: "patient_profiles", column: "diagnoses_encrypted", patient_id: patientId },
        }),
        vaultEncryptString({
          vaultKey,
          plaintext: languagesSpoken,
          aad: { table: "patient_profiles", column: "languages_spoken_encrypted", patient_id: patientId },
        }),
      ]);

      const { error } = await supabase.from("patient_profiles").upsert(
        {
          patient_id: patientId,
          communication_notes_encrypted: cnEnv,
          allergies_encrypted: alEnv,
          safety_notes_encrypted: snEnv,
          diagnoses_encrypted: dgEnv,
          languages_spoken_encrypted: lsEnv,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "patient_id" }
      );

      if (error) throw error;

      await loadProfile();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_save_profile");
    } finally {
      setSavingProfile(false);
    }
  }

  async function loadMedications() {
    setMedsLoading(true);
    setMsg(null);

    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      const { data, error } = await supabase
        .from("medications")
        .select("id, patient_id, name, dosage, schedule_text, active, created_by, created_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setMeds((data ?? []) as MedicationRow[]);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_medications");
    } finally {
      setMedsLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
    loadMedications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, !!vaultKey]);

  async function createMedication() {
    setMsg(null);

    const name = newName.trim();
    if (!name) return setMsg("medication_name_required");

    setMedsSaving("create");
    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const uid = auth.user?.id;
      if (!uid) throw new Error("not_authenticated");

      const { error } = await supabase.from("medications").insert({
        patient_id: patientId,
        name,
        dosage: newDosage.trim() ? newDosage.trim() : null,
        schedule_text: newScheduleText.trim() ? newScheduleText.trim() : null,
        active: true,
        created_by: uid,
      });

      if (error) throw error;

      setNewName("");
      setNewDosage("");
      setNewScheduleText("");
      await loadMedications();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_medication");
    } finally {
      setMedsSaving(null);
    }
  }

  async function updateMedication(
    m: MedicationRow,
    patch: Partial<Pick<MedicationRow, "name" | "dosage" | "schedule_text" | "active">>
  ) {
    setMsg(null);
    setMedsSaving(m.id);

    try {
      const { error } = await supabase.from("medications").update(patch).eq("id", m.id).eq("patient_id", patientId);
      if (error) throw error;
      await loadMedications();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_update_medication");
    } finally {
      setMedsSaving(null);
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
            <div className="cc-subtle">You can’t decrypt or save encrypted profile fields (E2EE).</div>
          </div>
        ) : null}

        <div className="cc-grid-2-125">
          <div className="cc-card cc-card-pad cc-stack">
            <h2 className="cc-h2">Encrypted profile notes</h2>

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

            <div className="cc-grid-2">
              <div className="cc-field">
                <div className="cc-label">Diagnoses (E2EE)</div>
                <textarea
                  className="cc-textarea"
                  value={diagnoses}
                  onChange={(e) => setDiagnoses(e.target.value)}
                  placeholder={vaultKey ? "Encrypted diagnoses…" : "Encrypted diagnoses (vault needed)…"}
                  disabled={!vaultKey}
                />
              </div>

              <div className="cc-field">
                <div className="cc-label">Languages spoken (E2EE)</div>
                <textarea
                  className="cc-textarea"
                  value={languagesSpoken}
                  onChange={(e) => setLanguagesSpoken(e.target.value)}
                  placeholder={vaultKey ? "Encrypted languages spoken…" : "Encrypted languages spoken (vault needed)…"}
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
              <button className="cc-btn cc-btn-primary" onClick={saveProfile} disabled={!vaultKey || savingProfile}>
                {savingProfile ? "Saving…" : "Save profile"}
              </button>
              <button className="cc-btn" onClick={loadProfile} disabled={loading}>
                {loading ? "Loading…" : "Refresh"}
              </button>

              {profile?.updated_at ? (
                <span className="cc-small">Last updated: {new Date(profile.updated_at).toLocaleString()}</span>
              ) : (
                <span className="cc-small">No profile record yet.</span>
              )}
            </div>
          </div>

          <div className="cc-card cc-card-pad cc-stack">
            <div className="cc-row-between">
              <div>
                <h2 className="cc-h2">Medications</h2>
                <div className="cc-subtle">
                  Used by <b>Medication logs</b>. (Current schema stores these fields as plaintext metadata.)
                </div>
              </div>
              <Link className="cc-btn" href={`/app/patients/${patientId}/medication-logs`}>
                Open logs
              </Link>
            </div>

            <div className="cc-panel-soft cc-stack">
              <div className="cc-grid-2">
                <div className="cc-field">
                  <div className="cc-label">Name</div>
                  <input className="cc-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Sertraline" />
                </div>

                <div className="cc-field">
                  <div className="cc-label">Dosage</div>
                  <input className="cc-input" value={newDosage} onChange={(e) => setNewDosage(e.target.value)} placeholder="e.g. 50mg" />
                </div>
              </div>

              <div className="cc-field">
                <div className="cc-label">Schedule text</div>
                <input
                  className="cc-input"
                  value={newScheduleText}
                  onChange={(e) => setNewScheduleText(e.target.value)}
                  placeholder="e.g. once daily in the morning"
                />
              </div>

              <div className="cc-row">
                <button className="cc-btn cc-btn-secondary" onClick={createMedication} disabled={medsSaving === "create"}>
                  {medsSaving === "create" ? "Adding…" : "Add medication"}
                </button>
                <button className="cc-btn" onClick={loadMedications} disabled={medsLoading}>
                  {medsLoading ? "Loading…" : "Refresh"}
                </button>
              </div>
            </div>

            {meds.length === 0 ? (
              <div className="cc-small">No medications yet.</div>
            ) : (
              <div className="cc-stack">
                {meds.map((m) => (
                  <MedicationEditor key={m.id} medication={m} busy={medsSaving === m.id} onSave={(patch) => updateMedication(m, patch)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MedicationEditor({
  medication,
  busy,
  onSave,
}: {
  medication: MedicationRow;
  busy: boolean;
  onSave: (patch: Partial<Pick<MedicationRow, "name" | "dosage" | "schedule_text" | "active">>) => void;
}) {
  const [name, setName] = useState(medication.name);
  const [dosage, setDosage] = useState(medication.dosage ?? "");
  const [scheduleText, setScheduleText] = useState(medication.schedule_text ?? "");

  useEffect(() => {
    setName(medication.name);
    setDosage(medication.dosage ?? "");
    setScheduleText(medication.schedule_text ?? "");
  }, [medication.id, medication.name, medication.dosage, medication.schedule_text]);

  const changed =
    name.trim() !== medication.name ||
    (dosage.trim() || "") !== (medication.dosage ?? "") ||
    (scheduleText.trim() || "") !== (medication.schedule_text ?? "");

  return (
    <div className="cc-panel">
      <div className="cc-row-between">
        <div className="cc-wrap">
          <div className="cc-strong">{medication.name}</div>
          <div className="cc-small cc-wrap">{medication.id}</div>
        </div>
        <span className={`cc-pill ${medication.active ? "cc-pill-primary" : "cc-pill-danger"}`}>
          {medication.active ? "Active" : "Inactive"}
        </span>
      </div>

      <div className="cc-spacer-12" />

      <div className="cc-grid-2">
        <div className="cc-field">
          <div className="cc-label">Name</div>
          <input className="cc-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="cc-field">
          <div className="cc-label">Dosage</div>
          <input className="cc-input" value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="Optional" />
        </div>
      </div>

      <div className="cc-field">
        <div className="cc-label">Schedule text</div>
        <input className="cc-input" value={scheduleText} onChange={(e) => setScheduleText(e.target.value)} placeholder="Optional" />
      </div>

      <div className="cc-row">
        <button
          className="cc-btn cc-btn-primary"
          disabled={busy || !changed}
          onClick={() =>
            onSave({
              name: name.trim(),
              dosage: dosage.trim() ? dosage.trim() : null,
              schedule_text: scheduleText.trim() ? scheduleText.trim() : null,
            })
          }
        >
          {busy ? "Saving…" : "Save changes"}
        </button>

        <button className="cc-btn" disabled={busy} onClick={() => onSave({ active: !medication.active })} title="Toggle active/inactive">
          {busy ? "…" : medication.active ? "Deactivate" : "Reactivate"}
        </button>

        <span className="cc-small">Created: {new Date(medication.created_at).toLocaleString()}</span>
      </div>
    </div>
  );
}