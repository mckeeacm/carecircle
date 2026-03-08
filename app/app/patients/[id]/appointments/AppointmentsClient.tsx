"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
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
  transport_proof_path: string | null;
  transport_proof_name: string | null;
  transport_proof_uploaded_at: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
  notes_encrypted: CipherEnvelopeV1 | null;
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

const PROOF_BUCKET = "appointment-proof";

function formatLocalDateTimeInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function parseLocalDateTimeInput(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function sanitiseFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
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
  return "Not set";
}

function fieldLabel(field: string) {
  if (field === "starts_at") return "Start time";
  if (field === "ends_at") return "End time";
  if (field === "title") return "Title";
  if (field === "location") return "Location";
  if (field === "provider") return "Provider";
  if (field === "status") return "Status";
  if (field === "transport_status") return "Transport status";
  if (field === "transport_by") return "Transport arranged by";
  if (field === "transport_proof_name") return "Transport proof";
  if (field === "notes_encrypted") return "Encrypted notes";
  if (field === "appointment") return "Appointment";
  return field;
}

function formatAuditValue(field: string, value: string | null) {
  if (value == null || value === "") return "—";
  if (field === "status") return statusLabel(value);
  if (field === "transport_status") return transportStatusLabel(value);
  if (field === "starts_at" || field === "ends_at") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  }
  if (field === "notes_encrypted") return "Updated";
  return value;
}

