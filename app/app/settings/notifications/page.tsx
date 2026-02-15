"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../lib/supabase";

type PushSubRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
  updated_at: string | null;
};

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

function getVapidPublicKey(): string {
  // In Next, env vars exposed to the browser must be prefixed NEXT_PUBLIC_
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY in environment.");
  return key;
}

// VAPID keys are base64url; pushManager.subscribe expects Uint8Array
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function requireAuthedUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export default function NotificationsPage() {
  // IMPORTANT: keep initial render stable for SSR hydration
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [userId, setUserId] = useState<string | null>(null);

  // These are browser-only; initialise to null so server/client match
  const [isSecureContext, setIsSecureContext] = useState<boolean | null>(null);
  const [hasSW, setHasSW] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | null>(null);

  const [hasSavedSubscription, setHasSavedSubscription] = useState<boolean | null>(null);
  const [subInfo, setSubInfo] = useState<{ endpointHost: string } | null>(null);

  // ---- load base browser capabilities (client-only) ----
  useEffect(() => {
    (async () => {
      const uid = await requireAuthedUserId();
      if (!uid) {
        window.location.href = "/";
        return;
      }
      setUserId(uid);

      const notifSupported = typeof window !== "undefined" && "Notification" in window;
      const swSupported = typeof window !== "undefined" && "serviceWorker" in navigator;

      setPermission(notifSupported ? Notification.permission : "unsupported");
      setHasSW(swSupported);
      setIsSecureContext(typeof window !== "undefined" ? window.isSecureContext : false);

      // Try register SW early (safe)
      if (swSupported) {
        try {
          await navigator.serviceWorker.register("/sw.js");
        } catch {
          // leave as-is; we surface issues on enable
        }
      }

      await refreshSavedSubscription(uid);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshSavedSubscription(uid: string) {
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth,created_at,updated_at")
      .eq("user_id", uid)
      .maybeSingle();

    if (error) {
      setHasSavedSubscription(false);
      setSubInfo(null);
      return;
    }

    const row = (data ?? null) as PushSubRow | null;
    setHasSavedSubscription(!!row);

    if (row?.endpoint) {
      try {
        const u = new URL(row.endpoint);
        setSubInfo({ endpointHost: u.host });
      } catch {
        setSubInfo(null);
      }
    } else {
      setSubInfo(null);
    }
  }

  const canAttemptPush = useMemo(() => {
    return isSecureContext !== false && hasSW !== false && permission !== "unsupported";
  }, [hasSW, isSecureContext, permission]);

  // ---- enable push flow ----
  async function enablePush() {
    setStatus({ kind: "loading", msg: "Enabling push…" });

    try {
      if (!userId) throw new Error("Not signed in.");
      if (typeof window === "undefined") throw new Error("Must run in a browser.");

      if (!("Notification" in window)) throw new Error("Notifications aren’t supported in this browser.");
      if (!("serviceWorker" in navigator)) throw new Error("Service workers aren’t supported in this browser.");

      if (!window.isSecureContext) {
        throw new Error("Push requires a secure context (HTTPS or localhost).");
      }

      // Ask permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error("Notification permission was not granted.");

      // Ensure SW registered
      const reg = await navigator.serviceWorker.ready;

      const vapidPublicKey = getVapidPublicKey();
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const json = sub.toJSON();
      const endpoint = sub.endpoint;
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;

      if (!endpoint || !p256dh || !auth) throw new Error("Subscription keys missing.");

      // NOTE: Your table has unique on (user_id, endpoint) and/or endpoint.
      // If you're keeping ONE subscription per user, maybeSingle() will work.
      // This upsert must match a UNIQUE constraint you actually have.
      // Use user_id,endpoint to match your index push_subscriptions_user_id_endpoint_key.
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: userId,
          endpoint,
          p256dh,
          auth,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,endpoint" }
      );

      if (error) throw new Error(error.message);

      await refreshSavedSubscription(userId);
      setStatus({ kind: "ok", msg: "Push enabled 🎉" });
    } catch (e: any) {
      setStatus({ kind: "error", msg: e?.message ?? "Failed to enable push." });
    }
  }

  async function disablePush() {
    setStatus({ kind: "loading", msg: "Disabling push…" });

    try {
      if (!userId) throw new Error("Not signed in.");
      if (typeof window === "undefined") throw new Error("Must run in a browser.");
      if (!("serviceWorker" in navigator)) throw new Error("Service workers aren’t supported in this browser.");

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();

      // If you're allowing multiple subs per user, consider deleting by endpoint too.
      const { error } = await supabase.from("push_subscriptions").delete().eq("user_id", userId);
      if (error) throw new Error(error.message);

      await refreshSavedSubscription(userId);
      setStatus({ kind: "ok", msg: "Push disabled." });
    } catch (e: any) {
      setStatus({ kind: "error", msg: e?.message ?? "Failed to disable push." });
    }
  }

  async function sendTestPush() {
    setStatus({ kind: "loading", msg: "Sending test notification…" });

    try {
      if (!userId) throw new Error("Not signed in.");

      // ✅ Get the Supabase access token and pass it to the API route
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw new Error(sessionErr.message);

      const token = sessionData.session?.access_token;
      if (!token) throw new Error("No access token found. Try signing out/in.");

      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_id: userId }), // server ignores this and uses token user anyway
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Test push failed (${res.status})`);
      }

      setStatus({ kind: "ok", msg: "Test push sent. Check your notifications ✅" });
    } catch (e: any) {
      setStatus({ kind: "error", msg: e?.message ?? "Failed to send test push." });
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <a href="/app" style={{ textDecoration: "underline", fontSize: 14 }}>
        ← Back
      </a>

      <h1 style={{ marginTop: 8 }}>Notifications</h1>
      <p style={{ marginTop: -6, opacity: 0.75 }}>
        Enable push notifications for reminders and updates.
      </p>

      <div style={{ marginTop: 12, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>Status</h2>

        <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
          <div>
            <b>Signed in:</b> {userId ? "Yes" : "…"}
          </div>
          <div>
            <b>Secure context (HTTPS/localhost):</b>{" "}
            {isSecureContext === null ? "…" : isSecureContext ? "Yes" : "No"}
          </div>
          <div>
            <b>Service worker support:</b> {hasSW === null ? "…" : hasSW ? "Yes" : "No"}
          </div>
          <div>
            <b>Notification permission:</b>{" "}
            {permission === null ? "…" : permission === "unsupported" ? "Unsupported" : permission}
          </div>
          <div>
            <b>Subscription saved:</b>{" "}
            {hasSavedSubscription === null ? "…" : hasSavedSubscription ? "Yes" : "No"}
            {subInfo?.endpointHost ? (
              <span style={{ opacity: 0.7 }}> (endpoint: {subInfo.endpointHost})</span>
            ) : null}
          </div>
        </div>

        {!canAttemptPush && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              border: "1px solid #f3d5d5",
              borderRadius: 10,
              background: "#fff7f7",
            }}
          >
            <b>Push isn’t available yet.</b>
            <div style={{ marginTop: 6, opacity: 0.8 }}>
              You need HTTPS/localhost, service workers, and a supported browser.
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <button onClick={enablePush} disabled={!canAttemptPush || status.kind === "loading"}>
            Enable push
          </button>

          <button
            onClick={disablePush}
            disabled={status.kind === "loading" || hasSavedSubscription !== true}
          >
            Disable push
          </button>

          <button
            onClick={sendTestPush}
            disabled={status.kind === "loading" || hasSavedSubscription !== true}
          >
            Send test push
          </button>
        </div>

        {status.kind !== "idle" && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 10,
              border: "1px solid #eee",
              background:
                status.kind === "error"
                  ? "#fff7f7"
                  : status.kind === "ok"
                  ? "#f4fff6"
                  : "#fafafa",
              color: status.kind === "error" ? "crimson" : "inherit",
              whiteSpace: "pre-wrap",
            }}
          >
            {status.msg}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>Next</h2>
        <ul style={{ marginTop: 6, opacity: 0.85, lineHeight: 1.5 }}>
          <li>Once “Test push” works, we’ll trigger pushes from: meds, appointments, and circle updates.</li>
          <li>Then we’ll add clinician polish + summary formatting, and the monetisation steps.</li>
        </ul>
      </div>
    </main>
  );
}
