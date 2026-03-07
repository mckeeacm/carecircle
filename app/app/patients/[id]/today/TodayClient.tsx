"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import MobileShell from "@/app/components/MobileShell";

type PatientRow = { id: string; display_name: string | null };

type JournalPreview = {
  id: string;
  created_at: string;
  journal_type: string;
  shared_to_circle: boolean;
};

type AppointmentRow = {
  id: string;
  starts_at: string | null;
  title: string | null;
  location: string | null;
};

type MedicationRow = {
  id: string;
  name: string;
  dosage: string;
  schedule_text: string;
  active: boolean;
};

type MedicationLogRow = {
  id: string;
  created_at: string;
  status: string | null;
  medication_id: string;
};

type DmThreadRow = {
  id?: string;
  thread_id?: string;
  last_message_at?: string | null;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function TodayClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [patient, setPatient] = useState<PatientRow | null>(null);

  const [journals, setJournals] = useState<JournalPreview[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [meds, setMeds] = useState<MedicationRow[]>([]);
  const [medLogs, setMedLogs] = useState<MedicationLogRow[]>([]);

  const [dmStatus, setDmStatus] = useState<"ok" | "unavailable" | "loading">("loading");
  const [dmThreadCount, setDmThreadCount] = useState<number>(0);

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

      const { data: j, error: jErr } = await supabase
        .from("journal_entries")
        .select("id, created_at, journal_type, shared_to_circle")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (jErr) throw jErr;
      setJournals((j ?? []) as JournalPreview[]);

      const now = new Date();
      const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      try {
        const { data: a, error: aErr } = await supabase
          .from("appointments")
          .select("id, starts_at, title, location")
          .eq("patient_id", patientId)
          .gte("starts_at", now.toISOString())
          .lte("starts_at", until.toISOString())
          .order("starts_at", { ascending: true })
          .limit(10);

        if (aErr) throw aErr;
        setAppointments((a ?? []) as AppointmentRow[]);
      } catch {
        setAppointments([]);
      }

      const { data: m, error: mErr } = await supabase
        .from("medications")
        .select("id, name, dosage, schedule_text, active")
        .eq("patient_id", patientId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(10);

      if (mErr) throw mErr;
      setMeds((m ?? []) as MedicationRow[]);

      const { data: ml, error: mlErr } = await supabase
        .from("medication_logs")
        .select("id, created_at, status, medication_id")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (mlErr) throw mlErr;
      setMedLogs((ml ?? []) as MedicationLogRow[]);

      try {
        const { data: threads, error: dmErr } = await supabase.rpc("dm_list_threads", {
          p_patient_id: patientId,
        });

        if (dmErr) throw dmErr;

        const rows = (threads ?? []) as DmThreadRow[];
        setDmThreadCount(rows.length);
        setDmStatus("ok");
      } catch {
        setDmThreadCount(0);
        setDmStatus("unavailable");
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_today");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [patientId, supabase]);

  return (
    <MobileShell
      title="Today"
      subtitle={patient?.display_name ?? patientId}
      patientId={patientId}
      rightSlot={
        <Link className="cc-btn" href="/app/hub">
          Hub
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
          <div className="cc-subtle">
            You can still browse metadata, but encrypted content won’t decrypt until secure access is available on this device.
          </div>
        </div>
      ) : null}

      <div className="cc-grid-3">
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <h2 className="cc-h2">Messages</h2>
            <Link className="cc-btn" href={`/app/patients/${patientId}/dm`}>
              Open
            </Link>
          </div>
          <div className="cc-spacer-12" />
          {dmStatus === "loading" ? (
            <div className="cc-small">Checking…</div>
          ) : dmStatus === "unavailable" ? (
            <div className="cc-small">Messages currently unavailable.</div>
          ) : dmThreadCount > 0 ? (
            <div className="cc-panel-blue">
              <div className="cc-strong">{dmThreadCount} direct message thread{dmThreadCount === 1 ? "" : "s"}</div>
              <div className="cc-small">Tap to view recent messages.</div>
            </div>
          ) : (
            <div className="cc-small">No message threads yet.</div>
          )}
        </div>

        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <h2 className="cc-h2">Next 24h appointments</h2>
            <Link className="cc-btn" href={`/app/patients/${patientId}/appointments`}>
              View
            </Link>
          </div>
          <div className="cc-spacer-12" />
          {appointments.length === 0 ? (
            <div className="cc-small">None in the next 24 hours.</div>
          ) : (
            <div className="cc-stack">
              {appointments.slice(0, 3).map((a) => (
                <div key={a.id} className="cc-panel-soft">
                  <div className="cc-strong">{a.title ?? "Appointment"}</div>
                  <div className="cc-small">
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
              Logs
            </Link>
          </div>
          <div className="cc-spacer-12" />
          {meds.length === 0 ? (
            <div className="cc-small">No active medications.</div>
          ) : (
            <div className="cc-stack">
              {meds.slice(0, 3).map((m) => (
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
      </div>

      <div className="cc-grid-2-125">
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <h2 className="cc-h2">Newest journals</h2>
            <Link className="cc-btn cc-btn-primary" href={`/app/patients/${patientId}/journals`}>
              Open
            </Link>
          </div>
          <div className="cc-spacer-12" />
          {journals.length === 0 ? (
            <div className="cc-small">None yet.</div>
          ) : (
            <div className="cc-stack">
              {journals.map((j) => (
                <div key={j.id} className="cc-panel-soft">
                  <div className="cc-row-between">
                    <div>
                      <div className="cc-strong">{j.journal_type}</div>
                      <div className="cc-small">{new Date(j.created_at).toLocaleString()}</div>
                    </div>
                    <span className={`cc-pill ${j.shared_to_circle ? "cc-pill-primary" : ""}`}>
                      {j.shared_to_circle ? "shared" : "private"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <h2 className="cc-h2">Recent medication logs</h2>
            <Link className="cc-btn" href={`/app/patients/${patientId}/medication-logs`}>
              Open
            </Link>
          </div>
          <div className="cc-spacer-12" />
          {medLogs.length === 0 ? (
            <div className="cc-small">No logs yet.</div>
          ) : (
            <div className="cc-stack">
              {medLogs.slice(0, 5).map((l) => (
                <div key={l.id} className="cc-panel-soft">
                  <div className="cc-row-between">
                    <div className="cc-strong">{l.status ?? "—"}</div>
                    <div className="cc-small">{new Date(l.created_at).toLocaleString()}</div>
                  </div>
                  <div className="cc-small cc-wrap">medication_id: {l.medication_id}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="cc-row">
        <button className="cc-btn" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
    </MobileShell>
  );
}