export default function AppointmentsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [auditRows, setAuditRows] = useState<AppointmentAuditRow[]>([]);
  const [membersById, setMembersById] = useState<Record<string, MemberBasic>>({});
  const [plainById, setPlainById] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyAppointmentId, setBusyAppointmentId] = useState<string | null>(null);
  const [openingProofId, setOpeningProofId] = useState<string | null>(null);

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
  const [newProofFile, setNewProofFile] = useState<File | null>(null);

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

      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, patient_id, starts_at, ends_at, title, location, provider, status, transport_status, transport_by, transport_proof_path, transport_proof_name, transport_proof_uploaded_at, created_by, created_at, updated_by, updated_at, notes_encrypted"
        )
        .eq("patient_id", patientId)
        .order("starts_at", { ascending: true })
        .limit(100);

      if (error) throw error;
      setRows((data ?? []) as AppointmentRow[]);

      const { data: logsData, error: logsErr } = await supabase
        .from("appointment_audit_logs")
        .select("id, appointment_id, patient_id, changed_by, changed_at, action, field_name, old_value, new_value")
        .eq("patient_id", patientId)
        .order("changed_at", { ascending: false })
        .limit(500);

      if (logsErr) throw logsErr;
      setAuditRows((logsData ?? []) as AppointmentAuditRow[]);
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

  function whoLabel(userId: string | null) {
    if (!userId) return "Unknown";
    const m = membersById[userId];
    return m?.nickname?.trim() || userId;
  }

  async function uploadProofForAppointment(appointmentId: string, file: File) {
    const safeName = sanitiseFileName(file.name);
    const path = `${patientId}/${appointmentId}/${Date.now()}-${safeName}`;

    const { error: updateErr } = await supabase
      .from("appointments")
      .update({
        transport_proof_path: path,
        transport_proof_name: file.name,
        transport_proof_uploaded_at: new Date().toISOString(),
      })
      .eq("id", appointmentId)
      .eq("patient_id", patientId);

    if (updateErr) throw updateErr;

    const { error: uploadErr } = await supabase.storage.from(PROOF_BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
    });

    if (uploadErr) {
      await supabase
        .from("appointments")
        .update({
          transport_proof_path: null,
          transport_proof_name: null,
          transport_proof_uploaded_at: null,
        })
        .eq("id", appointmentId)
        .eq("patient_id", patientId);

      throw uploadErr;
    }
  }

  async function removeProofFromAppointment(row: AppointmentRow) {
    if (!row.transport_proof_path) return;

    setBusyAppointmentId(row.id);
    setMsg(null);

    try {
      const { error: removeErr } = await supabase.storage.from(PROOF_BUCKET).remove([row.transport_proof_path]);
      if (removeErr) throw removeErr;

      const { error: updateErr } = await supabase
        .from("appointments")
        .update({
          transport_proof_path: null,
          transport_proof_name: null,
          transport_proof_uploaded_at: null,
        })
        .eq("id", row.id)
        .eq("patient_id", patientId);

      if (updateErr) throw updateErr;

      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_remove_transport_proof");
    } finally {
      setBusyAppointmentId(null);
    }
  }

  async function openProof(row: AppointmentRow) {
    if (!row.transport_proof_path) return;

    setOpeningProofId(row.id);
    setMsg(null);

    try {
      const { data, error } = await supabase.storage
        .from(PROOF_BUCKET)
        .createSignedUrl(row.transport_proof_path, 60);

      if (error) throw error;
      if (!data?.signedUrl) throw new Error("failed_to_open_transport_proof");

      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_open_transport_proof");
    } finally {
      setOpeningProofId(null);
    }
  }

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

      if (newProofFile && transportStatus !== "organised") {
        throw new Error("transport_proof_requires_organised_transport");
      }

      const startsIso = parseLocalDateTimeInput(startsAt);
      if (!startsIso) throw new Error("invalid_starts_at");

      const endsIso = endsAt.trim() ? parseLocalDateTimeInput(endsAt) : null;
      if (endsAt.trim() && !endsIso) throw new Error("invalid_ends_at");

      const { data, error } = await supabase
        .from("appointments")
        .insert({
          patient_id: patientId,
          starts_at: startsIso,
          ends_at: endsIso,
          title: title.trim() || "Appointment",
          location: location.trim() || null,
          provider: provider.trim() || null,
          status: status || null,
          transport_status: transportStatus || null,
          transport_by: transportBy.trim() || null,
          notes_encrypted: notesEnv,
        })
        .select(
          "id, patient_id, starts_at, ends_at, title, location, provider, status, transport_status, transport_by, transport_proof_path, transport_proof_name, transport_proof_uploaded_at, created_by, created_at, updated_by, updated_at, notes_encrypted"
        )
        .single();

      if (error) throw error;

      const createdRow = data as AppointmentRow;

      if (newProofFile) {
        await uploadProofForAppointment(createdRow.id, newProofFile);
      }

      setNotes("");
      setLocation("");
      setProvider("");
      setStatus("scheduled");
      setTransportStatus("");
      setTransportBy("");
      setTitle("Appointment");
      setEndsAt("");
      setNewProofFile(null);

      const now = new Date();
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
      setStartsAt(local.toISOString().slice(0, 16));

      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_appointment");
    } finally {
      setSaving(false);
    }
  }

  async function updateAppointment(
    row: AppointmentRow,
    patch: {
      starts_at: string;
      ends_at: string | null;
      title: string;
      location: string | null;
      provider: string | null;
      status: string | null;
      transport_status: string | null;
      transport_by: string | null;
      notesPlain?: string;
      notesTouched?: boolean;
      proofFile?: File | null;
      removeProof?: boolean;
    }
  ) {
    setBusyAppointmentId(row.id);
    setMsg(null);

    try {
      const startsIso = parseLocalDateTimeInput(patch.starts_at);
      if (!startsIso) throw new Error("invalid_starts_at");

      const endsIso = patch.ends_at ? parseLocalDateTimeInput(patch.ends_at) : null;
      if (patch.ends_at && !endsIso) throw new Error("invalid_ends_at");

      if (patch.proofFile && patch.transport_status !== "organised") {
        throw new Error("transport_proof_requires_organised_transport");
      }

      let notesEnv = row.notes_encrypted;

      if (patch.notesTouched) {
        if (patch.notesPlain?.trim()) {
          if (!vaultKey) throw new Error("no_vault_share");
          notesEnv = await vaultEncryptString({
            vaultKey,
            plaintext: patch.notesPlain,
            aad: { table: "appointments", column: "notes_encrypted", patient_id: patientId },
          });
        } else {
          notesEnv = null;
        }
      }

      if (patch.removeProof && row.transport_proof_path) {
        const { error: removeErr } = await supabase.storage.from(PROOF_BUCKET).remove([row.transport_proof_path]);
        if (removeErr) throw removeErr;
      }

      if (patch.proofFile && row.transport_proof_path) {
        const { error: removeErr } = await supabase.storage.from(PROOF_BUCKET).remove([row.transport_proof_path]);
        if (removeErr) throw removeErr;
      }

      const updatePayload: Record<string, any> = {
        starts_at: startsIso,
        ends_at: endsIso,
        title: patch.title.trim() || "Appointment",
        location: patch.location?.trim() ? patch.location.trim() : null,
        provider: patch.provider?.trim() ? patch.provider.trim() : null,
        status: patch.status || null,
        transport_status: patch.transport_status || null,
        transport_by: patch.transport_by?.trim() ? patch.transport_by.trim() : null,
        notes_encrypted: notesEnv,
      };

      if (patch.removeProof || patch.transport_status !== "organised") {
        updatePayload.transport_proof_path = null;
        updatePayload.transport_proof_name = null;
        updatePayload.transport_proof_uploaded_at = null;
      }

      const { error } = await supabase
        .from("appointments")
        .update(updatePayload)
        .eq("id", row.id)
        .eq("patient_id", patientId);

      if (error) throw error;

      if (patch.proofFile) {
        await uploadProofForAppointment(row.id, patch.proofFile);
      }

      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_update_appointment");
    } finally {
      setBusyAppointmentId(null);
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

  function appointmentAuditRows(appointmentId: string) {
    return auditRows.filter((x) => x.appointment_id === appointmentId);
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
            <div className="cc-subtle">Create an appointment in a clearer, more practical order.</div>
          </div>

          <button className="cc-btn" onClick={refresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div className="cc-panel-soft cc-stack" style={{ padding: 16, borderRadius: 20 }}>
          <div className="cc-strong">Appointment details</div>

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
              <div className="cc-label">Location (optional)</div>
              <input className="cc-input" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>

            <div className="cc-field">
              <div className="cc-label">Status</div>
              <select className="cc-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="cc-panel-soft cc-stack" style={{ padding: 16, borderRadius: 20 }}>
          <div className="cc-strong">Transport</div>

          <div className="cc-grid-2">
            <div className="cc-field">
              <div className="cc-label">Transport status</div>
              <select
                className="cc-select"
                value={transportStatus}
                onChange={(e) => setTransportStatus(e.target.value)}
              >
                {TRANSPORT_OPTIONS.map((opt) => (
                  <option key={opt.value || "empty"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
            <div className="cc-label">Proof of booking (optional)</div>
            <input
              className="cc-input"
              type="file"
              accept="image/*,.pdf"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setNewProofFile(e.target.files?.[0] ?? null);
              }}
            />
            <div className="cc-small cc-subtle">
              Upload a screenshot or PDF confirmation. Use transport status “Organised” when attaching proof.
            </div>
            {newProofFile ? (
              <div className="cc-small cc-subtle">Selected: {newProofFile.name}</div>
            ) : null}
          </div>
        </div>

        <div className="cc-panel-soft cc-stack" style={{ padding: 16, borderRadius: 20 }}>
          <div className="cc-strong">Encrypted notes</div>

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
        </div>

        <div className="cc-row">
          <button className="cc-btn cc-btn-primary" onClick={createAppointment} disabled={saving}>
            {saving ? "Saving…" : "Create appointment"}
          </button>
        </div>
      </div>

      <AppointmentSection
        title="Upcoming"
        subtitle="What’s coming up next for this circle."
        rows={upcomingRows}
        patientId={patientId}
        busyAppointmentId={busyAppointmentId}
        openingProofId={openingProofId}
        vaultKeyAvailable={!!vaultKey}
        plainById={plainById}
        whoLabel={whoLabel}
        onDecryptNotes={decryptNotes}
        onOpenProof={openProof}
        onRemoveProof={removeProofFromAppointment}
        onSaveAppointment={updateAppointment}
        appointmentAuditRows={appointmentAuditRows}
      />

      {pastRows.length > 0 ? (
        <AppointmentSection
          title="Past appointments"
          subtitle="Recent appointment history."
          rows={pastRows.slice().reverse()}
          patientId={patientId}
          busyAppointmentId={busyAppointmentId}
          openingProofId={openingProofId}
          vaultKeyAvailable={!!vaultKey}
          plainById={plainById}
          whoLabel={whoLabel}
          onDecryptNotes={decryptNotes}
          onOpenProof={openProof}
          onRemoveProof={removeProofFromAppointment}
          onSaveAppointment={updateAppointment}
          appointmentAuditRows={appointmentAuditRows}
        />
      ) : null}
    </MobileShell>
  );
}

function AppointmentSection({
  title,
  subtitle,
  rows,
  patientId,
  busyAppointmentId,
  openingProofId,
  vaultKeyAvailable,
  plainById,
  whoLabel,
  onDecryptNotes,
  onOpenProof,
  onRemoveProof,
  onSaveAppointment,
  appointmentAuditRows,
}: {
  title: string;
  subtitle: string;
  rows: AppointmentRow[];
  patientId: string;
  busyAppointmentId: string | null;
  openingProofId: string | null;
  vaultKeyAvailable: boolean;
  plainById: Record<string, string>;
  whoLabel: (userId: string | null) => string;
  onDecryptNotes: (row: AppointmentRow) => Promise<void>;
  onOpenProof: (row: AppointmentRow) => Promise<void>;
  onRemoveProof: (row: AppointmentRow) => Promise<void>;
  onSaveAppointment: (
    row: AppointmentRow,
    patch: {
      starts_at: string;
      ends_at: string | null;
      title: string;
      location: string | null;
      provider: string | null;
      status: string | null;
      transport_status: string | null;
      transport_by: string | null;
      notesPlain?: string;
      notesTouched?: boolean;
      proofFile?: File | null;
      removeProof?: boolean;
    }
  ) => Promise<void>;
  appointmentAuditRows: (appointmentId: string) => AppointmentAuditRow[];
}) {
  return (
    <div className="cc-card cc-card-pad cc-stack">
      <div className="cc-row-between">
        <div>
          <h2 className="cc-h2">{title}</h2>
          <div className="cc-subtle">{subtitle}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="cc-small">{title === "Upcoming" ? "No upcoming appointments." : "No past appointments."}</div>
      ) : (
        <div className="cc-stack">
          {rows.map((r) => (
            <AppointmentEditorCard
              key={r.id}
              appointment={r}
              patientId={patientId}
              busy={busyAppointmentId === r.id}
              openingProof={openingProofId === r.id}
              vaultKeyAvailable={vaultKeyAvailable}
              decryptedNote={plainById[r.id]}
              whoLabel={whoLabel}
              auditRows={appointmentAuditRows(r.id)}
              onDecryptNotes={() => onDecryptNotes(r)}
              onOpenProof={() => onOpenProof(r)}
              onRemoveProof={() => onRemoveProof(r)}
              onSave={onSaveAppointment}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AppointmentEditorCard({
  appointment,
  patientId,
  busy,
  openingProof,
  vaultKeyAvailable,
  decryptedNote,
  whoLabel,
  auditRows,
  onDecryptNotes,
  onOpenProof,
  onRemoveProof,
  onSave,
}: {
  appointment: AppointmentRow;
  patientId: string;
  busy: boolean;
  openingProof: boolean;
  vaultKeyAvailable: boolean;
  decryptedNote?: string;
  whoLabel: (userId: string | null) => string;
  auditRows: AppointmentAuditRow[];
  onDecryptNotes: () => Promise<void>;
  onOpenProof: () => Promise<void>;
  onRemoveProof: () => Promise<void>;
  onSave: (
    row: AppointmentRow,
    patch: {
      starts_at: string;
      ends_at: string | null;
      title: string;
      location: string | null;
      provider: string | null;
      status: string | null;
      transport_status: string | null;
      transport_by: string | null;
      notesPlain?: string;
      notesTouched?: boolean;
      proofFile?: File | null;
      removeProof?: boolean;
    }
  ) => Promise<void>;
}) {
  const [title, setTitle] = useState(appointment.title);
  const [provider, setProvider] = useState(appointment.provider ?? "");
  const [startsAt, setStartsAt] = useState(formatLocalDateTimeInput(appointment.starts_at));
  const [endsAt, setEndsAt] = useState(formatLocalDateTimeInput(appointment.ends_at));
  const [location, setLocation] = useState(appointment.location ?? "");
  const [status, setStatus] = useState(appointment.status ?? "scheduled");
  const [transportStatus, setTransportStatus] = useState(appointment.transport_status ?? "");
  const [transportBy, setTransportBy] = useState(appointment.transport_by ?? "");
  const [notesValue, setNotesValue] = useState(decryptedNote ?? "");
  const [notesTouched, setNotesTouched] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [removeProof, setRemoveProof] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    setTitle(appointment.title);
    setProvider(appointment.provider ?? "");
    setStartsAt(formatLocalDateTimeInput(appointment.starts_at));
    setEndsAt(formatLocalDateTimeInput(appointment.ends_at));
    setLocation(appointment.location ?? "");
    setStatus(appointment.status ?? "scheduled");
    setTransportStatus(appointment.transport_status ?? "");
    setTransportBy(appointment.transport_by ?? "");
    setProofFile(null);
    setRemoveProof(false);
  }, [
    appointment.id,
    appointment.title,
    appointment.provider,
    appointment.starts_at,
    appointment.ends_at,
    appointment.location,
    appointment.status,
    appointment.transport_status,
    appointment.transport_by,
    appointment.transport_proof_path,
    appointment.transport_proof_name,
  ]);

  useEffect(() => {
    if (decryptedNote != null) {
      setNotesValue(decryptedNote);
      setNotesTouched(false);
    } else if (!appointment.notes_encrypted) {
      setNotesValue("");
      setNotesTouched(false);
    }
  }, [appointment.notes_encrypted, decryptedNote]);

  const noteCanBeEdited = vaultKeyAvailable && (!appointment.notes_encrypted || decryptedNote != null);

  const changed =
    title.trim() !== appointment.title ||
    provider.trim() !== (appointment.provider ?? "") ||
    startsAt !== formatLocalDateTimeInput(appointment.starts_at) ||
    endsAt !== formatLocalDateTimeInput(appointment.ends_at) ||
    location.trim() !== (appointment.location ?? "") ||
    status !== (appointment.status ?? "scheduled") ||
    transportStatus !== (appointment.transport_status ?? "") ||
    transportBy.trim() !== (appointment.transport_by ?? "") ||
    notesTouched ||
    !!proofFile ||
    removeProof;

  return (
    <div className="cc-panel-soft cc-stack" style={{ padding: 16, borderRadius: 20 }}>
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
            <span className={`cc-pill ${statusPillClass(appointment.status)}`}>{statusLabel(appointment.status)}</span>
            <span className="cc-small cc-subtle">
              {new Date(appointment.starts_at).toLocaleString()}
              {appointment.ends_at ? ` → ${new Date(appointment.ends_at).toLocaleString()}` : ""}
            </span>
          </div>

          <div className="cc-strong">{appointment.title}</div>
          <div className="cc-small cc-subtle" style={{ marginTop: 6 }}>
            Created by <b>{whoLabel(appointment.created_by)}</b> on{" "}
            <b>{new Date(appointment.created_at).toLocaleString()}</b>
          </div>
          {appointment.updated_at ? (
            <div className="cc-small cc-subtle" style={{ marginTop: 4 }}>
              Last edited by <b>{whoLabel(appointment.updated_by)}</b> on{" "}
              <b>{new Date(appointment.updated_at).toLocaleString()}</b>
            </div>
          ) : null}
        </div>

        <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="cc-btn" type="button" onClick={() => setShowAudit((v) => !v)}>
            {showAudit ? "Hide trail" : "Show trail"}
          </button>
          <button
            className="cc-btn"
            onClick={onDecryptNotes}
            disabled={!vaultKeyAvailable || !appointment.notes_encrypted || decryptedNote != null}
          >
            {decryptedNote != null ? "Decrypted" : appointment.notes_encrypted ? "Decrypt notes" : "No notes"}
          </button>
        </div>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <div className="cc-label">Title</div>
          <input className="cc-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="cc-field">
          <div className="cc-label">Provider</div>
          <input className="cc-input" value={provider} onChange={(e) => setProvider(e.target.value)} />
        </div>
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
          <div className="cc-label">Ends at</div>
          <input className="cc-input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <div className="cc-label">Location</div>
          <input className="cc-input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>

        <div className="cc-field">
          <div className="cc-label">Status</div>
          <select className="cc-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="cc-panel" style={{ padding: 12, borderRadius: 16 }}>
        <div className="cc-strong" style={{ marginBottom: 10 }}>
          Transport
        </div>

        <div className="cc-grid-2">
          <div className="cc-field">
            <div className="cc-label">Transport status</div>
            <select className="cc-select" value={transportStatus} onChange={(e) => setTransportStatus(e.target.value)}>
              {TRANSPORT_OPTIONS.map((opt) => (
                <option key={opt.value || "empty"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="cc-field">
            <div className="cc-label">Who is transporting?</div>
            <input
              className="cc-input"
              value={transportBy}
              onChange={(e) => setTransportBy(e.target.value)}
              placeholder="Name or arrangement details"
            />
          </div>
        </div>

        <div className="cc-field" style={{ marginTop: 12 }}>
          <div className="cc-label">Proof of booking</div>

          {appointment.transport_proof_name && !removeProof ? (
            <div className="cc-row" style={{ marginBottom: 10 }}>
              <span className="cc-small cc-subtle">
                Current proof: <b>{appointment.transport_proof_name}</b>
                {appointment.transport_proof_uploaded_at
                  ? ` • uploaded ${new Date(appointment.transport_proof_uploaded_at).toLocaleString()}`
                  : ""}
              </span>
              <button className="cc-btn" type="button" onClick={onOpenProof} disabled={openingProof}>
                {openingProof ? "Opening…" : "Open proof"}
              </button>
              <button className="cc-btn cc-btn-danger" type="button" onClick={() => setRemoveProof(true)}>
                Remove proof
              </button>
            </div>
          ) : null}

          {removeProof ? (
            <div className="cc-small cc-subtle" style={{ marginBottom: 10 }}>
              Proof will be removed when you save changes.
            </div>
          ) : null}

          <input
            className="cc-input"
            type="file"
            accept="image/*,.pdf"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setProofFile(e.target.files?.[0] ?? null)}
          />

          {proofFile ? (
            <div className="cc-small cc-subtle" style={{ marginTop: 6 }}>
              New proof selected: {proofFile.name}
            </div>
          ) : null}
        </div>
      </div>

      <div className="cc-field">
        <div className="cc-label">Encrypted notes</div>
        <textarea
          className="cc-textarea"
          value={notesValue}
          onChange={(e) => {
            setNotesValue(e.target.value);
            setNotesTouched(true);
          }}
          disabled={!noteCanBeEdited}
          placeholder={
            !vaultKeyAvailable
              ? "Vault key not available on this device."
              : appointment.notes_encrypted && decryptedNote == null
              ? "Decrypt notes first to edit existing encrypted notes."
              : "Optional appointment note…"
          }
        />
        {appointment.notes_encrypted && decryptedNote == null && vaultKeyAvailable ? (
          <div className="cc-small cc-subtle">
            Existing encrypted notes are present. Decrypt them first before editing.
          </div>
        ) : null}
      </div>

      {decryptedNote != null ? (
        <div className="cc-panel-soft" style={{ padding: 12, borderRadius: 16 }}>
          <div className="cc-small cc-strong" style={{ marginBottom: 8 }}>
            Decrypted note preview
          </div>
          <div className="cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
            {decryptedNote || "—"}
          </div>
        </div>
      ) : null}

      <div className="cc-row">
        <button
          className="cc-btn cc-btn-primary"
          disabled={busy || !changed}
          onClick={() =>
            onSave(appointment, {
              title,
              provider,
              starts_at: startsAt,
              ends_at: endsAt || null,
              location,
              status,
              transport_status: transportStatus || null,
              transport_by: transportBy,
              notesPlain: notesValue,
              notesTouched,
              proofFile,
              removeProof,
            })
          }
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>

      {showAudit ? (
        <div className="cc-panel-soft cc-stack" style={{ padding: 14, borderRadius: 18 }}>
          <div className="cc-strong">Audit trail</div>

          {auditRows.length === 0 ? (
            <div className="cc-small">No audit entries yet.</div>
          ) : (
            <div className="cc-stack">
              {auditRows.map((log) => (
                <div key={log.id} className="cc-panel" style={{ padding: 12, borderRadius: 14 }}>
                  <div className="cc-small cc-subtle" style={{ marginBottom: 6 }}>
                    <b>{whoLabel(log.changed_by)}</b> • {new Date(log.changed_at).toLocaleString()}
                  </div>

                  {log.action === "insert" ? (
                    <div className="cc-wrap">
                      Created <b>{fieldLabel(log.field_name)}</b>
                      {log.new_value != null && log.new_value !== "" ? (
                        <>
                          : <b>{formatAuditValue(log.field_name, log.new_value)}</b>
                        </>
                      ) : null}
                    </div>
                  ) : log.action === "delete" ? (
                    <div className="cc-wrap">
                      Deleted <b>{formatAuditValue("appointment", log.old_value)}</b>
                    </div>
                  ) : (
                    <div className="cc-wrap">
                      Changed <b>{fieldLabel(log.field_name)}</b> from{" "}
                      <b>{formatAuditValue(log.field_name, log.old_value)}</b> to{" "}
                      <b>{formatAuditValue(log.field_name, log.new_value)}</b>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}