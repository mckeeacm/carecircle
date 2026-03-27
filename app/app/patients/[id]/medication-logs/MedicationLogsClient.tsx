"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";
import MobileShell from "@/app/components/MobileShell";
import { useUserLanguage } from "@/app/components/UserLanguageProvider";

type MedicationRow = {
  id: string;
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
  created_by: string;
  created_at: string;
};

type MemberBasic = {
  user_id: string;
  nickname: string | null;
  role: string | null;
  is_controller: boolean | null;
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

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

const STATUS_OPTIONS = [
  { value: "taken", label: "Taken" },
  { value: "missed", label: "Missed" },
  { value: "refused", label: "Refused" },
  { value: "delayed", label: "Delayed" },
] as const;

const REMINDER_CHANNEL_ID = "medication-reminders";
const SYSTEM_NOTE_PREFIX = "__SYSTEM_NOTES__:";

function reminderStorageKey(patientId: string) {
  return `carecircle:android-med-reminder-ids:${patientId}`;
}

function readScheduledReminderIds(patientId: string): number[] {
  try {
    const raw = localStorage.getItem(reminderStorageKey(patientId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => Number.isInteger(x));
  } catch {
    return [];
  }
}

function writeScheduledReminderIds(patientId: string, ids: number[]) {
  try {
    localStorage.setItem(reminderStorageKey(patientId), JSON.stringify(ids));
  } catch {}
}

function hashToPositiveInt(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function reminderNotificationId(groupId: string) {
  return 100000000 + (hashToPositiveInt(`medication-reminder:${groupId}`) % 900000000);
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

export default function MedicationLogsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();
  const { languageCode } = useUserLanguage();

  const [meds, setMeds] = useState<MedicationRow[]>([]);
  const [logs, setLogs] = useState<MedicationLogRow[]>([]);
  const [membersById, setMembersById] = useState<Record<string, MemberBasic>>({});
  const [notePlainById, setNotePlainById] = useState<Record<string, string>>({});

  const [reminderGroups, setReminderGroups] = useState<ReminderGroupRow[]>([]);
  const [reminderMembers, setReminderMembers] = useState<ReminderGroupMemberRow[]>([]);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingReminder, setSavingReminder] = useState(false);
  const [busyReminderId, setBusyReminderId] = useState<string | null>(null);

  const [selectedMedicationIds, setSelectedMedicationIds] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("taken");
  const [note, setNote] = useState<string>("");

  const [reminderName, setReminderName] = useState<string>("");
  const [reminderTime, setReminderTime] = useState<string>("20:00");
  const [selectedReminderMedIds, setSelectedReminderMedIds] = useState<string[]>([]);
  const [nowTick, setNowTick] = useState<number>(Date.now());

  function medLabelFrom(list: MedicationRow[], id: string) {
    const m = list.find((x) => x.id === id);
    if (!m) return id;
    return `${m.name}${m.dosage ? ` (${m.dosage})` : ""}`;
  }

  async function syncNativeReminderNotifications(
    groups: ReminderGroupRow[],
    members: ReminderGroupMemberRow[],
    medications: MedicationRow[]
  ) {
    if (Capacitor.getPlatform() !== "android") return;

    try {
      const previouslyScheduledIds = readScheduledReminderIds(patientId);

      if (previouslyScheduledIds.length > 0) {
        await LocalNotifications.cancel({
          notifications: previouslyScheduledIds.map((id) => ({ id })),
        });
      }

      await LocalNotifications.createChannel({
        id: REMINDER_CHANNEL_ID,
        name: "Medication reminders",
        description: "Daily medication reminder alarms",
        importance: 5,
        visibility: 1,
      });

      let permissions = await LocalNotifications.checkPermissions();
      if (permissions.display !== "granted") {
        permissions = await LocalNotifications.requestPermissions();
      }

      if (permissions.display !== "granted") {
        writeScheduledReminderIds(patientId, []);
        return;
      }

      const notifications = groups
        .filter((group) => group.active)
        .flatMap((group) => {
          const parsedTime = parseReminderTime(group.reminder_time);
          if (!parsedTime) return [];

          const groupMedicationLabels = members
            .filter((m) => m.group_id === group.id)
            .map((m) => medLabelFrom(medications, m.medication_id));

          const body =
            groupMedicationLabels.length > 0
              ? `Time for: ${groupMedicationLabels.join(", ")}`
              : "Time to take your medication.";

          return [
            {
              id: reminderNotificationId(group.id),
              title: group.name?.trim() || "Medication reminder",
              body,
              channelId: REMINDER_CHANNEL_ID,
              smallIcon: "ic_launcher",
              schedule: {
                on: {
                  hour: parsedTime.hour,
                  minute: parsedTime.minute,
                },
                allowWhileIdle: true,
              },
              extra: {
                type: "medication_reminder_group",
                patientId,
                groupId: group.id,
                url: `/app/patients/${patientId}/today`,
              },
            },
          ];
        });

      if (notifications.length === 0) {
        writeScheduledReminderIds(patientId, []);
        return;
      }

      await LocalNotifications.schedule({ notifications });
      writeScheduledReminderIds(
        patientId,
        notifications.map((n) => n.id)
      );
    } catch (err) {
      console.error("Failed to sync native medication reminders", err);
    }
  }

  async function refresh() {
    setLoading(true);
    setMsg(null);

    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      const { data: memberRows, error: memberErr } = await supabase.rpc("patient_members_basic_list", {
        pid: patientId,
      });

      if (!memberErr) {
        const map: Record<string, MemberBasic> = {};
        for (const r of (memberRows ?? []) as MemberBasic[]) map[r.user_id] = r;
        setMembersById(map);
      }

      const { data: m, error: mErr } = await supabase
        .from("medications")
        .select("id, name, dosage, schedule_text, active")
        .eq("patient_id", patientId)
        .eq("active", true)
        .order("created_at", { ascending: false });

      if (mErr) throw mErr;
      const medsList = (m ?? []) as MedicationRow[];
      setMeds(medsList);

      if (selectedMedicationIds.length === 0 && medsList[0]?.id) {
        setSelectedMedicationIds([medsList[0].id]);
      } else {
        setSelectedMedicationIds((prev) => prev.filter((id) => medsList.some((m) => m.id === id)));
      }

      const todayStart = startOfToday(new Date()).toISOString();

      const { data: l, error: lErr } = await supabase
        .from("medication_logs")
        .select("id, patient_id, medication_id, status, note_encrypted, created_by, created_at")
        .eq("patient_id", patientId)
        .gte("created_at", todayStart)
        .order("created_at", { ascending: false })
        .limit(200);

      if (lErr) throw lErr;
      const loadedLogs = (l ?? []) as MedicationLogRow[];
      setLogs(loadedLogs);

      const { data: rg, error: rgErr } = await supabase
        .from("medication_reminder_groups")
        .select("id, patient_id, name, reminder_time, active, created_by, created_at, updated_at")
        .eq("patient_id", patientId)
        .order("reminder_time", { ascending: true })
        .order("created_at", { ascending: true });

      if (rgErr) throw rgErr;

      const groups = (rg ?? []) as ReminderGroupRow[];
      setReminderGroups(groups);

      const groupIds = groups.map((g) => g.id);

      if (groupIds.length === 0) {
        setReminderMembers([]);
        await syncNativeReminderNotifications(groups, [], medsList);
      } else {
        const { data: rm, error: rmErr } = await supabase
          .from("medication_reminder_group_members")
          .select("group_id, medication_id")
          .in("group_id", groupIds);

        if (rmErr) throw rmErr;

        const memberList = (rm ?? []) as ReminderGroupMemberRow[];
        setReminderMembers(memberList);
        await syncNativeReminderNotifications(groups, memberList, medsList);
      }

      if (vaultKey) {
        const missedWithNotes = loadedLogs.filter((x) => x.status === "missed" && x.note_encrypted);
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
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_medication_logs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTick(Date.now());
    }, 30000);

    return () => window.clearInterval(id);
  }, []);

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

  async function createLog() {
    if (!vaultKey) return setMsg("no_vault_share");
    if (selectedMedicationIds.length === 0) return setMsg("select_medication");

    setSaving(true);
    setMsg(null);

    try {
      await createLogsForMedicationIds({
        medicationIds: selectedMedicationIds,
        status,
        noteText: note,
      });

      setNote("");
      setStatus("taken");
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_medication_log");
    } finally {
      setSaving(false);
    }
  }

  async function createReminderGroup() {
    if (!patientId || !isUuid(patientId)) return setMsg(`invalid patientId: ${String(patientId)}`);
    if (selectedReminderMedIds.length === 0) return setMsg("select_at_least_one_medication_for_reminder");
    if (!reminderTime) return setMsg("reminder_time_required");

    setSavingReminder(true);
    setMsg(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const uid = auth.user?.id;
      if (!uid) throw new Error("not_authenticated");

      const fallbackName =
        selectedReminderMedIds.length === 1 ? medLabel(selectedReminderMedIds[0]) : "Medication group";

      const { data: insertedGroup, error: groupErr } = await supabase
        .from("medication_reminder_groups")
        .insert({
          patient_id: patientId,
          name: reminderName.trim() || fallbackName,
          reminder_time: reminderTime,
          active: true,
          created_by: uid,
        })
        .select("id, patient_id, name, reminder_time, active, created_by, created_at, updated_at")
        .single();

      if (groupErr) throw groupErr;

      const groupId = (insertedGroup as ReminderGroupRow).id;

      const memberRows = selectedReminderMedIds.map((mid) => ({
        group_id: groupId,
        medication_id: mid,
      }));

      const { error: memberErr } = await supabase
        .from("medication_reminder_group_members")
        .insert(memberRows);

      if (memberErr) throw memberErr;

      setReminderName("");
      setReminderTime("20:00");
      setSelectedReminderMedIds([]);
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_medication_reminder_group");
    } finally {
      setSavingReminder(false);
    }
  }

  async function toggleReminderActive(group: ReminderGroupRow) {
    setBusyReminderId(group.id);
    setMsg(null);

    try {
      const { error } = await supabase
        .from("medication_reminder_groups")
        .update({ active: !group.active })
        .eq("id", group.id)
        .eq("patient_id", patientId);

      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_toggle_reminder_group");
    } finally {
      setBusyReminderId(null);
    }
  }

  async function deleteReminderGroup(groupId: string) {
    setBusyReminderId(groupId);
    setMsg(null);

    try {
      const { error } = await supabase
        .from("medication_reminder_groups")
        .delete()
        .eq("id", groupId)
        .eq("patient_id", patientId);

      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_delete_reminder_group");
    } finally {
      setBusyReminderId(null);
    }
  }

  async function decryptLog(l: MedicationLogRow) {
    if (!vaultKey || !l.note_encrypted) return;
    if (notePlainById[l.id] != null) return;

    const plain = await decryptStringWithLocalCache({
      patientId,
      table: "medication_logs",
      rowId: l.id,
      column: "note_encrypted",
      env: l.note_encrypted,
      vaultKey,
    });

    setNotePlainById((prev) => ({ ...prev, [l.id]: plain }));
  }

  function whoLabel(createdBy: string, plainNote?: string) {
    if (isSystemNotesPlaintext(plainNote)) return "System notes";
    const m = membersById[createdBy];
    if (!m) return createdBy;
    return m.nickname?.trim() || createdBy;
  }

  function medLabel(id: string) {
    const m = meds.find((x) => x.id === id);
    if (!m) return id;
    return `${m.name}${m.dosage ? ` (${m.dosage})` : ""}`;
  }

  function medSchedule(id: string) {
    const m = meds.find((x) => x.id === id);
    return m?.schedule_text?.trim() || "";
  }

  function statusLabel(value: string | null) {
    return STATUS_OPTIONS.find((s) => s.value === value)?.label ?? value ?? "—";
  }

  function statusClass(value: string | null) {
    if (value === "taken") return "cc-pill-primary";
    if (value === "missed") return "cc-pill-danger";
    return "";
  }

  function formatReminderTime(value: string) {
    const raw = value.includes(":") ? value.slice(0, 5) : value;
    return raw || value;
  }

  function reminderGroupMedicationLabels(groupId: string) {
    return reminderMembers
      .filter((m) => m.group_id === groupId)
      .map((m) => medLabel(m.medication_id));
  }

  function toggleReminderMedication(mid: string) {
    setSelectedReminderMedIds((prev) =>
      prev.includes(mid) ? prev.filter((x) => x !== mid) : [...prev, mid]
    );
  }

  function toggleQuickMedication(mid: string) {
    setSelectedMedicationIds((prev) =>
      prev.includes(mid) ? prev.filter((x) => x !== mid) : [...prev, mid]
    );
  }

  const selectedMedicationNames = meds
    .filter((m) => selectedMedicationIds.includes(m.id))
    .map((m) => m.name);

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

      const relevantLogs = logs.filter((log) => {
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
  }, [logs, nowTick, reminderGroups, reminderMembers]);

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

      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_mark_reminder_taken");
    } finally {
      setBusyReminderId(null);
    }
  }

  const selectedMedicationSubtitle =
    selectedMedicationNames.length === 0
      ? "Track medication activity"
      : selectedMedicationNames.length === 1
      ? selectedMedicationNames[0]
      : `${selectedMedicationNames.length} medications selected`;

  const ui =
    languageCode === "it"
      ? {
          title: "Registri farmaci",
          subtitle: "Monitora l'attivita dei farmaci",
          medicationsSelected: "farmaci selezionati",
          today: "Oggi",
          error: "Errore",
          secureTitle: "L'accesso sicuro non e pronto su questo dispositivo",
          secureSubtitle: "Le note protette saranno disponibili quando questo dispositivo avra completato la configurazione sicura.",
          quickLog: "Registrazione rapida",
          quickLogSubtitle: "Tocca uno o piu farmaci, scegli uno stato e salva.",
          loading: "Caricamento...",
          refresh: "Aggiorna",
          noActiveMeds: "Nessun farmaco attivo",
          noActiveMedsSubtitle: "Non ci sono ancora farmaci attivi da registrare.",
          medication: "Farmaco",
          status: "Stato",
          note: "Nota (protetta, facoltativa)",
          optionalNote: "Nota facoltativa...",
          saveLog: "Salva registro",
          saving: "Salvataggio...",
        }
      : {
          title: "Medication logs",
          subtitle: "Track medication activity",
          medicationsSelected: "medications selected",
          today: "Today",
          error: "Error",
          secureTitle: "Secure access is not ready on this device",
          secureSubtitle: "Protected notes will become available once this device finishes secure setup.",
          quickLog: "Quick log",
          quickLogSubtitle: "Tap one or more medications, choose a status, and save.",
          loading: "Loading...",
          refresh: "Refresh",
          noActiveMeds: "No active medications",
          noActiveMedsSubtitle: "There are no active medications to log yet.",
          medication: "Medication",
          status: "Status",
          note: "Note (encrypted, optional)",
          optionalNote: "Optional note...",
          saveLog: "Save log",
          saving: "Saving...",
        };

  return (
    <MobileShell
      title={ui.title}
      subtitle={
        selectedMedicationNames.length === 0
          ? ui.subtitle
          : selectedMedicationNames.length === 1
          ? selectedMedicationNames[0]
          : `${selectedMedicationNames.length} ${ui.medicationsSelected}`
      }
      patientId={patientId}
      rightSlot={
        <Link className="cc-btn" href={`/app/patients/${patientId}/today`}>
          {ui.today}
        </Link>
      }
    >
      {msg ? (
        <div className="cc-status cc-status-error">
          <div className="cc-status-error-title">{ui.error}</div>
          <div className="cc-wrap">{msg}</div>
        </div>
      ) : null}

      {!vaultKey ? (
        <div className="cc-status cc-status-loading">
          <div className="cc-strong">{ui.secureTitle}</div>
          <div className="cc-subtle">{ui.secureSubtitle}</div>
        </div>
      ) : null}

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">{ui.quickLog}</h2>
            <div className="cc-subtle">{ui.quickLogSubtitle}</div>
          </div>

          <button className="cc-btn" onClick={refresh} disabled={loading}>
            {loading ? ui.loading : ui.refresh}
          </button>
        </div>

        {meds.length === 0 ? (
          <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
            <div className="cc-strong">{ui.noActiveMeds}</div>
            <div className="cc-small cc-subtle">{ui.noActiveMedsSubtitle}</div>
          </div>
        ) : (
          <>
            <div className="cc-field">
              <div className="cc-label">{ui.medication}</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 10,
                }}
              >
                {meds.map((m) => {
                  const selected = selectedMedicationIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`cc-btn ${selected ? "cc-btn-primary" : ""}`}
                      onClick={() => toggleQuickMedication(m.id)}
                      style={{
                        minHeight: 64,
                        justifyContent: "flex-start",
                        textAlign: "left",
                        display: "block",
                      }}
                    >
                      <div className="cc-strong">
                        {m.name}
                        {m.dosage ? <span className="cc-subtle"> ({m.dosage})</span> : null}
                      </div>
                      {m.schedule_text ? (
                        <div className="cc-small" style={{ marginTop: 4 }}>
                          {m.schedule_text}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="cc-field">
              <div className="cc-label">{ui.status}</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 10,
                }}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`cc-btn ${status === opt.value ? "cc-btn-primary" : ""}`}
                    onClick={() => setStatus(opt.value)}
                    style={{
                      minHeight: 46,
                      justifyContent: "center",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="cc-field">
              <div className="cc-label">{ui.note}</div>
              <textarea
                className="cc-textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={ui.optionalNote}
                disabled={!vaultKey}
              />
            </div>

            <div className="cc-row">
              <button
                className="cc-btn cc-btn-primary"
                onClick={createLog}
                disabled={!vaultKey || saving || selectedMedicationIds.length === 0}
              >
                {saving ? ui.saving : ui.saveLog}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="cc-card cc-card-pad cc-stack">
        <div>
          <h2 className="cc-h2">Medication reminders</h2>
          <div className="cc-subtle">
            Create reminders for one medication or a group, such as Evening meds.
          </div>
          <div className="cc-small cc-subtle" style={{ marginTop: 6 }}>
            On Android app builds, active reminders are also scheduled as device notifications.
          </div>
        </div>

        {reminderStates.length > 0 ? (
          <div className="cc-stack">
            <div className="cc-strong">Today’s reminder status</div>

            {reminderStates.map((state) => {
              const busy = busyReminderId === state.group.id;
              const statePillClass =
                state.state === "taken"
                  ? "cc-pill-primary"
                  : state.state === "missed"
                  ? "cc-pill-danger"
                  : "";

              return (
                <div
                  key={`state-${state.group.id}`}
                  className="cc-panel-soft"
                  style={{
                    padding: 16,
                    borderRadius: 20,
                    border:
                      state.state === "missed"
                        ? "1px solid rgba(220, 38, 38, 0.18)"
                        : undefined,
                  }}
                >
                  <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 12 }}>
                    <div className="cc-wrap" style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          alignItems: "center",
                          marginBottom: 6,
                        }}
                      >
                        <span className={`cc-pill ${statePillClass}`}>
                          {state.state === "upcoming"
                            ? "Upcoming"
                            : state.state === "due"
                            ? "Due now"
                            : state.state === "taken"
                            ? "Taken"
                            : "Missed"}
                        </span>
                        <span className="cc-small cc-subtle">
                          {formatReminderDisplayTime(state.dueAt)} →{" "}
                          {state.closesAt.getHours() === 23 && state.closesAt.getMinutes() === 59
                            ? "Midnight"
                            : formatReminderDisplayTime(state.closesAt)}
                        </span>
                      </div>

                      <div className="cc-strong">{state.group.name}</div>

                      <div className="cc-small cc-subtle" style={{ marginTop: 6 }}>
                        {state.medicationIds.map((id) => medLabel(id)).join(" • ") || "No medications"}
                      </div>

                      {state.state === "missed" && state.missingMedicationIds.length > 0 ? (
                        <div
                          className="cc-small"
                          style={{ marginTop: 8, color: "crimson", fontWeight: 800 }}
                        >
                          Missed: {state.missingMedicationIds.map((id) => medLabel(id)).join(" • ")}
                        </div>
                      ) : null}
                    </div>

                    <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        className="cc-btn cc-btn-primary"
                        onClick={() => markReminderTaken(state)}
                        disabled={
                          busy ||
                          state.medicationIds.length === 0 ||
                          state.state === "missed" ||
                          state.state === "taken"
                        }
                      >
                        {busy ? "Saving…" : state.state === "taken" ? "Taken" : "Taken"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="cc-panel-soft cc-stack" style={{ padding: 16, borderRadius: 20 }}>
          <div className="cc-strong">New reminder</div>

          <div className="cc-grid-2">
            <div className="cc-field">
              <div className="cc-label">Reminder name</div>
              <input
                className="cc-input"
                value={reminderName}
                onChange={(e) => setReminderName(e.target.value)}
                placeholder="e.g. Evening meds"
              />
            </div>

            <div className="cc-field">
              <div className="cc-label">Time</div>
              <input
                className="cc-input"
                type="time"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
              />
            </div>
          </div>

          <div className="cc-field">
            <div className="cc-label">Included medications</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
              }}
            >
              {meds.map((m) => {
                const selected = selectedReminderMedIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`cc-btn ${selected ? "cc-btn-primary" : ""}`}
                    onClick={() => toggleReminderMedication(m.id)}
                    style={{
                      minHeight: 56,
                      justifyContent: "flex-start",
                      textAlign: "left",
                      display: "block",
                    }}
                  >
                    <div className="cc-strong">
                      {m.name}
                      {m.dosage ? <span className="cc-subtle"> ({m.dosage})</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="cc-row">
            <button
              className="cc-btn cc-btn-primary"
              onClick={createReminderGroup}
              disabled={savingReminder || selectedReminderMedIds.length === 0}
            >
              {savingReminder ? "Saving…" : "Save reminder"}
            </button>
          </div>

          <div className="cc-small cc-subtle">
            This stores reminder schedules and syncs them to Android notifications when available.
          </div>
        </div>

        {reminderGroups.length === 0 ? (
          <div className="cc-small">No reminders yet.</div>
        ) : (
          <div className="cc-stack">
            {reminderGroups.map((group) => {
              const groupMeds = reminderGroupMedicationLabels(group.id);
              const busy = busyReminderId === group.id;

              return (
                <div key={group.id} className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
                  <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 12 }}>
                    <div className="cc-wrap" style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          alignItems: "center",
                          marginBottom: 6,
                        }}
                      >
                        <span className={`cc-pill ${group.active ? "cc-pill-primary" : ""}`}>
                          {group.active ? "Active" : "Paused"}
                        </span>
                        <span className="cc-small cc-subtle">{formatReminderTime(group.reminder_time)}</span>
                      </div>

                      <div className="cc-strong">{group.name}</div>

                      <div className="cc-small cc-subtle" style={{ marginTop: 6 }}>
                        {groupMeds.length > 0 ? groupMeds.join(" • ") : "No medications"}
                      </div>
                    </div>

                    <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button className="cc-btn" onClick={() => toggleReminderActive(group)} disabled={busy}>
                        {busy ? "…" : group.active ? "Pause" : "Activate"}
                      </button>
                      <button
                        className="cc-btn cc-btn-danger"
                        onClick={() => deleteReminderGroup(group.id)}
                        disabled={busy}
                      >
                        {busy ? "…" : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">Recent logs</h2>
            <div className="cc-subtle">Latest medication activity for this circle.</div>
          </div>
        </div>

        {logs.length === 0 ? (
          <div className="cc-small">No logs yet.</div>
        ) : (
          <div className="cc-stack">
            {logs.map((l) => {
              const plain = notePlainById[l.id];
              const hasNote = !!l.note_encrypted;
              const displayNote = stripSystemPrefix(plain);

              return (
                <div
                  key={l.id}
                  className="cc-panel-soft"
                  style={{
                    padding: 14,
                    borderRadius: 18,
                    border: l.status === "missed" ? "1px solid rgba(220, 38, 38, 0.18)" : undefined,
                  }}
                >
                  <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 12 }}>
                    <div className="cc-wrap" style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          alignItems: "center",
                          marginBottom: 6,
                        }}
                      >
                        <span className={`cc-pill ${statusClass(l.status)}`}>{statusLabel(l.status)}</span>
                        <span className="cc-small cc-subtle">{new Date(l.created_at).toLocaleString()}</span>
                      </div>

                      <div className="cc-strong">{medLabel(l.medication_id)}</div>

                      {medSchedule(l.medication_id) ? (
                        <div className="cc-small cc-subtle" style={{ marginTop: 4 }}>
                          {medSchedule(l.medication_id)}
                        </div>
                      ) : null}

                      <div className="cc-small cc-subtle" style={{ marginTop: 8 }}>
                        Logged by <b>{whoLabel(l.created_by, plain)}</b>
                      </div>
                    </div>

                    <button
                      className="cc-btn"
                      onClick={() => decryptLog(l)}
                      disabled={!vaultKey || !!plain || !hasNote}
                    >
                      {plain ? "Decrypted" : hasNote ? "Decrypt note" : "No note"}
                    </button>
                  </div>

                  {plain ? (
                    <div className="cc-spacer-12">
                      <div
                        className="cc-panel"
                        style={{
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {displayNote || "—"}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </MobileShell>
  );
}

