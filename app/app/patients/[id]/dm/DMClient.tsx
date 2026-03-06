"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type ThreadRow = {
  thread_id: string;
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
  patient_id: string;
  user_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
  created_at: string | null;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function isDecryptMismatchError(e: any) {
  const text = String(e?.message ?? e ?? "").toLowerCase();
  return (
    text.includes("ciphertext cannot be decrypted using that key") ||
    text.includes("decrypt") ||
    text.includes("aead") ||
    text.includes("ciphertext")
  );
}

export default function DMClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [threadTitlePlain, setThreadTitlePlain] = useState<Record<string, string>>({});
  const [threadPreviewPlain, setThreadPreviewPlain] = useState<Record<string, string>>({});
  const [threadDecryptFailed, setThreadDecryptFailed] = useState<Record<string, boolean>>({});

  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [bodyPlain, setBodyPlain] = useState<Record<string, string>>({});
  const [messageDecryptFailed, setMessageDecryptFailed] = useState<Record<string, boolean>>({});

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

      const { data: memberRows, error: memberErr } = await supabase.rpc("permissions_members_list", {
        pid: patientId,
      });
      if (memberErr) throw memberErr;

      const allMembers = ((memberRows ?? []) as Member[]).filter((m) => m.user_id !== uid);
      setMembers(allMembers);

      if (!selectedRecipientId && allMembers[0]?.user_id) {
        setSelectedRecipientId(allMembers[0].user_id);
      }

      const { data: threadRows, error: threadErr } = await supabase.rpc("dm_list_threads", {
        p_patient_id: patientId,
      });
      if (threadErr) throw threadErr;

      const nextThreads = (threadRows ?? []) as ThreadRow[];
      setThreads(nextThreads);

      if (!activeThreadId && nextThreads[0]?.thread_id) {
        setActiveThreadId(nextThreads[0].thread_id);
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
      const { data, error } = await supabase.rpc("dm_list_messages", {
        p_thread_id: threadId,
        p_limit: 200,
        p_before: null,
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
    if (threadDecryptFailed[t.thread_id]) return;

    try {
      if (t.title_encrypted && threadTitlePlain[t.thread_id] == null) {
        const plain = await decryptStringWithLocalCache({
          patientId,
          table: "dm_threads",
          rowId: t.thread_id,
          column: "title_encrypted",
          env: t.title_encrypted,
          vaultKey,
        });
        setThreadTitlePlain((p) => ({ ...p, [t.thread_id]: plain }));
      }

      if (t.last_message_preview_encrypted && threadPreviewPlain[t.thread_id] == null) {
        const plain = await decryptStringWithLocalCache({
          patientId,
          table: "dm_threads",
          rowId: t.thread_id,
          column: "last_message_preview_encrypted",
          env: t.last_message_preview_encrypted,
          vaultKey,
        });
        setThreadPreviewPlain((p) => ({ ...p, [t.thread_id]: plain }));
      }
    } catch (e: any) {
      if (isDecryptMismatchError(e)) {
        setThreadDecryptFailed((p) => ({ ...p, [t.thread_id]: true }));
      } else {
        throw e;
      }
    }
  }

  async function decryptMessageIfNeeded(m: MessageRow) {
    if (!vaultKey) return;
    if (bodyPlain[m.id] != null) return;
    if (messageDecryptFailed[m.id]) return;

    try {
      const plain = await decryptStringWithLocalCache({
        patientId,
        table: "dm_messages",
        rowId: m.id,
        column: "body_encrypted",
        env: m.body_encrypted,
        vaultKey,
      });

      setBodyPlain((p) => ({ ...p, [m.id]: plain }));
    } catch (e: any) {
      if (isDecryptMismatchError(e)) {
        setMessageDecryptFailed((p) => ({ ...p, [m.id]: true }));
      } else {
        throw e;
      }
    }
  }

  async function autoDecryptVisibleContent() {
    if (!vaultKey) return;

    for (const t of threads) {
      await decryptThreadIfNeeded(t);
    }

    for (const m of messages) {
      await decryptMessageIfNeeded(m);
    }
  }

  useEffect(() => {
    autoDecryptVisibleContent().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!vaultKey, threads.length, messages.length, activeThreadId]);

  async function openOrCreateDirectThread() {
    setMsg(null);

    try {
      if (!vaultKey) throw new Error("no_vault_share");
      if (!selectedRecipientId) throw new Error("select_a_member");
      if (!currentUserId) throw new Error("not_authenticated");

      const titleEnv = await vaultEncryptString({
        vaultKey,
        plaintext: newThreadTitle.trim() || "Direct message",
        aad: { table: "dm_threads", column: "title_encrypted", patient_id: patientId },
      });

      const { data, error } = await supabase.rpc("dm_create_thread", {
        p_patient_id: patientId,
        p_member_user_ids: [currentUserId, selectedRecipientId],
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

      const { error } = await supabase.rpc("dm_send_message", {
        p_thread_id: activeThreadId,
        p_body_encrypted: bodyEnv,
        p_meta_encrypted: null,
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
    return `${m.nickname ?? m.user_id} (${m.role ?? "member"}${m.is_controller ? ", controller" : ""})`;
  }

  function senderLabel(senderId: string) {
    if (senderId === currentUserId) return "You";
    const member = members.find((m) => m.user_id === senderId);
    return member?.nickname ?? senderId;
  }

  function threadDisplayTitle(t: ThreadRow) {
    if (threadTitlePlain[t.thread_id]) return threadTitlePlain[t.thread_id];
    if (threadDecryptFailed[t.thread_id]) return "Some items on this thread are unreadable here";
    if (t.title_encrypted) return "Encrypted title";
    return "Untitled";
  }

  function threadDisplayPreview(t: ThreadRow) {
    if (threadPreviewPlain[t.thread_id]) return threadPreviewPlain[t.thread_id];
    if (threadDecryptFailed[t.thread_id]) return "Encrypted preview unavailable";
    if (t.last_message_preview_encrypted) return "Encrypted preview";
    return "";
  }

  const activeThreadHasDecryptIssue =
    !!activeThreadId &&
    (threadDecryptFailed[activeThreadId] ||
      messages.some((m) => m.thread_id === activeThreadId && messageDecryptFailed[m.id]));

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
            <div className="cc-strong">Secure access not ready on this device</div>
            <div className="cc-subtle">
              Direct messages are encrypted. Open secure access for this circle first.
            </div>
            <div className="cc-spacer-12" />
            <Link className="cc-btn cc-btn-primary" href={`/app/patients/${patientId}/vault-init`}>
              Fix secure access
            </Link>
          </div>
        ) : null}

        {activeThreadHasDecryptIssue ? (
          <div className="cc-status cc-status-loading">
            <div className="cc-strong">Some older messages on this thread can’t be opened on this device</div>
            <div className="cc-subtle">
              This usually means they were encrypted with a different secure key version.
              You can still use this thread, but older items may remain unreadable here.
            </div>
            <div className="cc-spacer-12" />
            <Link className="cc-btn cc-btn-primary" href={`/app/patients/${patientId}/vault-init`}>
              Refresh secure access
            </Link>
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
                  const title = threadDisplayTitle(t);
                  const prev = threadDisplayPreview(t);
                  const active = t.thread_id === activeThreadId;

                  return (
                    <button
                      key={t.thread_id}
                      className={`cc-btn ${active ? "cc-btn-primary" : ""}`}
                      onClick={() => setActiveThreadId(t.thread_id)}
                      title={t.thread_id}
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
                      const failed = messageDecryptFailed[m.id];

                      return (
                        <div key={m.id} className="cc-panel-soft">
                          <div className="cc-row-between">
                            <div className="cc-small cc-wrap">
                              <b>{senderLabel(m.sender_id)}</b> • {new Date(m.sent_at).toLocaleString()}
                            </div>

                            {!plain && !failed ? (
                              <button className="cc-btn" onClick={() => decryptMessageIfNeeded(m)} disabled={!vaultKey}>
                                Decrypt
                              </button>
                            ) : null}
                          </div>

                          <div className="cc-spacer-12" />

                          {plain ? (
                            <div className="cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
                              {plain}
                            </div>
                          ) : failed ? (
                            <div className="cc-small cc-subtle">
                              This message could not be opened on this device. It may belong to an older secure key version for this circle.
                            </div>
                          ) : (
                            <div className="cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
                              —
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="cc-panel-green cc-stack">
                  <div className="cc-field">
                    <div className="cc-label">New message (E2EE)</div>
                    <textarea
                      className="cc-textarea"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      disabled={!vaultKey}
                    />
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