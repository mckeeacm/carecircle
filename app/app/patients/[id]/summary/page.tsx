"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabase";

// Optional E2EE helpers (safe fallback if not configured)
import { derivePatientKey, decryptText } from "@/lib/crypto";

/* ================= TYPES ================= */

type ProfileRowAny = Record<string, any>;
type DiagnosisRowAny = Record<string, any>;
type MedicationRowAny = Record<string, any>;
type NoteRowAny = Record<string, any>;
type MedLogRowAny = Record<string, any>;
type AuditRowAny = Record<string, any>;

type Profile = {
  speaks: boolean | null;
  communication_methods: string | null;
  languages_understood: string | null;
  preferred_language: string | null;
  allergies: string | null;
  panic_triggers: string | null;
  calming_strategies: string | null;
  important_notes: string | null;

  has_health_poa: boolean | null;
  has_respect_letter: boolean | null;
  health_poa_held_by: string | null;
  respect_letter_held_by: string | null;

  guardian_setup?: boolean;
  updated_at: string | null;
};

type Diagnosis = {
  id: string;
  diagnosis: string;
  diagnosed_on: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
};

type Medication = {
  id: string;
  name: string;
  dosage: string | null;
  active: boolean;
  schedule_morning: boolean;
  schedule_midday: boolean;
  schedule_evening: boolean;
  schedule_bedtime: boolean;
  schedule_prn: boolean;
  created_at: string;
};

type SummaryNote = {
  id: string;
  journal_type: "patient" | "carer";
  created_at: string;
  mood: "very_sad" | "sad" | "neutral" | "happy" | "very_happy" | null;
  pain_level: number | null;
  content: string | null;
};

type Slot = "morning" | "midday" | "evening" | "bedtime" | "prn";

type MedLog = {
  medication_id: string;
  slot: Slot | null;
  status: "taken" | "missed";
  created_at: string;
};

type AuditEvent = {
  id: string;
  created_at: string;
  action: string | null;
  resource: string | null;
  user_id: string | null;
};

/* ================= CONSTANTS ================= */

const moodEmoji: Record<string, string> = {
  very_sad: "😢",
  sad: "🙁",
  neutral: "😐",
  happy: "🙂",
  very_happy: "😄",
};

const slotLabel: Record<Slot, string> = {
  morning: "Morning",
  midday: "Midday",
  evening: "Evening",
  bedtime: "Bedtime",
  prn: "As needed",
};

const SLOTS: Slot[] = ["morning", "midday", "evening", "bedtime", "prn"];

/* ================= HELPERS ================= */

function yesNo(v: boolean | null | undefined) {
  if (v === null || v === undefined) return "Not specified";
  return v ? "Yes" : "No";
}

