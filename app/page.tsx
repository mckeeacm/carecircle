"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Mode = "login" | "signup" | "reset";

type CircleMembership = {
  patient_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
  created_at: string;
};

type ShareRow = {
  patient_id: string;
};

type ProfileRow = {
  patient_id: string;
};

type PublicKeyRow = {
  user_id: string;
  algorithm: string | null;
};

type CacheRecord = {
  v: 1;
  createdAt: number;
  expiresAt: number;
  vaultKeyB64: string;
};

const PENDING_INVITE_KEY = "carecircle:pending-invite-token:v1";

function isUuid(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function cacheKey(pid: string, uid: string) {
  return `carecircle:vaultkey:v1:${pid}:${uid}`;
}

function readCachedVaultKey(pid: string, uid: string): Uint8Array | null {
  try {
    const raw = localStorage.getItem(cacheKey(pid, uid));
    if (!raw) return null;
    const rec = JSON.parse(raw) as CacheRecord;
    if (!rec || rec.v !== 1) return null;
    if (!rec.expiresAt || Date.now() > rec.expiresAt) {
      localStorage.removeItem(cacheKey(pid, uid));
      return null;
    }
    return new Uint8Array(1);
  } catch {
    return null;
  }
}

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

function clearPendingInviteToken() {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
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
  const [inviteTokenFromUrl, setInviteTokenFromUrl] = useState("");

  async function routeAfterAuth(userId: string) {
    const pendingInvite = inviteTokenFromUrl || readPendingInviteToken();

    if (pendingInvite) {
      router.replace(`/app/onboarding?invite=${encodeURIComponent(pendingInvite)}`);
      return;
    }

    const { data: publicKeyRow, error: pkErr } = await supabase
      .from("user_public_keys")
      .select("user_id, algorithm")
      .eq("user_id", userId)
      .maybeSingle();

    if (pkErr) throw pkErr;

    const hasDeviceKey =
      !!(publicKeyRow as PublicKeyRow | null)?.user_id &&
      (((publicKeyRow as PublicKeyRow | null)?.algorithm ?? "") === "crypto_box_seal");

    const { data: pm, error: memErr } = await supabase
      .from("patient_members")
      .select("patient_id, role, nickname, is_controller, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (memErr) throw memErr;

    const memberships = (pm ?? []) as CircleMembership[];
    const patientIds = memberships.map((m) => m.patient_id).filter(isUuid);

    if (patientIds.length === 0) {
      router.replace("/app/onboarding");
      return;
    }

    if (!hasDeviceKey) {
      router.replace(`/app/onboarding?pid=${encodeURIComponent(patientIds[0])}`);
      return;
    }

    const { data: shares, error: shareErr } = await supabase
      .from("patient_vault_shares")
      .select("patient_id")
      .eq("user_id", userId)
      .in("patient_id", patientIds);

    if (shareErr) throw shareErr;

    const { data: profiles, error: profileErr } = await supabase
      .from("patient_profiles")
      .select("patient_id")
      .in("patient_id", patientIds);

    if (profileErr) throw profileErr;

    const shareSet = new Set(((shares ?? []) as ShareRow[]).map((r) => r.patient_id));
    const profileSet = new Set(((profiles ?? []) as ProfileRow[]).map((r) => r.patient_id));

    const firstIncompletePid =
      patientIds.find((pid) => !shareSet.has(pid)) ||
      patientIds.find((pid) => !readCachedVaultKey(pid, userId)) ||
      patientIds.find((pid) => !profileSet.has(pid)) ||
      "";

    if (firstIncompletePid) {
      router.replace(`/app/onboarding?pid=${encodeURIComponent(firstIncompletePid)}`);
      return;
    }

    clearPendingInviteToken();
    router.replace("/app/hub");
  }

  useEffect(() => {
    const token = readInviteFromLocation();
    if (token) {
      writePendingInviteToken(token);
      setInviteTokenFromUrl(token);
    } else {
      setInviteTokenFromUrl("");
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
          await routeAfterAuth(data.session.user.id);
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
        await routeAfterAuth(session.user.id);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [inviteTokenFromUrl, router, supabase]);

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

      if (!password) throw new Error("Please enter your password.");

      if (mode === "signup") {
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters.");
        }

        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });

        if (error) throw error;

        if (data.user?.id) {
          await routeAfterAuth(data.user.id);
          return;
        }

        setMsg("Account created. Check your email if confirmation is enabled.");
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) throw error;
      if (!data.user?.id) throw new Error("Sign-in succeeded, but no user session was returned.");

      await routeAfterAuth(data.user.id);
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

  function buttonForMode() {
    if (mode === "signup") return loading ? "Creating account…" : "Create account";
    if (mode === "reset") return loading ? "Sending…" : "Send reset email";
    return loading ? "Signing in…" : "Sign in";
  }

  if (checkingSession) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          background: "linear-gradient(180deg, #dfe9e5 0%, #e8f1ed 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            background: "rgba(255,255,255,0.88)",
            border: "1px solid rgba(0,0,0,0.06)",
            borderRadius: 28,
            padding: 24,
            boxShadow: "0 18px 50px rgba(48, 73, 67, 0.12)",
            backdropFilter: "blur(10px)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>CareCircle</h1>
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 16, lineHeight: 1.5 }}>
            Checking your sign-in…
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "linear-gradient(180deg, #dfe9e5 0%, #e8f1ed 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "rgba(255,255,255,0.88)",
          border: "1px solid rgba(0,0,0,0.06)",
          borderRadius: 28,
          padding: 24,
          boxShadow: "0 18px 50px rgba(48, 73, 67, 0.12)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.01em",
              color: "#48635b",
              marginBottom: 8,
            }}
          >
            CareCircle
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: 28,
              lineHeight: 1.1,
              fontWeight: 800,
              color: "#111",
            }}
          >
            {titleForMode()}
          </h1>

          <p
            style={{
              marginTop: 12,
              marginBottom: 0,
              fontSize: 16,
              lineHeight: 1.5,
              color: "#2f3b37",
            }}
          >
            Shared meds, appointments, and care notes — without confusion.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#24312d" }}>Email</span>
            <input
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              style={inputStyle}
              placeholder="name@example.com"
            />
          </label>

          {mode !== "reset" ? (
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#24312d" }}>Password</span>
              <input
                type="password"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                style={inputStyle}
                placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              />
            </label>
          ) : null}

          {mode === "signup" ? (
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#24312d" }}>Confirm password</span>
              <input
                type="password"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                style={inputStyle}
                placeholder="Repeat your password"
              />
            </label>
          ) : null}

          {msg ? (
            <div
              style={{
                borderRadius: 18,
                padding: "12px 14px",
                background: "rgba(86, 163, 120, 0.12)",
                color: "#194d2f",
                fontSize: 14,
                lineHeight: 1.45,
              }}
            >
              {msg}
            </div>
          ) : null}

          {error ? (
            <div
              style={{
                borderRadius: 18,
                padding: "12px 14px",
                background: "rgba(204, 67, 67, 0.1)",
                color: "#7c1f1f",
                fontSize: 14,
                lineHeight: 1.45,
              }}
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            style={{
              minHeight: 52,
              borderRadius: 18,
              border: "none",
              background: "#4b7a6c",
              color: "white",
              fontSize: 16,
              fontWeight: 700,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.8 : 1,
            }}
          >
            {buttonForMode()}
          </button>
        </form>

        <div
          style={{
            marginTop: 18,
            display: "grid",
            gap: 10,
          }}
        >
          {mode !== "login" ? (
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setMsg(null);
                setError(null);
              }}
              style={linkButtonStyle}
            >
              Back to sign in
            </button>
          ) : null}

          {mode === "login" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setMode("reset");
                  setMsg(null);
                  setError(null);
                }}
                style={linkButtonStyle}
              >
                Forgot password?
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setMsg(null);
                  setError(null);
                }}
                style={linkButtonStyle}
              >
                Create a new account
              </button>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 48,
  borderRadius: 16,
  border: "1px solid rgba(0,0,0,0.1)",
  background: "rgba(255,255,255,0.92)",
  padding: "0 14px",
  fontSize: 16,
  outline: "none",
};

const linkButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  textAlign: "left",
  color: "#4b7a6c",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};