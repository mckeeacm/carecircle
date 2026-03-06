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

type MembershipRow = {
  user_id: string;
  nickname: string | null;
  role: string | null;
  is_controller: boolean | null;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function JournalsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [rows, setRows] = useState<JournalRow[]>([]);
  const [sobrietyRows, setSobrietyRows] = useState<SobrietyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"all" | "shared">("all");

  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [myRole, setMyRole] = useState<string>("");
  const [isPatientRole, setIsPatientRole] = useState(false);

  const [journalType, setJournalType] = useState("journal");
  const [mood, setMood] = useState("");
  const [content, setContent] = useState("");
  const [painLevel, setPainLevel] = useState<number | "">("");
  const [sharedToCircle, setSharedToCircle] = useState(true);

  const [trackerMood, setTrackerMood] = useState<string>("");
  const [trackerPain, setTrackerPain] = useState<number | null>(null);
  const [trackerSobriety, setTrackerSobriety] = useState<"yes" | "no" | "">("");
  const [trackerShare, setTrackerShare] = useState(true);

  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    if (!patientId || !isUuid(patientId)) {
      setMsg(`invalid patientId: ${String(patientId)}`);
      return;
    }

    setLoading(true);
    setMsg(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const uid = auth.user?.id ?? "";
      setCurrentUserId(uid);

      const { data: myMemberRows, error: myMemberErr } = await supabase
        .from("patient_members")
        .select("user_id, nickname, role, is_controller")
        .eq("patient_id", patientId)
        .eq("user_id", uid)
        .limit(1);

      if (myMemberErr) throw myMemberErr;

      const me = ((myMemberRows ?? [])[0] ?? null) as MembershipRow | null;
      const role = me?.role ?? "";
      setMyRole(role);
      setIsPatientRole(role === "patient");

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

      setRows((data ?? []) as JournalRow[]);

      const { data: sobriety, error: sErr } = await supabase
        .from("sobriety_logs")
        .select(
          "id, patient_id, occurred_at, status, substance, intensity, note_encrypted, created_by, created_at"
        )
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (!sErr) {
        setSobrietyRows((sobriety ?? []) as SobrietyRow[]);
      } else {
        setSobrietyRows([]);
      }
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

  async function createEntry() {
    if (!vaultKey) return setMsg("no_vault_share");
    if (!content.trim()) return setMsg("content_required");
    if (!patientId || !isUuid(patientId)) return setMsg(`invalid patientId: ${String(patientId)}`);

    setMsg(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const uid = auth.user?.id;
      if (!uid) throw new Error("not_authenticated");

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

      const effectiveSharedToCircle = isPatientRole ? sharedToCircle : true;

      const { error } = await supabase.from("journal_entries").insert({
        patient_id: patientId,
        journal_type: journalType,
        occurred_at: new Date().toISOString(),
        created_by: uid,
        shared_to_circle: effectiveSharedToCircle,
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

  async function saveTrackers() {
    if (!vaultKey) return setMsg("no_vault_share");
    if (!isPatientRole) return setMsg("only_patient_can_log_trackers");
    if (!patientId || !isUuid(patientId)) return setMsg(`invalid patientId: ${String(patientId)}`);
    if (!trackerMood && trackerPain == null && !trackerSobriety) return setMsg("choose_at_least_one_tracker");

    setMsg(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const uid = auth.user?.id;
      if (!uid) throw new Error("not_authenticated");

      if (trackerMood || trackerPain != null) {
        const contentParts: string[] = [];
        if (trackerMood) contentParts.push(`Mood: ${trackerMood}`);
        if (trackerPain != null) contentParts.push(`Pain: ${trackerPain}/10`);

        const contentEnv = await vaultEncryptString({
          vaultKey,
          plaintext: contentParts.join("\n"),
          aad: { table: "journal_entries", column: "content_encrypted", patient_id: patientId },
        });

        const moodEnv = await vaultEncryptString({
          vaultKey,
          plaintext: trackerMood || "",
          aad: { table: "journal_entries", column: "mood_encrypted", patient_id: patientId },
        });

        const { error: jErr } = await supabase.from("journal_entries").insert({
          patient_id: patientId,
          journal_type: "tracker",
          occurred_at: new Date().toISOString(),
          created_by: uid,
          shared_to_circle: trackerShare,
          pain_level: trackerPain,
          include_in_clinician_summary: false,
          content_encrypted: contentEnv,
          mood_encrypted: moodEnv,
        });

        if (jErr) throw jErr;
      }

      if (trackerSobriety) {
        const noteText = trackerSobriety === "yes" ? "Sobriety maintained" : "Sobriety concern logged";

        const noteEnv = await vaultEncryptString({
          vaultKey,
          plaintext: noteText,
          aad: { table: "sobriety_logs", column: "note_encrypted", patient_id: patientId },
        });

        const { error: sErr } = await supabase.from("sobriety_logs").insert({
          patient_id: patientId,
          occurred_at: new Date().toISOString(),
          status: trackerSobriety === "yes" ? "yes" : "no",
          substance: null,
          intensity: null,
          note_encrypted: noteEnv,
          created_by: uid,
        });

        if (sErr) throw sErr;

        if (trackerShare) {
          const contentEnv = await vaultEncryptString({
            vaultKey,
            plaintext: `Sobriety today: ${trackerSobriety === "yes" ? "Yes" : "No"}`,
            aad: { table: "journal_entries", column: "content_encrypted", patient_id: patientId },
          });

          const moodEnv = await vaultEncryptString({
            vaultKey,
            plaintext: "",
            aad: { table: "journal_entries", column: "mood_encrypted", patient_id: patientId },
          });

          const { error: shareErr } = await supabase.from("journal_entries").insert({
            patient_id: patientId,
            journal_type: "sobriety-tracker",
            occurred_at: new Date().toISOString(),
            created_by: uid,
            shared_to_circle: true,
            pain_level: null,
            include_in_clinician_summary: false,
            content_encrypted: contentEnv,
            mood_encrypted: moodEnv,
          });

          if (shareErr) throw shareErr;
        }
      }

      setTrackerMood("");
      setTrackerPain(null);
      setTrackerSobriety("");
      setTrackerShare(true);
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_save_trackers");
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

        {isPatientRole ? (
          <div className="cc-card cc-card-pad cc-stack">
            <h2 className="cc-h2">Trackers</h2>
            <div className="cc-subtle">
              Simple daily patient inputs. You can also share them to the circle journal.
            </div>

            <div className="cc-grid-3">
              <div className="cc-panel-soft cc-stack">
                <div className="cc-strong">Mood</div>
                <div className="cc-row">
                  {["😞", "🙁", "😐", "🙂", "😄"].map((emoji) => (
                    <button
                      key={emoji}
                      className={`cc-btn ${trackerMood === emoji ? "cc-btn-primary" : ""}`}
                      onClick={() => setTrackerMood(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div className="cc-panel-soft cc-stack">
                <div className="cc-strong">Pain</div>
                <div className="cc-row" style={{ flexWrap: "wrap" }}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      className={`cc-btn ${trackerPain === n ? "cc-btn-primary" : ""}`}
                      onClick={() => setTrackerPain(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="cc-panel-soft cc-stack">
                <div className="cc-strong">Sobriety</div>
                <div className="cc-row">
                  <button
                    className={`cc-btn ${trackerSobriety === "yes" ? "cc-btn-primary" : ""}`}
                    onClick={() => setTrackerSobriety("yes")}
                  >
                    Yes
                  </button>
                  <button
                    className={`cc-btn ${trackerSobriety === "no" ? "cc-btn-danger" : ""}`}
                    onClick={() => setTrackerSobriety("no")}
                  >
                    No
                  </button>
                </div>
              </div>
            </div>

            <label className="cc-check">
              <input type="checkbox" checked={trackerShare} onChange={(e) => setTrackerShare(e.target.checked)} />
              <span className="cc-label">Share trackers to circle journal</span>
            </label>

            <div className="cc-row">
              <button className="cc-btn cc-btn-primary" onClick={saveTrackers} disabled={!vaultKey}>
                Save trackers
              </button>
            </div>
          </div>
        ) : null}

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
                min={0}
                max={10}
                value={painLevel}
                onChange={(e) => setPainLevel(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </div>

            {isPatientRole ? (
              <label className="cc-check">
                <input type="checkbox" checked={sharedToCircle} onChange={(e) => setSharedToCircle(e.target.checked)} />
                <span className="cc-label">Share to circle</span>
              </label>
            ) : (
              <div className="cc-small cc-subtle">Entries from non-patient members are always shared to the circle.</div>
            )}
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

        {sobrietyRows.length > 0 ? (
          <div className="cc-card cc-card-pad">
            <h2 className="cc-h2">Recent sobriety tracker logs</h2>
            <div className="cc-spacer-12" />
            <div className="cc-stack">
              {sobrietyRows.map((r) => (
                <SobrietyCard key={r.id} row={r} patientId={patientId} vaultKey={vaultKey} />
              ))}
            </div>
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

function SobrietyCard({
  row,
  patientId,
  vaultKey,
}: {
  row: SobrietyRow;
  patientId: string;
  vaultKey: Uint8Array | null;
}) {
  const [plain, setPlain] = useState("");

  async function decrypt() {
    if (!vaultKey || !row.note_encrypted || plain) return;

    const text = await decryptStringWithLocalCache({
      patientId,
      table: "sobriety_logs",
      rowId: row.id,
      column: "note_encrypted",
      env: row.note_encrypted,
      vaultKey,
    });

    setPlain(text);
  }

  return (
    <div className="cc-panel-soft">
      <div className="cc-row-between">
        <div className="cc-wrap">
          <div className="cc-strong">
            Sobriety: {row.status}
            <span className="cc-small"> • {new Date(row.created_at).toLocaleString()}</span>
          </div>
        </div>

        <button className="cc-btn" onClick={decrypt} disabled={!vaultKey || !row.note_encrypted || !!plain}>
          {plain ? "Decrypted" : row.note_encrypted ? "Decrypt" : "No note"}
        </button>
      </div>

      {plain ? (
        <div className="cc-spacer-12">
          <div className="cc-panel">{plain}</div>
        </div>
      ) : null}
    </div>
  );
}