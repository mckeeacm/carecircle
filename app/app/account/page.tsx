"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

type CircleRow = {
  patient_id: string;
  display_name: string;
  role: string;
  is_controller: boolean;
};

function appBaseFromPathname(pathname: string) {
  if (pathname.startsWith("/app/app/") || pathname === "/app/app") return "/app/app";
  if (pathname.startsWith("/app/") || pathname === "/app") return "/app";
  return "";
}

function humanRole(role: string | null | undefined) {
  const r = (role ?? "").toLowerCase();
  if (!r) return "Circle member";
  if (r === "family") return "Family";
  if (r === "carer") return "Carer / support";
  if (r === "support_worker") return "Carer / support";
  if (r === "professional") return "Professional support";
  if (r === "professional_support") return "Professional support";
  if (r === "clinician") return "Clinician";
  if (r === "owner") return "Patient / Guardian";
  if (r === "guardian") return "Legal guardian";
  if (r === "legal_guardian") return "Legal guardian";
  if (r === "patient") return "Patient";
  return role!;
}

export default function AccountPage() {
  const base = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return appBaseFromPathname(window.location.pathname);
  }, []);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [circles, setCircles] = useState<CircleRow[]>([]);

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
    setEmail(data.user.email ?? "");
    setUserId(data.user.id);
    return data.user;
  }

  async function signOut() {
    setLoading("Signing out…");
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  async function updatePassword() {
    setError(null);

    const pw = newPassword.trim();
    const pw2 = confirmPassword.trim();

    if (pw.length < 8) return setPageError("Password must be at least 8 characters.");
    if (pw !== pw2) return setPageError("Passwords do not match.");

    setLoading("Updating password…");

    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return setPageError(error.message);

    setNewPassword("");
    setConfirmPassword("");
    setOk("Password updated ✅");
  }

  async function loadCircles() {
    setError(null);

    // Uses patient_members + patients. If you *don’t* have FK relationship set up,
    // use the RPC version below (recommended) after you apply the SQL in section 2.
    const user = await requireAuth();
    if (!user) return;

    // Preferred: RPC (works even without PostgREST relationships)
    const rpc = await supabase.rpc("my_circles");
    if (rpc.error) return setPageError(rpc.error.message);

    setCircles((rpc.data ?? []) as CircleRow[]);
  }

  useEffect(() => {
    (async () => {
      setLoading("Loading account…");
      const u = await requireAuth();
      if (!u) return;
      await loadCircles();
      setOk("Ready.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        {/* Header */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1">Account</h1>
              <div className="cc-subtle">Your login, circles, and security settings.</div>
            </div>

            <div className="cc-row">
              <Link className="cc-btn" href={`${base}/today`}>
                ← Back to Today
              </Link>
              <button className="cc-btn" onClick={signOut}>
                🚪 Sign out
              </button>
            </div>
          </div>

          {/* Status */}
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
                {status.kind === "error" ? (
                  <span className="cc-status-error-title">Something needs attention: </span>
                ) : null}
                {status.msg}
              </div>

              {error ? (
                <div className="cc-small" style={{ color: "crimson", whiteSpace: "pre-wrap" } as any}>
                  {error}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Signed-in details */}
        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">Signed in as</h2>

          <div className="cc-panel" style={{ marginTop: 12 } as any}>
            <div className="cc-subtle">
              <b>Email:</b> {email || "—"}
            </div>
            <div className="cc-small" style={{ marginTop: 6 } as any}>
              <b>User ID:</b> {userId || "—"}
            </div>
          </div>
        </div>

        {/* My circles */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">My circles</h2>
              <div className="cc-subtle">Patients you have access to, and your role.</div>
            </div>
            <button className="cc-btn" onClick={loadCircles}>
              Refresh
            </button>
          </div>

          {circles.length === 0 ? (
            <p className="cc-subtle" style={{ marginTop: 12 } as any}>
              No circles yet.
            </p>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 } as any}>
              {circles.map((c) => (
                <div key={c.patient_id} className="cc-panel-blue">
                  <div className="cc-row-between">
                    <div style={{ minWidth: 260 } as any}>
                      <div className="cc-strong">{c.display_name}</div>
                      <div className="cc-small" style={{ marginTop: 4 } as any}>
                        Role: <b>{humanRole(c.role)}</b>
                        {c.is_controller ? " • controller" : ""}
                      </div>
                    </div>

                    <div className="cc-row">
                      <Link className="cc-btn" href={`${base}/patients/${c.patient_id}`}>
                        Open patient
                      </Link>
                      {c.is_controller ? (
                        <Link className="cc-btn cc-btn-primary" href={`${base}/patients/${c.patient_id}/permissions`}>
                          🔐 Permissions
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Change password */}
        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">Change password</h2>
          <div className="cc-subtle">Use at least 8 characters.</div>

          <div className="cc-grid-2" style={{ marginTop: 12 } as any}>
            <div className="cc-field">
              <div className="cc-label">New password</div>
              <input
                className="cc-input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            <div className="cc-field">
              <div className="cc-label">Confirm new password</div>
              <input
                className="cc-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="cc-row" style={{ marginTop: 12 } as any}>
            <button
              className="cc-btn cc-btn-primary"
              onClick={updatePassword}
              disabled={!newPassword.trim() || !confirmPassword.trim()}
            >
              Save password
            </button>

            <button
              className="cc-btn"
              onClick={() => {
                setNewPassword("");
                setConfirmPassword("");
                setError(null);
                setStatus({ kind: "idle" });
              }}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="cc-spacer-24" />
      </div>
    </main>
  );
}
