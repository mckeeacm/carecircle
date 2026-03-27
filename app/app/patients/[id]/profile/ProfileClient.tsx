"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";
import MobileShell from "@/app/components/MobileShell";
import { DEFAULT_ACCOUNT_LANGUAGE_CODE, normaliseLanguageCode } from "@/lib/languages";
import { useUserLanguage } from "@/app/components/UserLanguageProvider";

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
  communication_notes_summary: string | null;
  allergies_summary: string | null;
  safety_notes_summary: string | null;
  diagnoses_summary: string | null;
  languages_spoken_summary: string | null;
  has_health_wellbeing_lpa: boolean | null;
  health_wellbeing_lpa_holder_name: string | null;
  has_respect_form: boolean | null;
  respect_form_holder_name: string | null;
  has_unofficial_representative: boolean | null;
  unofficial_representative_name: string | null;
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

type SummaryFieldKind = "communication" | "allergies" | "safety" | "diagnoses" | "languages";

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
  const { languageCode } = useUserLanguage();

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

  const [commSummary, setCommSummary] = useState("");
  const [allergiesSummary, setAllergiesSummary] = useState("");
  const [safetySummary, setSafetySummary] = useState("");
  const [diagnosesSummary, setDiagnosesSummary] = useState("");
  const [languagesSummary, setLanguagesSummary] = useState("");
  const [preferredLanguageCode, setPreferredLanguageCode] = useState(DEFAULT_ACCOUNT_LANGUAGE_CODE);
  const [summaryCopyBusy, setSummaryCopyBusy] = useState<SummaryFieldKind | "all" | null>(null);

  const [hasHealthWellbeingLpa, setHasHealthWellbeingLpa] = useState(false);
  const [healthWellbeingLpaHolderName, setHealthWellbeingLpaHolderName] = useState("");
  const [hasRespectForm, setHasRespectForm] = useState(false);
  const [respectFormHolderName, setRespectFormHolderName] = useState("");
  const [hasUnofficialRepresentative, setHasUnofficialRepresentative] = useState(false);
  const [unofficialRepresentativeName, setUnofficialRepresentativeName] = useState("");

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

      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      setPreferredLanguageCode(normaliseLanguageCode(auth.user?.user_metadata?.preferred_language_code));

      const { data: pr, error: prErr } = await supabase
        .from("patient_profiles")
        .select(
          "patient_id, created_at, updated_at, communication_notes_encrypted, allergies_encrypted, safety_notes_encrypted, diagnoses_encrypted, languages_spoken_encrypted, communication_notes_summary, allergies_summary, safety_notes_summary, diagnoses_summary, languages_spoken_summary, has_health_wellbeing_lpa, health_wellbeing_lpa_holder_name, has_respect_form, respect_form_holder_name, has_unofficial_representative, unofficial_representative_name"
        )
        .eq("patient_id", patientId)
        .maybeSingle();

      if (prErr) throw prErr;

      const row = (pr ?? null) as PatientProfileRow | null;
      setProfile(row);

      if (row && vaultKey) {
        const [cn, al, sn, dg, ls] = await Promise.all([
          decryptProfileField({ env: row.communication_notes_encrypted, column: "communication_notes_encrypted" }),
          decryptProfileField({ env: row.allergies_encrypted, column: "allergies_encrypted" }),
          decryptProfileField({ env: row.safety_notes_encrypted, column: "safety_notes_encrypted" }),
          decryptProfileField({ env: row.diagnoses_encrypted, column: "diagnoses_encrypted" }),
          decryptProfileField({ env: row.languages_spoken_encrypted, column: "languages_spoken_encrypted" }),
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

      setCommSummary(row?.communication_notes_summary ?? "");
      setAllergiesSummary(row?.allergies_summary ?? "");
      setSafetySummary(row?.safety_notes_summary ?? "");
      setDiagnosesSummary(row?.diagnoses_summary ?? "");
      setLanguagesSummary(row?.languages_spoken_summary ?? "");

      setHasHealthWellbeingLpa(!!row?.has_health_wellbeing_lpa);
      setHealthWellbeingLpaHolderName(row?.health_wellbeing_lpa_holder_name ?? "");
      setHasRespectForm(!!row?.has_respect_form);
      setRespectFormHolderName(row?.respect_form_holder_name ?? "");
      setHasUnofficialRepresentative(!!row?.has_unofficial_representative);
      setUnofficialRepresentativeName(row?.unofficial_representative_name ?? "");
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
          communication_notes_summary: commSummary.trim() || null,
          allergies_summary: allergiesSummary.trim() || null,
          safety_notes_summary: safetySummary.trim() || null,
          diagnoses_summary: diagnosesSummary.trim() || null,
          languages_spoken_summary: languagesSummary.trim() || null,
          has_health_wellbeing_lpa: hasHealthWellbeingLpa,
          health_wellbeing_lpa_holder_name: hasHealthWellbeingLpa
            ? healthWellbeingLpaHolderName.trim() || null
            : null,
          has_respect_form: hasRespectForm,
          respect_form_holder_name: hasRespectForm ? respectFormHolderName.trim() || null : null,
          has_unofficial_representative: hasUnofficialRepresentative,
          unofficial_representative_name: hasUnofficialRepresentative
            ? unofficialRepresentativeName.trim() || null
            : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "patient_id" }
      );

      if (error) throw error;

      await loadProfile();
      setMsg("Profile saved.");
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

  function getDetailedValue(kind: SummaryFieldKind) {
    if (kind === "communication") return communicationNotes;
    if (kind === "allergies") return allergies;
    if (kind === "safety") return safetyNotes;
    if (kind === "diagnoses") return diagnoses;
    return languagesSpoken;
  }

  function setSummaryValue(kind: SummaryFieldKind, value: string) {
    if (kind === "communication") setCommSummary(value);
    if (kind === "allergies") setAllergiesSummary(value);
    if (kind === "safety") setSafetySummary(value);
    if (kind === "diagnoses") setDiagnosesSummary(value);
    if (kind === "languages") setLanguagesSummary(value);
  }

  function getSummaryFieldLabel(kind: SummaryFieldKind) {
    if (kind === "communication") return "Communication notes";
    if (kind === "allergies") return "Allergies";
    if (kind === "safety") return "Safety notes";
    if (kind === "diagnoses") return "Diagnoses";
    return "Languages spoken";
  }

  async function translateToEnglishForSummary(text: string, fieldLabel: string) {
    const cleanText = text.trim();
    if (!cleanText) return "";

    if (normaliseLanguageCode(preferredLanguageCode) === "en") {
      return cleanText;
    }

    const { data: auth, error: authErr } = await supabase.auth.getSession();
    if (authErr) throw authErr;

    const accessToken = auth.session?.access_token;
    if (!accessToken) throw new Error("missing_auth_session");

    const res = await fetch("/api/translate/english", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        text: cleanText,
        fieldLabel,
        sourceLanguageCode: preferredLanguageCode,
      }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error ?? "failed_to_translate_summary");
    return String(json?.text ?? "").trim();
  }

  async function copyOneToSummary(kind: SummaryFieldKind) {
    setMsg(null);
    setSummaryCopyBusy(kind);

    try {
      const englishText = await translateToEnglishForSummary(getDetailedValue(kind), getSummaryFieldLabel(kind));
      setSummaryValue(kind, englishText);
      setMsg("Clinician summary updated in English.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_copy_summary");
    } finally {
      setSummaryCopyBusy(null);
    }
  }

  async function copyAllToSummary() {
    setMsg(null);
    setSummaryCopyBusy("all");

    try {
      const kinds: SummaryFieldKind[] = ["communication", "allergies", "safety", "diagnoses", "languages"];
      const results = await Promise.all(
        kinds.map(async (kind) => ({
          kind,
          englishText: await translateToEnglishForSummary(getDetailedValue(kind), getSummaryFieldLabel(kind)),
        }))
      );

      for (const result of results) {
        setSummaryValue(result.kind, result.englishText);
      }

      setMsg("Clinician summary updated in English.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_copy_summary");
    } finally {
      setSummaryCopyBusy(null);
    }
  }

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

  const ui =
    languageCode === "it"
      ? {
          title: "Profilo",
          summary: "Riepilogo",
          message: "Messaggio",
          secureTitle: "L'accesso sicuro non e pronto su questo dispositivo",
          secureSubtitle: "I campi dettagliati del profilo non sono ancora disponibili su questo dispositivo.",
          detailsTitle: "Dettagli del profilo",
          detailsSubtitle: "Mantieni allineate le note dettagliate e il riepilogo clinico senza doppio inserimento. Il riepilogo resta sempre in inglese.",
          copyAll: "Copia tutto nel riepilogo inglese",
          copying: "Copia in corso...",
          refresh: "Aggiorna",
          loading: "Caricamento...",
          saveProfile: "Salva profilo",
          saving: "Salvataggio...",
          lastUpdated: "Ultimo aggiornamento",
          noProfile: "Nessun profilo ancora registrato.",
          advanceTitle: "Pianificazione anticipata",
          advanceSubtitle: "Registra i dettagli chiave su rappresentanza e decisioni per passaggi di consegne e cura.",
          detailedNotes: "Note dettagliate del profilo",
          detailedNotesSubtitle: "Informazioni sensibili del cerchio disponibili quando l'accesso sicuro e pronto.",
        }
      : {
          title: "Profile",
          summary: "Summary",
          message: "Message",
          secureTitle: "Secure access is not ready on this device",
          secureSubtitle: "Detailed profile fields are not available on this device yet.",
          detailsTitle: "Profile details",
          detailsSubtitle: "Keep detailed notes and the clinician summary aligned without double entry. The summary always stays in English.",
          copyAll: "Copy all to English summary",
          copying: "Copying...",
          refresh: "Refresh",
          loading: "Loading...",
          saveProfile: "Save profile",
          saving: "Saving...",
          lastUpdated: "Last updated",
          noProfile: "No profile record yet.",
          advanceTitle: "Advance planning",
          advanceSubtitle: "Record key decision-making and representation details for handover and care.",
          detailedNotes: "Detailed profile notes",
          detailedNotesSubtitle: "Sensitive circle information that opens when secure access is ready.",
        };

  return (
    <MobileShell
      title={ui.title}
      subtitle={patient?.display_name ?? patientId}
      patientId={patientId}
      rightSlot={
        <Link className="cc-btn" href={`/app/patients/${patientId}/summary`}>
          {ui.summary}
        </Link>
      }
    >
      {msg ? (
        <div className="cc-status cc-status-error">
          <div className="cc-status-error-title">{ui.message}</div>
          <div className="cc-wrap">{msg}</div>
        </div>
      ) : null}

      {!vaultKey ? (
        <div className="cc-status cc-status-loading">
          <div className="cc-strong">{ui.secureTitle}</div>
          <div className="cc-subtle">{ui.secureSubtitle}</div>
        </div>
      ) : null}

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">{ui.detailsTitle}</h2>
              <div className="cc-subtle">{ui.detailsSubtitle}</div>
            </div>

          <div className="cc-row" style={{ flexWrap: "wrap" }}>
            <button className="cc-btn" onClick={copyAllToSummary} disabled={!vaultKey || summaryCopyBusy != null}>
              {summaryCopyBusy === "all" ? ui.copying : ui.copyAll}
            </button>
            <button className="cc-btn" onClick={loadProfile} disabled={loading}>
              {loading ? ui.loading : ui.refresh}
            </button>
            <button className="cc-btn cc-btn-primary" onClick={saveProfile} disabled={!vaultKey || savingProfile}>
              {savingProfile ? ui.saving : ui.saveProfile}
            </button>
          </div>
        </div>

        <div className="cc-small cc-subtle">
          {profile?.updated_at ? `${ui.lastUpdated}: ${new Date(profile.updated_at).toLocaleString()}` : ui.noProfile}
        </div>
      </div>

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">{ui.advanceTitle}</h2>
            <div className="cc-subtle">{ui.advanceSubtitle}</div>
          </div>
        </div>

        <AdvancePlanningEditor
          hasHealthWellbeingLpa={hasHealthWellbeingLpa}
          healthWellbeingLpaHolderName={healthWellbeingLpaHolderName}
          hasRespectForm={hasRespectForm}
          respectFormHolderName={respectFormHolderName}
          hasUnofficialRepresentative={hasUnofficialRepresentative}
          unofficialRepresentativeName={unofficialRepresentativeName}
          onHasHealthWellbeingLpaChange={setHasHealthWellbeingLpa}
          onHealthWellbeingLpaHolderNameChange={setHealthWellbeingLpaHolderName}
          onHasRespectFormChange={setHasRespectForm}
          onRespectFormHolderNameChange={setRespectFormHolderName}
          onHasUnofficialRepresentativeChange={setHasUnofficialRepresentative}
          onUnofficialRepresentativeNameChange={setUnofficialRepresentativeName}
        />
      </div>

      <div className="cc-grid-2-125">
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">{ui.detailedNotes}</h2>
              <div className="cc-subtle">{ui.detailedNotesSubtitle}</div>
            </div>
          </div>

          <ProfileFieldCard
            title="Communication notes"
            encryptedLabel="Communication notes (protected)"
            summaryLabel="Communication notes summary"
            encryptedValue={communicationNotes}
            summaryValue={commSummary}
            disabled={!vaultKey}
            copyBusy={summaryCopyBusy === "communication" || summaryCopyBusy === "all"}
            onEncryptedChange={setCommunicationNotes}
            onSummaryChange={setCommSummary}
            onCopyToSummary={() => copyOneToSummary("communication")}
          />

          <ProfileFieldCard
            title="Allergies"
            encryptedLabel="Allergies (protected)"
            summaryLabel="Allergies summary"
            encryptedValue={allergies}
            summaryValue={allergiesSummary}
            disabled={!vaultKey}
            copyBusy={summaryCopyBusy === "allergies" || summaryCopyBusy === "all"}
            onEncryptedChange={setAllergies}
            onSummaryChange={setAllergiesSummary}
            onCopyToSummary={() => copyOneToSummary("allergies")}
          />

          <ProfileFieldCard
            title="Safety notes"
            encryptedLabel="Safety notes (protected)"
            summaryLabel="Safety notes summary"
            encryptedValue={safetyNotes}
            summaryValue={safetySummary}
            disabled={!vaultKey}
            copyBusy={summaryCopyBusy === "safety" || summaryCopyBusy === "all"}
            onEncryptedChange={setSafetyNotes}
            onSummaryChange={setSafetySummary}
            onCopyToSummary={() => copyOneToSummary("safety")}
            emphasise
          />

          <ProfileFieldCard
            title="Diagnoses"
            encryptedLabel="Diagnoses (protected)"
            summaryLabel="Diagnoses summary"
            encryptedValue={diagnoses}
            summaryValue={diagnosesSummary}
            disabled={!vaultKey}
            copyBusy={summaryCopyBusy === "diagnoses" || summaryCopyBusy === "all"}
            onEncryptedChange={setDiagnoses}
            onSummaryChange={setDiagnosesSummary}
            onCopyToSummary={() => copyOneToSummary("diagnoses")}
          />

          <ProfileFieldCard
            title="Languages spoken"
            encryptedLabel="Languages spoken (protected)"
            summaryLabel="Languages spoken summary"
            encryptedValue={languagesSpoken}
            summaryValue={languagesSummary}
            disabled={!vaultKey}
            copyBusy={summaryCopyBusy === "languages" || summaryCopyBusy === "all"}
            onEncryptedChange={setLanguagesSpoken}
            onSummaryChange={setLanguagesSummary}
            onCopyToSummary={() => copyOneToSummary("languages")}
          />
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Clinician summary preview</h2>
              <div className="cc-subtle">
                These summary fields stay in English for permitted members, even if detailed notes are not open here yet.
              </div>
            </div>
            <Link className="cc-btn" href={`/app/patients/${patientId}/summary`}>
              Open summary
            </Link>
          </div>

          <AdvancePlanningSummaryCard
            hasHealthWellbeingLpa={hasHealthWellbeingLpa}
            healthWellbeingLpaHolderName={healthWellbeingLpaHolderName}
            hasRespectForm={hasRespectForm}
            respectFormHolderName={respectFormHolderName}
            hasUnofficialRepresentative={hasUnofficialRepresentative}
            unofficialRepresentativeName={unofficialRepresentativeName}
          />

          <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
            <div className="cc-small cc-strong" style={{ marginBottom: 8 }}>
              Safety notes
            </div>
            <div className="cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {safetySummary || "—"}
            </div>
          </div>

          <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
            <div className="cc-small cc-strong" style={{ marginBottom: 8 }}>
              Allergies
            </div>
            <div className="cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {allergiesSummary || "—"}
            </div>
          </div>

          <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
            <div className="cc-small cc-strong" style={{ marginBottom: 8 }}>
              Diagnoses
            </div>
            <div className="cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {diagnosesSummary || "—"}
            </div>
          </div>

          <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
            <div className="cc-small cc-strong" style={{ marginBottom: 8 }}>
              Communication notes
            </div>
            <div className="cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {commSummary || "—"}
            </div>
          </div>

          <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
            <div className="cc-small cc-strong" style={{ marginBottom: 8 }}>
              Languages spoken
            </div>
            <div className="cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {languagesSummary || "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">Medications</h2>
            <div className="cc-subtle">
              Used by <b>Medication logs</b>.
            </div>
          </div>
          <Link className="cc-btn" href={`/app/patients/${patientId}/medication-logs`}>
            Open logs
          </Link>
        </div>

        <div className="cc-panel-soft cc-stack" style={{ padding: 16, borderRadius: 20 }}>
          <div className="cc-strong">Add medication</div>

          <div className="cc-grid-2">
            <div className="cc-field">
              <div className="cc-label">Name</div>
              <input
                className="cc-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Sertraline"
              />
            </div>

            <div className="cc-field">
              <div className="cc-label">Dosage</div>
              <input
                className="cc-input"
                value={newDosage}
                onChange={(e) => setNewDosage(e.target.value)}
                placeholder="e.g. 50mg"
              />
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
              {medsSaving === "create" ? "Adding..." : "Add medication"}
            </button>
            <button className="cc-btn" onClick={loadMedications} disabled={medsLoading}>
              {medsLoading ? "Loading..." : "Refresh"}
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
    </MobileShell>
  );
}

