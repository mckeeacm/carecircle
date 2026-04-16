"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";
import MobileShell from "@/app/components/MobileShell";
import { useUserLanguage } from "@/app/components/UserLanguageProvider";
import { getPageUi } from "@/lib/pageUi";

type JournalRow = {
  id: string;
  patient_id: string;
  journal_type: string;
  occurred_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string | null;
  shared_to_circle: boolean;
  pain_level: number | null;
  include_in_clinician_summary: boolean | null;
  content_encrypted: CipherEnvelopeV1 | null;
  mood_encrypted: CipherEnvelopeV1 | null;
};

type JournalCommentRow = {
  id: string;
  journal_entry_id: string;
  patient_id: string;
  created_by: string;
  created_at: string;
  updated_at: string | null;
  content_encrypted: CipherEnvelopeV1;
};

type MembershipRow = {
  user_id: string;
  nickname: string | null;
  role: string | null;
  is_controller: boolean | null;
};

type JournalEntryKind = "incident_report" | "general_report" | "activity";

type IncidentPhoto = {
  path: string;
  name: string;
};

type StructuredJournalPayload =
  | {
      kind: "incident_report";
      title: "Incident Report";
      date: string;
      time: string;
      location: string;
      incidentType: string;
      description: string;
      personsInvolved: string;
      witnesses: string;
      photoUploads: IncidentPhoto[];
    }
  | {
      kind: "general_report";
      title: "General Report";
      content: string;
    }
  | {
      kind: "activity";
      title: "Activities";
      activityType: string;
      note: string;
      incidentReported: boolean;
    };

const STRUCTURED_ENTRY_PREFIX = "__CARECIRCLE_JOURNAL_V2__:";
const INCIDENT_PHOTO_BUCKET = "journal-incident-photos";

const JOURNAL_TITLE_OPTIONS: Array<{ value: JournalEntryKind; label: string }> = [
  { value: "incident_report", label: "Incident Report" },
  { value: "general_report", label: "General Report" },
  { value: "activity", label: "Activities" },
];

const INCIDENT_TYPE_OPTIONS = [
  "Behaviour incident",
  "Fall",
  "Medication issue",
  "Injury",
  "Safeguarding concern",
  "Health deterioration",
  "Missing person / absconding",
  "Property damage",
  "Visitor issue",
  "Other",
];

const ACTIVITY_OPTIONS = [
  "Bathing",
  "Bed Rail Check",
  "Behaviour",
  "Blood Pressure",
  "Blood Glucose",
  "Bowel Movement",
  "Enteral Feeding",
  "Falls",
  "Fluid Output",
  "Fluids Drink",
  "Infection",
  "Night Checks",
  "Nurse Notes",
  "Nutrition (Meal)",
  "Sanitary Change",
  "Medication Given",
  "Medication Refused",
  "Mobility",
  "Observation",
  "Personal Care",
  "Pressure Area Care",
  "Sleep Check",
  "Toileting",
  "Vitals",
  "Wound Care",
] as const;

type JournalEditSeed = {
  row: JournalRow;
  parsedPayload: StructuredJournalPayload | null;
  plainContent: string;
};

function moodLabel(mood: string, ui: Record<string, any>) {
  return ui.moodLabels?.[mood] ?? mood;
}

function journalTypeOptionLabel(kind: JournalEntryKind, ui: Record<string, any>) {
  return ui.journalTitleOptions?.[kind] ?? kind;
}

function incidentTypeLabel(type: string, ui: Record<string, any>) {
  return ui.incidentTypes?.[type] ?? type;
}

