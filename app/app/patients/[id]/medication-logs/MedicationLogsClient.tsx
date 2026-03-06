"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

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

  function medLabel(medicationId: string) {
    const m = meds.find((x) => x.id === medicationId);
    if (!m) return medicationId;
    return `${m.name}${m.dosage ? ` (${m.dosage})` : ""}`;
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Medication logs</h1>
            <div className="cc-subtle cc-wrap">{patientId}</div>
          </div>
          <div className="cc-row">
            <Link className="cc-btn" href={`/app/patients/${patientId}/today`}>
              Today
            </Link>
            <Link className="cc-btn" href="/app/hub">
              Hub
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
            <div className="cc-subtle">You can’t decrypt or save encrypted notes.</div>
          </div>
        ) : null}

        <div className="cc-card cc-card-pad cc-stack">
          <h2 className="cc-h2">New log</h2>

          <div className="cc-row">
            <div className="cc-field" style={{ minWidth: 280 }}>
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

            <div className="cc-field" style={{ minWidth: 220 }}>
              <div className="cc-label">Status</div>
              <select className="cc-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="taken">taken</option>
                <option value="missed">missed</option>
                <option value="refused">refused</option>
                <option value="delayed">delayed</option>
              </select>
            </div>
          </div>

          <div className="cc-field">
            <div className="cc-label">Note (E2EE)</div>
            <textarea
              className="cc-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Encrypted note…"
              disabled={!vaultKey}
            />
          </div>

          <div className="cc-row">
            <button className="cc-btn cc-btn-primary" onClick={createLog} disabled={!vaultKey || saving || !medicationId}>
              {saving ? "Saving…" : "Save log"}
            </button>
          </div>
        </div>

        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <h2 className="cc-h2">Recent logs</h2>
            <button className="cc-btn" onClick={refresh} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <div className="cc-spacer-12" />

          {logs.length === 0 ? (
            <div className="cc-small">No logs yet.</div>
          ) : (
            <div className="cc-stack">
              {logs.map((l) => {
                const plain = notePlainById[l.id];
                return (
                  <div key={l.id} className="cc-panel-soft">
                    <div className="cc-row-between">
                      <div className="cc-wrap">
                        <div className="cc-strong">{l.status ?? "—"}</div>
                        <div className="cc-small">{new Date(l.created_at).toLocaleString()}</div>
                        <div className="cc-small cc-wrap">Medication: {medLabel(l.medication_id)}</div>
                        <div className="cc-small cc-wrap">
                          Logged by: <b>{whoLabel(l.created_by)}</b>
                        </div>
                      </div>

                      <button
                        className="cc-btn"
                        onClick={() => decryptLog(l)}
                        disabled={!vaultKey || !!plain || !l.note_encrypted}
                      >
                        {plain ? "Decrypted" : l.note_encrypted ? "Decrypt note" : "No note"}
                      </button>
                    </div>

                    {plain ? (
                      <div className="cc-spacer-12">
                        <div className="cc-panel">{plain || "—"}</div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}