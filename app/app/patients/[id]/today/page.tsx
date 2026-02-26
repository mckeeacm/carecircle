"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type TodayOverview = {
  circles: number;
  upcoming_appt_circles: number;
  active_meds: number;
  taken_today: number;
  journals_today_total: number;
  journals_today_shared: number;
  error?: string;
};

type PatientRow = {
  id: string;
  display_name: string | null;
};

type AppointmentRow = {
  id: string;
  patient_id: string;
  starts_at: string;
  title: string | null;
  location: string | null;
  provider: string | null;
};

type JournalRow = {
  id: string;
  patient_id: string;
  journal_type: string;
  created_at: string;
  mood_encrypted: CipherEnvelopeV1 | null;
  content_encrypted: CipherEnvelopeV1 | null;
  shared_to_circle: boolean | null;
};

type MedicationRow = {
  id: string;
  patient_id: string;
  name: string;
  dosage: string | null;
  schedule_text: string | null;
  active: boolean | null;
};

type MedicationLogRow = {
  id: string;
  patient_id: string;
  medication_id: string;
  status: string | null;
  note_encrypted: CipherEnvelopeV1 | null;
  created_at: string;
};

export default function TodayPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [overview, setOverview] = useState<TodayOverview | null>(null);
  const [patientsById, setPatientsById] = useState<Record<string, PatientRow>>({});
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [meds, setMeds] = useState<MedicationRow[]>([]);
  const [logs, setLogs] = useState<MedicationLogRow[]>([]);
  const [notePlain, setNotePlain] = useState<Record<string, string>>({});
  const [journalPlain, setJournalPlain] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  function todayBounds() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { startISO: start.toISOString(), endISO: end.toISOString() };
  }

  function next24hISO() {
    const now = new Date();
    const later = new Date(now);
    later.setHours(now.getHours() + 24);
    return { nowISO: now.toISOString(), laterISO: later.toISOString() };
  }

  async function refresh() {
    setMsg(null);
    try {
      const { data: o, error: oErr } = await supabase.rpc("today_overview");
      if (oErr) throw oErr;
      setOverview(o as TodayOverview);

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;

      const { data: pm } = await supabase
        .from("patient_members")
        .select("patient_id")
        .eq("user_id", uid);

      const ids = (pm ?? []).map((r: any) => r.patient_id);
      if (ids.length === 0) return;

      const { data: pts } = await supabase
        .from("patients")
        .select("id, display_name")
        .in("id", ids);

      const pMap: Record<string, PatientRow> = {};
      (pts ?? []).forEach((p: any) => (pMap[p.id] = p));
      setPatientsById(pMap);

      // Upcoming appointments (next 24h)
      const { nowISO, laterISO } = next24hISO();
      const { data: appts } = await supabase
        .from("appointments")
        .select("id, patient_id, starts_at, title, location, provider")
        .in("patient_id", ids)
        .gte("starts_at", nowISO)
        .lte("starts_at", laterISO)
        .order("starts_at", { ascending: true });

      setAppointments((appts ?? []) as AppointmentRow[]);

      // Shared journals today
      const { startISO, endISO } = todayBounds();
      const { data: j } = await supabase
        .from("journal_entries")
        .select("id, patient_id, journal_type, created_at, mood_encrypted, content_encrypted, shared_to_circle")
        .in("patient_id", ids)
        .eq("shared_to_circle", true)
        .gte("created_at", startISO)
        .lt("created_at", endISO)
        .order("created_at", { ascending: false });

      setJournals((j ?? []) as JournalRow[]);

      // Medications
      const { data: m } = await supabase
        .from("medications")
        .select("id, patient_id, name, dosage, schedule_text, active")
        .in("patient_id", ids)
        .eq("active", true);

      setMeds((m ?? []) as MedicationRow[]);

      // Logs today
      const { data: l } = await supabase
        .from("medication_logs")
        .select("id, patient_id, medication_id, status, note_encrypted, created_at")
        .in("patient_id", ids)
        .gte("created_at", startISO)
        .lt("created_at", endISO);

      setLogs((l ?? []) as MedicationLogRow[]);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_today");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function decryptMedNote(l: MedicationLogRow) {
    if (!vaultKey || !l.note_encrypted) return;
    const plain = await decryptStringWithLocalCache({
      patientId: l.patient_id,
      table: "medication_logs",
      rowId: l.id,
      column: "note_encrypted",
      env: l.note_encrypted,
      vaultKey,
    });
    setNotePlain((p) => ({ ...p, [l.id]: plain }));
  }

  async function decryptJournal(j: JournalRow) {
    if (!vaultKey || !j.content_encrypted) return;
    const plain = await decryptStringWithLocalCache({
      patientId: j.patient_id,
      table: "journal_entries",
      rowId: j.id,
      column: "content_encrypted",
      env: j.content_encrypted,
      vaultKey,
    });
    setJournalPlain((p) => ({ ...p, [j.id]: plain }));
  }

  // --- Due & Overdue logic ---
  const takenMedIdsToday = new Set(
    logs.filter((l) => l.status === "taken").map((l) => l.medication_id)
  );

  const due = meds.filter(
    (m) => m.schedule_text && !takenMedIdsToday.has(m.id)
  );

  const isAfternoon = new Date().getHours() >= 12;

  const overdue = isAfternoon ? due : [];

  return (
    <div style={{ padding: 16 }}>
      <h2>Today</h2>

      {msg && <div style={{ color: "red" }}>{msg}</div>}

      <h3>Upcoming (next 24h)</h3>
      {appointments.map((a) => (
        <div key={a.id}>
          <b>{patientsById[a.patient_id]?.display_name}</b> •{" "}
          {new Date(a.starts_at).toLocaleString()} • {a.title}
        </div>
      ))}

      <h3 style={{ marginTop: 20 }}>Shared journals today</h3>
      {journals.map((j) => (
        <div key={j.id} style={{ marginBottom: 10 }}>
          <b>{patientsById[j.patient_id]?.display_name}</b> •{" "}
          {j.journal_type} • {new Date(j.created_at).toLocaleTimeString()}
          <div>
            <button onClick={() => decryptJournal(j)}>Decrypt</button>
          </div>
          {journalPlain[j.id] && (
            <div style={{ whiteSpace: "pre-wrap" }}>{journalPlain[j.id]}</div>
          )}
        </div>
      ))}

      <h3 style={{ marginTop: 20 }}>Taken today</h3>
      {logs
        .filter((l) => l.status === "taken")
        .map((l) => {
          const med = meds.find((m) => m.id === l.medication_id);
          return (
            <div key={l.id}>
              {patientsById[l.patient_id]?.display_name} • {med?.name} •{" "}
              {new Date(l.created_at).toLocaleTimeString()}
              <button onClick={() => decryptMedNote(l)}>Decrypt note</button>
              {notePlain[l.id] && <div>{notePlain[l.id]}</div>}
            </div>
          );
        })}

      <h3 style={{ marginTop: 20 }}>Due medications</h3>
      {due.map((m) => (
        <div key={m.id}>
          {patientsById[m.patient_id]?.display_name} • {m.name} •{" "}
          {m.schedule_text}
        </div>
      ))}

      <h3 style={{ marginTop: 20 }}>Overdue medications</h3>
      {overdue.map((m) => (
        <div key={m.id} style={{ color: "red" }}>
          {patientsById[m.patient_id]?.display_name} • {m.name}
        </div>
      ))}
    </div>
  );
}