function safeStr(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function fmt(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function scheduledSlots(m: Medication): Slot[] {
  const slots: Slot[] = [];
  if (m.schedule_morning) slots.push("morning");
  if (m.schedule_midday) slots.push("midday");
  if (m.schedule_evening) slots.push("evening");
  if (m.schedule_bedtime) slots.push("bedtime");
  if (m.schedule_prn) slots.push("prn");
  return slots;
}

/* ================= PAGE ================= */

export default function ClinicianSummaryPage() {
  const params = useParams();
  const patientId = String(params?.id ?? "");

  const [patientName, setPatientName] = useState("…");
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [notes, setNotes] = useState<SummaryNote[]>([]);

  // adherence + audit
  const [logs, setLogs] = useState<MedLog[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[] | null>(null); // null = not loaded/available

  // optional E2EE
  const [patientKey, setPatientKey] = useState<CryptoKey | null>(null);
  const ENC_SALT = process.env.NEXT_PUBLIC_ENC_SALT || "";

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        if (!patientId || patientId === "undefined") {
          setError("Missing patient id.");
          return;
        }

        // Patient name
        const p = await supabase.from("patients").select("display_name").eq("id", patientId).single();
        if (p.error) {
          setError(p.error.message);
          return;
        }
        setPatientName(p.data.display_name);

        // Try to derive patient key (optional)
        let key: CryptoKey | null = null;
        if (ENC_SALT) {
          try {
            key = await derivePatientKey(patientId, ENC_SALT);
          } catch {
            key = null;
          }
        }
        setPatientKey(key);

        const decryptMaybe = async (encrypted: any, plaintext: any): Promise<string | null> => {
          if (key && encrypted) {
            try {
              const out = await decryptText(key, encrypted);
              return safeStr(out);
            } catch {
              return "(Encrypted)";
            }
          }
          if (!key && encrypted && !plaintext) return "(Encrypted)";
          return safeStr(plaintext);
        };

        // PROFILE
        const prof = await supabase.from("patient_profiles").select("*").eq("patient_id", patientId).maybeSingle();
        if (prof.error) {
          setError(prof.error.message);
          return;
        }
        if (prof.data && typeof prof.data === "object") {
          const r = prof.data as ProfileRowAny;
          const hydrated: Profile = {
            speaks: r.speaks ?? null,
            communication_methods: await decryptMaybe(r.communication_methods_encrypted, r.communication_methods),
            languages_understood: safeStr(r.languages_understood),
            preferred_language: safeStr(r.preferred_language),
            allergies: await decryptMaybe(r.allergies_encrypted, r.allergies),
            panic_triggers: await decryptMaybe(r.panic_triggers_encrypted, r.panic_triggers),
            calming_strategies: await decryptMaybe(r.calming_strategies_encrypted, r.calming_strategies),
            important_notes: await decryptMaybe(r.important_notes_encrypted, r.important_notes),
            has_health_poa: r.has_health_poa ?? null,
            has_respect_letter: r.has_respect_letter ?? null,
            health_poa_held_by: safeStr(r.health_poa_held_by),
            respect_letter_held_by: safeStr(r.respect_letter_held_by),
            guardian_setup: r.guardian_setup ?? undefined,
            updated_at: r.updated_at ?? null,
          };
          setProfile(hydrated);
        } else {
          setProfile(null);
        }

        // DIAGNOSES
        const dx = await supabase
          .from("patient_diagnoses")
          .select("*")
          .eq("patient_id", patientId)
          .order("active", { ascending: false })
          .order("diagnosed_on", { ascending: false })
          .order("created_at", { ascending: false });

        if (dx.error) {
          setError(dx.error.message);
          return;
        }

        const dxRows = await Promise.all(
          (dx.data ?? []).map(async (row: DiagnosisRowAny) => {
            const notesText = await decryptMaybe(row.notes_encrypted, row.notes);
            return {
              id: String(row.id),
              diagnosis: String(row.diagnosis ?? ""),
              diagnosed_on: row.diagnosed_on ? String(row.diagnosed_on) : null,
              notes: notesText,
              active: !!row.active,
              created_at: String(row.created_at),
            } satisfies Diagnosis;
          })
        );
        setDiagnoses(dxRows);

        // MEDS
        const m = await supabase
          .from("medications")
          .select("*")
          .eq("patient_id", patientId)
          .eq("active", true)
          .order("created_at", { ascending: false });

        if (m.error) {
          setError(m.error.message);
          return;
        }

        const medsRows: Medication[] = (m.data ?? []).map((row: MedicationRowAny) => ({
          id: String(row.id),
          name: String(row.name ?? ""),
          dosage: row.dosage ? String(row.dosage) : null,
          active: !!row.active,
          schedule_morning: !!row.schedule_morning,
          schedule_midday: !!row.schedule_midday,
          schedule_evening: !!row.schedule_evening,
          schedule_bedtime: !!row.schedule_bedtime,
          schedule_prn: !!row.schedule_prn,
          created_at: String(row.created_at),
        }));
        setMeds(medsRows);

        // SUMMARY NOTES
        const n = await supabase
          .from("journal_entries")
          .select("id,journal_type,created_at,mood,pain_level,include_in_clinician_summary,content,content_encrypted")
          .eq("patient_id", patientId)
          .eq("include_in_clinician_summary", true)
          .order("created_at", { ascending: false });

        if (n.error) {
          setError(n.error.message);
          return;
        }

        const noteRows = await Promise.all(
          (n.data ?? []).map(async (row: NoteRowAny) => {
            const contentText = await decryptMaybe(row.content_encrypted, row.content);
            return {
              id: String(row.id),
              journal_type: (row.journal_type === "carer" ? "carer" : "patient") as "patient" | "carer",
              created_at: String(row.created_at),
              mood: (row.mood ?? null) as SummaryNote["mood"],
              pain_level: typeof row.pain_level === "number" ? row.pain_level : null,
              content: contentText,
            } satisfies SummaryNote;
          })
        );
        setNotes(noteRows);

        // MED LOGS (for adherence snapshot) — best effort
        const logsSince = daysAgoIso(7);
        const ml = await supabase
          .from("medication_logs")
          .select("medication_id,slot,status,created_at")
          .eq("patient_id", patientId)
          .gte("created_at", logsSince)
          .order("created_at", { ascending: false });

        if (!ml.error) {
          const lrows: MedLog[] = (ml.data ?? []).map((row: MedLogRowAny) => ({
            medication_id: String(row.medication_id),
            slot: (row.slot ?? null) as Slot | null,
            status: (row.status ?? "missed") as "taken" | "missed",
            created_at: String(row.created_at),
          }));
          setLogs(lrows);
        } else {
          // don't block the page; just skip
          setLogs([]);
        }

        // AUDIT TRAIL — best effort
        // If you have an audit table named `audit_events`, this will show it.
        // If not, we show "not available".
        const ae = await supabase
          .from("audit_events")
          .select("id,created_at,action,resource,user_id")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (ae.error) {
          setAuditEvents(null);
        } else {
          const arows: AuditEvent[] = (ae.data ?? []).map((row: AuditRowAny) => ({
            id: String(row.id),
            created_at: String(row.created_at),
            action: safeStr(row.action),
            resource: safeStr(row.resource),
            user_id: safeStr(row.user_id),
          }));
          setAuditEvents(arows);
        }
      } catch (e: any) {
        setError(e?.message ?? "Unknown error");
      }
    })();
  }, [patientId]);

  const activeDx = useMemo(() => diagnoses.filter((d) => d.active), [diagnoses]);

  const medScheduleLabel = (m: Medication) => {
    const parts: string[] = [];
    if (m.schedule_morning) parts.push("Morning");
    if (m.schedule_midday) parts.push("Midday");
    if (m.schedule_evening) parts.push("Evening");
    if (m.schedule_bedtime) parts.push("Bedtime");
    if (m.schedule_prn) parts.push("PRN");
    return parts.length ? parts.join(", ") : "—";
  };

  // Adherence snapshot (last 7 days):
  // For each medication+slot, we take the latest log as the current status.
  const adherence = useMemo(() => {
    const byMedSlot: Record<string, Record<string, MedLog>> = {};
    for (const l of logs) {
      const slot = l.slot ?? "unslotted";
      if (!byMedSlot[l.medication_id]) byMedSlot[l.medication_id] = {};
      if (!byMedSlot[l.medication_id][slot]) byMedSlot[l.medication_id][slot] = l; // logs are desc; first is latest
    }

    // Expected = active meds scheduled slots (PRN included only if scheduled_prn true)
    const expected: { medication_id: string; slot: Slot }[] = [];
    for (const m of meds) {
      for (const s of scheduledSlots(m)) expected.push({ medication_id: m.id, slot: s });
    }

    const total = expected.length;
    let taken = 0;
    let missed = 0;
    let unlogged = 0;

    for (const ex of expected) {
      const latest = byMedSlot?.[ex.medication_id]?.[ex.slot];
      if (!latest) unlogged += 1;
      else if (latest.status === "taken") taken += 1;
      else missed += 1;
    }

    const pct = total > 0 ? Math.round((taken / total) * 100) : 0;

    return { total, taken, missed, unlogged, pct, byMedSlot };
  }, [logs, meds]);

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        {/* Header */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div className="cc-row">
              <Link className="cc-btn print:hidden" href={`/app/patients/${patientId}?tab=overview`}>
                ← Back
              </Link>

              <div>
                <div className="cc-kicker">Clinician summary</div>
                <h1 className="cc-h1">{patientName}</h1>
                <div className="cc-small" style={{ marginTop: 6 }}>
                  {patientKey ? "Encrypted view enabled" : "Encrypted view not available (salt/key missing or not set up)"}
                </div>
              </div>
            </div>

            <button onClick={() => window.print()} className="cc-btn cc-btn-primary print:hidden">
              Print
            </button>
          </div>

          {error ? (
            <div className="cc-status cc-status-error" style={{ marginTop: 12 }}>
              <span className="cc-status-error-title">Error:</span> {error}
            </div>
          ) : null}
        </div>

        {/* Care profile */}
        <section className="cc-card cc-card-pad">
          <h2 className="cc-h2">Care profile</h2>

          {!profile ? (
            <p className="cc-subtle" style={{ marginTop: 10 }}>
              Not set.
            </p>
          ) : (
            <>
              <div className="cc-grid-2" style={{ marginTop: 12 }}>
                <KV label="Speaks">
                  {profile.speaks === null ? "Not specified" : profile.speaks ? "Yes" : "No / limited"}
                </KV>
                <KV label="Communication">{profile.communication_methods}</KV>
                <KV label="Languages">{profile.languages_understood}</KV>
                <KV label="Preferred language">{profile.preferred_language}</KV>

                <KV label="Allergies">{profile.allergies}</KV>
                <KV label="Panic triggers">{profile.panic_triggers}</KV>
                <KV label="Calming strategies">{profile.calming_strategies}</KV>

                <KV label="Health POA in place">{yesNo(profile.has_health_poa)}</KV>
                {profile.has_health_poa ? <KV label="Health POA held by">{profile.health_poa_held_by}</KV> : null}

                <KV label="RESPECT letter in place">{yesNo(profile.has_respect_letter)}</KV>
                {profile.has_respect_letter ? <KV label="RESPECT letter held by">{profile.respect_letter_held_by}</KV> : null}
              </div>

              {profile.important_notes ? (
                <div className="cc-panel" style={{ marginTop: 12 }}>
                  <div className="cc-strong">Important notes</div>
                  <div className="cc-subtle" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                    {profile.important_notes}
                  </div>
                </div>
              ) : null}

              {profile.updated_at ? (
                <div className="cc-small" style={{ marginTop: 12 }}>
                  Updated: {fmt(profile.updated_at)}
                </div>
              ) : null}
            </>
          )}
        </section>

        {/* Adherence snapshot */}
        <section className="cc-card cc-card-pad">
          <h2 className="cc-h2">Medication adherence snapshot (last 7 days)</h2>
          <p className="cc-subtle" style={{ marginTop: 6 }}>
            Uses the latest log per medication + slot as the current status for this window.
          </p>

          {adherence.total === 0 ? (
            <p className="cc-subtle" style={{ marginTop: 10 }}>
              No scheduled active medications to measure.
            </p>
          ) : (
            <div className="cc-panel-green" style={{ marginTop: 12 }}>
              <div className="cc-row-between">
                <div>
                  <div className="cc-strong">Overall: {adherence.pct}% taken</div>
                  <div className="cc-subtle" style={{ marginTop: 6 }}>
                    Taken: <b>{adherence.taken}</b> • Missed: <b>{adherence.missed}</b> • Unlogged: <b>{adherence.unlogged}</b> • Expected: <b>{adherence.total}</b>
                  </div>
                </div>
              </div>

              <div className="cc-spacer-12" />

              <div className="cc-stack">
                {meds.map((m) => {
                  const slots = scheduledSlots(m);
                  if (slots.length === 0) return null;

                  return (
                    <div key={m.id} className="cc-panel-soft">
                      <div className="cc-strong">{m.name}</div>
                      <div className="cc-subtle" style={{ marginTop: 6 }}>
                        {m.dosage ?? "—"} • Schedule: {medScheduleLabel(m)}
                      </div>

                      <div className="cc-row" style={{ marginTop: 10 }}>
                        {slots.map((s) => {
                          const latest = adherence.byMedSlot?.[m.id]?.[s];
                          const label = latest ? (latest.status === "taken" ? "✅ Taken" : "❌ Missed") : "— Unlogged";
                          return (
                            <span key={s} className="cc-pill">
                              {slotLabel[s]}: {label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Diagnoses */}
        <section className="cc-card cc-card-pad">
          <h2 className="cc-h2">Diagnoses</h2>

          {activeDx.length === 0 ? (
            <p className="cc-subtle" style={{ marginTop: 10 }}>
              No active diagnoses.
            </p>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 }}>
              {activeDx.map((d) => (
                <div key={d.id} className="cc-panel-green">
                  <div className="cc-strong">{d.diagnosis}</div>
                  <div className="cc-subtle" style={{ marginTop: 6 }}>
                    {d.diagnosed_on ? `Diagnosed: ${d.diagnosed_on}` : "Diagnosis date unknown"}
                  </div>
                  {d.notes ? (
                    <div className="cc-subtle" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                      {d.notes}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Medications */}
        <section className="cc-card cc-card-pad">
          <h2 className="cc-h2">Current medications</h2>

          {meds.length === 0 ? (
            <p className="cc-subtle" style={{ marginTop: 10 }}>
              No active medications.
            </p>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 }}>
              {meds.map((m) => (
                <div key={m.id} className="cc-panel-blue">
                  <div className="cc-strong">{m.name}</div>
                  <div className="cc-subtle" style={{ marginTop: 6 }}>
                    Dosage: {m.dosage ?? "—"}
                  </div>
                  <div className="cc-subtle" style={{ marginTop: 6 }}>
                    Schedule: {medScheduleLabel(m)}
                  </div>
                  <div className="cc-small" style={{ marginTop: 8 }}>
                    Added: {fmt(m.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Summary notes */}
        <section className="cc-card cc-card-pad">
          <h2 className="cc-h2">Shared notes</h2>
          <p className="cc-subtle" style={{ marginTop: 6 }}>
            Entries marked “Include in summary”.
          </p>

          {notes.length === 0 ? (
            <p className="cc-subtle" style={{ marginTop: 10 }}>
              No shared notes.
            </p>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 }}>
              {notes.map((n) => (
                <div key={n.id} className="cc-panel-soft">
                  <div className="cc-small">
                    {fmt(n.created_at)} • {n.journal_type}
                  </div>

                  <div className="cc-row" style={{ marginTop: 8 }}>
                    {n.mood ? <span>{moodEmoji[n.mood]}</span> : null}
                    {typeof n.pain_level === "number" ? (
                      <span className="cc-subtle">Pain {n.pain_level}/10</span>
                    ) : null}
                  </div>

                  <div className="cc-subtle" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
                    {n.content ?? "(No note)"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Audit trail */}
        <section className="cc-card cc-card-pad">
          <h2 className="cc-h2">Audit trail (latest)</h2>
          <p className="cc-subtle" style={{ marginTop: 6 }}>
            Recent access / actions. If this section shows “not available”, the DB table may be named differently (or not created yet).
          </p>

          {auditEvents === null ? (
            <div className="cc-panel" style={{ marginTop: 12 }}>
              <div className="cc-subtle">Not available.</div>
            </div>
          ) : auditEvents.length === 0 ? (
            <div className="cc-panel" style={{ marginTop: 12 }}>
              <div className="cc-subtle">No events yet.</div>
            </div>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 }}>
              {auditEvents.map((a) => (
                <div key={a.id} className="cc-panel">
                  <div className="cc-small">{fmt(a.created_at)}</div>
                  <div className="cc-subtle" style={{ marginTop: 6 }}>
                    <b>{a.action ?? "action"}</b> • {a.resource ?? "resource"}
                    {a.user_id ? ` • user: ${a.user_id}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="cc-spacer-24" />
      </div>
    </main>
  );
}

/* ================= UI HELPERS ================= */

function KV(props: { label: string; children?: React.ReactNode }) {
  if (props.children === null || props.children === undefined || props.children === "") return null;

  return (
    <div className="cc-field">
      <div className="cc-label">{props.label}</div>
      <div className="cc-subtle" style={{ fontSize: 14 }}>
        {props.children}
      </div>
    </div>
  );
}
