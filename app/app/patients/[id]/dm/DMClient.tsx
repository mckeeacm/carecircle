"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type ThreadRow = {
  id: string;
  patient_id: string;
  created_by: string;
  created_at: string;
  title_encrypted: CipherEnvelopeV1 | null;
  last_message_at: string | null;
  last_message_preview_encrypted: CipherEnvelopeV1 | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  patient_id: string;
  sender_id: string;
  sent_at: string;
  body_encrypted: CipherEnvelopeV1;
  meta_encrypted: CipherEnvelopeV1 | null;
};

type Member = { user_id: string; nickname: string | null; role: string; is_controller: boolean };

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function DmClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [threadTitlePlain, setThreadTitlePlain] = useState<Record<string, string>>({});
  const [threadPreviewPlain, setThreadPreviewPlain] = useState<Record<string, string>>({});

  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [bodyPlain, setBodyPlain] = useState<Record<string, string>>({});

  const [members, setMembers] = useState<Member[]>([]);
  const [newThreadTitle, setNewThreadTitle] = useState<string>("New thread");
  const [selectedUserIds, setSelectedUserIds] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<string>("");

  async function refreshThreads() {
    setMsg(null);
    setLoading(true);
    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      const { data: m, error: mErr } = await supabase
        .from("patient_members")
        .select("user_id, nickname, role, is_controller")
        .eq("patient_id", patientId);

      if (mErr) throw mErr;
      const ms = (m ?? []) as any[];
      setMembers(ms);

      // default select self and controllers
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      const nextSel: Record<string, boolean> = {};
      for (const r of ms) {
        if (r.user_id === uid || r.is_controller) nextSel[r.user_id] = true;
      }
      setSelectedUserIds((prev) => (Object.keys(prev).length ? prev : nextSel));

      const { data, error } = await supabase
        .from("dm_threads")
        .select("id, patient_id, created_by, created_at, title_encrypted, last_message_at, last_message_preview_encrypted")
        .eq("patient_id", patientId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setThreads((data ?? []) as ThreadRow[]);

      if (!activeThreadId && (data ?? [])[0]?.id) setActiveThreadId((data ?? [])[0].id);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_threads");
    } finally {
      setLoading(false);
    }
  }

  async function refreshMessages(threadId: string) {
    setMsg(null);
    try {
      const { data, error } = await supabase
        .from("dm_messages")
        .select("id, thread_id, patient_id, sender_id, sent_at, body_encrypted, meta_encrypted")
        .eq("patient_id", patientId)
        .eq("thread_id", threadId)
        .order("sent_at", { ascending: true })
        .limit(200);

      if (error) throw error;
      setMessages((data ?? []) as MessageRow[]);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_messages");
    }
  }

  useEffect(() => {
    refreshThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  useEffect(() => {
    if (activeThreadId) refreshMessages(activeThreadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  async function decryptThreadIfNeeded(t: ThreadRow) {
    if (!vaultKey) return;
    if (threadTitlePlain[t.id] != null && threadPreviewPlain[t.id] != null) return;

    if (t.title_encrypted && threadTitlePlain[t.id] == null) {
      const plain = await decryptStringWithLocalCache({
        patientId,
        table: "dm_threads",
        rowId: t.id,
        column: "title_encrypted",
        env: t.title_encrypted,
        vaultKey,
      });
      setThreadTitlePlain((p) => ({ ...p, [t.id]: plain }));
    }

    if (t.last_message_preview_encrypted && threadPreviewPlain[t.id] == null) {
      const plain = await decryptStringWithLocalCache({
        patientId,
        table: "dm_threads",
        rowId: t.id,
        column: "last_message_preview_encrypted",
        env: t.last_message_preview_encrypted,
        vaultKey,
      });
      setThreadPreviewPlain((p) => ({ ...p, [t.id]: plain }));
    }
  }

  async function decryptMessageIfNeeded(m: MessageRow) {
    if (!vaultKey) return;
    if (bodyPlain[m.id] != null) return;

    const plain = await decryptStringWithLocalCache({
      patientId,
      table: "dm_messages",
      rowId: m.id,
      column: "body_encrypted",
      env: m.body_encrypted,
      vaultKey,
    });

    setBodyPlain((p) => ({ ...p, [m.id]: plain }));
  }

  async function createThread() {
    setMsg(null);
    try {
      if (!vaultKey) throw new Error("no_vault_share");

      const userIds = Object.entries(selectedUserIds)
        .filter(([, v]) => v)
        .map(([k]) => k);

      if (userIds.length < 2) throw new Error("select_at_least_2_members");

      const titleEnv = await vaultEncryptString({
        vaultKey,
        plaintext: newThreadTitle || "New thread",
        aad: { table: "dm_threads", column: "title_encrypted", patient_id: patientId },
      });

      // Create thread
      const { data: t, error: tErr } = await supabase
        .from("dm_threads")
        .insert({
          patient_id: patientId,
          title_encrypted: titleEnv,
        })
        .select("id")
        .single();

      if (tErr) throw tErr;

      const threadId = t.id as string;

      // Add members (controller-only by current policies)
      const rows = userIds.map((uid) => ({
        thread_id: threadId,
        user_id: uid,
      }));

      const { error: mErr } = await supabase.from("dm_thread_members").insert(rows);
      if (mErr) throw mErr;

      await refreshThreads();
      setActiveThreadId(threadId);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_thread");
    }
  }

  async function sendMessage() {
    setMsg(null);
    try {
      if (!vaultKey) throw new Error("no_vault_share");
      if (!activeThreadId) throw new Error("no_thread_selected");
      if (!draft.trim()) throw new Error("message_empty");

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("not_authenticated");

      const bodyEnv = await vaultEncryptString({
        vaultKey,
        plaintext: draft,
        aad: { table: "dm_messages", column: "body_encrypted", patient_id: patientId },
      });

      const previewEnv = await vaultEncryptString({
        vaultKey,
        plaintext: draft.slice(0, 120),
        aad: { table: "dm_threads", column: "last_message_preview_encrypted", patient_id: patientId },
      });

      const sentAt = new Date().toISOString();

      const { error: insErr } = await supabase.from("dm_messages").insert({
        thread_id: activeThreadId,
        patient_id: patientId,
        sender_id: uid,
        sent_at: sentAt,
        body_encrypted: bodyEnv,
        meta_encrypted: null,
      });

      if (insErr) throw insErr;

      // best-effort update thread “last message”
      await supabase
        .from("dm_threads")
        .update({ last_message_at: sentAt, last_message_preview_encrypted: previewEnv })
        .eq("id", activeThreadId);

      setDraft("");
      await refreshThreads();
      await refreshMessages(activeThreadId);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_send_message");
    }
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Direct messages</h1>
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
            <div className="cc-subtle">Threads and messages are E2EE and can’t be decrypted/sent without vault access.</div>
          </div>
        ) : null}

        <div className="cc-grid-2-125">
          {/* Threads */}
          <div className="cc-card cc-card-pad cc-stack">
            <div className="cc-row-between">
              <h2 className="cc-h2">Threads</h2>
              <button className="cc-btn" onClick={refreshThreads} disabled={loading}>
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>

            <div className="cc-panel-blue cc-stack">
              <div className="cc-strong">New thread</div>

              <div className="cc-field">
                <div className="cc-label">Title (E2EE)</div>
                <input className="cc-input" value={newThreadTitle} onChange={(e) => setNewThreadTitle(e.target.value)} disabled={!vaultKey} />
              </div>

              <div className="cc-small cc-subtle">Select members:</div>
              <div className="cc-stack">
                {members.map((m) => (
                  <label key={m.user_id} className="cc-check">
                    <input
                      type="checkbox"
                      checked={!!selectedUserIds[m.user_id]}
                      onChange={(e) => setSelectedUserIds((p) => ({ ...p, [m.user_id]: e.target.checked }))}
                    />
                    <span className="cc-wrap">{m.nickname ?? m.user_id}</span>
                    <span className="cc-small">({m.role}{m.is_controller ? ", controller" : ""})</span>
                  </label>
                ))}
              </div>

              <button className="cc-btn cc-btn-primary" onClick={createThread} disabled={!vaultKey}>
                Create thread
              </button>

              <div className="cc-small cc-subtle">
                Note: your current RLS only allows controllers to add thread members. If you want non-controllers to create threads, we’ll adjust policies deliberately.
              </div>
            </div>

            <div className="cc-stack">
              {threads.length === 0 ? (
                <div className="cc-small">No threads yet.</div>
              ) : (
                threads.map((t) => {
                  const title = threadTitlePlain[t.id] ?? (t.title_encrypted ? "Encrypted title" : "Untitled");
                  const prev = threadPreviewPlain[t.id] ?? (t.last_message_preview_encrypted ? "Encrypted preview" : "");
                  const active = t.id === activeThreadId;

                  return (
                    <button
                      key={t.id}
                      className={`cc-btn ${active ? "cc-btn-primary" : ""}`}
                      onClick={async () => {
                        setActiveThreadId(t.id);
                        await decryptThreadIfNeeded(t);
                      }}
                      disabled={!vaultKey && (t.title_encrypted != null || t.last_message_preview_encrypted != null)}
                      title={t.id}
                      style={{ justifyContent: "space-between", width: "100%" }}
                    >
                      <span className="cc-wrap">{title}</span>
                      <span className="cc-small">{prev ? `• ${prev}` : ""}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="cc-card cc-card-pad cc-stack">
            <div className="cc-row-between">
              <h2 className="cc-h2">Messages</h2>
              <span className="cc-small cc-wrap">{activeThreadId || "No thread selected"}</span>
            </div>

            {!activeThreadId ? (
              <div className="cc-panel">Select a thread to view messages.</div>
            ) : (
              <>
                <div className="cc-stack">
                  {messages.length === 0 ? (
                    <div className="cc-small">No messages yet.</div>
                  ) : (
                    messages.map((m) => {
                      const plain = bodyPlain[m.id];
                      return (
                        <div key={m.id} className="cc-panel-soft">
                          <div className="cc-row-between">
                            <div className="cc-small cc-wrap">
                              <b>{m.sender_id}</b> • {new Date(m.sent_at).toLocaleString()}
                            </div>
                            <button className="cc-btn" onClick={() => decryptMessageIfNeeded(m)} disabled={!vaultKey || !!plain}>
                              {plain ? "Decrypted" : "Decrypt"}
                            </button>
                          </div>
                          <div className="cc-spacer-12" />
                          <div className="cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
                            {plain ?? "—"}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="cc-panel-green cc-stack">
                  <div className="cc-field">
                    <div className="cc-label">New message (E2EE)</div>
                    <textarea className="cc-textarea" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!vaultKey} />
                  </div>
                  <button className="cc-btn cc-btn-primary" onClick={sendMessage} disabled={!vaultKey}>
                    Send
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}