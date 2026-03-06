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

type Member = {
  user_id: string;
  nickname: string | null;
  role: string;
  is_controller: boolean;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function DMClient({ patientId }: { patientId: string }) {
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
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [selectedRecipientId, setSelectedRecipientId] = useState<string>("");
  const [newThreadTitle, setNewThreadTitle] = useState<string>("Direct message");
  const [draft, setDraft] = useState<string>("");

  async function refreshThreads() {
    setMsg(null);
    setLoading(true);

    try {
      if (!patientId || !isUuid(patientId)) {
        throw new Error(`invalid patientId: ${String(patientId)}`);
      }

      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const uid = auth.user?.id;
      if (!uid) throw new Error("not_authenticated");
      setCurrentUserId(uid);

      const { data: memberRows, error: memberErr } = await supabase.rpc("dm_private_members_list", {
        pid: patientId,
      });

      if (memberErr) throw memberErr;

      const allMembers = ((memberRows ?? []) as Member[]).filter((m) => m.user_id !== uid);
      setMembers(allMembers);

      if (!selectedRecipientId && allMembers[0]?.user_id) {
        setSelectedRecipientId(allMembers[0].user_id);
      }

      const { data: threadRows, error: threadErr } = await supabase.rpc("dm_private_threads_list", {
        pid: patientId,
      });

      if (threadErr) throw threadErr;

      const nextThreads = (threadRows ?? []) as ThreadRow[];
      setThreads(nextThreads);

      if (!activeThreadId && nextThreads[0]?.id) {
        setActiveThreadId(nextThreads[0].id);
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_threads");
    } finally {
      setLoading(false);
    }
  }

  async function refreshMessages(threadId: string) {
    setMsg(null);

    try {
      const { data, error } = await supabase.rpc("dm_private_messages_list", {
        p_thread_id: threadId,
      });

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

  async function openOrCreateDirectThread() {
    setMsg(null);

    try {
      if (!vaultKey) throw new Error("no_vault_share");
      if (!selectedRecipientId) throw new Error("select_a_member");

      const titleEnv = await vaultEncryptString({
        vaultKey,
        plaintext: newThreadTitle.trim() || "Direct message",
        aad: { table: "dm_threads", column: "title_encrypted", patient_id: patientId },
      });

      const { data, error } = await supabase.rpc("dm_private_open_thread", {
        pid: patientId,
        other_uid: selectedRecipientId,
        p_title_encrypted: titleEnv,
      });

      if (error) throw error;

      const threadId = data as string;
      await refreshThreads();
      setActiveThreadId(threadId);
      await refreshMessages(threadId);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_open_direct_thread");
    }
  }

  async function sendMessage() {
    setMsg(null);

    try {
      if (!vaultKey) throw new Error("no_vault_share");
      if (!activeThreadId) throw new Error("no_thread_selected");
      if (!draft.trim()) throw new Error("message_empty");

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

      const { error } = await supabase.rpc("dm_private_send_message", {
        p_thread_id: activeThreadId,
        p_patient_id: patientId,
        p_body_encrypted: bodyEnv,
        p_meta_encrypted: null,
        p_sent_at: sentAt,
        p_preview_encrypted: previewEnv,
      });

      if (error) throw error;

      setDraft("");
      await refreshThreads();
      await refreshMessages(activeThreadId);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_send_message");
    }
  }

  function memberLabel(m: Member) {
    return `${m.nickname ?? m.user_id} (${m.role}${m.is_controller ? ", controller" : ""})`;
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
            <div className="cc-subtle">Threads and messages are E2EE and can’t be decrypted or sent without vault access.</div>
          </div>
        ) : null}

        <div className="cc-panel-blue">
          <div className="cc-strong">Private 1-to-1 direct messages</div>
          <div className="cc-subtle">
            This page is for direct messaging between two circle members. For updates to multiple recipients, use the circle journal.
          </div>
        </div>

        <div className="cc-grid-2-125">
          <div className="cc-card cc-card-pad cc-stack">
            <div className="cc-row-between">
              <h2 className="cc-h2">Threads</h2>
              <button className="cc-btn" onClick={refreshThreads} disabled={loading}>
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>

            <div className="cc-panel-blue cc-stack">
              <div className="cc-strong">New direct message</div>

              <div className="cc-field">
                <div className="cc-label">Who do you want to message?</div>
                <select
                  className="cc-select"
                  value={selectedRecipientId}
                  onChange={(e) => setSelectedRecipientId(e.target.value)}
                  disabled={!vaultKey}
                >
                  <option value="">Select a circle member…</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cc-field">
                <div className="cc-label">Thread title (E2EE)</div>
                <input
                  className="cc-input"
                  value={newThreadTitle}
                  onChange={(e) => setNewThreadTitle(e.target.value)}
                  disabled={!vaultKey}
                />
              </div>

              <button className="cc-btn cc-btn-primary" onClick={openOrCreateDirectThread} disabled={!vaultKey}>
                Open direct message
              </button>

              <div className="cc-small cc-subtle">
                This creates or reopens a private thread between you and one other circle member.
              </div>
            </div>

            <div className="cc-stack">
              {threads.length === 0 ? (
                <div className="cc-small">No direct message threads yet.</div>
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

          <div className="cc-card cc-card-pad cc-stack">
            <div className="cc-row-between">
              <h2 className="cc-h2">Messages</h2>
              <span className="cc-small cc-wrap">{activeThreadId || "No thread selected"}</span>
            </div>

            {!activeThreadId ? (
              <div className="cc-panel">Select or open a direct message thread.</div>
            ) : (
              <>
                <div className="cc-stack">
                  {messages.length === 0 ? (
                    <div className="cc-small">No messages yet.</div>
                  ) : (
                    messages.map((m) => {
                      const plain = bodyPlain[m.id];
                      const isMine = m.sender_id === currentUserId;

                      return (
                        <div key={m.id} className="cc-panel-soft">
                          <div className="cc-row-between">
                            <div className="cc-small cc-wrap">
                              <b>{isMine ? "You" : m.sender_id}</b> • {new Date(m.sent_at).toLocaleString()}
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