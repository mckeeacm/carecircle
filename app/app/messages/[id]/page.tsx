"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

type MessageRow = {
  id: string;
  thread_id: string;
  patient_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

export default function ThreadPage() {
  const params = useParams();
  const threadId = String(params?.id ?? "");

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [authedUserId, setAuthedUserId] = useState<string | null>(null);

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  function setPageError(msg: string) {
    setError(msg);
    setStatus({ kind: "error", msg });
  }
  function setOk(msg: string) {
    setError(null);
    setStatus({ kind: "ok", msg });
  }
  function setLoading(msg: string) {
    setError(null);
    setStatus({ kind: "loading", msg });
  }

  async function requireAuth() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      window.location.href = "/";
      return null;
    }
    setAuthedUserId(data.user.id);
    return data.user;
  }

  async function loadMessages() {
    setError(null);
    const q = await supabase
      .from("dm_messages")
      .select("id,thread_id,patient_id,sender_id,body,created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(500);

    if (q.error) return setPageError(q.error.message);
    setMessages((q.data ?? []) as MessageRow[]);
  }

  async function send() {
    const text = draft.trim();
    if (!text) return;

    setLoading("Sending…");
    const { error } = await supabase.rpc("send_dm_message", {
      p_thread_id: threadId,
      p_body: text,
    });
    if (error) return setPageError(error.message);

    setDraft("");
    await loadMessages();
    setOk("Sent ✅");
  }

  useEffect(() => {
    (async () => {
      if (!threadId || threadId === "undefined") return setPageError("Missing thread id.");
      const user = await requireAuth();
      if (!user) return;

      setLoading("Loading chat…");
      await loadMessages();
      setOk("Up to date.");

      // realtime (optional): basic polling fallback
      const interval = window.setInterval(loadMessages, 4000);
      return () => window.clearInterval(interval);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const rendered = useMemo(() => {
    return messages.map((m) => {
      const mine = authedUserId && m.sender_id === authedUserId;
      return (
        <div key={m.id} className={mine ? "cc-panel-blue" : "cc-panel-green"}>
          <div className="cc-row-between">
            <div className="cc-small">
              {mine ? "You" : "Member"} • {new Date(m.created_at).toLocaleString()}
            </div>
          </div>
          <div style={{ marginTop: 6 }}>{m.body}</div>
        </div>
      );
    });
  }, [messages, authedUserId]);

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">Messages</div>
              <h1 className="cc-h1">Chat</h1>
              <div className="cc-small">{threadId}</div>
            </div>

            <div className="cc-row">
              <Link className="cc-btn" href="/app/messages">← Back to Messages</Link>
              <Link className="cc-btn" href="/app/today">Today</Link>
            </div>
          </div>
        </div>

        {status.kind !== "idle" && (
          <div className={`cc-status cc-card ${status.kind === "ok" ? "cc-status-ok" : status.kind === "error" ? "cc-status-error" : "cc-status-loading"}`}>
            <div>
              {status.kind === "error" ? <span className="cc-status-error-title">Something needs attention: </span> : null}
              {status.msg}
            </div>
            {error ? <div className="cc-small" style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</div> : null}
          </div>
        )}

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-stack">{rendered}</div>
          <div ref={bottomRef} />

          <div className="cc-panel">
            <div className="cc-field">
              <div className="cc-label">Message</div>
              <textarea
                className="cc-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write something private…"
              />
            </div>

            <div className="cc-row" style={{ marginTop: 10 }}>
              <button className="cc-btn cc-btn-secondary" onClick={send} disabled={!draft.trim()}>
                Send
              </button>
              <button className="cc-btn" onClick={loadMessages}>Refresh</button>
            </div>
          </div>
        </div>

        <div className="cc-spacer-24" />
      </div>
    </main>
  );
}
