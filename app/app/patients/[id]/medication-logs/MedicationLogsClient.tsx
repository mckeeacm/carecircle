"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";
import MobileShell from "@/app/components/MobileShell";

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

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

const STATUS_OPTIONS = [
  { value: "taken", label: "Taken" },
  { value: "missed", label: "Missed" },
  { value: "refused", label: "Refused" },
  { value: "delayed", label: "Delayed" },
] as const;

export default function MedicationLogsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

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

  const [medicationId, setMedicationId] = useState<string>("");
  const [status, setStatus] = useState<string>("taken");
  const [note, setNote] = useState<string>("");

  const [reminderName, setReminderName] = useState<string>("");
  const [reminderTime, setReminderTime] = useState<string>("20:00");
  const [selectedReminderMedIds, setSelectedReminderMedIds] = useState<string[]>([]);

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

      if (!medicationId && medsList[0]?.id) {
        setMedicationId(medsList[0].id);
      }

      const { data: l, error: lErr } = await supabase
        .from("medication_logs")
        .select("id, patient_id, medication_id, status, note_encrypted, created_by, created_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (lErr) throw lErr;
      setLogs((l ?? []) as MedicationLogRow[]);

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
      } else {
        const { data: rm, error: rmErr } = await supabase
          .from("medication_reminder_group_members")
          .select("group_id, medication_id")
          .in("group_id", groupIds);

        if (rmErr) throw rmErr;
        setReminderMembers((rm ?? []) as ReminderGroupMemberRow[]);
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

  async function createLog() {
    if (!vaultKey) return setMsg("no_vault_share");
    if (!medicationId) return setMsg("select_medication");

    setSaving(true);
    setMsg(null);

    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const uid = auth.user?.id;
      if (!uid) throw new Error("not_authenticated");

      let noteEnv: CipherEnvelopeV1 | null = null;
      if (note.trim()) {
        noteEnv = await vaultEncryptString({
          vaultKey,
          plaintext: note,
          aad: { table: "medication_logs", column: "note_encrypted", patient_id: patientId },
        });
      }

      const { error } = await supabase.from("medication_logs").insert({
        patient_id: patientId,
        medication_id: medicationId,
        status,
        created_by: uid,
        note_encrypted: noteEnv,
      });

      if (error) throw error;

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
        selectedReminderMedIds.length === 1
          ? medLabel(selectedReminderMedIds[0])
          : "Medication group";

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

  function whoLabel(createdBy: string) {
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

  const selectedMedication = meds.find((m) => m.id === medicationId) ?? null;

  return (
    <MobileShell
      title="Medication logs"
      subtitle={selectedMedication ? selectedMedication.name : "Track medication activity"}
      patientId={patientId}
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

      {!vaultKey ? (
        <div className="cc-status cc-status-loading">
          <div className="cc-strong">Vault key not available on this device</div>
          <div className="cc-subtle">You can’t decrypt or save encrypted notes.</div>
        </div>
      ) : null}

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">Quick log</h2>
            <div className="cc-subtle">Tap a medication, choose a status, and save.</div>
          </div>

          <button className="cc-btn" onClick={refresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {meds.length === 0 ? (
          <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
            <div className="cc-strong">No active medications</div>
            <div className="cc-small cc-subtle">There are no active medications to log yet.</div>
          </div>
        ) : (
          <>
            <div className="cc-field">
              <div className="cc-label">Medication</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 10,
                }}
              >
                {meds.map((m) => {
                  const selected = medicationId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`cc-btn ${selected ? "cc-btn-primary" : ""}`}
                      onClick={() => setMedicationId(m.id)}
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

            {selectedMedication ? (
              <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
                <div className="cc-strong">
                  {selectedMedication.name}
                  {selectedMedication.dosage ? (
                    <span className="cc-subtle"> ({selectedMedication.dosage})</span>
                  ) : null}
                </div>
                {selectedMedication.schedule_text ? (
                  <div className="cc-small cc-subtle" style={{ marginTop: 4 }}>
                    {selectedMedication.schedule_text}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="cc-field">
              <div className="cc-label">Status</div>
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
              <div className="cc-label">Note (encrypted, optional)</div>
              <textarea
                className="cc-textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note…"
                disabled={!vaultKey}
              />
            </div>

            <div className="cc-row">
              <button
                className="cc-btn cc-btn-primary"
                onClick={createLog}
                disabled={!vaultKey || saving || !medicationId}
              >
                {saving ? "Saving…" : "Save log"}
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
        </div>

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
            This saves reminder schedules in the app. Actual device notifications need a follow-on notification layer.
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
                      <button className="cc-btn cc-btn-danger" onClick={() => deleteReminderGroup(group.id)} disabled={busy}>
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

              return (
                <div
                  key={l.id}
                  className="cc-panel-soft"
                  style={{
                    padding: 14,
                    borderRadius: 18,
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
                        Logged by <b>{whoLabel(l.created_by)}</b>
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
                        {plain || "—"}
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