function YesNoButtons({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 10,
      }}
    >
      <button
        type="button"
        className={`cc-btn ${value ? "cc-btn-primary" : ""}`}
        onClick={() => onChange(true)}
        style={{ minHeight: 46 }}
      >
        Yes
      </button>
      <button
        type="button"
        className={`cc-btn ${!value ? "cc-btn-primary" : ""}`}
        onClick={() => onChange(false)}
        style={{ minHeight: 46 }}
      >
        No
      </button>
    </div>
  );
}

function AdvancePlanningEditor({
  hasHealthWellbeingLpa,
  healthWellbeingLpaHolderName,
  hasRespectForm,
  respectFormHolderName,
  hasUnofficialRepresentative,
  unofficialRepresentativeName,
  onHasHealthWellbeingLpaChange,
  onHealthWellbeingLpaHolderNameChange,
  onHasRespectFormChange,
  onRespectFormHolderNameChange,
  onHasUnofficialRepresentativeChange,
  onUnofficialRepresentativeNameChange,
}: {
  hasHealthWellbeingLpa: boolean;
  healthWellbeingLpaHolderName: string;
  hasRespectForm: boolean;
  respectFormHolderName: string;
  hasUnofficialRepresentative: boolean;
  unofficialRepresentativeName: string;
  onHasHealthWellbeingLpaChange: (value: boolean) => void;
  onHealthWellbeingLpaHolderNameChange: (value: string) => void;
  onHasRespectFormChange: (value: boolean) => void;
  onRespectFormHolderNameChange: (value: string) => void;
  onHasUnofficialRepresentativeChange: (value: boolean) => void;
  onUnofficialRepresentativeNameChange: (value: string) => void;
}) {
  return (
    <div className="cc-stack">
      <div className="cc-panel-soft cc-stack" style={{ padding: 16, borderRadius: 20 }}>
        <div className="cc-strong">Health and Wellbeing Power of Attorney</div>
        <YesNoButtons value={hasHealthWellbeingLpa} onChange={onHasHealthWellbeingLpaChange} />
        {hasHealthWellbeingLpa ? (
          <div className="cc-field">
            <div className="cc-label">Name of person who holds it</div>
            <input
              className="cc-input"
              value={healthWellbeingLpaHolderName}
              onChange={(e) => onHealthWellbeingLpaHolderNameChange(e.target.value)}
              placeholder="Enter full name"
            />
          </div>
        ) : null}
      </div>

      <div className="cc-panel-soft cc-stack" style={{ padding: 16, borderRadius: 20 }}>
        <div className="cc-strong">RESPECT form or Emergency Care Plan</div>
        <YesNoButtons value={hasRespectForm} onChange={onHasRespectFormChange} />
        {hasRespectForm ? (
          <div className="cc-field">
            <div className="cc-label">Name of person who holds it</div>
            <input
              className="cc-input"
              value={respectFormHolderName}
              onChange={(e) => onRespectFormHolderNameChange(e.target.value)}
              placeholder="Enter full name"
            />
          </div>
        ) : null}
      </div>

      <div className="cc-panel-soft cc-stack" style={{ padding: 16, borderRadius: 20 }}>
        <div className="cc-strong">Nominated Advocate</div>
        <YesNoButtons value={hasUnofficialRepresentative} onChange={onHasUnofficialRepresentativeChange} />
        {hasUnofficialRepresentative ? (
          <div className="cc-field">
            <div className="cc-label">Name of nominated advocate</div>
            <input
              className="cc-input"
              value={unofficialRepresentativeName}
              onChange={(e) => onUnofficialRepresentativeNameChange(e.target.value)}
              placeholder="Enter full name"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AdvancePlanningSummaryCard({
  hasHealthWellbeingLpa,
  healthWellbeingLpaHolderName,
  hasRespectForm,
  respectFormHolderName,
  hasUnofficialRepresentative,
  unofficialRepresentativeName,
}: {
  hasHealthWellbeingLpa: boolean;
  healthWellbeingLpaHolderName: string | null;
  hasRespectForm: boolean;
  respectFormHolderName: string | null;
  hasUnofficialRepresentative: boolean;
  unofficialRepresentativeName: string | null;
}) {
  return (
    <div className="cc-panel-soft cc-stack" style={{ padding: 16, borderRadius: 20 }}>
      <div className="cc-small cc-strong">Advance planning</div>

      <AdvancePlanningSummaryRow
        label="Health and Wellbeing Power of Attorney"
        enabled={hasHealthWellbeingLpa}
        name={healthWellbeingLpaHolderName}
      />

      <AdvancePlanningSummaryRow
        label="RESPECT form or Emergency Care Plan"
        enabled={hasRespectForm}
        name={respectFormHolderName}
      />

      <AdvancePlanningSummaryRow
        label="Nominated Advocate"
        enabled={hasUnofficialRepresentative}
        name={unofficialRepresentativeName}
      />
    </div>
  );
}

function AdvancePlanningSummaryRow({
  label,
  enabled,
  name,
}: {
  label: string;
  enabled: boolean;
  name: string | null | undefined;
}) {
  return (
    <div className="cc-wrap">
      <div className="cc-row-between" style={{ alignItems: "center", gap: 12 }}>
        <div className="cc-small cc-strong">{label}</div>
        <span className={`cc-pill ${enabled ? "cc-pill-primary" : ""}`}>{enabled ? "Yes" : "No"}</span>
      </div>
      {enabled ? (
        <div className="cc-small cc-subtle" style={{ marginTop: 6 }}>
          Holder: <b>{name?.trim() || "Not recorded"}</b>
        </div>
      ) : null}
    </div>
  );
}

function ProfileFieldCard({
  title,
  encryptedLabel,
  summaryLabel,
  encryptedValue,
  summaryValue,
  disabled,
  copyBusy,
  emphasise,
  onEncryptedChange,
  onSummaryChange,
  onCopyToSummary,
}: {
  title: string;
  encryptedLabel: string;
  summaryLabel: string;
  encryptedValue: string;
  summaryValue: string;
  disabled: boolean;
  copyBusy?: boolean;
  emphasise?: boolean;
  onEncryptedChange: (value: string) => void;
  onSummaryChange: (value: string) => void;
  onCopyToSummary: () => void;
}) {
  return (
    <div
      className="cc-panel-soft cc-stack"
      style={{
        padding: 16,
        borderRadius: 20,
        border: emphasise ? "1px solid rgba(214, 76, 76, 0.18)" : undefined,
      }}
    >
      <div className="cc-row-between" style={{ alignItems: "center", gap: 12 }}>
        <div className="cc-strong">{title}</div>
        <button className="cc-btn" type="button" onClick={onCopyToSummary} disabled={disabled || copyBusy}>
          {copyBusy ? "Copying..." : "Copy to English summary"}
        </button>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <div className="cc-label">{encryptedLabel}</div>
          <textarea
            className="cc-textarea"
            value={encryptedValue}
            onChange={(e) => onEncryptedChange(e.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="cc-field">
          <div className="cc-label">{summaryLabel}</div>
          <textarea className="cc-textarea" value={summaryValue} onChange={(e) => onSummaryChange(e.target.value)} />
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
    <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
      <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 12 }}>
        <div className="cc-wrap">
          <div className="cc-strong">{medication.name}</div>
          <div className="cc-small cc-subtle">Created: {new Date(medication.created_at).toLocaleString()}</div>
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
          <input
            className="cc-input"
            value={dosage}
            onChange={(e) => setDosage(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="cc-field">
        <div className="cc-label">Schedule text</div>
        <input
          className="cc-input"
          value={scheduleText}
          onChange={(e) => setScheduleText(e.target.value)}
          placeholder="Optional"
        />
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
              {busy ? "Saving..." : "Save changes"}
        </button>

        <button className="cc-btn" disabled={busy} onClick={() => onSave({ active: !medication.active })}>
          {busy ? "…" : medication.active ? "Deactivate" : "Reactivate"}
        </button>
      </div>
    </div>
  );
}
