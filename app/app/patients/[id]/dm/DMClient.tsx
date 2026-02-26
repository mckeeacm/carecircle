"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { loadMyPatientVaultKey } from "@/lib/e2ee/patientVault";
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

type MsgRow = {
  id: string;
  thread_id: string;
  patient_id: string;
  sender_id: string;
  sent_at: string;
  body_encrypted: CipherEnvelopeV1 | null;
  meta_encrypted: CipherEnvelopeV1 | null;
};

type MemberRow = {
  user_id: string;
  role: string;
  nickname: string | null;
  is_controller: boolean;
};

export default function DMClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [draft, setDraft] = useState("");

  // Load vault key for this patient (required for all DM encryption/decryption)
  useEffect(() => {
    loadMyPatientVaultKey(patientId)
      .then(setVaultKey)
      .catch((e: any) => setError(e?.message ?? "no_vault_share"));
  }, [patientId]);

  // Load circle members (for "Message a member" 1:1 picker)
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return setError("not_authenticated");

      const { data, error } = await supabase
        .from("patient_members")
        .select("user_id, role, nickname, is_controller")
        .eq("patient_id", patientId);

      if (error) return setError(error.message);

      const list = ((data ?? []) as MemberRow[]).filter((m) => m.user_id !== auth.user!.id);
      setMembers(list);
    })().catch((e: any) => setError(e?.message ?? "members_failed"));
  }, [patientId, supabase]);

  // Load threads (only ones where I'm a member), scoped to this patient
  async function loadThreads() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error("not_authenticated");

    const { data: memberRows, error: memErr } = await supabase
      .from("dm_thread_members")
      .select("thread_id")
      .eq("user_id", auth.user.id);

    if (memErr) throw memErr;

    const threadIds = (memberRows ?? []).map((r: any) => r.thread_id as string);
    if (threadIds.length === 0) {
      setThreads([]);
      setActiveThreadId(null);
      return;
    }

    const { data, error } = await supabase
      .from("dm_threads")
      .select("id, patient_id, created_by, created_at, title_encrypted, last_message_at, last_message_preview_encrypted")
      .eq("patient_id", patientId)
      .in("id", threadIds)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const list = (data ?? []) as ThreadRow[];
    setThreads(list);
    if (!activeThreadId && list[0]?.id) setActiveThreadId(list[0].id);
  }

  async function loadMessages(threadId: string) {
    const { data, error } = await supabase
      .from("dm_messages")
      .select("id, thread_id, patient_id, sender_id, sent_at, body_encrypted, meta_encrypted")
      .eq("patient_id", patientId)
      .eq("thread_id", threadId)
      .order("sent_at", { ascending: true })
      .limit(200);

    if (error) throw error;
    setMessages((data ?? []) as MsgRow[]);
  }

  useEffect(() => {
    loadThreads().catch((e: any) => setError(e?.message ?? "threads_failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  // When a thread is active, load messages + subscribe to realtime inserts
  useEffect(() => {
    if (!activeThreadId) return;

    loadMessages(activeThreadId).catch((e: any) => setError(e?.message ?? "messages_failed"));

    const channel = supabase
      .channel(`dm:${patientId}:${activeThreadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_messages", filter: `thread_id=eq.${activeThreadId}` },
        (payload: { new: MsgRow }) => {
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeThreadId, patientId, supabase]);

  async function decryptThreadTitle(t: ThreadRow): Promise<string> {
    if (!vaultKey || !t.title_encrypted) return "(encrypted)";
    return decryptStringWithLocalCache({
      patientId,
      table: "dm_threads",
      rowId: t.id,
      column: "title_encrypted",
      env: t.title_encrypted,
      vaultKey,
    });
  }

  async function decryptMsgBody(m: MsgRow): Promise<string> {
    if (!vaultKey || !m.body_encrypted) return "(encrypted)";
    return decryptStringWithLocalCache({
      patientId,
      table: "dm_messages",
      rowId: m.id,
      column: "body_encrypted",
      env: m.body_encrypted,
      vaultKey,
    });
  }

  // 1:1 only: open existing thread with selected user if found, else create a new 2-member thread
  async function openOrCreate1to1(otherUserId: string, otherLabel: string) {
    if (!vaultKey) return setError("no_vault_share");
    setError(null);
    setBusyUserId(otherUserId);

    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("not_authenticated");
      const me = auth.user.id;
      const them = otherUserId;

      // Get my thread ids
      const { data: myRows, error: myErr } = await supabase
        .from("dm_thread_members")
        .select("thread_id")
        .eq("user_id", me);
      if (myErr) throw myErr;

      const myThreadIds = (myRows ?? []).map((r: any) => r.thread_id as string);

      // If I have any threads, find overlaps with "them"
      if (myThreadIds.length > 0) {
        const { data: bothRows, error: bothErr } = await supabase
          .from("dm_thread_members")
          .select("thread_id")
          .eq("user_id", them)
          .in("thread_id", myThreadIds);
        if (bothErr) throw bothErr;

        const candidateIds = (bothRows ?? []).map((r: any) => r.thread_id as string);

        if (candidateIds.length > 0) {
          // Fetch those threads for this patient
          const { data: candidateThreads, error: tErr } = await supabase
            .from("dm_threads")
            .select("id, patient_id, created_by, created_at, title_encrypted, last_message_at, last_message_preview_encrypted")
            .eq("patient_id", patientId)
            .in("id", candidateIds);
          if (tErr) throw tErr;

          // Enforce 1:1 by verifying member count == 2 (me + them)
          for (const t of (candidateThreads ?? []) as ThreadRow[]) {
            const { data: mems, error: mErr } = await supabase
              .from("dm_thread_members")
              .select("user_id")
              .eq("thread_id", t.id);
            if (mErr) throw mErr;

            const ids = (mems ?? []).map((x: any) => x.user_id as string);
            const unique = Array.from(new Set(ids));
            if (unique.length === 2 && unique.includes(me) && unique.includes(them)) {
              setActiveThreadId(t.id);
              await loadThreads();
              return;
            }
          }
        }
      }

      // No existing 1:1 thread: create new
      const titleEnv = await vaultEncryptString({
        vaultKey,
        plaintext: otherLabel, // encrypted anyway
        aad: { table: "dm_threads", column: "title_encrypted", patient_id: patientId, type: "dm_1to1" },
      });

      const { data: thread, error: createErr } = await supabase
        .from("dm_threads")
        .insert({
          patient_id: patientId,
          created_by: me,
          title_encrypted: titleEnv,
          last_message_at: null,
          last_message_preview_encrypted: null,
        })
        .select("id")
        .single();
      if (createErr) throw createErr;

      const nowIso = new Date().toISOString();
      const { error: addErr } = await supabase.from("dm_thread_members").insert([
        { thread_id: thread.id, user_id: me, added_by: me, added_at: nowIso },
        { thread_id: thread.id, user_id: them, added_by: me, added_at: nowIso },
      ]);
      if (addErr) throw addErr;

      await loadThreads();
      setActiveThreadId(thread.id);
    } catch (e: any) {
      setError(e?.message ?? "dm_open_failed");
    } finally {
      setBusyUserId(null);
    }
  }

  async function sendMessage() {
    if (!vaultKey) return setError("no_vault_share");
    if (!activeThreadId) return setError("no_thread_selected");
    if (!draft.trim()) return;

    setError(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("not_authenticated");

    const nowIso = new Date().toISOString();
    const text = draft;

    const bodyEnv = await vaultEncryptString({
      vaultKey,
      plaintext: text,
      aad: { table: "dm_messages", column: "body_encrypted", patient_id: patientId, thread_id: activeThreadId },
    });

    const metaEnv = await vaultEncryptString({
      vaultKey,
      plaintext: JSON.stringify({ v: 1 }),
      aad: { table: "dm_messages", column: "meta_encrypted", patient_id: patientId, thread_id: activeThreadId },
    });

    const { error: msgErr } = await supabase.from("dm_messages").insert({
      thread_id: activeThreadId,
      patient_id: patientId,
      sender_id: auth.user.id,
      sent_at: nowIso,
      body_encrypted: bodyEnv,
      meta_encrypted: metaEnv,
    });

    if (msgErr) return setError(msgErr.message);

    // Update thread preview
    const previewEnv = await vaultEncryptString({
      vaultKey,
      plaintext: text.slice(0, 80),
      aad: { table: "dm_threads", column: "last_message_preview_encrypted", patient_id: patientId },
    });

    await supabase
      .from("dm_threads")
      .update({ last_message_at: nowIso, last_message_preview_encrypted: previewEnv })
      .eq("id", activeThreadId);

    setDraft("");
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>Direct Messages (1:1)</h2>

      {error && (
        <div style={{ border: "1px solid #c33", padding: 10, borderRadius: 10, marginBottom: 12 }}>
          <b>Error:</b> {error}
        </div>
      )}

      {/* 1:1 picker */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 10, marginBottom: 12 }}>
        <b>Message a member</b>
        <div style={{ marginTop: 10 }}>
          {members.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.7 }}>No other members found for this circle.</div>
          ) : (
            members.map((m) => {
              const label = m.nickname ?? m.user_id;
              return (
                <button
                  key={m.user_id}
                  onClick={() => openOrCreate1to1(m.user_id, label)}
                  disabled={!vaultKey || busyUserId === m.user_id}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: 10,
                    borderRadius: 10,
                    marginBottom: 8,
                    border: "1px solid #eee",
                  }}
                >
                  {busyUserId === m.user_id ? "Opening…" : label}{" "}
                  <span style={{ opacity: 0.7, fontSize: 12 }}>
                    • {m.role}
                    {m.is_controller ? " (controller)" : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Threads + Messages */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12 }}>
        {/* Threads */}
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 10 }}>
          <b>Threads</b>
          <div style={{ marginTop: 10 }}>
            {threads.map((t) => (
              <ThreadItem
                key={t.id}
                thread={t}
                active={t.id === activeThreadId}
                onClick={() => setActiveThreadId(t.id)}
                decryptTitle={decryptThreadTitle}
              />
            ))}
            {threads.length === 0 && <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>No threads yet.</div>}
          </div>
        </div>

        {/* Messages */}
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 10 }}>
          <b>Messages</b>

          <div style={{ height: 420, overflow: "auto", border: "1px solid #eee", borderRadius: 12, padding: 10, marginTop: 10 }}>
            {messages.map((m) => (
              <MessageItem key={m.id} msg={m} decryptBody={decryptMsgBody} />
            ))}
            {activeThreadId && messages.length === 0 && (
              <div style={{ fontSize: 12, opacity: 0.7 }}>No messages yet.</div>
            )}
            {!activeThreadId && <div style={{ fontSize: 12, opacity: 0.7 }}>Select a member or a thread.</div>}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a message…"
              style={{ flex: 1 }}
            />
            <button onClick={sendMessage} disabled={!vaultKey || !activeThreadId || !draft.trim()}>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThreadItem({
  thread,
  active,
  onClick,
  decryptTitle,
}: {
  thread: ThreadRow;
  active: boolean;
  onClick: () => void;
  decryptTitle: (t: ThreadRow) => Promise<string>;
}) {
  const [title, setTitle] = useState("(encrypted)");

  useEffect(() => {
    decryptTitle(thread).then(setTitle).catch(() => setTitle("(decrypt failed)"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, thread.title_encrypted?.nonce_b64, thread.title_encrypted?.ct_b64]);

  return (
    <div
      onClick={onClick}
      style={{
        border: active ? "2px solid #222" : "1px solid #eee",
        borderRadius: 12,
        padding: 10,
        marginTop: 8,
        cursor: "pointer",
      }}
    >
      <b>{title}</b>
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        {thread.last_message_at ? new Date(thread.last_message_at).toLocaleString() : "No messages yet"}
      </div>
    </div>
  );
}

function MessageItem({
  msg,
  decryptBody,
}: {
  msg: MsgRow;
  decryptBody: (m: MsgRow) => Promise<string>;
}) {
  const [body, setBody] = useState("…");

  useEffect(() => {
    decryptBody(msg).then(setBody).catch(() => setBody("(decrypt failed)"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.id, msg.body_encrypted?.nonce_b64, msg.body_encrypted?.ct_b64]);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        {new Date(msg.sent_at).toLocaleString()} • {msg.sender_id}
      </div>
      <div style={{ whiteSpace: "pre-wrap" }}>{body}</div>
    </div>
  );
}