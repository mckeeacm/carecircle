"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

function appBaseFromPathname(pathname: string) {
  if (pathname.startsWith("/app/app/") || pathname === "/app/app") return "/app/app";
  if (pathname.startsWith("/app/") || pathname === "/app") return "/app";
  return "";
}

export default function HubPage() {
  const base = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return appBaseFromPathname(window.location.pathname);
  }, []);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState<string>("…");
  const [authed, setAuthed] = useState(false);

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
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    if (!data.user) {
      window.location.href = "/";
      return null;
    }
    setAuthed(true);
    setEmail(data.user.email ?? "Signed in");
    return data.user;
  }

  useEffect(() => {
    (async () => {
      setLoading("Loading…");
      const u = await requireAuth();
      if (!u) return;
      setOk("Up to date.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authed) {
    return (
      <main className="cc-page">
        <div className="cc-container cc-stack">
          <div className="cc-card cc-card-pad">
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Hub</h1>
            <div className="cc-subtle">Checking session…</div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-card cc-card-pad">
          <div className="cc-kicker">CareCircle</div>
          <h1 className="cc-h1">Hub</h1>
          <div className="cc-subtle">Signed in as {email}</div>

          {status.kind !== "idle" && (
            <div
              className={[
                "cc-status",
                status.kind === "ok"
                  ? "cc-status-ok"
                  : status.kind === "loading"
                    ? "cc-status-loading"
                    : status.kind === "error"
                      ? "cc-status-error"
                      : "",
              ].join(" ")}
              style={{ marginTop: 12 } as any}
            >
              <div>
                {status.kind === "error" ? <span className="cc-status-error-title">Something needs attention: </span> : null}
                {status.msg}
              </div>
              {error ? (
                <div className="cc-small" style={{ color: "crimson", whiteSpace: "pre-wrap" } as any}>
                  {error}
                </div>
              ) : null}
            </div>
          )}

          <div className="cc-spacer-12" />

          <div className="cc-row">
            <Link className="cc-btn cc-btn-primary" href={`${base}/today`}>
              🗓️ Today
            </Link>
            <Link className="cc-btn" href={`${base}/account`}>
              ⚙️ Account
            </Link>
            <button
              className="cc-btn"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/";
              }}
            >
              🚪 Sign out
            </button>
          </div>

          <div className="cc-spacer-12" />

          <div className="cc-panel">
            <div className="cc-strong">Next steps</div>
            <div className="cc-subtle" style={{ marginTop: 6 } as any}>
              Use <b>Today</b> to open patient circles. Permissions + E2EE live in each patient circle.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
