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

/** Fetch E2EE salt from DB (preferred), fallback to NEXT_PUBLIC_ENC_SALT. */
async function loadEncSalt(): Promise<string> {
  const q = await supabase.from("app_config").select("value").eq("key", "enc_salt").maybeSingle();
  if (!q.error && q.data?.value) return String(q.data.value);
  return process.env.NEXT_PUBLIC_ENC_SALT || "";
}

/** Try audit tables in order and return rows + resolved table name. */
async function loadAuditBestEffort(patientId: string) {
  const candidates = ["audit_events", "audit_log", "audit_trail"];
  let lastErr: string | null = null;

  for (const table of candidates) {
    const res = await supabase
      .from(table)
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (res.error) {
      lastErr = res.error.message;
      continue;
    }

    return { table, rows: (res.data ?? []) as AuditRowAny[], error: null as string | null };
  }

  return { table: null as string | null, rows: [] as AuditRowAny[], error: lastErr };
}

function mapAuditRow(row: AuditRowAny): AuditEvent {
  const id = String(row.id ?? row.event_id ?? row.audit_id ?? crypto.randomUUID());
  const created_at = String(row.created_at ?? row.timestamp ?? row.time ?? new Date().toISOString());

  const action =
    safeStr(row.action) ??
    safeStr(row.event) ??
    safeStr(row.event_type) ??
    safeStr(row.type) ??
    safeStr(row.operation) ??
    null;

  const resource =
    safeStr(row.resource) ??
    safeStr(row.entity) ??
    safeStr(row.table) ??
    safeStr(row.table_name) ??
    safeStr(row.target) ??
    null;

  const user_id =
    safeStr(row.user_id) ??
    safeStr(row.actor_id) ??
    safeStr(row.performed_by) ??
    safeStr(row.created_by) ??
    null;

  return { id, created_at, action, resource, user_id };
}

/* ================= PAGE ================= */

type ViewKey = "glance" | "profile" | "meds" | "diagnoses" | "notes" | "audit";

