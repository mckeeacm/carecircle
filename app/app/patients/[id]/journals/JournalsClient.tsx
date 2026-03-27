"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";
import MobileShell from "@/app/components/MobileShell";

type JournalRow = {
  id: string;
  patient_id: string;
  journal_type: string;
  occurred_at: string | null;
  created_by: string;
  created_at: string;
  shared_to_circle: boolean;
  pain_level: number | null;
  include_in_clinician_summary: boolean | null;
  content_encrypted: CipherEnvelopeV1 | null;
  mood_encrypted: CipherEnvelopeV1 | null;
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

function makeJournalTypeLabel(journalType: string) {
  if (journalType === "tracker") return "Tracker log";
  if (journalType === "incident_report") return "Incident Report";
  if (journalType === "general_report") return "General Report";
  if (journalType === "activity") return "Activity";
  if (journalType === "journal") return "Journal";
  return journalType;
}

function needsIncidentCheckbox(activityType: string) {
  return activityType === "Falls" || activityType === "Behaviour";
}

export default function JournalsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

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

  const [selectedActivityType, setSelectedActivityType] = useState("");
  const [activityNote, setActivityNote] = useState("");
  const [activityIncidentReported, setActivityIncidentReported] = useState(false);

  const [trackerMood, setTrackerMood] = useState("");
  const [trackerPain, setTrackerPain] = useState<number | null>(null);
  const [trackerSobriety, setTrackerSobriety] = useState<"yes" | "no" | "">("");
  const [trackerShare, setTrackerShare] = useState(true);

  const [savingEntry, setSavingEntry] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

      let query = supabase
        .from("journal_entries")
        .select(
          "id, patient_id, journal_type, occurred_at, created_by, created_at, shared_to_circle, pain_level, include_in_clinician_summary, content_encrypted, mood_encrypted"
        )
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (viewMode === "shared") query = query.eq("shared_to_circle", true);

      const { data, error } = await query;
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
  }

  function resetActivityForm() {
    setSelectedActivityType("");
    setActivityNote("");
    setActivityIncidentReported(false);
  }

  function resetEntryForm() {
    setGeneralReportContent("");
    setSharedToCircle(true);
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

  async function createEntry() {
    setMsg(null);
    setSavingEntry(true);

    try {
      if (journalTitle === "general_report") {
        if (!generalReportContent.trim()) throw new Error("general_report_required");

        await createStructuredEntry(
          {
            kind: "general_report",
            title: "General Report",
            content: generalReportContent.trim(),
          },
          "general_report"
        );
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

        const photoUploads = await uploadIncidentPhotos(uid);

        await createStructuredEntry(
          {
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
          },
          "incident_report"
        );
      } else {
        if (!selectedActivityType) throw new Error("activity_type_required");

        await createStructuredEntry(
          {
            kind: "activity",
            title: "Activities",
            activityType: selectedActivityType,
            note: activityNote.trim(),
            incidentReported: needsIncidentCheckbox(selectedActivityType) ? activityIncidentReported : false,
          },
          "activity"
        );
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
    journalTitle === "incident_report"
      ? "Save incident report"
      : journalTitle === "general_report"
      ? "Save general report"
      : "Save activity";

  return (
    <MobileShell
      title="Journal"
      subtitle={myRole ? `Role: ${myRole}` : patientId}
      patientId={patientId}
      rightSlot={
        <Link className="cc-btn" href={`/app/patients/${patientId}/today`}>
          Today
        </Link>
      }
    >
      {msg ? (
        <div className="cc-status cc-status-error">
          <div className="cc-status-error-title">Error</div>
          <div className="cc-wrap">{msg}</div>
        </div>
      ) : null}

      {!vaultKey ? (
        <div className="cc-status cc-status-loading">
          <div className="cc-strong">Vault key not available on this device</div>
          <div className="cc-subtle">You canÂ't decrypt or save encrypted content.</div>
        </div>
      ) : null}

      <div className="cc-row">
        <button
          className={`cc-tab ${viewMode === "all" ? "cc-tab-active" : ""}`}
          onClick={() => setViewMode("all")}
        >
          All entries
        </button>
        <button
          className={`cc-tab ${viewMode === "shared" ? "cc-tab-active" : ""}`}
          onClick={() => setViewMode("shared")}
        >
          Circle feed
        </button>
        <button className="cc-btn" onClick={refresh} disabled={loading}>
          {loading ? "LoadingÂ" : "Refresh"}
        </button>
      </div>

      {isPatientRole ? (
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">TodayÂ's trackers</h2>
              <div className="cc-subtle">Mood, pain and sobriety are saved together as one tracker log.</div>
            </div>
          </div>

          <div className="cc-grid-3">
            <div className="cc-panel-soft cc-stack">
              <div className="cc-strong">Mood</div>
              <div className="cc-row">
                {["Sad", "Low", "Okay", "Good", "Great"].map((mood) => (
                  <button
                    key={mood}
                    className={`cc-btn ${trackerMood === mood ? "cc-btn-primary" : ""}`}
                    onClick={() => setTrackerMood(mood)}
                  >
                    {mood}
                  </button>
                ))}
              </div>
            </div>

            <div className="cc-panel-soft cc-stack">
              <div className="cc-strong">Pain</div>
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
              <div className="cc-strong">Sobriety</div>
              <div className="cc-row">
                <button
                  className={`cc-btn ${trackerSobriety === "yes" ? "cc-btn-primary" : ""}`}
                  onClick={() => setTrackerSobriety("yes")}
                >
                  Yes
                </button>
                <button
                  className={`cc-btn ${trackerSobriety === "no" ? "cc-btn-danger" : ""}`}
                  onClick={() => setTrackerSobriety("no")}
                >
                  No
                </button>
              </div>
            </div>
          </div>

          <label className="cc-check">
            <input type="checkbox" checked={trackerShare} onChange={(e) => setTrackerShare(e.target.checked)} />
            <span className="cc-label">Share tracker log to circle journal</span>
          </label>

          <div className="cc-row">
            <button className="cc-btn cc-btn-primary" onClick={saveTrackers} disabled={!vaultKey}>
              Save trackers
            </button>
          </div>
        </div>
      ) : null}

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">New entry</h2>
            <div className="cc-subtle">Choose a journal title and complete the matching form.</div>
          </div>
        </div>

        <div className="cc-grid-2">
          <div className="cc-field">
            <div className="cc-label">Journal title</div>
            <select
              className="cc-select"
              value={journalTitle}
              onChange={(e) => setJournalTitle(e.target.value as JournalEntryKind)}
            >
              {JOURNAL_TITLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {isPatientRole ? (
            <label className="cc-check" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={sharedToCircle} onChange={(e) => setSharedToCircle(e.target.checked)} />
              <span className="cc-label">Share to circle</span>
            </label>
          ) : (
            <div className="cc-small cc-subtle" style={{ alignSelf: "end" }}>
              Entries from non-patient members are always shared to the circle.
            </div>
          )}
        </div>

        {journalTitle === "incident_report" ? (
          <div className="cc-stack">
            <div className="cc-grid-2">
              <div className="cc-field">
                <div className="cc-label">Date</div>
                <input className="cc-input" type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} />
              </div>

              <div className="cc-field">
                <div className="cc-label">Time</div>
                <input className="cc-input" type="time" value={incidentTime} onChange={(e) => setIncidentTime(e.target.value)} />
              </div>
            </div>

            <div className="cc-grid-2">
              <div className="cc-field">
                <div className="cc-label">Location</div>
                <input
                  className="cc-input"
                  value={incidentLocation}
                  onChange={(e) => setIncidentLocation(e.target.value)}
                  placeholder="e.g. Bedroom, dining room, garden"
                />
              </div>

              <div className="cc-field">
                <div className="cc-label">Type of incident</div>
                <select className="cc-select" value={incidentType} onChange={(e) => setIncidentType(e.target.value)}>
                  {INCIDENT_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="cc-field">
              <div className="cc-label">Description</div>
              <textarea
                className="cc-textarea"
                value={incidentDescription}
                onChange={(e) => setIncidentDescription(e.target.value)}
                placeholder="Short summary of what happened."
              />
            </div>

            <div className="cc-field">
              <div className="cc-label">Full details of the persons involved</div>
              <textarea
                className="cc-textarea"
                value={incidentPersonsInvolved}
                onChange={(e) => setIncidentPersonsInvolved(e.target.value)}
                placeholder="Names, roles, injuries, actions taken."
              />
            </div>

            <div className="cc-field">
              <div className="cc-label">Witnesses</div>
              <textarea
                className="cc-textarea"
                value={incidentWitnesses}
                onChange={(e) => setIncidentWitnesses(e.target.value)}
                placeholder="Witnesses, statements, or note none."
              />
            </div>

            <div className="cc-field">
              <div className="cc-label">Upload photos</div>
              <input className="cc-input" type="file" multiple accept="image/*" onChange={handleIncidentFileChange} />
              {incidentPhotoFiles.length > 0 ? (
                <div className="cc-small cc-subtle">
                  {incidentPhotoFiles.length} photo{incidentPhotoFiles.length === 1 ? "" : "s"} selected.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {journalTitle === "general_report" ? (
          <div className="cc-field">
            <div className="cc-label">General report</div>
            <textarea
              className="cc-textarea"
              value={generalReportContent}
              onChange={(e) => setGeneralReportContent(e.target.value)}
              placeholder="Write the full report here."
            />
          </div>
        ) : null}

        {journalTitle === "activity" ? (
          <div className="cc-stack">
            <div className="cc-field">
              <div className="cc-label">Activity</div>
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
                    {activity}
                  </button>
                ))}
              </div>
            </div>

            {needsIncidentCheckbox(selectedActivityType) ? (
              <label className="cc-check">
                <input type="checkbox" checked={activityIncidentReported} onChange={(e) => setActivityIncidentReported(e.target.checked)} />
                <span className="cc-label">Incident reported?</span>
              </label>
            ) : null}

            <div className="cc-field">
              <div className="cc-label">Optional note</div>
              <textarea
                className="cc-textarea"
                value={activityNote}
                onChange={(e) => setActivityNote(e.target.value)}
                placeholder="Add a short note if needed."
              />
            </div>
          </div>
        ) : null}

        <div className="cc-row">
          <button className="cc-btn cc-btn-primary" onClick={createEntry} disabled={!vaultKey || savingEntry}>
            {savingEntry ? "SavingÂ" : entryActionLabel}
          </button>
        </div>
      </div>

      <div className="cc-card cc-card-pad">
        <h2 className="cc-h2">Recent entries</h2>
        <div className="cc-spacer-12" />

        {rows.length === 0 ? (
          <div className="cc-small">{viewMode === "shared" ? "No shared entries yet." : "No entries yet."}</div>
        ) : (
          <div className="cc-stack">
            {rows.map((r) => (
              <JournalCard key={r.id} row={r} patientId={patientId} vaultKey={vaultKey} currentUserId={currentUserId} />
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
}: {
  row: JournalRow;
  patientId: string;
  vaultKey: Uint8Array | null;
  currentUserId: string;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [open, setOpen] = useState(false);
  const [ptMood, setPtMood] = useState("");
  const [ptContent, setPtContent] = useState("");
  const [openingPhotoPath, setOpeningPhotoPath] = useState<string | null>(null);

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
    } else {
      setOpen(false);
    }
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
  const typeLabel = makeJournalTypeLabel(row.journal_type);

  return (
    <div className="cc-panel-soft">
      <div className="cc-row-between">
        <div className="cc-wrap">
          <div className="cc-strong">
            {parsedPayload?.title ?? typeLabel}
            <span className="cc-small">
              {" "}
              Â {new Date(row.created_at).toLocaleString()} Â {row.shared_to_circle ? "shared" : "private"}
              {row.pain_level != null ? ` Â pain:${row.pain_level}` : ""}
              {row.created_by === currentUserId ? " Â you" : ""}
            </span>
          </div>
        </div>

        <button className="cc-btn" onClick={toggle}>
          {open ? "Hide" : "Decrypt"}
        </button>
      </div>

      {open ? (
        <div className="cc-spacer-12">
          {ptMood ? (
            <>
              <div className="cc-small">
                <b>Mood:</b> {ptMood}
              </div>
              <div className="cc-spacer-12" />
            </>
          ) : null}

          {parsedPayload?.kind === "incident_report" ? (
            <div className="cc-stack" style={{ gap: 10 }}>
              <div className="cc-small"><b>Date:</b> {parsedPayload.date} {parsedPayload.time}</div>
              <div className="cc-small"><b>Location:</b> {parsedPayload.location}</div>
              <div className="cc-small"><b>Type of incident:</b> {parsedPayload.incidentType}</div>
              <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                <b>Description:</b>
                {"\n"}
                {parsedPayload.description}
              </div>
              <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                <b>Persons involved:</b>
                {"\n"}
                {parsedPayload.personsInvolved}
              </div>
              <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                <b>Witnesses:</b>
                {"\n"}
                {parsedPayload.witnesses || "Â-"}
              </div>
              {parsedPayload.photoUploads.length > 0 ? (
                <div className="cc-stack" style={{ gap: 8 }}>
                  <div className="cc-small"><b>Photos:</b></div>
                  <div className="cc-row">
                    {parsedPayload.photoUploads.map((photo) => (
                      <button
                        key={photo.path}
                        className="cc-btn"
                        onClick={() => openIncidentPhoto(photo)}
                        disabled={openingPhotoPath === photo.path}
                      >
                        {openingPhotoPath === photo.path ? "OpeningÂ" : photo.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : parsedPayload?.kind === "general_report" ? (
            <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{parsedPayload.content || "Â-"}</div>
          ) : parsedPayload?.kind === "activity" ? (
            <div className="cc-stack" style={{ gap: 8 }}>
              <div className="cc-small"><b>Activity:</b> {parsedPayload.activityType}</div>
              {needsIncidentCheckbox(parsedPayload.activityType) ? (
                <div className="cc-small"><b>Incident reported:</b> {parsedPayload.incidentReported ? "Yes" : "No"}</div>
              ) : null}
              <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                {parsedPayload.note || "No additional note."}
              </div>
            </div>
          ) : (
            <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{ptContent || "Â-"}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
