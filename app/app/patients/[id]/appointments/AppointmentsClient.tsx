"use client";

import { useEffect, useMemo, useState } from "react";
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
  title: string | null;
  location: string | null;
  provider: string | null;
  notes_encrypted: CipherEnvelopeV1 | null;
  status: string | null;
  created_by: string;
  created_at: string;
};

function toLocalInputValue(iso: string): string {
  // yyyy-mm-ddThh:mm for <input type="datetime-local">
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(v: string): string {
  // Treat as local time, convert to ISO
  return new Date(v).toISOString();
}

export default function AppointmentsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // selection + decrypted cache
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notesPlainById, setNotesPlainById] = useState<Record<string, string>>({});

  // form fields
  const [startsAt, setStartsAt] = useState<string>(() => toLocalInputValue(new Date().toISOString()));
  const [endsAt, setEndsAt] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [location, setLocation] = useState<string>("");
  const [provider, setProvider] = useState<string>("");
  const [status, setStatus] = useState<string>("scheduled");
  const [notesPlain, setNotesPlain] = useState<string>("");

  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    setMsg(null);
    try {
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, patient_id, starts_at, ends_at, title, location, provider, notes_encrypted, status, created_by, created_at"
        )
        .eq("patient_id", patientId)
        .order("starts_at", { ascending: true })
        .limit(200);

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

  function resetForm() {
    setActiveId(null);
    setStartsAt(toLocalInputValue(new Date().toISOString()));
    setEndsAt("");
    setTitle("");
    setLocation("");
    setProvider("");
    setStatus("scheduled");
    setNotesPlain("");
  }

  async function loadIntoForm(a: AppointmentRow) {
    setActiveId(a.id);
    setStartsAt(toLocalInputValue(a.starts_at));
    setEndsAt(a.ends_at ? toLocalInputValue(a.ends_at) : "");
    setTitle(a.title ?? "");
    setLocation(a.location ?? "");
    setProvider(a.provider ?? "");
    setStatus(a.status ?? "scheduled");

    // decrypt notes into form if possible
    if (vaultKey && a.notes_encrypted) {
      const cached = notesPlainById[a.id];
      if (cached != null) {
        setNotesPlain(cached);
      } else {
        const plain = await decryptStringWithLocalCache({
          patientId,
          table: "appointments",
          rowId: a.id,
          column: "notes_encrypted",
          env: a.notes_encrypted,
          vaultKey,
        });
        setNotesPlainById((prev) => ({ ...prev, [a.id]: plain }));
        setNotesPlain(plain);
      }
    } else {
      setNotesPlain("");
    }
  }

  async function decryptNotesPreview(a: AppointmentRow) {
    if (!vaultKey || !a.notes_encrypted) return;
    if (notesPlainById[a.id] != null) return;

    const plain = await decryptStringWithLocalCache({
      patientId,
      table: "appointments",
      rowId: a.id,
      column: "notes_encrypted",
      env: a.notes_encrypted,
      vaultKey,
    });

    setNotesPlainById((prev) => ({ ...prev, [a.id]: plain }));
  }

  async function save() {
    if (!vaultKey) return setMsg("no_vault_share");
    setSaving(true);
    setMsg(null);

    try {
      const notesEnv = await vaultEncryptString({
        vaultKey,
        plaintext: notesPlain,
        aad: { table: "appointments", column: "notes_encrypted", patient_id: patientId },
      });

      const payload: Partial<AppointmentRow> & { patient_id: string; starts_at: string; notes_encrypted: any } = {
        patient_id: patientId,
        starts_at: fromLocalInputValue(startsAt),
        ends_at: endsAt ? fromLocalInputValue(endsAt) : null,
        title: title.trim() ? title.trim() : null,
        location: location.trim() ? location.trim() : null,
        provider: provider.trim() ? provider.trim() : null,
        status: status.trim() ? status.trim() : null,
        notes_encrypted: notesEnv,
      };

      if (!activeId) {
        const { error } = await supabase.from("appointments").insert(payload as any);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("appointments").update(payload as any).eq("id", activeId);
        if (error) throw error;

        // update decrypted cache for this id
        setNotesPlainById((prev) => ({ ...prev, [activeId]: notesPlain }));
      }

      await refresh();
      resetForm();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_save_appointment");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setMsg(null);
    try {
      const { error } = await supabase.from("appointments").delete().eq("id", id);
      if (error) throw error;
      if (activeId === id) resetForm();
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_delete_appointment");
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>Appointments</h2>

      {msg && <div style={{ border: "1px solid #c33", padding: 10, borderRadius: 10, marginBottom: 12 }}>{msg}</div>}

      {!vaultKey && (
        <div style={{ border: "1px solid #f0c", padding: 10, borderRadius: 10, marginBottom: 12 }}>
          Vault key not available on this device. You can’t decrypt or save encrypted notes.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 12 }}>
        {/* List */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <b>List</b>
            <button onClick={refresh} disabled={loading} style={{ padding: "6px 10px", borderRadius: 10 }}>
              {loading ? "…" : "Refresh"}
            </button>
          </div>

          <div style={{ marginTop: 10 }}>
            {rows.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.7 }}>No appointments.</div>
            ) : (
              rows.map((a) => {
                const preview = notesPlainById[a.id];
                return (
                  <div
                    key={a.id}
                    style={{
                      border: a.id === activeId ? "2px solid #222" : "1px solid #f0f0f0",
                      borderRadius: 12,
                      padding: 10,
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{a.title ?? "Appointment"}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{new Date(a.starts_at).toLocaleString()}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {a.provider ? `Provider: ${a.provider}` : ""}
                      {a.location ? ` • ${a.location}` : ""}
                      {a.status ? ` • ${a.status}` : ""}
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button
                        onClick={() => loadIntoForm(a)}
                        style={{ padding: "6px 10px", borderRadius: 10 }}
                      >
                        Edit
                      </button>

                      <button
                        onClick={() => decryptNotesPreview(a)}
                        disabled={!vaultKey || !a.notes_encrypted || preview != null}
                        style={{ padding: "6px 10px", borderRadius: 10 }}
                      >
                        {preview != null ? "Notes decrypted" : "Decrypt notes"}
                      </button>

                      <button
                        onClick={() => remove(a.id)}
                        style={{ padding: "6px 10px", borderRadius: 10 }}
                      >
                        Delete
                      </button>
                    </div>

                    {preview != null ? (
                      <div style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>
                        {preview.length > 140 ? preview.slice(0, 140) + "…" : preview}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Editor */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <b>{activeId ? "Edit appointment" : "New appointment"}</b>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={resetForm} style={{ padding: "6px 10px", borderRadius: 10 }}>
                New
              </button>
              <button onClick={save} disabled={!vaultKey || saving} style={{ padding: "6px 10px", borderRadius: 10 }}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              Starts
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              Ends (optional)
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Checkup" />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              Location
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              Provider
              <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Optional" />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              Status
              <input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="scheduled / cancelled / done" />
            </label>

            <div>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Notes (E2EE)</div>
              <textarea
                value={notesPlain}
                onChange={(e) => setNotesPlain(e.target.value)}
                rows={6}
                style={{ width: "100%" }}
                placeholder="Encrypted appointment notes…"
                disabled={!vaultKey}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}