export default function ClinicianSummaryPage() {
  const params = useParams();
  const patientId = String(params?.id ?? "");

  const [patientName, setPatientName] = useState("…");
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [notes, setNotes] = useState<SummaryNote[]>([]);

  const [logs, setLogs] = useState<MedLog[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[] | null>(null);
  const [auditInfo, setAuditInfo] = useState<{ table: string | null; error: string | null }>({ table: null, error: null });

  // E2EE
  const [patientKey, setPatientKey] = useState<CryptoKey | null>(null);
  const [encStatus, setEncStatus] = useState<"loading" | "enabled" | "disabled" | "error">("loading");

  // Mobile efficiency: default "At a glance" + sticky nav
  const [view, setView] = useState<ViewKey>("glance");

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        if (!patientId || patientId === "undefined") {
          setError("Missing patient id.");
          return;
        }

        // Require auth
        const u = await supabase.auth.getUser();
        if (!u.data.user) {
          window.location.href = "/";
          return;
        }

        // Patient name
        const p = await supabase.from("patients").select("display_name").eq("id", patientId).single();
        if (p.error) return setError(p.error.message);
        setPatientName(p.data.display_name);

        // Salt -> derive key
        setEncStatus("loading");
        const salt = await loadEncSalt();

        let key: CryptoKey | null = null;
        if (salt && salt.trim().length >= 8) {
          try {
            key = await derivePatientKey(patientId, salt);
            setEncStatus("enabled");
          } catch {
            key = null;
            setEncStatus("error");
          }
        } else {
          setEncStatus("disabled");
        }
        setPatientKey(key);

        const decryptMaybe = async (encrypted: any, plaintext: any): Promise<string | null> => {
          if (key && encrypted) {
            try {
              const out = await decryptText(key, encrypted);
              return safeStr(out);
            } catch {
              return "(Encrypted – unable to decrypt)";
            }
          }
          if (!key && encrypted && !plaintext) return "(Encrypted)";
          return safeStr(plaintext);
        };

        // PROFILE
        const prof = await supabase.from("patient_profiles").select("*").eq("patient_id", patientId).maybeSingle();
        if (prof.error) return setError(prof.error.message);

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

        if (dx.error) return setError(dx.error.message);

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

        if (m.error) return setError(m.error.message);

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

        if (n.error) return setError(n.error.message);

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

        // MED LOGS (best effort)
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
          setLogs([]);
        }

        // AUDIT (best effort)
        const a = await loadAuditBestEffort(patientId);
        setAuditInfo({ table: a.table, error: a.error });

        if (a.table === null) setAuditEvents(null);
        else setAuditEvents(a.rows.map(mapAuditRow));
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

  // Adherence snapshot: latest log per medication+slot (within logs window)
  const adherence = useMemo(() => {
    const byMedSlot: Record<string, Record<string, MedLog>> = {};
    for (const l of logs) {
      const slot = (l.slot ?? "unslotted") as any;
      if (!byMedSlot[l.medication_id]) byMedSlot[l.medication_id] = {};
      if (!byMedSlot[l.medication_id][slot]) byMedSlot[l.medication_id][slot] = l;
    }

    const expected: { medication_id: string; slot: Slot }[] = [];
    for (const m of meds) for (const s of scheduledSlots(m)) expected.push({ medication_id: m.id, slot: s });

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

  // Glance slices (compact)
  const glanceNotes = useMemo(() => notes.slice(0, 3), [notes]);
  const glanceAudit = useMemo(() => (auditEvents ?? []).slice(0, 5), [auditEvents]);
  const glanceMeds = useMemo(() => meds.slice(0, 3), [meds]);

  const encBanner = useMemo(() => {
    if (encStatus === "loading") return "Checking encrypted view…";
    if (encStatus === "enabled") return "Encrypted view enabled";
    if (encStatus === "disabled") return "Encrypted view not available (enc_salt not configured)";
    return "Encrypted view error (salt/key mismatch or format mismatch)";
  }, [encStatus]);

  const navItems: { key: ViewKey; label: string }[] = [
    { key: "glance", label: "At a glance" },
    { key: "profile", label: "Profile" },
    { key: "meds", label: "Meds" },
    { key: "diagnoses", label: "Diagnoses" },
    { key: "notes", label: "Notes" },
    { key: "audit", label: "Audit" },
  ];

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
                  {encBanner}
                </div>

                {/* Compact “counts” row (no new colours/cards) */}
                <div className="cc-row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 } as any}>
                  <span className="cc-pill">Active dx: <b>{activeDx.length}</b></span>
                  <span className="cc-pill">Meds: <b>{meds.length}</b></span>
                  <span className="cc-pill">Summary notes: <b>{notes.length}</b></span>
                  <span className="cc-pill">Adherence: <b>{adherence.total ? `${adherence.pct}%` : "—"}</b></span>
                  <span className="cc-pill">
                    Audit:{" "}
                    <b>
                      {auditEvents === null ? "—" : auditEvents.length}
                    </b>
                  </span>
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

        {/* Sticky mini-nav (mobile efficient, same pills/cards) */}
        <div
          className="cc-card cc-card-pad print:hidden"
          style={{ position: "sticky", top: 8, zIndex: 10 } as any}
        >
          <div className="cc-row" style={{ gap: 8, flexWrap: "wrap" } as any}>
            {navItems.map((it) => {
              const active = view === it.key;
              return (
                <button
                  key={it.key}
                  className={active ? "cc-pill cc-pill-primary" : "cc-pill"}
                  onClick={() => setView(it.key)}
                  type="button"
                >
                  {it.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ================= AT A GLANCE (DEFAULT) ================= */}
        {view === "glance" ? (
          <section className="cc-stack">
            {/* Profile (compact) */}
            <section className="cc-card cc-card-pad">
              <div className="cc-row-between">
                <h2 className="cc-h2">Care profile (key)</h2>
                <button className="cc-btn" onClick={() => setView("profile")}>
                  See all
                </button>
              </div>

              {!profile ? (
                <p className="cc-subtle" style={{ marginTop: 10 }}>
                  Not set.
                </p>
              ) : (
                <div className="cc-panel" style={{ marginTop: 12 } as any}>
                  <div className="cc-stack" style={{ gap: 8 } as any}>
                    <div className="cc-subtle">
                      <b>Speaks:</b> {profile.speaks === null ? "Not specified" : profile.speaks ? "Yes" : "No / limited"}
                    </div>
                    {profile.languages_understood ? (
                      <div className="cc-subtle">
                        <b>Languages:</b> {profile.languages_understood}
                      </div>
                    ) : null}
                    {profile.preferred_language ? (
                      <div className="cc-subtle">
                        <b>Preferred:</b> {profile.preferred_language}
                      </div>
                    ) : null}
                    <div className="cc-subtle">
                      <b>Health POA:</b> {yesNo(profile.has_health_poa)}
                      {profile.has_health_poa && profile.health_poa_held_by ? <>{" • "} <b>Held by:</b> {profile.health_poa_held_by}</> : null}
                    </div>
                    <div className="cc-subtle">
                      <b>RESPECT:</b> {yesNo(profile.has_respect_letter)}
                      {profile.has_respect_letter && profile.respect_letter_held_by ? <>{" • "} <b>Held by:</b> {profile.respect_letter_held_by}</> : null}
                    </div>
                    {profile.allergies ? (
                      <div className="cc-subtle">
                        <b>Allergies:</b> {profile.allergies}
                      </div>
                    ) : null}
                    {profile.important_notes ? (
                      <div className="cc-subtle">
                        <b>Important notes:</b> {profile.important_notes}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </section>

            {/* Adherence (compact topline) */}
            <section className="cc-card cc-card-pad">
              <div className="cc-row-between">
                <h2 className="cc-h2">Adherence (7 days)</h2>
                <button className="cc-btn" onClick={() => setView("meds")}>
                  See meds
                </button>
              </div>

              {adherence.total === 0 ? (
                <p className="cc-subtle" style={{ marginTop: 10 }}>
                  No scheduled active medications to measure.
                </p>
              ) : (
                <div className="cc-panel-green" style={{ marginTop: 12 }}>
                  <div className="cc-strong">{adherence.pct}% taken</div>
                  <div className="cc-subtle" style={{ marginTop: 6 }}>
                    Taken: <b>{adherence.taken}</b> • Missed: <b>{adherence.missed}</b> • Unlogged: <b>{adherence.unlogged}</b> • Expected: <b>{adherence.total}</b>
                  </div>

                  {/* Show just 3 meds here to reduce scroll */}
                  <div className="cc-stack" style={{ marginTop: 12 }}>
                    {glanceMeds.length === 0 ? (
                      <div className="cc-subtle">No active medications.</div>
                    ) : (
                      glanceMeds.map((m) => {
                        const slots = scheduledSlots(m);
                        return (
                          <div key={m.id} className="cc-panel-soft">
                            <div className="cc-row-between">
                              <div style={{ minWidth: 220 } as any}>
                                <div className="cc-strong">{m.name}</div>
                                <div className="cc-subtle" style={{ marginTop: 6 }}>
                                  {m.dosage ?? "—"} • {medScheduleLabel(m)}
                                </div>
                              </div>
                              <div className="cc-row" style={{ flexWrap: "wrap", gap: 6 } as any}>
                                {slots.slice(0, 3).map((s) => {
                                  const latest = adherence.byMedSlot?.[m.id]?.[s];
                                  const label = latest ? (latest.status === "taken" ? "✅" : "❌") : "—";
                                  return (
                                    <span key={s} className="cc-pill">
                                      {slotLabel[s]} {label}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {meds.length > 3 ? (
                    <div className="cc-row" style={{ marginTop: 10 } as any}>
                      <button className="cc-btn" onClick={() => setView("meds")}>
                        View all medications
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            {/* Diagnoses (compact) */}
            <section className="cc-card cc-card-pad">
              <div className="cc-row-between">
                <h2 className="cc-h2">Diagnoses</h2>
                <button className="cc-btn" onClick={() => setView("diagnoses")}>
                  See all
                </button>
              </div>

              {activeDx.length === 0 ? (
                <p className="cc-subtle" style={{ marginTop: 10 }}>
                  No active diagnoses.
                </p>
              ) : (
                <div className="cc-panel" style={{ marginTop: 12 } as any}>
                  <div className="cc-stack" style={{ gap: 8 } as any}>
                    {activeDx.slice(0, 4).map((d) => (
                      <div key={d.id} className="cc-subtle">
                        <b>{d.diagnosis}</b>
                        {d.diagnosed_on ? ` • ${d.diagnosed_on}` : ""}
                      </div>
                    ))}
                    {activeDx.length > 4 ? <div className="cc-small">+ {activeDx.length - 4} more</div> : null}
                  </div>
                </div>
              )}
            </section>

            {/* Notes (latest few) */}
            <section className="cc-card cc-card-pad">
              <div className="cc-row-between">
                <div>
                  <h2 className="cc-h2">Shared notes (latest)</h2>
                  <p className="cc-subtle" style={{ marginTop: 6 }}>
                    Entries marked “Include in summary”.
                  </p>
                </div>
                <button className="cc-btn" onClick={() => setView("notes")}>
                  See all
                </button>
              </div>

              {glanceNotes.length === 0 ? (
                <p className="cc-subtle" style={{ marginTop: 10 }}>
                  No shared notes.
                </p>
              ) : (
                <div className="cc-stack" style={{ marginTop: 12 }}>
                  {glanceNotes.map((n) => (
                    <div key={n.id} className="cc-panel-soft">
                      <div className="cc-small">
                        {fmt(n.created_at)} • {n.journal_type}
                      </div>

                      <div className="cc-row" style={{ marginTop: 8 }}>
                        {n.mood ? <span>{moodEmoji[n.mood]}</span> : null}
                        {typeof n.pain_level === "number" ? <span className="cc-subtle">Pain {n.pain_level}/10</span> : null}
                      </div>

                      <div className="cc-subtle" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
                        {n.content ?? "(No note)"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Audit (latest few) */}
            <section className="cc-card cc-card-pad">
              <div className="cc-row-between">
                <div>
                  <h2 className="cc-h2">Audit (latest)</h2>
                  <p className="cc-subtle" style={{ marginTop: 6 }}>
                    Recent access / actions{auditInfo.table ? <> • source: <b>{auditInfo.table}</b></> : ""}.
                  </p>
                </div>
                <button className="cc-btn" onClick={() => setView("audit")}>
                  See all
                </button>
              </div>

              {auditEvents === null ? (
                <div className="cc-panel" style={{ marginTop: 12 }}>
                  <div className="cc-subtle">Not available.</div>
                  {auditInfo.error ? (
                    <div className="cc-small" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                      {auditInfo.error}
                    </div>
                  ) : null}
                </div>
              ) : glanceAudit.length === 0 ? (
                <div className="cc-panel" style={{ marginTop: 12 }}>
                  <div className="cc-subtle">No events yet.</div>
                </div>
              ) : (
                <div className="cc-stack" style={{ marginTop: 12 }}>
                  {glanceAudit.map((a) => (
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
          </section>
        ) : null}

        {/* ================= FULL SECTIONS (SAME CARDS) ================= */}

        {view === "profile" ? (
          <section className="cc-card cc-card-pad">
            <div className="cc-row-between">
              <h2 className="cc-h2">Care profile</h2>
              <button className="cc-btn" onClick={() => setView("glance")}>
                Back to glance
              </button>
            </div>

            {!profile ? (
              <p className="cc-subtle" style={{ marginTop: 10 }}>
                Not set.
              </p>
            ) : (
              <>
                <div className="cc-grid-2" style={{ marginTop: 12 }}>
                  <KV label="Speaks">{profile.speaks === null ? "Not specified" : profile.speaks ? "Yes" : "No / limited"}</KV>
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
        ) : null}

        {view === "meds" ? (
          <section className="cc-stack">
            <section className="cc-card cc-card-pad">
              <div className="cc-row-between">
                <div>
                  <h2 className="cc-h2">Medication adherence snapshot (last 7 days)</h2>
                  <p className="cc-subtle" style={{ marginTop: 6 }}>
                    Uses the latest log per medication + slot as the current status for this window.
                  </p>
                </div>
                <button className="cc-btn" onClick={() => setView("glance")}>
                  Back to glance
                </button>
              </div>

              {adherence.total === 0 ? (
                <p className="cc-subtle" style={{ marginTop: 10 }}>
                  No scheduled active medications to measure.
                </p>
              ) : (
                <div className="cc-panel-green" style={{ marginTop: 12 }}>
                  <div className="cc-strong">Overall: {adherence.pct}% taken</div>
                  <div className="cc-subtle" style={{ marginTop: 6 }}>
                    Taken: <b>{adherence.taken}</b> • Missed: <b>{adherence.missed}</b> • Unlogged: <b>{adherence.unlogged}</b> • Expected: <b>{adherence.total}</b>
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

                          <div className="cc-row" style={{ marginTop: 10, flexWrap: "wrap", gap: 6 } as any}>
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
          </section>
        ) : null}

        {view === "diagnoses" ? (
          <section className="cc-card cc-card-pad">
            <div className="cc-row-between">
              <h2 className="cc-h2">Diagnoses</h2>
              <button className="cc-btn" onClick={() => setView("glance")}>
                Back to glance
              </button>
            </div>

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
        ) : null}

        {view === "notes" ? (
          <section className="cc-card cc-card-pad">
            <div className="cc-row-between">
              <div>
                <h2 className="cc-h2">Shared notes</h2>
                <p className="cc-subtle" style={{ marginTop: 6 }}>
                  Entries marked “Include in summary”.
                </p>
              </div>
              <button className="cc-btn" onClick={() => setView("glance")}>
                Back to glance
              </button>
            </div>

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
                      {typeof n.pain_level === "number" ? <span className="cc-subtle">Pain {n.pain_level}/10</span> : null}
                    </div>

                    <div className="cc-subtle" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
                      {n.content ?? "(No note)"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {view === "audit" ? (
          <section className="cc-card cc-card-pad">
            <div className="cc-row-between">
              <div>
                <h2 className="cc-h2">Audit trail (latest)</h2>
                <p className="cc-subtle" style={{ marginTop: 6 }}>
                  Recent access / actions{auditInfo.table ? <> • source: <b>{auditInfo.table}</b></> : ""}.
                </p>
              </div>
              <button className="cc-btn" onClick={() => setView("glance")}>
                Back to glance
              </button>
            </div>

            {auditEvents === null ? (
              <div className="cc-panel" style={{ marginTop: 12 }}>
                <div className="cc-subtle">Not available.</div>
                {auditInfo.error ? (
                  <div className="cc-small" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                    {auditInfo.error}
                  </div>
                ) : null}
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
        ) : null}

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
