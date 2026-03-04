"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type AppointmentRow = {
  id: string;
  patient_id: string;
  starts_at: string;
  ends_at: string | null;
  title: string;
  location: string | null;
  provider: string | null;
  status: string | null;
  created_by: string;
  created_at: string;
  notes_encrypted: CipherEnvelopeV1 | null;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function AppointmentsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [plainById, setPlainById] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // form
  const [startsAt, setStartsAt] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [endsAt, setEndsAt] = useState<string>("");
  const [title, setTitle] = useState<string>("Appointment");
  const [location, setLocation] = useState<string>("");
  const [provider, setProvider] = useState<string>("");
  const [status, setStatus] = useState<string>("scheduled");
  const [notes, setNotes] = useState<string>("");

  async function refresh() {
    setLoading(true);
    setMsg(null);
    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      const { data, error } = await supabase
        .from("appointments")
        .select("id, patient_id, starts_at, ends_at, title, location, provider, status, created_by, created_at, notes_encrypted")
        .eq("patient_id", patientId)
        .order("starts_at", { ascending: true })
        .limit(50);

      if (error) throw error;
      setRows((data ?? []) as AppointmentRow[]);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_appointments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  async function createAppointment() {
    setSaving(true);
    setMsg(null);
    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      let notesEnv: CipherEnvelopeV1 | null = null;
      if (notes.trim()) {
        if (!vaultKey) throw new Error("no_vault_share");
        notesEnv = await vaultEncryptString({
          vaultKey,
          plaintext: notes,
          aad: { table: "appointments", column: "notes_encrypted", patient_id: patientId },
        });
      }

      const starts = new Date(startsAt);
      if (Number.isNaN(starts.getTime())) throw new Error("invalid_starts_at");

      const ends = endsAt.trim() ? new Date(endsAt) : null;
      if (endsAt.trim() && ends && Number.isNaN(ends.getTime())) throw new Error("invalid_ends_at");

      const { error } = await supabase.from("appointments").insert({
        patient_id: patientId,
        starts_at: starts.toISOString(),
        ends_at: ends ? ends.toISOString() : null,
        title,
        location: location || null,
        provider: provider || null,
        status: status || null,
        notes_encrypted: notesEnv,
      });

      if (error) throw error;

      setNotes("");
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_appointment");
    } finally {
      setSaving(false);
    }
  }

  async function decryptNotes(row: AppointmentRow) {
    if (!vaultKey || !row.notes_encrypted) return;
    if (plainById[row.id] != null) return;

    const plain = await decryptStringWithLocalCache({
      patientId,
      table: "appointments",
      rowId: row.id,
      column: "notes_encrypted",
      env: row.notes_encrypted,
      vaultKey,
    });

    setPlainById((p) => ({ ...p, [row.id]: plain }));
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Appointments</h1>
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
          <h2 className="cc-h2">New appointment</h2>

          <div className="cc-grid-2">
            <div className="cc-field">
              <div className="cc-label">Starts at</div>
              <input
                className="cc-input"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>

            <div className="cc-field">
              <div className="cc-label">Ends at (optional)</div>
              <input
                className="cc-input"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="cc-grid-2">
            <div className="cc-field">
              <div className="cc-label">Title</div>
              <input className="cc-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="cc-field">
              <div className="cc-label">Status (optional)</div>
              <input className="cc-input" value={status} onChange={(e) => setStatus(e.target.value)} />
            </div>
          </div>

          <div className="cc-grid-2">
            <div className="cc-field">
              <div className="cc-label">Location (optional)</div>
              <input className="cc-input" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>

            <div className="cc-field">
              <div className="cc-label">Provider (optional)</div>
              <input className="cc-input" value={provider} onChange={(e) => setProvider(e.target.value)} />
            </div>
          </div>

          <div className="cc-field">
            <div className="cc-label">Notes (E2EE, optional)</div>
            <textarea className="cc-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!vaultKey} />
          </div>

          <div className="cc-row">
            <button className="cc-btn cc-btn-primary" onClick={createAppointment} disabled={saving}>
              {saving ? "Saving…" : "Create"}
            </button>
            <button className="cc-btn" onClick={refresh} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <h2 className="cc-h2">Upcoming</h2>
          </div>

          {rows.length === 0 ? (
            <div className="cc-small">No appointments yet.</div>
          ) : (
            rows.map((r) => {
              const plain = plainById[r.id];
              return (
                <div key={r.id} className="cc-panel-soft">
                  <div className="cc-row-between">
                    <div className="cc-wrap">
                      <div className="cc-strong">{r.title}</div>
                      <div className="cc-small">
                        {new Date(r.starts_at).toLocaleString()}
                        {r.ends_at ? ` → ${new Date(r.ends_at).toLocaleString()}` : ""}
                        {r.location ? ` • ${r.location}` : ""}
                        {r.provider ? ` • ${r.provider}` : ""}
                        {r.status ? ` • ${r.status}` : ""}
                      </div>
                    </div>

                    <button
                      className="cc-btn"
                      onClick={() => decryptNotes(r)}
                      disabled={!vaultKey || !r.notes_encrypted || !!plain}
                    >
                      {plain ? "Decrypted" : r.notes_encrypted ? "Decrypt notes" : "No notes"}
                    </button>
                  </div>

                  {plain ? (
                    <div className="cc-spacer-12">
                      <div className="cc-panel" style={{ whiteSpace: "pre-wrap" }}>
                        {plain}
                      </div>
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