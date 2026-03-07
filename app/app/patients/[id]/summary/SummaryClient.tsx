"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import MobileShell from "@/app/components/MobileShell";

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

function SummaryBlock({
  title,
  value,
  emergency = false,
}: {
  title: string;
  value: string;
  emergency?: boolean;
}) {
  return (
    <div
      className="cc-panel-soft"
      style={{
        padding: 16,
        borderRadius: 20,
        border: emergency ? "1px solid rgba(214, 76, 76, 0.18)" : undefined,
        background: emergency
          ? "linear-gradient(180deg, rgba(255,244,244,0.78), rgba(255,255,255,0.42))"
          : undefined,
      }}
    >
      <div
        className="cc-small cc-strong"
        style={{
          marginBottom: 8,
          letterSpacing: "0.01em",
        }}
      >
        {title}
      </div>
      <div
        className="cc-wrap"
        style={{
          whiteSpace: "pre-wrap",
          lineHeight: 1.5,
          fontSize: emergency ? 15 : 14,
        }}
      >
        {value || "—"}
      </div>
    </div>
  );
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
    <MobileShell
      title="Clinician summary"
      subtitle={patient?.display_name ?? patientId}
      patientId={patientId}
      hideBottomNav
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

      <div
        className="cc-card cc-card-pad"
        style={{
          padding: 18,
        }}
      >
        <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 className="cc-h2" style={{ marginBottom: 6 }}>
              Emergency overview
            </h2>
            <div className="cc-subtle">
              Readable without vault unlock. Prioritised for quick scanning in urgent situations.
            </div>
          </div>

          <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Link className="cc-btn" href={`/app/patients/${patientId}/profile`}>
              Profile
            </Link>
            <Link className="cc-btn" href="/app/hub">
              Hub
            </Link>
            <button className="cc-btn" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="cc-spacer-12" />

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span className="cc-pill cc-pill-primary">{patient?.display_name ?? "Patient"}</span>
          <span className="cc-pill">Summary view</span>
          <span className="cc-pill">
            Updated: {profileUpdatedAt ? new Date(profileUpdatedAt).toLocaleString() : "—"}
          </span>
        </div>
      </div>

      <div className="cc-grid-2-125">
        <div className="cc-card cc-card-pad cc-stack">
          <h2 className="cc-h2">Immediate clinical priorities</h2>
          <div className="cc-subtle">Most important items first.</div>

          <SummaryBlock title="Safety notes" value={safetyNotes} emergency />
          <SummaryBlock title="Allergies" value={allergies} emergency />
          <SummaryBlock title="Diagnoses" value={diagnoses} emergency />
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <h2 className="cc-h2">Communication essentials</h2>
          <div className="cc-subtle">Helpful for direct interaction and handover.</div>

          <SummaryBlock title="Communication notes" value={commNotes} />
          <SummaryBlock title="Languages spoken" value={languagesSpoken} />
        </div>
      </div>

      <div className="cc-grid-2-125">
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <h2 className="cc-h2">Upcoming appointments</h2>
            <Link className="cc-btn" href={`/app/patients/${patientId}/appointments`}>
              Open
            </Link>
          </div>

          <div className="cc-spacer-12" />

          {appointments.length === 0 ? (
            <div className="cc-small">No upcoming appointments.</div>
          ) : (
            <div className="cc-stack">
              {appointments.map((a) => (
                <div
                  key={a.id}
                  className="cc-panel-soft"
                  style={{
                    padding: 14,
                    borderRadius: 18,
                  }}
                >
                  <div className="cc-strong">{a.title ?? "Appointment"}</div>
                  <div className="cc-small" style={{ marginTop: 4 }}>
                    {(a.starts_at ? new Date(a.starts_at).toLocaleString() : "—") +
                      (a.location ? ` • ${a.location}` : "")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <h2 className="cc-h2">Active medications</h2>
            <Link className="cc-btn" href={`/app/patients/${patientId}/medication-logs`}>
              Open
            </Link>
          </div>

          <div className="cc-spacer-12" />

          {meds.length === 0 ? (
            <div className="cc-small">No active medications.</div>
          ) : (
            <div className="cc-stack">
              {meds.map((m) => (
                <div
                  key={m.id}
                  className="cc-panel-soft"
                  style={{
                    padding: 14,
                    borderRadius: 18,
                  }}
                >
                  <div className="cc-strong">
                    {m.name} {m.dosage ? <span className="cc-subtle">({m.dosage})</span> : null}
                  </div>
                  <div className="cc-small" style={{ marginTop: 4 }}>
                    {m.schedule_text || "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="cc-card cc-card-pad">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">Recent shared journal entries</h2>
            <div className="cc-subtle">Latest shared context from the circle.</div>
          </div>

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
              <div
                key={j.id}
                className="cc-panel-soft"
                style={{
                  padding: 14,
                  borderRadius: 18,
                }}
              >
                <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <div className="cc-strong">{j.journal_type}</div>
                    <div className="cc-small" style={{ marginTop: 4 }}>
                      {new Date(j.created_at).toLocaleString()}
                    </div>
                  </div>

                  <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {j.pain_level != null ? <span className="cc-pill">Pain: {j.pain_level}</span> : null}
                    <span className="cc-pill cc-pill-primary">Shared</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="cc-spacer-12" />
        <div className="cc-small cc-subtle">
          This summary is designed for fast reading by permitted members without vault unlock.
        </div>
      </div>
    </MobileShell>
  );
}