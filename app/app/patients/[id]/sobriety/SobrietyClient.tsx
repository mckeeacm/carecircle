"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type SobrietyRow = {
  id: string;
  patient_id: string;
  occurred_at: string;
  status: string;
  substance: string | null;
  intensity: number | null;
  note_encrypted: CipherEnvelopeV1 | null;
  created_by: string;
  created_at: string;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function SobrietyClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [rows, setRows] = useState<SobrietyRow[]>([]);
  const [plainById, setPlainById] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // form
  const [occurredAt, setOccurredAt] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [status, setStatus] = useState<string>("sober"); // required by schema
  const [substance, setSubstance] = useState<string>("");
  const [intensity, setIntensity] = useState<string>("");
  const [note, setNote] = useState<string>("");

  async function refresh() {
    setLoading(true);
    setMsg(null);
    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      const { data, error } = await supabase
        .from("sobriety_logs")
        .select("id, patient_id, occurred_at, status, substance, intensity, note_encrypted, created_by, created_at")
        .eq("patient_id", patientId)
        .order("occurred_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setRows((data ?? []) as SobrietyRow[]);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_sobriety");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  async function createLog() {
    setSaving(true);
    setMsg(null);
    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);
      if (!status.trim()) throw new Error("status_required");

      let noteEnv: CipherEnvelopeV1 | null = null;
      if (note.trim()) {
        if (!vaultKey) throw new Error("no_vault_share");
        noteEnv = await vaultEncryptString({
          vaultKey,
          plaintext: note,
          aad: { table: "sobriety_logs", column: "note_encrypted", patient_id: patientId },
        });
      }

      const occ = new Date(occurredAt);
      if (Number.isNaN(occ.getTime())) throw new Error("invalid_occurred_at");

      const intensityVal = intensity.trim() ? Number(intensity) : null;
      if (intensity.trim() && Number.isNaN(intensityVal)) throw new Error("invalid_intensity");

      const { error } = await supabase.from("sobriety_logs").insert({
        patient_id: patientId,
        occurred_at: occ.toISOString(),
        status,
        substance: substance.trim() ? substance.trim() : null,
        intensity: intensityVal,
        note_encrypted: noteEnv,
      });

      if (error) throw error;

      setNote("");
      setIntensity("");
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_sobriety_log");
    } finally {
      setSaving(false);
    }
  }

  async function decryptNote(r: SobrietyRow) {
    if (!vaultKey || !r.note_encrypted) return;
    if (plainById[r.id] != null) return;

    const plain = await decryptStringWithLocalCache({
      patientId,
      table: "sobriety_logs",
      rowId: r.id,
      column: "note_encrypted",
      env: r.note_encrypted,
      vaultKey,
    });

    setPlainById((p) => ({ ...p, [r.id]: plain }));
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Sobriety</h1>
            <div className="cc-subtle cc-wrap">{patientId}</div>
          </div>
          <div className="cc-row">
            <Link className="cc-btn" href={`/app/patients/${patientId}/today`}>Today</Link>
            <Link className="cc-btn" href="/app/hub">Hub</Link>
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
            <div className="cc-subtle">Encrypted notes can’t be saved or decrypted.</div>
          </div>
        ) : null}

        <div className="cc-card cc-card-pad cc-stack">
          <h2 className="cc-h2">New log</h2>

          <div className="cc-grid-2">
            <div className="cc-field">
              <div className="cc-label">Occurred at</div>
              <input
                className="cc-input"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </div>

            <div className="cc-field">
              <div className="cc-label">Status (required)</div>
              <input className="cc-input" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="sober / relapse / craving" />
            </div>
          </div>

          <div className="cc-grid-2">
            <div className="cc-field">
              <div className="cc-label">Substance (optional)</div>
              <input className="cc-input" value={substance} onChange={(e) => setSubstance(e.target.value)} />
            </div>

            <div className="cc-field">
              <div className="cc-label">Intensity (optional number)</div>
              <input className="cc-input" value={intensity} onChange={(e) => setIntensity(e.target.value)} placeholder="e.g. 1-10" />
            </div>
          </div>

          <div className="cc-field">
            <div className="cc-label">Note (E2EE, optional)</div>
            <textarea className="cc-textarea" value={note} onChange={(e) => setNote(e.target.value)} disabled={!vaultKey} />
          </div>

          <div className="cc-row">
            <button className="cc-btn cc-btn-primary" onClick={createLog} disabled={saving}>
              {saving ? "Saving…" : "Create"}
            </button>
            <button className="cc-btn" onClick={refresh} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <h2 className="cc-h2">Recent logs</h2>

          {rows.length === 0 ? (
            <div className="cc-small">No logs yet.</div>
          ) : (
            rows.map((r) => {
              const plain = plainById[r.id];
              return (
                <div key={r.id} className="cc-panel-soft">
                  <div className="cc-row-between">
                    <div className="cc-wrap">
                      <div className="cc-strong">{r.status}</div>
                      <div className="cc-small">
                        {new Date(r.occurred_at).toLocaleString()}
                        {r.substance ? ` • ${r.substance}` : ""}
                        {r.intensity != null ? ` • intensity:${r.intensity}` : ""}
                      </div>
                    </div>

                    <button className="cc-btn" onClick={() => decryptNote(r)} disabled={!vaultKey || !r.note_encrypted || !!plain}>
                      {plain ? "Decrypted" : r.note_encrypted ? "Decrypt note" : "No note"}
                    </button>
                  </div>

                  {plain ? (
                    <div className="cc-spacer-12">
                      <div className="cc-panel" style={{ whiteSpace: "pre-wrap" }}>{plain}</div>
                    </div>
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