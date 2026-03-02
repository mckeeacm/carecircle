// app/app/patients/[id]/journals/JournalsClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function JournalsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"all" | "shared">("all");

  const [journalType, setJournalType] = useState("journal");
  const [mood, setMood] = useState("");
  const [content, setContent] = useState("");
  const [painLevel, setPainLevel] = useState<number | "">("");
  const [sharedToCircle, setSharedToCircle] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    if (!patientId || !isUuid(patientId)) {
      setMsg(`invalid patientId: ${String(patientId)}`);
      return;
    }

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

      if (viewMode === "shared") query = query.eq("shared_to_circle", true);

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

  useEffect(() => {
    if (!patientId || !isUuid(patientId)) return;

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
  }, [patientId]);

  async function createEntry() {
    if (!vaultKey) return setMsg("no_vault_share");
    if (!content.trim()) return setMsg("content_required");
    if (!patientId || !isUuid(patientId)) return setMsg(`invalid patientId: ${String(patientId)}`);

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
        journal_type: journalType,
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
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Journals</h1>
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
            <div className="cc-subtle">You can’t decrypt or save encrypted content.</div>
          </div>
        ) : null}

        <div className="cc-row">
          <button
            className={`cc-tab ${viewMode === "all" ? "cc-tab-active" : ""}`}
            onClick={() => setViewMode("all")}
          >
            All entries
          </button>
          <button
            className={`cc-tab ${viewMode === "shared" ? "cc-tab-active" : ""}`}
            onClick={() => setViewMode("shared")}
          >
            Circle feed
          </button>
          <button className="cc-btn" onClick={refresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <h2 className="cc-h2">New entry</h2>

          <div className="cc-row">
            <div className="cc-field" style={{ minWidth: 220 }}>
              <div className="cc-label">journal_type (plaintext)</div>
              <input className="cc-input" value={journalType} onChange={(e) => setJournalType(e.target.value)} />
            </div>

            <div className="cc-field" style={{ minWidth: 220 }}>
              <div className="cc-label">Mood (encrypted)</div>
              <input className="cc-input" value={mood} onChange={(e) => setMood(e.target.value)} />
            </div>

            <div className="cc-field" style={{ width: 160 }}>
              <div className="cc-label">Pain (0–10)</div>
              <input
                className="cc-input"
                type="number"
                value={painLevel}
                onChange={(e) => setPainLevel(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </div>

            <label className="cc-check">
              <input type="checkbox" checked={sharedToCircle} onChange={(e) => setSharedToCircle(e.target.checked)} />
              <span className="cc-label">Share to circle</span>
            </label>
          </div>

          <div className="cc-field">
            <div className="cc-label">Journal content (encrypted)</div>
            <textarea className="cc-textarea" value={content} onChange={(e) => setContent(e.target.value)} />
          </div>

          <div className="cc-row">
            <button className="cc-btn cc-btn-primary" onClick={createEntry} disabled={!vaultKey || !content.trim()}>
              Save entry
            </button>
          </div>
        </div>

        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">Recent entries</h2>
          <div className="cc-spacer-12" />

          {rows.length === 0 ? (
            <div className="cc-small">{viewMode === "shared" ? "No shared entries yet." : "No entries yet."}</div>
          ) : (
            <div className="cc-stack">
              {rows.map((r) => (
                <JournalCard key={r.id} row={r} patientId={patientId} vaultKey={vaultKey} />
              ))}
            </div>
          )}
        </div>
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
    <div className="cc-panel-soft">
      <div className="cc-row-between">
        <div className="cc-wrap">
          <div className="cc-strong">
            {row.journal_type}{" "}
            <span className="cc-small">
              • {new Date(row.created_at).toLocaleString()} • {row.shared_to_circle ? "shared" : "private"}
              {row.pain_level != null ? ` • pain:${row.pain_level}` : ""}
            </span>
          </div>
        </div>

        <button className="cc-btn" onClick={toggle}>
          {open ? "Hide" : "Decrypt"}
        </button>
      </div>

      {open ? (
        <div className="cc-spacer-12">
          <div className="cc-small">
            <b>Mood:</b> {ptMood || "—"}
          </div>
          <div className="cc-spacer-12" />
          <div className="cc-wrap" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
            {ptContent || "—"}
          </div>
        </div>
      ) : null}
    </div>
  );
}