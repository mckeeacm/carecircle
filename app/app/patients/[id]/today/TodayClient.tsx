// app/app/patients/[id]/today/TodayClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";

type PatientRow = { id: string; display_name: string };

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

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function ts() {
  return new Date().toISOString();
}

export default function TodayClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [msg, setMsg] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const [patient, setPatient] = useState<PatientRow | null>(null);

  const [journals, setJournals] = useState<JournalPreview[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [meds, setMeds] = useState<MedicationRow[]>([]);
  const [medLogs, setMedLogs] = useState<MedicationLogRow[]>([]);
  const [dmStatus, setDmStatus] = useState<"ok" | "unavailable" | "loading">("loading");

  function log(line: string) {
    setDebug((p) => [...p, `[${ts()}] ${line}`].slice(-200));
  }

  useEffect(() => {
    (async () => {
      setMsg(null);
      setDebug([]);
      setPatient(null);
      setJournals([]);
      setAppointments([]);
      setMeds([]);
      setMedLogs([]);
      setDmStatus("loading");

      if (!patientId || !isUuid(patientId)) {
        setMsg(`invalid patientId: ${String(patientId)}`);
        log(`ERROR invalid patientId: ${String(patientId)}`);
        return;
      }

      try {
        log(`Loading patient display_name…`);
        const { data: p, error: pErr } = await supabase
          .from("patients")
          .select("id, display_name")
          .eq("id", patientId)
          .single();

        if (pErr) throw pErr;
        setPatient(p as PatientRow);

        // Journals (newest)
        log(`Loading newest journal_entries…`);
        const { data: j, error: jErr } = await supabase
          .from("journal_entries")
          .select("id, created_at, journal_type, shared_to_circle")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(5);

        if (jErr) throw jErr;
        setJournals((j ?? []) as JournalPreview[]);
        log(`journal_entries loaded: ${(j ?? []).length}`);

        // Appointments (next 24h) — tolerate table missing by catching and showing empty
        const now = new Date();
        const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        log(`Loading appointments next 24h: ${now.toISOString()} -> ${until.toISOString()}`);

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
          log(`appointments loaded: ${(a ?? []).length}`);
        } catch (e: any) {
          log(`appointments unavailable: ${e?.message ?? String(e)}`);
          setAppointments([]);
        }

        // Medications (active)
        log(`Loading active medications…`);
        const { data: m, error: mErr } = await supabase
          .from("medications")
          .select("id, name, dosage, schedule_text, active")
          .eq("patient_id", patientId)
          .eq("active", true)
          .order("created_at", { ascending: false })
          .limit(10);

        if (mErr) throw mErr;
        setMeds((m ?? []) as MedicationRow[]);
        log(`medications loaded: ${(m ?? []).length}`);

        // Medication logs
        log(`Loading recent medication_logs…`);
        const { data: ml, error: mlErr } = await supabase
          .from("medication_logs")
          .select("id, created_at, status, medication_id")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(10);

        if (mlErr) throw mlErr;
        setMedLogs((ml ?? []) as MedicationLogRow[]);
        log(`medication_logs loaded: ${(ml ?? []).length}`);

        // DM threads: don’t crash Today if DM policies are currently broken
        log(`Loading dm_threads (best-effort)…`);
        try {
          const { error: dmErr } = await supabase
            .from("dm_threads")
            .select("id")
            .eq("patient_id", patientId)
            .limit(1);

          if (dmErr) throw dmErr;
          setDmStatus("ok");
          log(`dm_threads ok`);
        } catch (e: any) {
          setDmStatus("unavailable");
          log(`dm_threads unavailable: ${e?.message ?? String(e)}`);
        }

        log(`Today load complete.`);
      } catch (e: any) {
        setMsg(e?.message ?? "failed_to_load_today");
        log(`FAILED: ${e?.message ?? String(e)}`);
      }
    })();
  }, [patientId, supabase]);

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Today</h1>
            <div className="cc-subtle">{patient?.display_name ?? patientId}</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">
              Back to Hub
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
            <div className="cc-subtle">
              You can still browse metadata, but encrypted content won’t decrypt until you have a vault share on this device.
            </div>
          </div>
        ) : null}

        <div className="cc-grid-3">
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
              <div className="cc-panel">
                <div className="cc-strong">DM temporarily unavailable</div>
                <div className="cc-small">
                  Your current RLS on <code>dm_thread_members</code> is recursing. Fixing that is a DB policy task; Today won’t crash.
                </div>
              </div>
            ) : (
              <div className="cc-small">DM ok.</div>
            )}
          </div>
        </div>

        <div className="cc-grid-2-125">
          <div className="cc-card cc-card-pad">
            <div className="cc-row-between">
              <h2 className="cc-h2">Active medications</h2>
              <Link className="cc-btn cc-btn-secondary" href={`/app/patients/${patientId}/medication-logs`}>
                Logs
              </Link>
            </div>
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
                {medLogs.map((l) => (
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

        <div className="cc-card cc-card-pad">
          <div className="cc-strong">Debug</div>
          <div className="cc-small cc-subtle">Log will appear here.</div>
          <div className="cc-spacer-12" />
          <pre className="cc-panel-soft cc-wrap" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {debug.join("\n")}
          </pre>
        </div>
      </div>
    </div>
  );
}