function activityLabel(activity: string, ui: Record<string, any>) {
  return ui.activityTypes?.[activity] ?? activity;
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function buildStructuredPayload(payload: StructuredJournalPayload) {
  return `${STRUCTURED_ENTRY_PREFIX}${JSON.stringify(payload)}`;
}

function parseStructuredPayload(value: string): StructuredJournalPayload | null {
  if (!value.startsWith(STRUCTURED_ENTRY_PREFIX)) return null;

  try {
    const parsed = JSON.parse(value.slice(STRUCTURED_ENTRY_PREFIX.length)) as StructuredJournalPayload;
    if (!parsed || typeof parsed !== "object" || typeof parsed.kind !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function getDefaultIncidentDate() {
  return new Date().toISOString().slice(0, 10);
}

function getDefaultIncidentTime() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(11, 16);
}

function sanitiseFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

function makeJournalTypeLabelForUi(journalType: string, ui: Record<string, any>) {
  return ui.journalTypeLabels?.[journalType] ?? journalType;
}

function needsIncidentCheckbox(activityType: string) {
  return activityType === "Falls" || activityType === "Behaviour";
}

export default function JournalsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();
  const { languageCode } = useUserLanguage();
  const ui = getPageUi("journals", languageCode);

  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"all" | "shared">("all");

  const [currentUserId, setCurrentUserId] = useState("");
  const [myRole, setMyRole] = useState("");
  const [isPatientRole, setIsPatientRole] = useState(false);

  const [journalTitle, setJournalTitle] = useState<JournalEntryKind>("incident_report");
  const [generalReportContent, setGeneralReportContent] = useState("");
  const [sharedToCircle, setSharedToCircle] = useState(true);

  const [incidentDate, setIncidentDate] = useState(getDefaultIncidentDate());
  const [incidentTime, setIncidentTime] = useState(getDefaultIncidentTime());
  const [incidentLocation, setIncidentLocation] = useState("");
  const [incidentType, setIncidentType] = useState("Behaviour incident");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [incidentPersonsInvolved, setIncidentPersonsInvolved] = useState("");
  const [incidentWitnesses, setIncidentWitnesses] = useState("");
  const [incidentPhotoFiles, setIncidentPhotoFiles] = useState<File[]>([]);
  const [incidentExistingPhotos, setIncidentExistingPhotos] = useState<IncidentPhoto[]>([]);

  const [selectedActivityType, setSelectedActivityType] = useState("");
  const [activityNote, setActivityNote] = useState("");
  const [activityIncidentReported, setActivityIncidentReported] = useState(false);

  const [trackerMood, setTrackerMood] = useState("");
  const [trackerPain, setTrackerPain] = useState<number | null>(null);
  const [trackerSobriety, setTrackerSobriety] = useState<"yes" | "no" | "">("");
  const [trackerShare, setTrackerShare] = useState(true);

  const [savingEntry, setSavingEntry] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  async function refresh() {
    if (!patientId || !isUuid(patientId)) {
      setMsg(`invalid patientId: ${String(patientId)}`);
      return;
    }

    setLoading(true);
    setMsg(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const uid = auth.user?.id ?? "";
      setCurrentUserId(uid);

      const { data: myMemberRows, error: myMemberErr } = await supabase
        .from("patient_members")
        .select("user_id, nickname, role, is_controller")
        .eq("patient_id", patientId)
        .eq("user_id", uid)
        .limit(1);

      if (myMemberErr) throw myMemberErr;

      const me = ((myMemberRows ?? [])[0] ?? null) as MembershipRow | null;
      const role = me?.role ?? "";
      setMyRole(role);
      setIsPatientRole(role === "patient");

      const baseSelect =
        "id, patient_id, journal_type, occurred_at, created_by, created_at, shared_to_circle, pain_level, include_in_clinician_summary, content_encrypted, mood_encrypted";
      const selectWithAudit = `${baseSelect}, updated_at`;

      const buildJournalQuery = (selectColumns: string) => {
        let journalQuery = supabase
          .from("journal_entries")
          .select(selectColumns)
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (viewMode === "shared") journalQuery = journalQuery.eq("shared_to_circle", true);
        return journalQuery;
      };

      let { data, error } = await buildJournalQuery(selectWithAudit);

      if (error && (error.code === "PGRST204" || /updated_at|schema cache|column/i.test(error.message ?? ""))) {
        const fallback = await buildJournalQuery(baseSelect);
        data = (fallback.data ?? []).map((row) => ({ ...row, updated_at: null }));
        error = fallback.error;
      }

      if (error) throw error;

      setRows((data ?? []) as JournalRow[]);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "failed_to_load_journals");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, viewMode]);

  useEffect(() => {
    if (!patientId || !isUuid(patientId)) return;

    const channel = supabase
      .channel(`journals:${patientId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "journal_entries", filter: `patient_id=eq.${patientId}` },
        () => refresh()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sobriety_logs", filter: `patient_id=eq.${patientId}` },
        () => refresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  function resetIncidentForm() {
    setIncidentDate(getDefaultIncidentDate());
    setIncidentTime(getDefaultIncidentTime());
    setIncidentLocation("");
    setIncidentType("Behaviour incident");
    setIncidentDescription("");
    setIncidentPersonsInvolved("");
    setIncidentWitnesses("");
    setIncidentPhotoFiles([]);
    setIncidentExistingPhotos([]);
  }

  function resetActivityForm() {
    setSelectedActivityType("");
    setActivityNote("");
    setActivityIncidentReported(false);
  }

  function resetEntryForm() {
    setGeneralReportContent("");
    setSharedToCircle(true);
    setEditingEntryId(null);
    resetIncidentForm();
    resetActivityForm();
  }

  function handleIncidentFileChange(event: ChangeEvent<HTMLInputElement>) {
    setIncidentPhotoFiles(Array.from(event.target.files ?? []));
  }

  async function uploadIncidentPhotos(userId: string) {
    if (incidentPhotoFiles.length === 0) return [] as IncidentPhoto[];

    const uploadedPaths: string[] = [];

    try {
      const uploaded = await Promise.all(
        incidentPhotoFiles.map(async (file) => {
          const safeName = sanitiseFileName(file.name || "incident-photo");
          const path = `${patientId}/${userId}/${Date.now()}-${safeName}`;

          const { error } = await supabase.storage.from(INCIDENT_PHOTO_BUCKET).upload(path, file, {
            upsert: false,
            contentType: file.type || undefined,
          });

          if (error) throw error;

          uploadedPaths.push(path);
          return { path, name: file.name };
        })
      );

      return uploaded;
    } catch (e) {
      if (uploadedPaths.length > 0) {
        await supabase.storage.from(INCIDENT_PHOTO_BUCKET).remove(uploadedPaths);
      }
      throw e;
    }
  }

  async function createStructuredEntry(payload: StructuredJournalPayload, journalType: JournalEntryKind) {
    if (!vaultKey) throw new Error("no_vault_share");
    if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw authErr;
    const uid = auth.user?.id;
    if (!uid) throw new Error("not_authenticated");

    const contentEnv = await vaultEncryptString({
      vaultKey,
      plaintext: buildStructuredPayload(payload),
      aad: { table: "journal_entries", column: "content_encrypted", patient_id: patientId },
    });

    const effectiveSharedToCircle = isPatientRole ? sharedToCircle : true;
    const occurredAt =
      journalType === "incident_report" && payload.kind === "incident_report"
        ? new Date(`${payload.date}T${payload.time || "00:00"}`).toISOString()
        : new Date().toISOString();

    const { error } = await supabase.from("journal_entries").insert({
      patient_id: patientId,
      journal_type: journalType,
      occurred_at: occurredAt,
      created_by: uid,
      shared_to_circle: effectiveSharedToCircle,
      pain_level: null,
      include_in_clinician_summary: false,
      content_encrypted: contentEnv,
      mood_encrypted: null,
    });

    if (error) throw error;
  }

  async function updateStructuredEntry(
    entryId: string,
    payload: StructuredJournalPayload,
    journalType: JournalEntryKind
  ) {
    if (!vaultKey) throw new Error("no_vault_share");
    if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw authErr;
    const uid = auth.user?.id;
    if (!uid) throw new Error("not_authenticated");

    const contentEnv = await vaultEncryptString({
      vaultKey,
      plaintext: buildStructuredPayload(payload),
      aad: { table: "journal_entries", column: "content_encrypted", patient_id: patientId },
    });

    const effectiveSharedToCircle = isPatientRole ? sharedToCircle : true;
    const occurredAt =
      journalType === "incident_report" && payload.kind === "incident_report"
        ? new Date(`${payload.date}T${payload.time || "00:00"}`).toISOString()
        : new Date().toISOString();

    const { error } = await supabase
      .from("journal_entries")
      .update({
        journal_type: journalType,
        occurred_at: occurredAt,
        shared_to_circle: effectiveSharedToCircle,
        content_encrypted: contentEnv,
        updated_at: new Date().toISOString(),
        updated_by: uid,
      })
      .eq("id", entryId)
      .eq("patient_id", patientId)
      .eq("created_by", uid);

    if (error) throw error;
  }

  function beginEditingEntry(seed: JournalEditSeed) {
    const { row, parsedPayload, plainContent } = seed;
    if (row.created_by !== currentUserId) return;
    if (row.journal_type === "tracker") return;

    setEditingEntryId(row.id);
    setSharedToCircle(row.shared_to_circle);

    if (parsedPayload?.kind === "incident_report") {
      setJournalTitle("incident_report");
      setIncidentDate(parsedPayload.date || getDefaultIncidentDate());
      setIncidentTime(parsedPayload.time || getDefaultIncidentTime());
      setIncidentLocation(parsedPayload.location || "");
      setIncidentType(parsedPayload.incidentType || "Behaviour incident");
      setIncidentDescription(parsedPayload.description || "");
      setIncidentPersonsInvolved(parsedPayload.personsInvolved || "");
      setIncidentWitnesses(parsedPayload.witnesses || "");
      setIncidentPhotoFiles([]);
      setIncidentExistingPhotos(parsedPayload.photoUploads || []);
      setGeneralReportContent("");
      resetActivityForm();
      return;
    }

    if (parsedPayload?.kind === "general_report") {
      setJournalTitle("general_report");
      setGeneralReportContent(parsedPayload.content || "");
      resetIncidentForm();
      resetActivityForm();
      return;
    }

    if (parsedPayload?.kind === "activity") {
      setJournalTitle("activity");
      setSelectedActivityType(parsedPayload.activityType || "");
      setActivityNote(parsedPayload.note || "");
      setActivityIncidentReported(!!parsedPayload.incidentReported);
      resetIncidentForm();
      setGeneralReportContent("");
      return;
    }

    setJournalTitle(row.journal_type === "general_report" ? "general_report" : "activity");
    setGeneralReportContent(plainContent || "");
    resetIncidentForm();
    resetActivityForm();
  }

  async function createEntry() {
    setMsg(null);
    setSavingEntry(true);

    try {
      if (journalTitle === "general_report") {
        if (!generalReportContent.trim()) throw new Error("general_report_required");
        const payload: StructuredJournalPayload = {
          kind: "general_report",
          title: "General Report",
          content: generalReportContent.trim(),
        };
        if (editingEntryId) {
          await updateStructuredEntry(editingEntryId, payload, "general_report");
        } else {
          await createStructuredEntry(payload, "general_report");
        }
      } else if (journalTitle === "incident_report") {
        if (!incidentDate) throw new Error("incident_date_required");
        if (!incidentTime) throw new Error("incident_time_required");
        if (!incidentLocation.trim()) throw new Error("incident_location_required");
        if (!incidentType.trim()) throw new Error("incident_type_required");
        if (!incidentDescription.trim()) throw new Error("incident_description_required");
        if (!incidentPersonsInvolved.trim()) throw new Error("incident_persons_required");

        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const uid = auth.user?.id;
        if (!uid) throw new Error("not_authenticated");

        const newPhotoUploads = await uploadIncidentPhotos(uid);
        const photoUploads = editingEntryId ? [...incidentExistingPhotos, ...newPhotoUploads] : newPhotoUploads;
        const payload: StructuredJournalPayload = {
          kind: "incident_report",
          title: "Incident Report",
          date: incidentDate,
          time: incidentTime,
          location: incidentLocation.trim(),
          incidentType: incidentType.trim(),
          description: incidentDescription.trim(),
          personsInvolved: incidentPersonsInvolved.trim(),
          witnesses: incidentWitnesses.trim(),
          photoUploads,
        };
        if (editingEntryId) {
          await updateStructuredEntry(editingEntryId, payload, "incident_report");
        } else {
          await createStructuredEntry(payload, "incident_report");
        }
      } else {
        if (!selectedActivityType) throw new Error("activity_type_required");
        const payload: StructuredJournalPayload = {
          kind: "activity",
          title: "Activities",
          activityType: selectedActivityType,
          note: activityNote.trim(),
          incidentReported: needsIncidentCheckbox(selectedActivityType) ? activityIncidentReported : false,
        };
        if (editingEntryId) {
          await updateStructuredEntry(editingEntryId, payload, "activity");
        } else {
          await createStructuredEntry(payload, "activity");
        }
      }

      resetEntryForm();
      await refresh();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "failed_to_create_journal");
    } finally {
      setSavingEntry(false);
    }
  }

  async function saveTrackers() {
    if (!vaultKey) return setMsg("no_vault_share");
    if (!isPatientRole) return setMsg("only_patient_can_log_trackers");
    if (!patientId || !isUuid(patientId)) return setMsg(`invalid patientId: ${String(patientId)}`);
    if (!trackerMood && trackerPain == null && !trackerSobriety) return setMsg("choose_at_least_one_tracker");

    setMsg(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const uid = auth.user?.id;
      if (!uid) throw new Error("not_authenticated");

      const contentParts: string[] = [];

      if (trackerMood) contentParts.push(`Mood: ${trackerMood}`);
      if (trackerPain != null) contentParts.push(`Pain: ${trackerPain}/10`);
      if (trackerSobriety) contentParts.push(`Sobriety today: ${trackerSobriety === "yes" ? "Yes" : "No"}`);

      const contentEnv = await vaultEncryptString({
        vaultKey,
        plaintext: contentParts.join("\n"),
        aad: { table: "journal_entries", column: "content_encrypted", patient_id: patientId },
      });

      const moodEnv = await vaultEncryptString({
        vaultKey,
        plaintext: trackerMood || "",
        aad: { table: "journal_entries", column: "mood_encrypted", patient_id: patientId },
      });

      const { error: jErr } = await supabase.from("journal_entries").insert({
        patient_id: patientId,
        journal_type: "tracker",
        occurred_at: new Date().toISOString(),
        created_by: uid,
        shared_to_circle: trackerShare,
        pain_level: trackerPain,
        include_in_clinician_summary: false,
        content_encrypted: contentEnv,
        mood_encrypted: moodEnv,
      });

      if (jErr) throw jErr;

      if (trackerSobriety) {
        const noteText = contentParts.join("\n");

        const noteEnv = await vaultEncryptString({
          vaultKey,
          plaintext: noteText,
          aad: { table: "sobriety_logs", column: "note_encrypted", patient_id: patientId },
        });

        const { error: sErr } = await supabase.from("sobriety_logs").insert({
          patient_id: patientId,
          occurred_at: new Date().toISOString(),
          status: trackerSobriety === "yes" ? "yes" : "no",
          substance: null,
          intensity: null,
          note_encrypted: noteEnv,
          created_by: uid,
        });

        if (sErr) throw sErr;
      }

      setTrackerMood("");
      setTrackerPain(null);
      setTrackerSobriety("");
      setTrackerShare(true);
      await refresh();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "failed_to_save_trackers");
    }
  }

  const entryActionLabel =
    editingEntryId
      ? ui.updateEntry
      : journalTitle === "incident_report"
      ? ui.saveIncidentReport
      : journalTitle === "general_report"
      ? ui.saveGeneralReport
      : ui.saveActivity;


  return (
    <MobileShell
      title={ui.title}
      subtitle={myRole ? `${ui.roleLabel}: ${myRole}` : patientId}
      patientId={patientId}
      rightSlot={
        <Link className="cc-btn" href={`/app/patients/${patientId}/today`}>
          {ui.today}
        </Link>
      }
    >
      {msg ? (
        <div className="cc-status cc-status-error">
          <div className="cc-status-error-title">{ui.error}</div>
          <div className="cc-wrap">{msg}</div>
        </div>
      ) : null}

      {!vaultKey ? (
        <div className="cc-status cc-status-loading">
          <div className="cc-strong">{ui.secureTitle}</div>
          <div className="cc-subtle">{ui.secureSubtitle}</div>
        </div>
      ) : null}

      <div className="cc-row">
        <button
          className={`cc-tab ${viewMode === "all" ? "cc-tab-active" : ""}`}
          onClick={() => setViewMode("all")}
        >
          {ui.allEntries}
        </button>
        <button
          className={`cc-tab ${viewMode === "shared" ? "cc-tab-active" : ""}`}
          onClick={() => setViewMode("shared")}
        >
          {ui.circleFeed}
        </button>
        <button className="cc-btn" onClick={refresh} disabled={loading}>
          {loading ? ui.loading : ui.refresh}
        </button>
      </div>

      {isPatientRole ? (
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">{ui.trackersTitle}</h2>
              <div className="cc-subtle">{ui.trackersSubtitle}</div>
            </div>
          </div>

          <div className="cc-grid-3">
            <div className="cc-panel-soft cc-stack">
              <div className="cc-strong">{ui.mood}</div>
              <div className="cc-row">
                {["Sad", "Low", "Okay", "Good", "Great"].map((mood) => (
                  <button
                    key={mood}
                    className={`cc-btn ${trackerMood === mood ? "cc-btn-primary" : ""}`}
                    onClick={() => setTrackerMood(mood)}
                  >
                    {moodLabel(mood, ui)}
                  </button>
                ))}
              </div>
            </div>

            <div className="cc-panel-soft cc-stack">
              <div className="cc-strong">{ui.pain}</div>
              <div className="cc-row" style={{ flexWrap: "wrap" }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    className={`cc-btn ${trackerPain === n ? "cc-btn-primary" : ""}`}
                    onClick={() => setTrackerPain(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="cc-panel-soft cc-stack">
              <div className="cc-strong">{ui.sobriety}</div>
              <div className="cc-row">
                <button
                  className={`cc-btn ${trackerSobriety === "yes" ? "cc-btn-primary" : ""}`}
                  onClick={() => setTrackerSobriety("yes")}
                >
                  {ui.yes}
                </button>
                <button
                  className={`cc-btn ${trackerSobriety === "no" ? "cc-btn-danger" : ""}`}
                  onClick={() => setTrackerSobriety("no")}
                >
                  {ui.no}
                </button>
              </div>
            </div>
          </div>

          <label className="cc-check">
            <input type="checkbox" checked={trackerShare} onChange={(e) => setTrackerShare(e.target.checked)} />
            <span className="cc-label">{ui.shareTracker}</span>
          </label>

          <div className="cc-row">
            <button className="cc-btn cc-btn-primary" onClick={saveTrackers} disabled={!vaultKey}>
              {ui.saveTrackers}
            </button>
          </div>
        </div>
      ) : null}

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">{editingEntryId ? ui.editEntry : ui.newEntry}</h2>
            <div className="cc-subtle">{editingEntryId ? ui.editEntrySubtitle : ui.newEntrySubtitle}</div>
          </div>
          {editingEntryId ? (
            <button className="cc-btn" onClick={resetEntryForm}>
              {ui.cancelEdit}
            </button>
          ) : null}
        </div>

        <div className="cc-grid-2">
          <div className="cc-field">
            <div className="cc-label">{ui.journalTitle}</div>
            <select
              className="cc-select"
              value={journalTitle}
              onChange={(e) => setJournalTitle(e.target.value as JournalEntryKind)}
            >
              {JOURNAL_TITLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {journalTypeOptionLabel(option.value, ui)}
                </option>
              ))}
            </select>
          </div>

          {isPatientRole ? (
            <label className="cc-check" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={sharedToCircle} onChange={(e) => setSharedToCircle(e.target.checked)} />
              <span className="cc-label">{ui.shareToCircle}</span>
            </label>
          ) : (
            <div className="cc-small cc-subtle" style={{ alignSelf: "end" }}>
              {ui.nonPatientShared}
            </div>
          )}
        </div>

        {journalTitle === "incident_report" ? (
          <div className="cc-stack">
            <div className="cc-grid-2">
              <div className="cc-field">
                <div className="cc-label">{ui.date}</div>
                <input className="cc-input" type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} />
              </div>

              <div className="cc-field">
                <div className="cc-label">{ui.time}</div>
                <input className="cc-input" type="time" value={incidentTime} onChange={(e) => setIncidentTime(e.target.value)} />
              </div>
            </div>

            <div className="cc-grid-2">
              <div className="cc-field">
                <div className="cc-label">{ui.location}</div>
                <input
                  className="cc-input"
                  value={incidentLocation}
                  onChange={(e) => setIncidentLocation(e.target.value)}
                  placeholder={ui.locationPlaceholder}
                />
              </div>

              <div className="cc-field">
                <div className="cc-label">{ui.incidentType}</div>
                <select className="cc-select" value={incidentType} onChange={(e) => setIncidentType(e.target.value)}>
                  {INCIDENT_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {incidentTypeLabel(option, ui)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="cc-field">
              <div className="cc-label">{ui.description}</div>
              <textarea
                className="cc-textarea"
                value={incidentDescription}
                onChange={(e) => setIncidentDescription(e.target.value)}
                placeholder={ui.descriptionPlaceholder}
              />
            </div>

            <div className="cc-field">
              <div className="cc-label">{ui.personsInvolved}</div>
              <textarea
                className="cc-textarea"
                value={incidentPersonsInvolved}
                onChange={(e) => setIncidentPersonsInvolved(e.target.value)}
                placeholder={ui.personsInvolvedPlaceholder}
              />
            </div>

            <div className="cc-field">
              <div className="cc-label">{ui.witnesses}</div>
              <textarea
                className="cc-textarea"
                value={incidentWitnesses}
                onChange={(e) => setIncidentWitnesses(e.target.value)}
                placeholder={ui.witnessesPlaceholder}
              />
            </div>

            <div className="cc-field">
              <div className="cc-label">{ui.uploadPhotos}</div>
              <input className="cc-input" type="file" multiple accept="image/*" onChange={handleIncidentFileChange} />
              {editingEntryId && incidentExistingPhotos.length > 0 ? (
                <div className="cc-small cc-subtle">
                  {incidentExistingPhotos.length} {incidentExistingPhotos.length === 1 ? ui.existingPhoto : ui.existingPhotos}
                </div>
              ) : null}
              {incidentPhotoFiles.length > 0 ? (
                <div className="cc-small cc-subtle">
                  {incidentPhotoFiles.length} {incidentPhotoFiles.length === 1 ? ui.photoSelected : ui.photosSelected}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {journalTitle === "general_report" ? (
          <div className="cc-field">
            <div className="cc-label">{ui.generalReport}</div>
            <textarea
              className="cc-textarea"
              value={generalReportContent}
              onChange={(e) => setGeneralReportContent(e.target.value)}
              placeholder={ui.generalReportPlaceholder}
            />
          </div>
        ) : null}

        {journalTitle === "activity" ? (
          <div className="cc-stack">
            <div className="cc-field">
              <div className="cc-label">{ui.activity}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                {ACTIVITY_OPTIONS.map((activity) => (
                  <button
                    key={activity}
                    type="button"
                    className={`cc-btn ${selectedActivityType === activity ? "cc-btn-primary" : ""}`}
                    onClick={() => {
                      setSelectedActivityType(activity);
                      if (!needsIncidentCheckbox(activity)) setActivityIncidentReported(false);
                    }}
                    style={{ justifyContent: "flex-start", minHeight: 52 }}
                  >
                    {activityLabel(activity, ui)}
                  </button>
                ))}
              </div>
            </div>

            {needsIncidentCheckbox(selectedActivityType) ? (
              <label className="cc-check">
                <input type="checkbox" checked={activityIncidentReported} onChange={(e) => setActivityIncidentReported(e.target.checked)} />
                <span className="cc-label">{ui.incidentReported}</span>
              </label>
            ) : null}

            <div className="cc-field">
              <div className="cc-label">{ui.optionalNote}</div>
              <textarea
                className="cc-textarea"
                value={activityNote}
                onChange={(e) => setActivityNote(e.target.value)}
                placeholder={ui.optionalNotePlaceholder}
              />
            </div>
          </div>
        ) : null}

        <div className="cc-row">
          <button className="cc-btn cc-btn-primary" onClick={createEntry} disabled={!vaultKey || savingEntry}>
            {savingEntry ? ui.saving : entryActionLabel}
          </button>
        </div>
      </div>

      <div className="cc-card cc-card-pad">
        <h2 className="cc-h2">{ui.recentEntries}</h2>
        <div className="cc-spacer-12" />

        {rows.length === 0 ? (
          <div className="cc-small">{viewMode === "shared" ? ui.noSharedEntries : ui.noEntries}</div>
        ) : (
          <div className="cc-stack">
            {rows.map((r) => (
              <JournalCard
                key={r.id}
                row={r}
                patientId={patientId}
                vaultKey={vaultKey}
                currentUserId={currentUserId}
                onEditEntry={beginEditingEntry}
              />
            ))}
          </div>
        )}
      </div>
    </MobileShell>
  );
}

function JournalCard({
  row,
  patientId,
  vaultKey,
  currentUserId,
  onEditEntry,
}: {
  row: JournalRow;
  patientId: string;
  vaultKey: Uint8Array | null;
  currentUserId: string;
  onEditEntry: (seed: JournalEditSeed) => void;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { languageCode } = useUserLanguage();
  const ui = getPageUi("journals", languageCode);
  const [open, setOpen] = useState(false);
  const [ptMood, setPtMood] = useState("");
  const [ptContent, setPtContent] = useState("");
  const [openingPhotoPath, setOpeningPhotoPath] = useState<string | null>(null);
  const [comments, setComments] = useState<JournalCommentRow[]>([]);
  const [commentPlainById, setCommentPlainById] = useState<Record<string, string>>({});
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState("");

  async function decrypt() {
    if (!vaultKey) return;

    const mood = row.mood_encrypted
      ? await decryptStringWithLocalCache({
          patientId,
          table: "journal_entries",
          rowId: row.id,
          column: "mood_encrypted",
          env: row.mood_encrypted,
          vaultKey,
        })
      : "";

    const content = row.content_encrypted
      ? await decryptStringWithLocalCache({
          patientId,
          table: "journal_entries",
          rowId: row.id,
          column: "content_encrypted",
          env: row.content_encrypted,
          vaultKey,
        })
      : "";

    setPtMood(mood);
    setPtContent(content);
  }

  async function toggle() {
    if (!open) {
      setOpen(true);
      if (!ptContent) await decrypt();
      await refreshComments();
    } else {
      setOpen(false);
    }
  }

  async function refreshComments() {
    setLoadingComments(true);
    try {
      const { data, error } = await supabase
        .from("journal_comments")
        .select("id, journal_entry_id, patient_id, created_by, created_at, updated_at, content_encrypted")
        .eq("journal_entry_id", row.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      const next = (data ?? []) as JournalCommentRow[];
      setComments(next);

      if (!vaultKey) return;
      const decryptedEntries = await Promise.all(
        next.map(async (comment) => {
          const plain = await decryptStringWithLocalCache({
            patientId,
            table: "journal_comments",
            rowId: comment.id,
            column: "content_encrypted",
            env: comment.content_encrypted,
            vaultKey,
          });
          return [comment.id, plain] as const;
        })
      );

      setCommentPlainById(Object.fromEntries(decryptedEntries));
    } catch {
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  }

  async function saveComment() {
    if (!vaultKey) return;
    const draft = editingCommentId ? editingCommentDraft : commentDraft;
    if (!draft.trim()) return;

    setSavingComment(true);
    try {
      const contentEnv = await vaultEncryptString({
        vaultKey,
        plaintext: draft.trim(),
        aad: { table: "journal_comments", column: "content_encrypted", patient_id: patientId },
      });

      if (editingCommentId) {
        const { error } = await supabase
          .from("journal_comments")
          .update({
            content_encrypted: contentEnv,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingCommentId)
          .eq("created_by", currentUserId);
        if (error) throw error;
        setEditingCommentId(null);
        setEditingCommentDraft("");
      } else {
        const { error } = await supabase.from("journal_comments").insert({
          journal_entry_id: row.id,
          patient_id: patientId,
          created_by: currentUserId,
          content_encrypted: contentEnv,
        });
        if (error) throw error;
        setCommentDraft("");
      }

      await refreshComments();
    } finally {
      setSavingComment(false);
    }
  }

  function startEditingComment(commentId: string) {
    setEditingCommentId(commentId);
    setEditingCommentDraft(commentPlainById[commentId] ?? "");
  }

  function handleEditEntry() {
    onEditEntry({
      row,
      parsedPayload: ptContent ? parseStructuredPayload(ptContent) : null,
      plainContent: ptContent,
    });
  }

  async function openIncidentPhoto(photo: IncidentPhoto) {
    setOpeningPhotoPath(photo.path);

    try {
      const { data, error } = await supabase.storage.from(INCIDENT_PHOTO_BUCKET).createSignedUrl(photo.path, 60);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error("failed_to_open_incident_photo");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } finally {
      setOpeningPhotoPath(null);
    }
  }

  const parsedPayload = ptContent ? parseStructuredPayload(ptContent) : null;
  const typeLabel = makeJournalTypeLabelForUi(row.journal_type, ui);
  const cardTitle = parsedPayload
    ? journalTypeOptionLabel(parsedPayload.kind, ui)
    : typeLabel;
  const canEditEntry = row.created_by === currentUserId && row.journal_type !== "tracker";

  return (
    <div className="cc-panel-soft">
      <div className="cc-row-between">
        <div className="cc-wrap">
          <div className="cc-strong">
            {cardTitle}
            <span className="cc-small">
              {" "}
              - {new Date(row.created_at).toLocaleString()} - {row.shared_to_circle ? ui.shared : ui.private}
              {row.pain_level != null ? ` - ${ui.painTag}:${row.pain_level}` : ""}
              {row.created_by === currentUserId ? ` - ${ui.you}` : ""}
            </span>
          </div>
        </div>

        <div className="cc-row">
          {canEditEntry && open ? (
            <button className="cc-btn" onClick={handleEditEntry}>
              {ui.editEntry}
            </button>
          ) : null}
          <button className="cc-btn" onClick={toggle}>
            {open ? ui.hide : ui.open}
          </button>
        </div>
      </div>

      {open ? (
        <div className="cc-spacer-12">
          {ptMood ? (
            <>
              <div className="cc-small">
                <b>{ui.mood}:</b> {moodLabel(ptMood, ui)}
              </div>
              <div className="cc-spacer-12" />
            </>
          ) : null}

          {parsedPayload?.kind === "incident_report" ? (
            <div className="cc-stack" style={{ gap: 10 }}>
              <div className="cc-small"><b>{ui.date}:</b> {parsedPayload.date} {parsedPayload.time}</div>
              <div className="cc-small"><b>{ui.location}:</b> {parsedPayload.location}</div>
              <div className="cc-small"><b>{ui.incidentType}:</b> {incidentTypeLabel(parsedPayload.incidentType, ui)}</div>
              <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                <b>{ui.description}:</b>
                {"\n"}
                {parsedPayload.description}
              </div>
              <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                <b>{ui.personsInvolvedShort}:</b>
                {"\n"}
                {parsedPayload.personsInvolved}
              </div>
              <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                <b>{ui.witnesses}:</b>
                {"\n"}
                {parsedPayload.witnesses || "-"}
              </div>
              {parsedPayload.photoUploads.length > 0 ? (
                <div className="cc-stack" style={{ gap: 8 }}>
                  <div className="cc-small"><b>{ui.photos}:</b></div>
                  <div className="cc-row">
                    {parsedPayload.photoUploads.map((photo) => (
                      <button
                        key={photo.path}
                        className="cc-btn"
                        onClick={() => openIncidentPhoto(photo)}
                        disabled={openingPhotoPath === photo.path}
                      >
                        {openingPhotoPath === photo.path ? ui.opening : photo.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : parsedPayload?.kind === "general_report" ? (
            <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{parsedPayload.content || "-"}</div>
          ) : parsedPayload?.kind === "activity" ? (
            <div className="cc-stack" style={{ gap: 8 }}>
              <div className="cc-small"><b>{ui.activity}:</b> {activityLabel(parsedPayload.activityType, ui)}</div>
              {needsIncidentCheckbox(parsedPayload.activityType) ? (
                <div className="cc-small"><b>{ui.incidentReported}:</b> {parsedPayload.incidentReported ? ui.yes : ui.no}</div>
              ) : null}
              <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                {parsedPayload.note || ui.noAdditionalNote}
              </div>
            </div>
          ) : (
            <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{ptContent || "-"}</div>
          )}

          <div className="cc-spacer-12" />
          <div className="cc-stack" style={{ gap: 10 }}>
            <div className="cc-strong">{ui.comments}</div>
            {loadingComments ? <div className="cc-small cc-subtle">{ui.loadingComments}</div> : null}
            {!loadingComments && comments.length === 0 ? (
              <div className="cc-small cc-subtle">{ui.noComments}</div>
            ) : null}
            {comments.map((comment) => {
              const isAuthor = comment.created_by === currentUserId;
              const isEditing = editingCommentId === comment.id;
              const isEdited =
                !!comment.updated_at &&
                !!comment.created_at &&
                new Date(comment.updated_at).getTime() > new Date(comment.created_at).getTime() + 1000;

              return (
                <div key={comment.id} className="cc-panel" style={{ padding: 12 }}>
                  <div className="cc-row-between">
                    <div className="cc-small cc-subtle">
                      {isAuthor ? ui.you : comment.created_by}
                      {" · "}
                      {new Date(comment.created_at).toLocaleString()}
                      {isEdited ? ` · ${ui.edited}` : ""}
                    </div>
                    {isAuthor && !isEditing ? (
                      <button className="cc-btn" onClick={() => startEditingComment(comment.id)}>
                        {ui.editComment}
                      </button>
                    ) : null}
                  </div>

                  {isEditing ? (
                    <div className="cc-stack" style={{ gap: 8, marginTop: 8 }}>
                      <textarea
                        className="cc-textarea"
                        value={editingCommentDraft}
                        onChange={(e) => setEditingCommentDraft(e.target.value)}
                        placeholder={ui.commentPlaceholder}
                      />
                      <div className="cc-row">
                        <button className="cc-btn cc-btn-primary" onClick={saveComment} disabled={savingComment}>
                          {savingComment ? ui.savingComment : ui.updateComment}
                        </button>
                        <button
                          className="cc-btn"
                          onClick={() => {
                            setEditingCommentId(null);
                            setEditingCommentDraft("");
                          }}
                        >
                          {ui.cancelEdit}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 8 }}>
                      {commentPlainById[comment.id] || "-"}
                    </div>
                  )}
                </div>
              );
            })}

            {!editingCommentId ? (
              <div className="cc-stack" style={{ gap: 8 }}>
                <textarea
                  className="cc-textarea"
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  placeholder={ui.commentPlaceholder}
                />
                <div className="cc-row">
                  <button className="cc-btn cc-btn-primary" onClick={saveComment} disabled={savingComment || !vaultKey}>
                    {savingComment ? ui.savingComment : ui.addComment}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}



