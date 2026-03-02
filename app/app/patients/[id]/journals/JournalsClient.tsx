"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type JournalRow = {
  id: string;
  patient_id: string;
  journal_type: string;
  occurred_at: string | null;
  created_by: string;
  created_at: string;
  shared_to_circle: boolean;
  pain_level: number | null;
  include_in_clinician_summary: boolean | null;

  content_encrypted: CipherEnvelopeV1 | null;
  mood_encrypted: CipherEnvelopeV1 | null;
};

export default function JournalsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [viewMode, setViewMode] = useState<"all" | "shared">("all");

  // form
  const [journalType, setJournalType] = useState("journal"); // plaintext
  const [mood, setMood] = useState("");
  const [content, setContent] = useState("");
  const [painLevel, setPainLevel] = useState<number | "">("");
  const [sharedToCircle, setSharedToCircle] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    if (!patientId) return;
    setLoading(true);
    setMsg(null);

    try {
      let query = supabase
        .from("journal_entries")
        .select(
          "id, patient_id, journal_type, occurred_at, created_by, created_at, shared_to_circle, pain_level, include_in_clinician_summary, content_encrypted, mood_encrypted"
        )
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (viewMode === "shared") {
        query = query.eq("shared_to_circle", true);
      }

      const { data, error } = await query;
      if (error) throw error;

      setRows((data ?? []) as unknown as JournalRow[]);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_journals");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, viewMode]);

  // Realtime: refresh when a new journal entry is inserted for this patient
  useEffect(() => {
    if (!patientId) return;

    const channel = supabase
      .channel(`journals:${patientId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "journal_entries", filter: `patient_id=eq.${patientId}` },
        () => refresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, supabase]);

  async function createEntry() {
    if (!vaultKey) return setMsg("no_vault_share");
    if (!content.trim()) return setMsg("content_required");
    setMsg(null);

    try {
      const contentEnv = await vaultEncryptString({
        vaultKey,
        plaintext: content,
        aad: { table: "journal_entries", column: "content_encrypted", patient_id: patientId },
      });

      const moodEnv = await vaultEncryptString({
        vaultKey,
        plaintext: mood,
        aad: { table: "journal_entries", column: "mood_encrypted", patient_id: patientId },
      });

      const { error } = await supabase.from("journal_entries").insert({
        patient_id: patientId,
        journal_type: journalType, // plaintext
        occurred_at: new Date().toISOString(),
        shared_to_circle: sharedToCircle,
        pain_level: painLevel === "" ? null : painLevel,
        include_in_clinician_summary: false,

        content_encrypted: contentEnv,
        mood_encrypted: moodEnv,
      });

      if (error) throw error;

      setMood("");
      setContent("");
      setPainLevel("");
      setSharedToCircle(true);

      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_journal");
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>Journals</h2>

      {msg && <p style={{ color: "#a00" }}>{msg}</p>}

      {!vaultKey ? (
        <div style={{ border: "1px solid #c3c", padding: 10, borderRadius: 10, marginBottom: 12 }}>
          Vault key not available on this device. You can’t decrypt or save encrypted content.
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <button
          onClick={() => setViewMode("all")}
          style={{ padding: "6px 10px", borderRadius: 10, opacity: viewMode === "all" ? 1 : 0.6 }}
        >
          All entries
        </button>
        <button
          onClick={() => setViewMode("shared")}
          style={{ padding: "6px 10px", borderRadius: 10, opacity: viewMode === "shared" ? 1 : 0.6 }}
        >
          Circle feed
        </button>
        <button onClick={refresh} disabled={loading} style={{ padding: "6px 10px", borderRadius: 10 }}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={journalType}
            onChange={(e) => setJournalType(e.target.value)}
            placeholder="journal_type (plaintext)"
          />
          <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="Mood (encrypted)" />
          <input
            type="number"
            value={painLevel}
            onChange={(e) => setPainLevel(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="Pain (0-10)"
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={sharedToCircle}
              onChange={(e) => setSharedToCircle(e.target.checked)}
            />
            Share to circle
          </label>
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Journal content (encrypted)"
          rows={4}
          style={{ width: "100%", marginTop: 10 }}
          disabled={!vaultKey}
        />

        <button
          onClick={createEntry}
          disabled={!vaultKey || !content.trim()}
          style={{ marginTop: 10, padding: "8px 10px", borderRadius: 10 }}
        >
          Save entry
        </button>
      </div>

      <div style={{ marginTop: 14 }}>
        {loading ? <div>Loading…</div> : null}
        {rows.map((r) => (
          <JournalCard key={r.id} row={r} patientId={patientId} vaultKey={vaultKey} />
        ))}
        {!loading && rows.length === 0 ? (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            {viewMode === "shared" ? "No shared entries yet." : "No entries yet."}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function JournalCard({
  row,
  patientId,
  vaultKey,
}: {
  row: JournalRow;
  patientId: string;
  vaultKey: Uint8Array | null;
}) {
  const [open, setOpen] = useState(false);
  const [ptMood, setPtMood] = useState<string>("");
  const [ptContent, setPtContent] = useState<string>("");

  async function decrypt() {
    if (!vaultKey) return;

    const mood = row.mood_encrypted
      ? await decryptStringWithLocalCache({
          patientId,
          table: "journal_entries",
          rowId: row.id,
          column: "mood_encrypted",
          env: row.mood_encrypted,
          vaultKey,
        })
      : "";

    const content = row.content_encrypted
      ? await decryptStringWithLocalCache({
          patientId,
          table: "journal_entries",
          rowId: row.id,
          column: "content_encrypted",
          env: row.content_encrypted,
          vaultKey,
        })
      : "";

    setPtMood(mood);
    setPtContent(content);
  }

  async function toggle() {
    if (!open) {
      setOpen(true);
      if (!ptContent) await decrypt();
    } else {
      setOpen(false);
    }
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          <b>{row.journal_type}</b> • {new Date(row.created_at).toLocaleString()}
          {row.shared_to_circle ? " • shared" : " • private"}
          {row.pain_level != null ? ` • pain:${row.pain_level}` : ""}
        </div>
        <button onClick={toggle} style={{ padding: "6px 10px", borderRadius: 10 }} disabled={!vaultKey}>
          {open ? "Hide" : "Decrypt"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div>
            <b>Mood:</b> {ptMood || "—"}
          </div>
          <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{ptContent || "—"}</div>
        </div>
      )}
    </div>
  );
}