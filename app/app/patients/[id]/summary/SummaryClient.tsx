"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";

type PatientRow = { id: string; display_name: string };

type PatientProfileSummaryRow = {
  patient_id: string;
  updated_at: string;
  communication_notes_summary: string | null;
  allergies_summary: string | null;
  safety_notes_summary: string | null;
  diagnoses_summary: string | null;
  languages_spoken_summary: string | null;
};

type MedicationRow = {
  id: string;
  name: string;
  dosage: string | null;
  schedule_text: string | null;
};

type AppointmentRow = {
  id: string;
  starts_at: string | null;
  title: string | null;
  location: string | null;
};

type JournalPreview = {
  id: string;
  created_at: string;
  journal_type: string;
  pain_level: number | null;
  shared_to_circle: boolean;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function SummaryClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [msg, setMsg] = useState<string | null>(null);
  const [patient, setPatient] = useState<PatientRow | null>(null);

  const [commNotes, setCommNotes] = useState<string>("");
  const [allergies, setAllergies] = useState<string>("");
  const [safetyNotes, setSafetyNotes] = useState<string>("");
  const [diagnoses, setDiagnoses] = useState<string>("");
  const [languagesSpoken, setLanguagesSpoken] = useState<string>("");
  const [profileUpdatedAt, setProfileUpdatedAt] = useState<string | null>(null);

  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [meds, setMeds] = useState<MedicationRow[]>([]);
  const [sharedJournals, setSharedJournals] = useState<JournalPreview[]>([]);

  const [loading, setLoading] = useState(false);

  async function load() {
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
          "patient_id, updated_at, communication_notes_summary, allergies_summary, safety_notes_summary, diagnoses_summary, languages_spoken_summary"
        )
        .eq("patient_id", patientId)
        .maybeSingle();
      if (prErr) throw prErr;

      const row = (pr ?? null) as PatientProfileSummaryRow | null;

      setProfileUpdatedAt(row?.updated_at ?? null);
      setCommNotes(row?.communication_notes_summary ?? "");
      setAllergies(row?.allergies_summary ?? "");
      setSafetyNotes(row?.safety_notes_summary ?? "");
      setDiagnoses(row?.diagnoses_summary ?? "");
      setLanguagesSpoken(row?.languages_spoken_summary ?? "");

      try {
        const { data: a, error: aErr } = await supabase
          .from("appointments")
          .select("id, starts_at, title, location")
          .eq("patient_id", patientId)
          .gte("starts_at", new Date().toISOString())
          .order("starts_at", { ascending: true })
          .limit(5);
        if (aErr) throw aErr;
        setAppointments((a ?? []) as AppointmentRow[]);
      } catch {
        setAppointments([]);
      }

      const { data: m, error: mErr } = await supabase
        .from("medications")
        .select("id, name, dosage, schedule_text")
        .eq("patient_id", patientId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(8);

      if (mErr) throw mErr;
      setMeds((m ?? []) as MedicationRow[]);

      const { data: j, error: jErr } = await supabase
        .from("journal_entries")
        .select("id, created_at, journal_type, pain_level, shared_to_circle")
        .eq("patient_id", patientId)
        .eq("shared_to_circle", true)
        .order("created_at", { ascending: false })
        .limit(5);

      if (jErr) throw jErr;
      setSharedJournals((j ?? []) as JournalPreview[]);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_summary");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Clinician summary</h1>
            <div className="cc-subtle">{patient?.display_name ?? patientId}</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href={`/app/patients/${patientId}/today`}>
              Today
            </Link>
            <Link className="cc-btn" href={`/app/patients/${patientId}/profile`}>
              Profile
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

        <div className="cc-grid-3">
          <div className="cc-card cc-card-pad">
            <h2 className="cc-h2">Safety & communication</h2>
            <div className="cc-spacer-12" />

            <div className="cc-small cc-strong">Communication notes</div>
            <div className="cc-panel-soft cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {commNotes || "—"}
            </div>

            <div className="cc-spacer-12" />

            <div className="cc-small cc-strong">Languages spoken</div>
            <div className="cc-panel-soft cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {languagesSpoken || "—"}
            </div>

            <div className="cc-spacer-12" />

            <div className="cc-small cc-strong">Safety notes</div>
            <div className="cc-panel-soft cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {safetyNotes || "—"}
            </div>

            <div className="cc-spacer-12" />
            <div className="cc-small">
              Last updated: {profileUpdatedAt ? new Date(profileUpdatedAt).toLocaleString() : "—"}
            </div>
          </div>

          <div className="cc-card cc-card-pad">
            <h2 className="cc-h2">Clinical notes</h2>
            <div className="cc-spacer-12" />

            <div className="cc-small cc-strong">Diagnoses</div>
            <div className="cc-panel-soft cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {diagnoses || "—"}
            </div>

            <div className="cc-spacer-12" />

            <div className="cc-small cc-strong">Allergies</div>
            <div className="cc-panel-soft cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {allergies || "—"}
            </div>
          </div>

          <div className="cc-card cc-card-pad">
            <h2 className="cc-h2">Upcoming appointments</h2>
            <div className="cc-spacer-12" />
            {appointments.length === 0 ? (
              <div className="cc-small">No upcoming appointments.</div>
            ) : (
              <div className="cc-stack">
                {appointments.map((a) => (
                  <div key={a.id} className="cc-panel-soft">
                    <div className="cc-strong">{a.title ?? "Appointment"}</div>
                    <div className="cc-small">
                      {(a.starts_at ? new Date(a.starts_at).toLocaleString() : "—") + (a.location ? ` • ${a.location}` : "")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="cc-grid-2-125">
          <div className="cc-card cc-card-pad">
            <h2 className="cc-h2">Active medications</h2>
            <div className="cc-spacer-12" />
            {meds.length === 0 ? (
              <div className="cc-small">No active medications.</div>
            ) : (
              <div className="cc-stack">
                {meds.map((m) => (
                  <div key={m.id} className="cc-panel-soft">
                    <div className="cc-strong">
                      {m.name} {m.dosage ? <span className="cc-subtle">({m.dosage})</span> : null}
                    </div>
                    <div className="cc-small">{m.schedule_text || "—"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cc-card cc-card-pad">
            <div className="cc-row-between">
              <h2 className="cc-h2">Recent shared journal entries</h2>
              <Link className="cc-btn" href={`/app/patients/${patientId}/journals`}>
                Open journals
              </Link>
            </div>

            <div className="cc-spacer-12" />

            {sharedJournals.length === 0 ? (
              <div className="cc-small">No shared journal entries.</div>
            ) : (
              <div className="cc-stack">
                {sharedJournals.map((j) => (
                  <div key={j.id} className="cc-panel-soft">
                    <div className="cc-row-between">
                      <div>
                        <div className="cc-strong">{j.journal_type}</div>
                        <div className="cc-small">{new Date(j.created_at).toLocaleString()}</div>
                      </div>
                      <div className="cc-row">
                        {j.pain_level != null ? <span className="cc-pill">pain: {j.pain_level}</span> : null}
                        <span className="cc-pill cc-pill-primary">shared</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="cc-spacer-12" />
            <div className="cc-small cc-subtle">
              This summary is readable to permitted members without vault unlock.
            </div>
          </div>
        </div>

        <div className="cc-row">
          <button className="cc-btn" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>
    </div>
  );
}