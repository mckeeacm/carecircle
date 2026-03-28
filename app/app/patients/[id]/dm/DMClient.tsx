"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";
import MobileShell from "@/app/components/MobileShell";
import { useUserLanguage } from "@/app/components/UserLanguageProvider";
import { getPageUi } from "@/lib/pageUi";

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
  user_id: string;
  nickname: string | null;
  role: string | null;
  is_controller: boolean | null;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function isDecryptMismatchError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("ciphertext cannot be decrypted") ||
    m.includes("incorrect key pair") ||
    m.includes("failed to decrypt") ||
    m.includes("decrypt")
  );
}

export default function DMClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();
  const { languageCode } = useUserLanguage();
  const ui = getPageUi("dm", languageCode);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [openingThread, setOpeningThread] = useState(false);

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [threadTitlePlain, setThreadTitlePlain] = useState<Record<string, string>>({});
  const [threadPreviewPlain, setThreadPreviewPlain] = useState<Record<string, string>>({});

  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [bodyPlain, setBodyPlain] = useState<Record<string, string>>({});
  const [messageDecryptErrorById, setMessageDecryptErrorById] = useState<Record<string, string>>(
    {}
  );
  const [threadDecryptErrorById, setThreadDecryptErrorById] = useState<Record<string, string>>({});

  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [selectedRecipientId, setSelectedRecipientId] = useState<string>("");
  const [newThreadTitle, setNewThreadTitle] = useState<string>(ui.defaultThreadTitle);
  const [draft, setDraft] = useState<string>("");

  async function refreshThreads() {
    setMsg(null);
    setLoading(true);

    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;

      const uid = auth.user?.id;
      if (!uid) throw new Error("not_authenticated");
      setCurrentUserId(uid);

      const { data: memberRows, error: memberErr } = await supabase.rpc("patient_members_basic_list", {
        pid: patientId,
      });

      if (memberErr) throw memberErr;

      const allMembers = (memberRows ?? []) as Member[];
      setMembers(allMembers);

      const otherMembers = allMembers.filter((m) => m.user_id !== uid);
      if (!selectedRecipientId && otherMembers[0]?.user_id) {
        setSelectedRecipientId(otherMembers[0].user_id);
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
    setOpeningThread(true);

    try {
      const { data, error } = await supabase.rpc("dm_list_messages", {
        p_thread_id: threadId,
        p_limit: 200,
        p_before: null,
      });

      if (error) throw error;
      const nextMessages = ((data ?? []) as MessageRow[]).slice().reverse();
      setMessages(nextMessages);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_messages");
    } finally {
      setOpeningThread(false);
    }
  }

  useEffect(() => {
    refreshThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  useEffect(() => {
    if (activeThreadId) {
      refreshMessages(activeThreadId);
    } else {
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  useEffect(() => {
    setNewThreadTitle((current) => {
      const knownTitles = ["Direct message", "Messaggio diretto", ui.defaultThreadTitle];
      if (knownTitles.includes(current) || !current.trim()) return ui.defaultThreadTitle;
      return current;
    });
  }, [languageCode, ui.defaultThreadTitle]);

  async function decryptThreadIfNeeded(t: ThreadRow) {
    if (!vaultKey) return;

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
          table: "dm_messages",
          rowId: t.thread_id,
          column: "body_encrypted",
          env: t.last_message_preview_encrypted,
          vaultKey,
        });
        setThreadPreviewPlain((p) => ({ ...p, [t.thread_id]: plain }));
      }

      setThreadDecryptErrorById((prev) => {
        if (!(t.thread_id in prev)) return prev;
        const next = { ...prev };
        delete next[t.thread_id];
        return next;
      });
    } catch (e: any) {
      const text = e?.message ?? String(e);
      if (isDecryptMismatchError(text)) {
        setThreadDecryptErrorById((prev) => ({
          ...prev,
          [t.thread_id]: ui.threadDecryptError,
        }));
      } else {
        setMsg(text || "failed_to_decrypt_thread");
      }
    }
  }

  async function decryptMessageIfNeeded(m: MessageRow) {
    if (!vaultKey) return;
    if (bodyPlain[m.id] != null) return;

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
      setMessageDecryptErrorById((prev) => {
        if (!(m.id in prev)) return prev;
        const next = { ...prev };
        delete next[m.id];
        return next;
      });
    } catch (e: any) {
      const text = e?.message ?? String(e);
      if (isDecryptMismatchError(text)) {
        setMessageDecryptErrorById((prev) => ({
          ...prev,
          [m.id]: ui.messageDecryptError,
        }));
      } else {
        setMsg(text || "failed_to_decrypt_message");
      }
    }
  }

  useEffect(() => {
    if (!vaultKey) return;
    if (!activeThreadId) return;
    if (messages.length === 0) return;

    let cancelled = false;

    async function decryptVisibleMessages() {
      for (const m of messages) {
        if (cancelled) return;
        if (bodyPlain[m.id] != null) continue;
        try {
          await decryptMessageIfNeeded(m);
        } catch {}
      }
    }

    decryptVisibleMessages();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultKey, activeThreadId, messages]);

  async function openOrCreateDirectThread() {
    setMsg(null);

    try {
      if (!vaultKey) throw new Error("no_vault_share");
      if (!selectedRecipientId) throw new Error("select_a_member");
      if (!currentUserId) throw new Error("not_authenticated");

      const titleEnv = await vaultEncryptString({
        vaultKey,
        plaintext: newThreadTitle.trim() || ui.defaultThreadTitle,
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
    setSending(true);

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
    } finally {
      setSending(false);
    }
  }

  function memberLabel(m: Member) {
    const role =
      m.role === "patient"
        ? ui.rolePatient
        : m.role === "carer"
        ? ui.roleCarer
        : m.role === "family"
        ? ui.roleFamily
        : m.role ?? ui.roleMember;
    const controller = m.is_controller ? ui.controllerSuffix : "";
    return `${m.nickname ?? m.user_id} (${role}${controller})`;
  }

  function nicknameForUser(userId: string) {
    if (userId === currentUserId) return ui.you;
    const member = members.find((m) => m.user_id === userId);
    return member?.nickname?.trim() || userId;
  }

  function threadTitle(t: ThreadRow) {
    if (threadTitlePlain[t.thread_id]) return threadTitlePlain[t.thread_id];
    if (t.title_encrypted) return ui.protectedConversation;
    return ui.defaultThreadTitle;
  }

  function threadPreview(t: ThreadRow) {
    if (threadPreviewPlain[t.thread_id]) return threadPreviewPlain[t.thread_id];
    if (t.last_message_preview_encrypted) return ui.protectedPreview;
    return "";
  }


  return (
    <MobileShell
      title={ui.title}
      subtitle={ui.subtitle}
      patientId={patientId}
      rightSlot={
        <Link className="cc-btn" href={`/app/patients/${patientId}/today`}>
          {ui.today}
        </Link>
      }
    >
      {msg ? (
        <div className="cc-status cc-status-error">
          <div className="cc-status-error-title">{ui.error}</div>
          <div className="cc-wrap">{msg}</div>
        </div>
      ) : null}

      {!vaultKey ? (
        <div className="cc-status cc-status-loading">
          <div className="cc-strong">{ui.secureTitle}</div>
          <div className="cc-subtle">{ui.secureSubtitle}</div>
        </div>
      ) : null}

      <div className="cc-panel-blue">
        <div className="cc-strong">{ui.introTitle}</div>
        <div className="cc-subtle">{ui.introBody}</div>
      </div>

      <div className="cc-grid-2-125">
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <h2 className="cc-h2">{ui.threads}</h2>
            <button className="cc-btn" onClick={refreshThreads} disabled={loading}>
              {loading ? ui.loading : ui.refresh}
            </button>
          </div>

          <div className="cc-panel-blue cc-stack">
            <div className="cc-strong">{ui.newThread}</div>

            <div className="cc-field">
              <div className="cc-label">{ui.who}</div>
              <select
                className="cc-select"
                value={selectedRecipientId}
                onChange={(e) => setSelectedRecipientId(e.target.value)}
                disabled={!vaultKey}
              >
                <option value="">{ui.selectMember}</option>
                {members
                  .filter((m) => m.user_id !== currentUserId)
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </option>
                  ))}
              </select>
            </div>

            <div className="cc-field">
              <div className="cc-label">{ui.conversationTitle}</div>
              <input
                className="cc-input"
                value={newThreadTitle}
                onChange={(e) => setNewThreadTitle(e.target.value)}
                disabled={!vaultKey}
              />
            </div>

            <button className="cc-btn cc-btn-primary" onClick={openOrCreateDirectThread} disabled={!vaultKey}>
              {ui.openDirectMessage}
            </button>

            <div className="cc-small cc-subtle">
              {ui.helper}
            </div>
          </div>

          <div className="cc-stack">
            {threads.length === 0 ? (
              <div className="cc-small">{ui.noThreads}</div>
            ) : (
              threads.map((t) => {
                const active = t.thread_id === activeThreadId;
                const title = threadTitle(t);
                const prev = threadPreview(t);
                const decryptError = threadDecryptErrorById[t.thread_id];

                return (
                  <button
                    key={t.thread_id}
                    className={`cc-btn ${active ? "cc-btn-primary" : ""}`}
                    onClick={async () => {
                      setActiveThreadId(t.thread_id);
                      await decryptThreadIfNeeded(t);
                    }}
                    style={{
                      justifyContent: "flex-start",
                      width: "100%",
                      textAlign: "left",
                      display: "block",
                    }}
                  >
                    <div className="cc-strong cc-wrap">{title}</div>
                    {prev ? (
                      <div className="cc-small cc-subtle cc-wrap" style={{ marginTop: 4 }}>
                        {prev}
                      </div>
                    ) : null}
                    <div className="cc-small cc-subtle" style={{ marginTop: 4 }}>
                      {t.last_message_at
                        ? `${ui.lastMessage}: ${new Date(t.last_message_at).toLocaleString()}`
                        : `${ui.created}: ${new Date(t.created_at).toLocaleString()}`}
                    </div>
                    {decryptError ? (
                      <div className="cc-small" style={{ marginTop: 6, color: "crimson" }}>
                        {decryptError}
                      </div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <h2 className="cc-h2">{ui.messages}</h2>
            <span className="cc-small cc-wrap">{activeThreadId || ui.noThreadSelected}</span>
          </div>

          {!activeThreadId ? (
            <div className="cc-panel">{ui.selectThread}</div>
          ) : (
            <>
              {openingThread ? (
                <div className="cc-panel">{ui.loadingMessages}</div>
              ) : null}

              <div className="cc-stack">
                {messages.length === 0 ? (
                  <div className="cc-small">{ui.noMessages}</div>
                ) : (
                  messages.map((m) => {
                    const plain = bodyPlain[m.id];
                    const decryptError = messageDecryptErrorById[m.id];
                    const isMine = m.sender_id === currentUserId;
                    const senderName = nicknameForUser(m.sender_id);

                    return (
                      <div
                        key={m.id}
                        className="cc-panel-soft"
                        style={{
                          padding: 14,
                          borderRadius: 18,
                          border: isMine ? "1px solid rgba(94, 127, 163, 0.16)" : undefined,
                        }}
                      >
                        <div className="cc-row-between">
                          <div className="cc-small cc-wrap">
                            <b>{senderName}</b> - {new Date(m.sent_at).toLocaleString()}
                          </div>
                          <button
                            className="cc-btn"
                            onClick={() => decryptMessageIfNeeded(m)}
                            disabled={!vaultKey || !!plain}
                          >
                            {plain ? ui.open : ui.view}
                          </button>
                        </div>

                        <div className="cc-spacer-12" />

                        <div className="cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
                          {plain ?? (decryptError ? decryptError : ui.protectedMessage)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="cc-panel-green cc-stack">
                <div className="cc-field">
                  <div className="cc-label">{ui.newMessage}</div>
                  <textarea
                    className="cc-textarea"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={ui.messagePlaceholder}
                    disabled={!vaultKey || sending}
                  />
                </div>
                <button className="cc-btn cc-btn-primary" onClick={sendMessage} disabled={!vaultKey || sending}>
                  {sending ? ui.sending : ui.send}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </MobileShell>
  );
}
