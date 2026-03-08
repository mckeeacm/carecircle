"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Mode = "login" | "signup" | "reset";

export default function Home() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (active && data.session) {
        router.replace("/app/hub");
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        router.replace("/app/hub");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

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

        if (data.session) {
          router.replace("/app/hub");
          return;
        }

        setMsg("Account created. Check your email if confirmation is enabled.");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) throw error;

      router.replace("/app/hub");
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

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "linear-gradient(180deg, #dfe9e5 0%, #e8f1ed 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
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
            <button type="button" onClick={() => { setMode("login"); setMsg(null); setError(null); }} style={linkButtonStyle}>
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