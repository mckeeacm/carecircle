"use client";

import { useEffect, useMemo, useState } from "react";
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

export default function MedicationLogsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [meds, setMeds] = useState<MedicationRow[]>([]);
  const [logs, setLogs] = useState<MedicationLogRow[]>([]);
  const [notePlainById, setNotePlainById] = useState<Record<string, string>>({});

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // form
  const [medicationId, setMedicationId] = useState<string>("");
  const [status, setStatus] = useState<string>("taken");
  const [note, setNote] = useState<string>("");

  async function refresh() {
    setLoading(true);
    setMsg(null);
    try {
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
      const noteEnv = await vaultEncryptString({
        vaultKey,
        plaintext: note,
        aad: { table: "medication_logs", column: "note_encrypted", patient_id: patientId },
      });

      const { error } = await supabase.from("medication_logs").insert({
        patient_id: patientId,
        medication_id: medicationId,
        status,
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

  return (
    <div style={{ padding: 16 }}>
      <h2>Medication logs</h2>

      {msg && <div style={{ border: "1px solid #c33", padding: 10, borderRadius: 10, marginBottom: 12 }}>{msg}</div>}

      {!vaultKey && (
        <div style={{ border: "1px solid #f0c", padding: 10, borderRadius: 10, marginBottom: 12 }}>
          Vault key not available on this device. You can’t decrypt or save encrypted notes.
        </div>
      )}

      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Medication
            <select value={medicationId} onChange={(e) => setMedicationId(e.target.value)} style={{ padding: 6 }}>
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
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Status
            <input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="taken / missed / skipped" />
          </label>
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Note (E2EE)</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
            placeholder="Encrypted note…"
            disabled={!vaultKey}
          />
        </div>

        <button
          onClick={createLog}
          disabled={!vaultKey || saving || !medicationId}
          style={{ marginTop: 10, padding: "8px 10px", borderRadius: 10 }}
        >
          {saving ? "Saving…" : "Save log"}
        </button>
      </div>

      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <b>Recent logs</b>
          <button onClick={refresh} disabled={loading} style={{ padding: "6px 10px", borderRadius: 10 }}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>

        <div style={{ marginTop: 10 }}>
          {logs.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.7 }}>No logs yet.</div>
          ) : (
            logs.map((l) => {
              const plain = notePlainById[l.id];
              return (
                <div
                  key={l.id}
                  style={{ border: "1px solid #f3f3f3", borderRadius: 12, padding: 10, marginBottom: 10 }}
                >
                  <div style={{ fontSize: 13, opacity: 0.9 }}>
                    <b>{l.status ?? "—"}</b> • {new Date(l.created_at).toLocaleString()} • med:{l.medication_id}
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={() => decryptLog(l)}
                      disabled={!vaultKey || !!plain || !l.note_encrypted}
                      style={{ padding: "6px 10px", borderRadius: 10 }}
                    >
                      {plain ? "Decrypted" : l.note_encrypted ? "Decrypt note" : "No note"}
                    </button>
                  </div>

                  {plain ? (
                    <div style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>{plain || "—"}</div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}