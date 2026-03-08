"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Mode = "login" | "signup" | "reset";

const PENDING_INVITE_KEY = "carecircle:pending-invite-token:v1";

function readPendingInviteToken(): string {
  try {
    return (localStorage.getItem(PENDING_INVITE_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

function writePendingInviteToken(token: string) {
  try {
    if (token.trim()) localStorage.setItem(PENDING_INVITE_KEY, token.trim());
  } catch {}
}

function readInviteFromLocation(): string {
  if (typeof window === "undefined") return "";
  try {
    const url = new URL(window.location.href);
    return (url.searchParams.get("invite") ?? "").trim();
  } catch {
    return "";
  }
}

export default function Home() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState("");

  function routeAfterAuth() {
    const pendingInvite = inviteToken || readPendingInviteToken();

    if (pendingInvite) {
      router.replace(`/app/onboarding?invite=${encodeURIComponent(pendingInvite)}`);
      return;
    }

    router.replace("/app/onboarding");
  }

  useEffect(() => {
    const token = readInviteFromLocation();
    if (token) {
      writePendingInviteToken(token);
      setInviteToken(token);
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (!active) return;

        if (data.session?.user?.id) {
          routeAfterAuth();
          return;
        }
      } catch (e: any) {
        if (active) setError(e?.message ?? "Failed to check session.");
      } finally {
        if (active) setCheckingSession(false);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user?.id) {
        routeAfterAuth();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [inviteToken, router, supabase]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    setError(null);

    try {
      const cleanEmail = email.trim().toLowerCase();

      if (!cleanEmail) throw new Error("Please enter your email address.");

      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
        if (error) throw error;

        setMsg("Password reset email sent. Check your inbox.");
        return;
      }

      if (!password) {
        throw new Error("Please enter your password.");
      }

      if (mode === "signup") {
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters.");
        }

        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        const { error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });

        if (error) throw error;

        routeAfterAuth();
        return;
      }

      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error) throw error;

        routeAfterAuth();
      }
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function titleForMode() {
    if (mode === "signup") return "Create your account";
    if (mode === "reset") return "Reset password";
    return "Sign in";
  }

  function subtitleForMode() {
    if (mode === "signup") return "Set up your CareCircle account to continue.";
    if (mode === "reset") return "We’ll send you a password reset email.";
    return "Shared meds, appointments, and care notes — without confusion.";
  }

  if (checkingSession) {
    return (
      <div className="cc-page">
        <div
          className="cc-container"
          style={{
            minHeight: "calc(100dvh - max(28px, env(safe-area-inset-top)) - max(28px, env(safe-area-inset-bottom)))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className="cc-card cc-card-pad" style={{ width: "100%", maxWidth: 540 }}>
            <div className="cc-stack">
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1" style={{ fontSize: 34 }}>
                CareCircle
              </h1>
              <div style={{ fontSize: 18, lineHeight: 1.45 }}>Checking your sign-in…</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cc-page">
      <div
        className="cc-container"
        style={{
          minHeight: "calc(100dvh - max(28px, env(safe-area-inset-top)) - max(28px, env(safe-area-inset-bottom)))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div className="cc-card cc-card-pad" style={{ width: "100%", maxWidth: 540 }}>
          <div className="cc-stack">
            <div>
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1" style={{ fontSize: 34, marginTop: 6 }}>
                {titleForMode()}
              </h1>
              <div
                style={{
                  marginTop: 12,
                  fontSize: 18,
                  lineHeight: 1.45,
                  maxWidth: 420,
                }}
              >
                {subtitleForMode()}
              </div>
            </div>

            {msg ? (
              <div className="cc-status cc-status-ok">
                <div className="cc-wrap">{msg}</div>
              </div>
            ) : null}

            {error ? (
              <div className="cc-status cc-status-error">
                <div className="cc-status-error-title">Error</div>
                <div className="cc-wrap">{error}</div>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="cc-stack">
              <div className="cc-field">
                <div className="cc-label">Email</div>
                <input
                  className="cc-input"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  placeholder="name@example.com"
                />
              </div>

              {mode !== "reset" ? (
                <div className="cc-field">
                  <div className="cc-label">Password</div>
                  <input
                    className="cc-input"
                    type="password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                  />
                </div>
              ) : null}

              {mode === "signup" ? (
                <div className="cc-field">
                  <div className="cc-label">Confirm password</div>
                  <input
                    className="cc-input"
                    type="password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    placeholder="Repeat your password"
                  />
                </div>
              ) : null}

              <div className="cc-row">
                <button type="submit" className="cc-btn cc-btn-primary" disabled={loading}>
                  {mode === "signup"
                    ? loading
                      ? "Creating account…"
                      : "Create account"
                    : mode === "reset"
                    ? loading
                      ? "Sending…"
                      : "Send reset email"
                    : loading
                    ? "Signing in…"
                    : "Sign in"}
                </button>
              </div>
            </form>

            <div className="cc-stack" style={{ gap: 10 }}>
              {mode !== "login" ? (
                <button
                  type="button"
                  className="cc-btn"
                  onClick={() => {
                    setMode("login");
                    setMsg(null);
                    setError(null);
                  }}
                  style={{ justifyContent: "flex-start" }}
                >
                  Back to sign in
                </button>
              ) : null}

              {mode === "login" ? (
                <>
                  <button
                    type="button"
                    className="cc-btn"
                    onClick={() => {
                      setMode("reset");
                      setMsg(null);
                      setError(null);
                    }}
                    style={{ justifyContent: "flex-start" }}
                  >
                    Forgot password?
                  </button>

                  <button
                    type="button"
                    className="cc-btn"
                    onClick={() => {
                      setMode("signup");
                      setMsg(null);
                      setError(null);
                    }}
                    style={{ justifyContent: "flex-start" }}
                  >
                    Create a new account
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}