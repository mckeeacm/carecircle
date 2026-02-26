"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type SobrietyRow = {
  id: string;
  patient_id: string;
  occurred_at: string | null;
  status: string | null;
  substance: string | null;
  intensity: number | null;
  note_encrypted: CipherEnvelopeV1 | null;
  created_by: string;
  created_at: string;
};

export default function SobrietyClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { patientId, vaultKey } = usePatientVault();

  const [rows, setRows] = useState<SobrietyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // form
  const [occurredAt, setOccurredAt] = useState<string>(() => new Date().toISOString().slice(0, 16)); // yyyy-mm-ddThh:mm
  const [status, setStatus] = useState<string>("ok");
  const [substance, setSubstance] = useState<string>("alcohol");
  const [intensity, setIntensity] = useState<number | "">("");
  const [note, setNote] = useState<string>("");

  async function refresh() {
    if (!patientId) return;
    setLoading(true);
    setMsg(null);
    try {
      const { data, error } = await supabase
        .from("sobriety_logs")
        .select("id, patient_id, occurred_at, status, substance, intensity, note_encrypted, created_by, created_at")
        .eq("patient_id", patientId)
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setRows((data ?? []) as unknown as SobrietyRow[]);
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

  // realtime inserts
  useEffect(() => {
    if (!patientId) return;

    const channel = supabase
      .channel(`sobriety:${patientId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sobriety_logs", filter: `patient_id=eq.${patientId}` },
        () => refresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  async function createLog() {
    if (!vaultKey) return setMsg("no_vault_share");
    setMsg(null);

    try {
      const noteEnv = await vaultEncryptString({
        vaultKey,
        plaintext: note,
        aad: { table: "sobriety_logs", column: "note_encrypted", patient_id: patientId },
      });

      const { error } = await supabase.from("sobriety_logs").insert({
        patient_id: patientId,
        occurred_at: new Date(occurredAt).toISOString(),
        status,
        substance,
        intensity: intensity === "" ? null : intensity,
        note_encrypted: noteEnv,
      });

      if (error) throw error;

      setNote("");
      setIntensity("");
      setStatus("ok");
      setSubstance("alcohol");
      setOccurredAt(new Date().toISOString().slice(0, 16));

      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_sobriety");
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>Sobriety</h2>

      {msg && <p style={{ color: "#a00" }}>{msg}</p>}

      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
            When
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
            Status
            <input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="ok / craving / relapse" />
          </label>

          <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
            Substance
            <input value={substance} onChange={(e) => setSubstance(e.target.value)} placeholder="alcohol, nicotine, ..." />
          </label>

          <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
            Intensity
            <input
              type="number"
              value={intensity}
              onChange={(e) => setIntensity(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="0-10"
            />
          </label>
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (encrypted)"
          rows={3}
          style={{ width: "100%", marginTop: 10 }}
        />

        <button
          onClick={createLog}
          disabled={!vaultKey}
          style={{ marginTop: 10, padding: "8px 10px", borderRadius: 10 }}
        >
          Save log
        </button>
      </div>

      <div style={{ marginTop: 14 }}>
        {loading ? <div>Loading…</div> : null}
        {rows.map((r) => (
          <SobrietyCard key={r.id} row={r} patientId={patientId} vaultKey={vaultKey} />
        ))}
        {!loading && rows.length === 0 ? (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>No logs yet.</div>
        ) : null}
      </div>
    </div>
  );
}

function SobrietyCard({
  row,
  patientId,
  vaultKey,
}: {
  row: SobrietyRow;
  patientId: string;
  vaultKey: Uint8Array | null;
}) {
  const [open, setOpen] = useState(false);
  const [ptNote, setPtNote] = useState<string>("");

  async function decrypt() {
    if (!vaultKey || !row.note_encrypted) return;

    const note = await decryptStringWithLocalCache({
      patientId,
      table: "sobriety_logs",
      rowId: row.id,
      column: "note_encrypted",
      env: row.note_encrypted,
      vaultKey,
    });

    setPtNote(note);
  }

  async function toggle() {
    if (!open) {
      setOpen(true);
      if (!ptNote) await decrypt();
    } else {
      setOpen(false);
    }
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          <b>{row.status ?? "—"}</b>
          {row.substance ? ` • ${row.substance}` : ""}
          {row.intensity != null ? ` • intensity:${row.intensity}` : ""}
          {" • "}
          {new Date(row.occurred_at ?? row.created_at).toLocaleString()}
        </div>
        <button onClick={toggle} style={{ padding: "6px 10px", borderRadius: 10 }}>
          {open ? "Hide" : "Decrypt"}
        </button>
      </div>

      {open && <div style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{ptNote || "—"}</div>}
    </div>
  );
}