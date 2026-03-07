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

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [medicationId, setMedicationId] = useState<string>("");
  const [status, setStatus] = useState<string>("taken");
  const [note, setNote] = useState<string>("");

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
      if (!medicationId && medsList[0]?.id) setMedicationId(medsList[0].id);

      const { data: l, error: lErr } = await supabase
        .from("medication_logs")
        .select("id, patient_id, medication_id, status, note_encrypted, created_by, created_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (lErr) throw lErr;
      setLogs((l ?? []) as MedicationLogRow[]);
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

      const noteEnv = await vaultEncryptString({
        vaultKey,
        plaintext: note,
        aad: { table: "medication_logs", column: "note_encrypted", patient_id: patientId },
      });

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
    if (value === "missed" || value === "refused") return "";
    if (value === "delayed") return "";
    return "";
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
            <h2 className="cc-h2">New medication log</h2>
            <div className="cc-subtle">Quick, mobile-friendly logging for the active medication list.</div>
          </div>

          <button className="cc-btn" onClick={refresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {meds.length === 0 ? (
          <div className="cc-panel-soft">
            <div className="cc-strong">No active medications</div>
            <div className="cc-small cc-subtle">There are no active medications to log yet.</div>
          </div>
        ) : (
          <>
            <div className="cc-field">
              <div className="cc-label">Medication</div>
              <select className="cc-select" value={medicationId} onChange={(e) => setMedicationId(e.target.value)}>
                <option value="" disabled>
                  Select…
                </option>
                {meds.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.dosage ? ` (${m.dosage})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {selectedMedication ? (
              <div className="cc-panel-soft">
                <div className="cc-strong">
                  {selectedMedication.name}
                  {selectedMedication.dosage ? (
                    <span className="cc-subtle"> ({selectedMedication.dosage})</span>
                  ) : null}
                </div>
                {selectedMedication.schedule_text ? (
                  <div className="cc-small cc-subtle">{selectedMedication.schedule_text}</div>
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
              <div className="cc-label">Note (encrypted)</div>
              <textarea
                className="cc-textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note…"
                disabled={!vaultKey}
              />
            </div>

            <div className="cc-row">
              <button className="cc-btn cc-btn-primary" onClick={createLog} disabled={!vaultKey || saving || !medicationId}>
                {saving ? "Saving…" : "Save log"}
              </button>
            </div>
          </>
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