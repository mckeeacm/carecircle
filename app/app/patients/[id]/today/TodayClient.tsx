"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";
import MobileShell from "@/app/components/MobileShell";
import { useUserLanguage } from "@/app/components/UserLanguageProvider";
import { t } from "@/lib/i18n";

type PatientRow = { id: string; display_name: string | null };

type JournalPreview = {
  id: string;
  created_at: string;
  journal_type: string;
  shared_to_circle: boolean;
  created_by: string | null;
};

type AppointmentRow = {
  id: string;
  starts_at: string | null;
  title: string | null;
  location: string | null;
};

type AppointmentAuditRow = {
  id: string;
  appointment_id: string;
  patient_id: string;
  changed_by: string | null;
  changed_at: string;
  action: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
};

type MedicationLogRow = {
  id: string;
  created_at: string;
  status: string | null;
  medication_id: string;
  created_by: string;
  note_encrypted: CipherEnvelopeV1 | null;
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

type MemberBasic = {
  user_id: string;
  nickname: string | null;
  role: string | null;
  is_controller: boolean | null;
};

type ReminderGroupState = {
  group: ReminderGroupRow;
  medicationIds: string[];
  dueAt: Date;
  closesAt: Date;
  state: "upcoming" | "due" | "taken" | "missed";
  missingMedicationIds: string[];
  takenMedicationIds: string[];
  missedMedicationIds: string[];
};

type ActivityItem = {
  id: string;
  at: string;
  actorLabel: string;
  title: string;
  detail?: string;
  tone?: "normal" | "danger" | "positive";
};

const SYSTEM_NOTE_PREFIX = "__SYSTEM_NOTES__:";

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function formatReminderTime(value: string) {
  const raw = value.includes(":") ? value.slice(0, 5) : value;
  return raw || value;
}

function parseReminderTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return { hour, minute };
}

function startOfToday(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function endOfToday(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function reminderTimeForToday(reminderTime: string, now: Date) {
  const parsed = parseReminderTime(reminderTime);
  if (!parsed) return null;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), parsed.hour, parsed.minute, 0, 0);
}

function formatReminderDisplayTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isSystemNotesPlaintext(value: string | undefined) {
  return !!value && value.startsWith(SYSTEM_NOTE_PREFIX);
}

function stripSystemPrefix(value: string | undefined) {
  if (!value) return "";
  return isSystemNotesPlaintext(value) ? value.slice(SYSTEM_NOTE_PREFIX.length).trim() : value;
}

function fieldLabel(field: string) {
  if (field === "starts_at") return "appointment start time";
  if (field === "ends_at") return "appointment end time";
  if (field === "title") return "appointment title";
  if (field === "location") return "appointment location";
  if (field === "provider") return "appointment provider";
  if (field === "status") return "appointment status";
  if (field === "transport_status") return "transport status";
  if (field === "transport_by") return "transport arranged by";
  if (field === "transport_proof_name") return "transport proof";
  if (field === "notes_encrypted") return "appointment notes";
  if (field === "appointment") return "appointment";
  return field.replace(/_/g, " ");
}

function statusPillClass(value: string | null) {
  if (value === "taken") return "cc-pill-primary";
  if (value === "missed") return "cc-pill-danger";
  return "";
}

function medicationStatusLabel(value: string | null) {
  if (value === "taken") return "Taken";
  if (value === "missed") return "Missed";
  if (value === "refused") return "Refused";
  if (value === "delayed") return "Delayed";
  return value ?? "—";
}

function medicationStatusLabelForUi(value: string | null, languageCode: string) {
  if (value === "taken") return t(languageCode, "today.taken");
  if (value === "missed") return t(languageCode, "today.missed");
  if (value === "refused") return "Refused";
  if (value === "delayed") return "Delayed";
  return value ?? "-";
}

