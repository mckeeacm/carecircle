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

type MedicationLogRow = {
  id: string;
  created_at: string;
  status: string | null;
  medication_id: string;
};

type MedicationRow = {
  id: string;
  name: string;
  dosage: string | null;
  schedule_text: string | null;
  active: boolean | null;
};

type ReminderGroupRow = {
  id: string;
  patient_id: string;
  name: string;
  reminder_time: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ReminderGroupMemberRow = {
  group_id: string;
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

function formatReminderTime(value: string) {
  const raw = value.includes(":") ? value.slice(0, 5) : value;
  return raw || value;
}

export default function TodayClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [patient, setPatient] = useState<PatientRow | null>(null);

  const [journals, setJournals] = useState<JournalPreview[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [medLogs, setMedLogs] = useState<MedicationLogRow[]>([]);
  const [meds, setMeds] = useState<MedicationRow[]>([]);
  const [reminderGroups, setReminderGroups] = useState<ReminderGroupRow[]>([]);
  const [reminderMembers, setReminderMembers] = useState<ReminderGroupMemberRow[]>([]);

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

      const now = new Date();

      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);

      const endOfToday = new Date(now);
      endOfToday.setHours(23, 59, 59, 999);

      const { data: j, error: jErr } = await supabase
        .from("journal_entries")
        .select("id, created_at, journal_type, shared_to_circle")
        .eq("patient_id", patientId)
        .gte("created_at", startOfToday.toISOString())
        .lte("created_at", endOfToday.toISOString())
        .order("created_at", { ascending: false })
        .limit(5);

      if (jErr) throw jErr;
      setJournals((j ?? []) as JournalPreview[]);

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
        .order("created_at", { ascending: false });

      if (mErr) throw mErr;
      setMeds((m ?? []) as MedicationRow[]);

      const { data: ml, error: mlErr } = await supabase
        .from("medication_logs")
        .select("id, created_at, status, medication_id")
        .eq("patient_id", patientId)
        .gte("created_at", startOfToday.toISOString())
        .lte("created_at", endOfToday.toISOString())
        .order("created_at", { ascending: false })
        .limit(20);

      if (mlErr) throw mlErr;
      setMedLogs((ml ?? []) as MedicationLogRow[]);

      const { data: rg, error: rgErr } = await supabase
        .from("medication_reminder_groups")
        .select("id, patient_id, name, reminder_time, active, created_by, created_at, updated_at")
        .eq("patient_id", patientId)
        .eq("active", true)
        .order("reminder_time", { ascending: true });

      if (rgErr) {
        setReminderGroups([]);
        setReminderMembers([]);
      } else {
        const groups = (rg ?? []) as ReminderGroupRow[];
        setReminderGroups(groups);

        const groupIds = groups.map((g) => g.id);
        if (groupIds.length === 0) {
          setReminderMembers([]);
        } else {
          const { data: rm, error: rmErr } = await supabase
            .from("medication_reminder_group_members")
            .select("group_id, medication_id")
            .in("group_id", groupIds);

          if (rmErr) {
            setReminderMembers([]);
          } else {
            setReminderMembers((rm ?? []) as ReminderGroupMemberRow[]);
          }
        }
      }

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

  function medLabel(id: string) {
    const med = meds.find((m) => m.id === id);
    if (!med) return id;
    return `${med.name}${med.dosage ? ` (${med.dosage})` : ""}`;
  }

  function reminderGroupMedicationLabels(groupId: string) {
    return reminderMembers
      .filter((m) => m.group_id === groupId)
      .map((m) => medLabel(m.medication_id));
  }

  function normaliseTimeToToday(reminderTime: string) {
    const base = reminderTime.slice(0, 5);
    const [hh, mm] = base.split(":").map(Number);
    const d = new Date();
    d.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0);
    return d;
  }

  const now = new Date();
  const dueSoonCutoff = new Date(now.getTime() + 60 * 60 * 1000);

  const dueNowGroups = reminderGroups.filter((g) => {
    const t = normaliseTimeToToday(g.reminder_time);
    return t <= dueSoonCutoff;
  });

  const laterTodayGroups = reminderGroups.filter((g) => {
    const t = normaliseTimeToToday(g.reminder_time);
    return t > dueSoonCutoff;
  });

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
            You can still browse metadata, but encrypted content won’t decrypt until secure access is available on this
            device.
          </div>
        </div>
      ) : null}

      <div className="cc-grid-2-125">
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
              <div className="cc-strong">
                {dmThreadCount} direct message thread{dmThreadCount === 1 ? "" : "s"}
              </div>
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
      </div>

      <div className="cc-grid-2-125">
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <h2 className="cc-h2">Today’s journal</h2>
            <Link className="cc-btn cc-btn-primary" href={`/app/patients/${patientId}/journals`}>
              Open
            </Link>
          </div>
          <div className="cc-spacer-12" />
          {journals.length === 0 ? (
            <div className="cc-small">No journal entries yet today.</div>
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
            <h2 className="cc-h2">Medication reminders</h2>
            <Link className="cc-btn" href={`/app/patients/${patientId}/medication-logs`}>
              Open
            </Link>
          </div>
          <div className="cc-spacer-12" />

          {reminderGroups.length === 0 ? (
            <div className="cc-small">No medication reminders set.</div>
          ) : (
            <div className="cc-stack">
              {dueNowGroups.length > 0 ? (
                <div className="cc-panel-soft" style={{ padding: 14, borderRadius: 18 }}>
                  <div className="cc-strong">Due now / soon</div>
                  <div className="cc-spacer-12" />
                  <div className="cc-stack">
                    {dueNowGroups.map((group) => (
                      <div key={group.id} className="cc-panel" style={{ padding: 12 }}>
                        <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 10 }}>
                          <div>
                            <div className="cc-strong">{group.name}</div>
                            <div className="cc-small cc-subtle">{formatReminderTime(group.reminder_time)}</div>
                            <div className="cc-small cc-wrap" style={{ marginTop: 6 }}>
                              {reminderGroupMedicationLabels(group.id).join(" • ") || "No medications"}
                            </div>
                          </div>
                          <span className="cc-pill cc-pill-primary">Due</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {laterTodayGroups.length > 0 ? (
                <div className="cc-panel-soft" style={{ padding: 14, borderRadius: 18 }}>
                  <div className="cc-strong">Later today</div>
                  <div className="cc-spacer-12" />
                  <div className="cc-stack">
                    {laterTodayGroups.slice(0, 3).map((group) => (
                      <div key={group.id} className="cc-panel" style={{ padding: 12 }}>
                        <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 10 }}>
                          <div>
                            <div className="cc-strong">{group.name}</div>
                            <div className="cc-small cc-subtle">{formatReminderTime(group.reminder_time)}</div>
                            <div className="cc-small cc-wrap" style={{ marginTop: 6 }}>
                              {reminderGroupMedicationLabels(group.id).join(" • ") || "No medications"}
                            </div>
                          </div>
                          <span className="cc-pill">{formatReminderTime(group.reminder_time)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {medLogs.length > 0 ? (
                <div className="cc-panel-soft" style={{ padding: 14, borderRadius: 18 }}>
                  <div className="cc-strong">Logged today</div>
                  <div className="cc-spacer-12" />
                  <div className="cc-stack">
                    {medLogs.slice(0, 4).map((log) => (
                      <div key={log.id} className="cc-panel" style={{ padding: 12 }}>
                        <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 10 }}>
                          <div>
                            <div className="cc-strong">{medLabel(log.medication_id)}</div>
                            <div className="cc-small cc-subtle">{new Date(log.created_at).toLocaleString()}</div>
                          </div>
                          <span className={`cc-pill ${log.status === "taken" ? "cc-pill-primary" : ""}`}>
                            {log.status ?? "—"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
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
          <div className="cc-small">No logs yet today.</div>
        ) : (
          <div className="cc-stack">
            {medLogs.slice(0, 5).map((l) => (
              <div key={l.id} className="cc-panel-soft">
                <div className="cc-row-between">
                  <div className="cc-strong">{l.status ?? "—"}</div>
                  <div className="cc-small">{new Date(l.created_at).toLocaleString()}</div>
                </div>
                <div className="cc-small cc-wrap">{medLabel(l.medication_id)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="cc-row">
        <button className="cc-btn" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
    </MobileShell>
  );
}