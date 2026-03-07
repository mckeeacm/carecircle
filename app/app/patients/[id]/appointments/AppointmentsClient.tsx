"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";
import MobileShell from "@/app/components/MobileShell";

type AppointmentRow = {
  id: string;
  patient_id: string;
  starts_at: string;
  ends_at: string | null;
  title: string;
  location: string | null;
  provider: string | null;
  status: string | null;
  transport_status: string | null;
  transport_by: string | null;
  created_by: string;
  created_at: string;
  notes_encrypted: CipherEnvelopeV1 | null;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

const STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const TRANSPORT_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "organised", label: "Organised" },
  { value: "to_be_organised", label: "To be organised" },
] as const;

export default function AppointmentsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [plainById, setPlainById] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [startsAt, setStartsAt] = useState<string>(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  });
  const [endsAt, setEndsAt] = useState<string>("");
  const [title, setTitle] = useState<string>("Appointment");
  const [location, setLocation] = useState<string>("");
  const [provider, setProvider] = useState<string>("");
  const [status, setStatus] = useState<string>("scheduled");
  const [transportStatus, setTransportStatus] = useState<string>("");
  const [transportBy, setTransportBy] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  async function refresh() {
    setLoading(true);
    setMsg(null);

    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, patient_id, starts_at, ends_at, title, location, provider, status, transport_status, transport_by, created_by, created_at, notes_encrypted"
        )
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
        transport_status: transportStatus || null,
        transport_by: transportBy.trim() || null,
        notes_encrypted: notesEnv,
      });

      if (error) throw error;

      setNotes("");
      setLocation("");
      setProvider("");
      setStatus("scheduled");
      setTransportStatus("");
      setTransportBy("");
      setTitle("Appointment");
      setEndsAt("");
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

  function formatWhen(row: AppointmentRow) {
    const startText = new Date(row.starts_at).toLocaleString();
    if (!row.ends_at) return startText;
    return `${startText} → ${new Date(row.ends_at).toLocaleString()}`;
  }

  function statusLabel(value: string | null) {
    return STATUS_OPTIONS.find((s) => s.value === value)?.label ?? value ?? "—";
  }

  function statusPillClass(value: string | null) {
    if (value === "scheduled" || value === "confirmed") return "cc-pill-primary";
    return "";
  }

  function transportStatusLabel(value: string | null) {
    if (value === "organised") return "Organised";
    if (value === "to_be_organised") return "To be organised";
    return "";
  }

  const now = new Date();
  const upcomingRows = rows.filter((r) => new Date(r.starts_at).getTime() >= now.getTime());
  const pastRows = rows.filter((r) => new Date(r.starts_at).getTime() < now.getTime());

  return (
    <MobileShell
      title="Appointments"
      subtitle="Plan and track care appointments"
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
          <div className="cc-subtle">Encrypted notes can’t be saved or decrypted.</div>
        </div>
      ) : null}

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">New appointment</h2>
            <div className="cc-subtle">Create an appointment in a mobile-friendly format.</div>
          </div>

          <button className="cc-btn" onClick={refresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

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
            <div className="cc-label">Provider (optional)</div>
            <input className="cc-input" value={provider} onChange={(e) => setProvider(e.target.value)} />
          </div>
        </div>

        <div className="cc-grid-2">
          <div className="cc-field">
            <div className="cc-label">Location (optional)</div>
            <input className="cc-input" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>

          <div className="cc-field">
            <div className="cc-label">Who is transporting? (optional)</div>
            <input
              className="cc-input"
              value={transportBy}
              onChange={(e) => setTransportBy(e.target.value)}
              placeholder="Name or arrangement details"
            />
          </div>
        </div>

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
          <div className="cc-label">Transport</div>
          <select className="cc-select" value={transportStatus} onChange={(e) => setTransportStatus(e.target.value)}>
            {TRANSPORT_OPTIONS.map((opt) => (
              <option key={opt.value || "empty"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="cc-field">
          <div className="cc-label">Notes (encrypted, optional)</div>
          <textarea
            className="cc-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!vaultKey}
            placeholder="Optional appointment note…"
          />
        </div>

        <div className="cc-row">
          <button className="cc-btn cc-btn-primary" onClick={createAppointment} disabled={saving}>
            {saving ? "Saving…" : "Create appointment"}
          </button>
        </div>
      </div>

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">Upcoming</h2>
            <div className="cc-subtle">What’s coming up next for this circle.</div>
          </div>
        </div>

        {upcomingRows.length === 0 ? (
          <div className="cc-small">No upcoming appointments.</div>
        ) : (
          <div className="cc-stack">
            {upcomingRows.map((r) => {
              const plain = plainById[r.id];

              return (
                <div
                  key={r.id}
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
                        <span className={`cc-pill ${statusPillClass(r.status)}`}>{statusLabel(r.status)}</span>
                        <span className="cc-small cc-subtle">{formatWhen(r)}</span>
                      </div>

                      <div className="cc-strong">{r.title}</div>

                      {r.location ? (
                        <div className="cc-small cc-subtle" style={{ marginTop: 4 }}>
                          {r.location}
                        </div>
                      ) : null}

                      {r.provider ? (
                        <div className="cc-small cc-subtle" style={{ marginTop: 4 }}>
                          Provider: {r.provider}
                        </div>
                      ) : null}

                      {r.transport_status ? (
                        <div className="cc-small cc-subtle" style={{ marginTop: 4 }}>
                          Transport: {transportStatusLabel(r.transport_status)}
                        </div>
                      ) : null}

                      {r.transport_by ? (
                        <div className="cc-small cc-subtle" style={{ marginTop: 4 }}>
                          Who is transporting: {r.transport_by}
                        </div>
                      ) : null}
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
            })}
          </div>
        )}
      </div>

      {pastRows.length > 0 ? (
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Past appointments</h2>
              <div className="cc-subtle">Recent appointment history.</div>
            </div>
          </div>

          <div className="cc-stack">
            {pastRows
              .slice()
              .reverse()
              .map((r) => {
                const plain = plainById[r.id];

                return (
                  <div
                    key={r.id}
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
                          <span className={`cc-pill ${statusPillClass(r.status)}`}>{statusLabel(r.status)}</span>
                          <span className="cc-small cc-subtle">{formatWhen(r)}</span>
                        </div>

                        <div className="cc-strong">{r.title}</div>

                        {r.location ? (
                          <div className="cc-small cc-subtle" style={{ marginTop: 4 }}>
                            {r.location}
                          </div>
                        ) : null}

                        {r.provider ? (
                          <div className="cc-small cc-subtle" style={{ marginTop: 4 }}>
                            Provider: {r.provider}
                          </div>
                        ) : null}

                        {r.transport_status ? (
                          <div className="cc-small cc-subtle" style={{ marginTop: 4 }}>
                            Transport: {transportStatusLabel(r.transport_status)}
                          </div>
                        ) : null}

                        {r.transport_by ? (
                          <div className="cc-small cc-subtle" style={{ marginTop: 4 }}>
                            Who is transporting: {r.transport_by}
                          </div>
                        ) : null}
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
              })}
          </div>
        </div>
      ) : null}
    </MobileShell>
  );
}