export default function TodayClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();
  const { languageCode } = useUserLanguage();

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [patient, setPatient] = useState<PatientRow | null>(null);

  const [journals, setJournals] = useState<JournalPreview[]>([]);
  const [journals24h, setJournals24h] = useState<JournalPreview[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [appointmentAuditLogs, setAppointmentAuditLogs] = useState<AppointmentAuditRow[]>([]);
  const [medLogs, setMedLogs] = useState<MedicationLogRow[]>([]);
  const [meds, setMeds] = useState<MedicationRow[]>([]);
  const [reminderGroups, setReminderGroups] = useState<ReminderGroupRow[]>([]);
  const [reminderMembers, setReminderMembers] = useState<ReminderGroupMemberRow[]>([]);
  const [membersById, setMembersById] = useState<Record<string, MemberBasic>>({});
  const [notePlainById, setNotePlainById] = useState<Record<string, string>>({});

  const [dmStatus, setDmStatus] = useState<"ok" | "unavailable" | "loading">("loading");
  const [dmThreadCount, setDmThreadCount] = useState<number>(0);
  const [busyReminderId, setBusyReminderId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(Date.now());

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

      const { data: memberRows, error: memberErr } = await supabase.rpc("patient_members_basic_list", {
        pid: patientId,
      });

      if (!memberErr) {
        const map: Record<string, MemberBasic> = {};
        for (const r of (memberRows ?? []) as MemberBasic[]) {
          map[r.user_id] = r;
        }
        setMembersById(map);
      }

      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const startToday = startOfToday(now);
      const endToday = endOfToday(now);

      const { data: jToday, error: jTodayErr } = await supabase
        .from("journal_entries")
        .select("id, created_at, journal_type, shared_to_circle, created_by")
        .eq("patient_id", patientId)
        .gte("created_at", startToday.toISOString())
        .lte("created_at", endToday.toISOString())
        .order("created_at", { ascending: false })
        .limit(10);

      if (jTodayErr) throw jTodayErr;
      setJournals((jToday ?? []) as JournalPreview[]);

      const { data: j24, error: j24Err } = await supabase
        .from("journal_entries")
        .select("id, created_at, journal_type, shared_to_circle, created_by")
        .eq("patient_id", patientId)
        .gte("created_at", twentyFourHoursAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(50);

      if (j24Err) {
        setJournals24h([]);
      } else {
        setJournals24h((j24 ?? []) as JournalPreview[]);
      }

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

      try {
        const { data: aal, error: aalErr } = await supabase
          .from("appointment_audit_logs")
          .select("id, appointment_id, patient_id, changed_by, changed_at, action, field_name, old_value, new_value")
          .eq("patient_id", patientId)
          .gte("changed_at", twentyFourHoursAgo.toISOString())
          .order("changed_at", { ascending: false })
          .limit(100);

        if (aalErr) throw aalErr;
        setAppointmentAuditLogs((aal ?? []) as AppointmentAuditRow[]);
      } catch {
        setAppointmentAuditLogs([]);
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
        .select("id, created_at, status, medication_id, created_by, note_encrypted")
        .eq("patient_id", patientId)
        .gte("created_at", startToday.toISOString())
        .lte("created_at", endToday.toISOString())
        .order("created_at", { ascending: false })
        .limit(200);

      if (mlErr) throw mlErr;

      const todayLogs = (ml ?? []) as MedicationLogRow[];
      setMedLogs(todayLogs);

      if (vaultKey) {
        const missedWithNotes = todayLogs.filter((x) => x.status === "missed" && x.note_encrypted);
        if (missedWithNotes.length > 0) {
          const pairs = await Promise.all(
            missedWithNotes.map(async (row) => {
              try {
                const plain = await decryptStringWithLocalCache({
                  patientId,
                  table: "medication_logs",
                  rowId: row.id,
                  column: "note_encrypted",
                  env: row.note_encrypted as CipherEnvelopeV1,
                  vaultKey,
                });
                return [row.id, plain] as const;
              } catch {
                return null;
              }
            })
          );

          const additions: Record<string, string> = {};
          for (const pair of pairs) {
            if (pair) additions[pair[0]] = pair[1];
          }

          if (Object.keys(additions).length > 0) {
            setNotePlainById((prev) => ({ ...prev, ...additions }));
          }
        }
      }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTick(Date.now());
      load();
    }, 30000);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

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

  function whoLabel(userId: string | null, notePlain?: string) {
    if (isSystemNotesPlaintext(notePlain)) return t(languageCode, "today.system_notes");
    if (!userId) return t(languageCode, "today.unknown");
    const member = membersById[userId];
    return member?.nickname?.trim() || userId;
  }

  async function createLogsForMedicationIds(params: {
    medicationIds: string[];
    status: string;
    noteText?: string;
    systemNote?: boolean;
  }) {
    const medicationIds = Array.from(new Set(params.medicationIds)).filter(Boolean);
    if (medicationIds.length === 0) return;

    if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw authErr;
    const uid = auth.user?.id;
    if (!uid) throw new Error("not_authenticated");

    let noteEnv: CipherEnvelopeV1 | null = null;
    const noteText = params.noteText?.trim() ?? "";

    if (noteText) {
      if (!vaultKey) throw new Error("no_vault_share");
      noteEnv = await vaultEncryptString({
        vaultKey,
        plaintext: params.systemNote ? `${SYSTEM_NOTE_PREFIX} ${noteText}` : noteText,
        aad: { table: "medication_logs", column: "note_encrypted", patient_id: patientId },
      });
    }

    const rows = medicationIds.map((medicationId) => ({
      patient_id: patientId,
      medication_id: medicationId,
      status: params.status,
      created_by: uid,
      note_encrypted: noteEnv,
    }));

    const { error } = await supabase.from("medication_logs").insert(rows);
    if (error) throw error;
  }

  const reminderStates = useMemo<ReminderGroupState[]>(() => {
    const now = new Date(nowTick);
    const activeGroups = reminderGroups
      .filter((g) => g.active)
      .map((group) => {
        const dueAt = reminderTimeForToday(group.reminder_time, now);
        if (!dueAt) return null;
        return { group, dueAt };
      })
      .filter(Boolean) as { group: ReminderGroupRow; dueAt: Date }[];

    const sorted = activeGroups.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

    return sorted.map((entry, index) => {
      const nextDueToday = sorted[index + 1]?.dueAt ?? endOfToday(now);
      const medicationIds = reminderMembers
        .filter((m) => m.group_id === entry.group.id)
        .map((m) => m.medication_id);

      const relevantLogs = medLogs.filter((log) => {
        const created = new Date(log.created_at);
        return (
          medicationIds.includes(log.medication_id) &&
          sameDay(created, now) &&
          created.getTime() >= entry.dueAt.getTime() &&
          created.getTime() < nextDueToday.getTime()
        );
      });

      const takenMedicationIds = medicationIds.filter((mid) =>
        relevantLogs.some((log) => log.medication_id === mid && log.status === "taken")
      );

      const missedMedicationIds = medicationIds.filter((mid) =>
        relevantLogs.some((log) => log.medication_id === mid && log.status === "missed")
      );

      const completedMedicationIds = medicationIds.filter((mid) =>
        relevantLogs.some((log) => log.medication_id === mid)
      );

      const missingMedicationIds = medicationIds.filter((mid) => !completedMedicationIds.includes(mid));

      let state: ReminderGroupState["state"] = "upcoming";
      if (missingMedicationIds.length === 0 && medicationIds.length > 0) {
        state = missedMedicationIds.length > 0 ? "missed" : "taken";
      } else if (now.getTime() < entry.dueAt.getTime()) {
        state = "upcoming";
      } else if (now.getTime() >= nextDueToday.getTime()) {
        state = "missed";
      } else {
        state = "due";
      }

      return {
        group: entry.group,
        medicationIds,
        dueAt: entry.dueAt,
        closesAt: nextDueToday,
        state,
        missingMedicationIds,
        takenMedicationIds,
        missedMedicationIds,
      };
    });
  }, [medLogs, nowTick, reminderGroups, reminderMembers]);

  async function markReminderTaken(state: ReminderGroupState) {
    if (state.medicationIds.length === 0) return;

    setBusyReminderId(state.group.id);
    setMsg(null);

    try {
      const idsToLog =
        state.missingMedicationIds.length > 0 ? state.missingMedicationIds : state.medicationIds;

      await createLogsForMedicationIds({
        medicationIds: idsToLog,
        status: "taken",
      });

      await load();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_mark_reminder_taken");
    } finally {
      setBusyReminderId(null);
    }
  }

  const dueNowGroups = reminderStates.filter((g) => g.state === "due" || g.state === "missed");
  const laterTodayGroups = reminderStates.filter((g) => g.state === "upcoming");
  const completedGroups = reminderStates.filter((g) => g.state === "taken");

  const activityItems: ActivityItem[] = [
    ...journals24h.map((j) => ({
      id: `journal-${j.id}`,
      at: j.created_at,
      actorLabel: whoLabel(j.created_by),
      title: `${t(languageCode, "today.added_journal_entry")}: ${j.journal_type}`,
      detail: j.shared_to_circle ? t(languageCode, "today.shared") : t(languageCode, "today.private"),
      tone: "normal" as const,
    })),
    ...medLogs.map((log) => {
      const plain = notePlainById[log.id];
      const cleanNote = stripSystemPrefix(plain);
      return {
        id: `medlog-${log.id}`,
        at: log.created_at,
        actorLabel: whoLabel(log.created_by, plain),
        title: `${t(languageCode, "today.logged_medication_as")} ${medLabel(log.medication_id)}: ${medicationStatusLabelForUi(log.status, languageCode).toLowerCase()}`,
        detail: cleanNote || undefined,
        tone:
          log.status === "missed"
            ? ("danger" as const)
            : log.status === "taken"
            ? ("positive" as const)
            : ("normal" as const),
      };
    }),
    ...appointmentAuditLogs.map((log) => ({
      id: `apptaudit-${log.id}`,
      at: log.changed_at,
      actorLabel: whoLabel(log.changed_by),
      title:
        log.action === "insert"
          ? `${t(languageCode, "today.created")} ${fieldLabel(log.field_name)}`
          : log.action === "delete"
          ? t(languageCode, "today.deleted_appointment")
          : `${t(languageCode, "today.updated")} ${fieldLabel(log.field_name)}`,
      detail:
        log.action === "update"
          ? `${log.old_value ?? "—"} → ${log.new_value ?? "—"}`
          : log.action === "insert"
          ? log.new_value ?? undefined
          : log.old_value ?? undefined,
      tone: log.field_name === "status" && log.new_value === "cancelled" ? ("danger" as const) : ("normal" as const),
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 50);

  return (
    <MobileShell
      title={t(languageCode, "today.title")}
      subtitle={patient?.display_name ?? patientId}
      patientId={patientId}
      rightSlot={
        <Link className="cc-btn" href="/app/hub">
          {t(languageCode, "screen.hub")}
        </Link>
      }
    >
      {msg ? (
        <div className="cc-status cc-status-error">
          <div className="cc-status-error-title">{t(languageCode, "common.error")}</div>
          <div className="cc-wrap">{msg}</div>
        </div>
      ) : null}

      {!vaultKey ? (
        <div className="cc-status cc-status-loading">
          <div className="cc-strong">{t(languageCode, "today.secure_access_not_ready")}</div>
          <div className="cc-subtle">{t(languageCode, "today.secure_access_not_ready_subtitle")}</div>
        </div>
      ) : null}

      <div className="cc-grid-2-125">
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <h2 className="cc-h2">{t(languageCode, "today.messages")}</h2>
            <Link className="cc-btn" href={`/app/patients/${patientId}/dm`}>
              {t(languageCode, "today.open")}
            </Link>
          </div>
          <div className="cc-spacer-12" />
          {dmStatus === "loading" ? (
            <div className="cc-small">{t(languageCode, "today.checking")}</div>
          ) : dmStatus === "unavailable" ? (
            <div className="cc-small">{t(languageCode, "today.messages_unavailable")}</div>
          ) : dmThreadCount > 0 ? (
            <div className="cc-panel-blue">
              <div className="cc-strong">
                {dmThreadCount} {t(languageCode, "today.direct_message_threads")}
              </div>
              <div className="cc-small">{t(languageCode, "today.tap_to_view_messages")}</div>
            </div>
          ) : (
            <div className="cc-small">{t(languageCode, "today.no_message_threads")}</div>
          )}
        </div>

        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <h2 className="cc-h2">{t(languageCode, "today.next_24h_appointments")}</h2>
            <Link className="cc-btn" href={`/app/patients/${patientId}/appointments`}>
              {t(languageCode, "today.view")}
            </Link>
          </div>
          <div className="cc-spacer-12" />
          {appointments.length === 0 ? (
            <div className="cc-small">{t(languageCode, "today.none_next_24h")}</div>
          ) : (
            <div className="cc-stack">
              {appointments.slice(0, 3).map((a) => (
                <div key={a.id} className="cc-panel-soft">
                  <div className="cc-strong">{a.title ?? t(languageCode, "today.appointment")}</div>
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
            <h2 className="cc-h2">{t(languageCode, "today.journal_today")}</h2>
            <Link className="cc-btn cc-btn-primary" href={`/app/patients/${patientId}/journals`}>
              {t(languageCode, "today.open")}
            </Link>
          </div>
          <div className="cc-spacer-12" />
          {journals.length === 0 ? (
            <div className="cc-small">{t(languageCode, "today.no_journal_entries")}</div>
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
                      {j.shared_to_circle ? t(languageCode, "today.shared") : t(languageCode, "today.private")}
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
            <div className="cc-small">{t(languageCode, "today.no_medication_reminders")}</div>
          ) : (
            <div className="cc-stack">
              {dueNowGroups.length > 0 ? (
                <div className="cc-panel-soft" style={{ padding: 14, borderRadius: 18 }}>
                  <div className="cc-strong">{t(languageCode, "today.due_now")}</div>
                  <div className="cc-spacer-12" />
                  <div className="cc-stack">
                    {dueNowGroups.map((state) => {
                      const busy = busyReminderId === state.group.id;
                      const pillClass =
                        state.state === "missed" ? "cc-pill-danger" : "cc-pill-primary";

                      return (
                        <div
                          key={state.group.id}
                          className="cc-panel"
                          style={{
                            padding: 12,
                            border: state.state === "missed" ? "1px solid rgba(220, 38, 38, 0.18)" : undefined,
                          }}
                        >
                          <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 10 }}>
                            <div>
                              <div className="cc-strong">{state.group.name}</div>
                              <div className="cc-small cc-subtle">
                                {formatReminderDisplayTime(state.dueAt)} →{" "}
                                {state.closesAt.getHours() === 23 && state.closesAt.getMinutes() === 59
                                  ? t(languageCode, "today.midnight")
                                  : formatReminderDisplayTime(state.closesAt)}
                              </div>
                              <div className="cc-small cc-wrap" style={{ marginTop: 6 }}>
                                {state.medicationIds.map((id) => medLabel(id)).join(" - ") || t(languageCode, "today.no_medications")}
                              </div>
                              {state.state === "missed" && state.missingMedicationIds.length > 0 ? (
                                <div
                                  className="cc-small"
                                  style={{ marginTop: 8, color: "crimson", fontWeight: 800 }}
                                >
                                  {t(languageCode, "today.missed_prefix")}: {state.missingMedicationIds.map((id) => medLabel(id)).join(" - ")}
                                </div>
                              ) : null}
                            </div>

                            <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                              <span className={`cc-pill ${pillClass}`}>
                                {state.state === "missed" ? t(languageCode, "today.missed") : t(languageCode, "today.due")}
                              </span>
                              <button
                                className="cc-btn cc-btn-primary"
                                onClick={() => markReminderTaken(state)}
                                disabled={busy || state.state === "missed" || state.state === "taken"}
                              >
                                {busy ? t(languageCode, "today.saving") : t(languageCode, "today.taken")}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {laterTodayGroups.length > 0 ? (
                <div className="cc-panel-soft" style={{ padding: 14, borderRadius: 18 }}>
                  <div className="cc-strong">{t(languageCode, "today.later_today")}</div>
                  <div className="cc-spacer-12" />
                  <div className="cc-stack">
                    {laterTodayGroups.slice(0, 4).map((state) => (
                      <div key={state.group.id} className="cc-panel" style={{ padding: 12 }}>
                        <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 10 }}>
                          <div>
                            <div className="cc-strong">{state.group.name}</div>
                            <div className="cc-small cc-subtle">{formatReminderDisplayTime(state.dueAt)}</div>
                            <div className="cc-small cc-wrap" style={{ marginTop: 6 }}>
                              {state.medicationIds.map((id) => medLabel(id)).join(" - ") || t(languageCode, "today.no_medications")}
                            </div>
                          </div>
                          <span className="cc-pill">{formatReminderDisplayTime(state.dueAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {completedGroups.length > 0 ? (
                <div className="cc-panel-soft" style={{ padding: 14, borderRadius: 18 }}>
                  <div className="cc-strong">{t(languageCode, "today.completed_today")}</div>
                  <div className="cc-spacer-12" />
                  <div className="cc-stack">
                    {completedGroups.slice(0, 4).map((state) => (
                      <div key={state.group.id} className="cc-panel" style={{ padding: 12 }}>
                        <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 10 }}>
                          <div>
                            <div className="cc-strong">{state.group.name}</div>
                            <div className="cc-small cc-subtle">{formatReminderDisplayTime(state.dueAt)}</div>
                            <div className="cc-small cc-wrap" style={{ marginTop: 6 }}>
                              {state.medicationIds.map((id) => medLabel(id)).join(" - ") || t(languageCode, "today.no_medications")}
                            </div>
                          </div>
                          <span className="cc-pill cc-pill-primary">{t(languageCode, "today.taken")}</span>
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
          <h2 className="cc-h2">{t(languageCode, "today.activity_last_24h")}</h2>
          <button className="cc-btn" onClick={load} disabled={loading}>
            {loading ? t(languageCode, "common.loading") : t(languageCode, "common.refresh")}
          </button>
        </div>
        <div className="cc-spacer-12" />

        {activityItems.length === 0 ? (
          <div className="cc-small">{t(languageCode, "today.no_activity")}</div>
        ) : (
          <div className="cc-stack">
            {activityItems.map((item) => (
              <div
                key={item.id}
                className="cc-panel-soft"
                style={{
                  border: item.tone === "danger" ? "1px solid rgba(220, 38, 38, 0.18)" : undefined,
                }}
              >
                <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 12 }}>
                  <div className="cc-wrap" style={{ flex: 1 }}>
                    <div className="cc-strong">{item.title}</div>
                    {item.detail ? (
                      <div className="cc-small cc-subtle" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                        {item.detail}
                      </div>
                    ) : null}
                    <div className="cc-small cc-subtle" style={{ marginTop: 8 }}>
                      <b>{item.actorLabel}</b> • {new Date(item.at).toLocaleString()}
                    </div>
                  </div>
                  {item.tone === "positive" ? (
                    <span className="cc-pill cc-pill-primary">{t(languageCode, "today.done")}</span>
                  ) : item.tone === "danger" ? (
                    <span className="cc-pill cc-pill-danger">{t(languageCode, "today.attention")}</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </MobileShell>
  );
}

