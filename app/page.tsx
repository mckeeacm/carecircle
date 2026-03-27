"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUserLanguage } from "@/app/components/UserLanguageProvider";
import {
  DEFAULT_ACCOUNT_LANGUAGE_CODE,
  SUPPORTED_ACCOUNT_LANGUAGES,
  detectPreferredLanguageCode,
  getLanguageLabel,
  normaliseLanguageCode,
  storeLanguageCode,
} from "@/lib/languages";
import { t } from "@/lib/i18n";

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
  const { languageCode } = useUserLanguage();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [preferredLanguageCode, setPreferredLanguageCode] = useState(DEFAULT_ACCOUNT_LANGUAGE_CODE);

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
    if (typeof window === "undefined") return;
    const next = detectPreferredLanguageCode(window.navigator.language);
    setPreferredLanguageCode(next);
    storeLanguageCode(next);
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

      if (!password) throw new Error("Please enter your password.");

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
          options: {
            data: {
              preferred_language_code: normaliseLanguageCode(preferredLanguageCode),
              preferred_language_label: getLanguageLabel(preferredLanguageCode),
            },
          },
        });

        if (error) throw error;

        storeLanguageCode(preferredLanguageCode);

        routeAfterAuth();
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) throw error;

      const languageCode = normaliseLanguageCode(preferredLanguageCode);
      const { error: preferenceError } = await supabase.auth.updateUser({
        data: {
          preferred_language_code: languageCode,
          preferred_language_label: getLanguageLabel(languageCode),
        },
      });

      if (preferenceError) throw preferenceError;

      storeLanguageCode(languageCode);

      routeAfterAuth();
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const title =
    mode === "signup"
      ? t(languageCode, "screen.create_account")
      : mode === "reset"
      ? t(languageCode, "screen.reset_password")
      : t(languageCode, "screen.sign_in");

  const subtitle =
    mode === "signup"
      ? t(languageCode, "login.signup_subtitle")
      : mode === "reset"
      ? t(languageCode, "login.reset_subtitle")
      : t(languageCode, "login.signin_subtitle");

  return (
    <>
      <style jsx global>{`
        :root {
          color-scheme: light;
          --cc-bg: #f6f9fb;
          --cc-card: rgba(255, 255, 255, 0.92);
          --cc-border: rgba(15, 23, 42, 0.08);
          --cc-text: #0f172a;
          --cc-radius: 16px;
          --cc-shadow:
            0 1px 2px rgba(0, 0, 0, 0.04),
            0 8px 24px rgba(0, 0, 0, 0.06);
        }

        html,
        body {
          height: 100%;
          margin: 0;
          padding: 0;
          background: #dfe9e5 !important;
          color: var(--cc-text) !important;
          -webkit-text-size-adjust: 100%;
        }

        body {
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
            Helvetica, Arial, sans-serif;
          background:
            linear-gradient(rgba(246, 249, 251, 0.9), rgba(246, 249, 251, 0.95)),
            url("/images/carecircle-bg-main.png") center / cover fixed !important;
        }

        a,
        a:visited,
        a:hover,
        a:active,
        a:focus {
          color: inherit;
          text-decoration: none;
        }

        input,
        textarea,
        select,
        button {
          font: inherit;
          color-scheme: light;
        }

        .cc-page {
          position: relative;
          min-height: 100vh;
          padding: 24px;
          padding-left: max(24px, env(safe-area-inset-left));
          padding-right: max(24px, env(safe-area-inset-right));
          padding-top: max(24px, env(safe-area-inset-top));
          padding-bottom: max(24px, env(safe-area-inset-bottom));
        }

        .cc-container {
          position: relative;
          z-index: 1;
          max-width: 1100px;
          margin: 0 auto;
        }

        .cc-stack {
          display: grid;
          gap: 16px;
        }

        .cc-row {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }

        .cc-row-between {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .cc-grid-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .cc-grid-2-125 {
          display: grid;
          grid-template-columns: 1fr 1.25fr;
          gap: 16px;
        }

        .cc-grid-3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }

        @media (max-width: 900px) {
          .cc-grid-2,
          .cc-grid-2-125 {
            grid-template-columns: 1fr;
          }

          .cc-grid-3 {
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (max-width: 520px) {
          .cc-page {
            padding: 14px;
            padding-left: max(14px, env(safe-area-inset-left));
            padding-right: max(14px, env(safe-area-inset-right));
            padding-top: max(14px, env(safe-area-inset-top));
            padding-bottom: max(14px, env(safe-area-inset-bottom));
          }

          .cc-grid-3 {
            grid-template-columns: 1fr;
          }
        }

        .cc-wrap {
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .cc-card {
          background: var(--cc-card) !important;
          color: var(--cc-text) !important;
          border: 1px solid var(--cc-border) !important;
          border-radius: var(--cc-radius);
          box-shadow: var(--cc-shadow);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        .cc-card-pad {
          padding: 16px;
        }

        .cc-panel,
        .cc-panel-soft,
        .cc-panel-green,
        .cc-panel-blue {
          padding: 12px;
          border-radius: 14px;
          color: var(--cc-text) !important;
          border: 1px solid rgba(15, 23, 42, 0.06) !important;
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
        }

        .cc-panel {
          background: rgba(201, 211, 224, 0.2) !important;
        }

        .cc-panel-soft {
          background: rgba(255, 255, 255, 0.78) !important;
        }

        .cc-panel-green {
          background: rgba(127, 175, 163, 0.12) !important;
        }

        .cc-panel-blue {
          background: rgba(94, 127, 163, 0.12) !important;
        }

        .cc-kicker {
          font-size: 12px;
          opacity: 0.7;
        }

        .cc-h1 {
          margin: 0;
          font-size: 24px;
          letter-spacing: -0.2px;
        }

        .cc-h2 {
          margin: 0;
          font-size: 18px;
          letter-spacing: -0.1px;
        }

        .cc-subtle {
          opacity: 0.75;
          font-size: 13px;
        }

        .cc-small {
          font-size: 12px;
          opacity: 0.7;
        }

        .cc-strong {
          font-weight: 900;
        }

        .cc-pill {
          font-size: 12px;
          padding: 4px 10px;
          border-radius: 999px;
          font-weight: 900;
          color: var(--cc-text) !important;
          border: 1px solid rgba(15, 23, 42, 0.08) !important;
          background: rgba(255, 255, 255, 0.92) !important;
        }

        .cc-pill-primary {
          background: rgba(94, 127, 163, 0.18) !important;
        }

        .cc-pill-danger {
          background: rgba(220, 38, 38, 0.12) !important;
        }

        .cc-btn,
        .cc-btn:visited,
        .cc-btn:hover,
        .cc-btn:active,
        .cc-btn:focus {
          border-radius: 14px;
          padding: 10px 14px;
          font-weight: 800;
          border: 1px solid rgba(15, 23, 42, 0.1) !important;
          background: rgba(255, 255, 255, 0.9) !important;
          color: var(--cc-text) !important;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .cc-btn-primary,
        .cc-btn-primary:visited,
        .cc-btn-primary:hover,
        .cc-btn-primary:active,
        .cc-btn-primary:focus {
          background: rgba(94, 127, 163, 0.18) !important;
          color: var(--cc-text) !important;
        }

        .cc-btn-secondary,
        .cc-btn-secondary:visited,
        .cc-btn-secondary:hover,
        .cc-btn-secondary:active,
        .cc-btn-secondary:focus {
          background: rgba(127, 175, 163, 0.2) !important;
          color: var(--cc-text) !important;
        }

        .cc-btn-danger,
        .cc-btn-danger:visited,
        .cc-btn-danger:hover,
        .cc-btn-danger:active,
        .cc-btn-danger:focus {
          color: crimson !important;
        }

        .cc-btn:disabled,
        .cc-btn-disabled {
          opacity: 0.55;
          cursor: not-allowed;
          pointer-events: none;
        }

        .cc-field {
          display: grid;
          gap: 6px;
        }

        .cc-label {
          font-size: 13px;
          opacity: 0.8;
        }

        .cc-input,
        .cc-select,
        .cc-textarea {
          width: 100%;
          padding: 12px;
          border-radius: 14px;
          border: 1px solid rgba(15, 23, 42, 0.08) !important;
          background: rgba(255, 255, 255, 0.95) !important;
          color: var(--cc-text) !important;
          box-sizing: border-box;
        }

        .cc-textarea {
          min-height: 90px;
          resize: vertical;
        }

        .cc-status {
          padding: 12px;
          border-radius: 16px;
          border: 1px solid var(--cc-border);
          background: rgba(255, 255, 255, 0.9) !important;
          color: var(--cc-text) !important;
        }

        .cc-status-ok {
          border-left: 4px solid #2f8f5b;
        }

        .cc-status-loading {
          border-left: 4px solid rgba(94, 127, 163, 1);
        }

        .cc-status-error {
          border-left: 4px solid crimson;
        }

        .cc-status-error-title {
          color: crimson;
          font-weight: 900;
        }
      `}</style>

      {checkingSession ? (
        <div className="cc-page">
          <div
            className="cc-container"
            style={{
              minHeight:
                "calc(100dvh - max(24px, env(safe-area-inset-top)) - max(24px, env(safe-area-inset-bottom)))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div className="cc-card cc-card-pad" style={{ width: "100%", maxWidth: 560 }}>
              <div className="cc-stack">
                <div className="cc-brand-lockup">
                  <span className="cc-brand-mark" aria-hidden="true">
                    <Image
                      src="/images/carecircle-watermark.png"
                      alt=""
                      className="cc-brand-mark-img"
                      width={34}
                      height={34}
                    />
                  </span>
                  <span className="cc-brand-copy">
                    <span className="cc-kicker">CareBridge Studios</span>
                    <span className="cc-brand-name">CareCircle</span>
                  </span>
                </div>
                <h1 className="cc-h1" style={{ fontSize: 38 }}>
                  CareCircle
                </h1>
                <div className="cc-subtle" style={{ fontSize: 18 }}>
                  {t(languageCode, "login.checking_sign_in")}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="cc-page">
          <div
            className="cc-container"
            style={{
              minHeight:
                "calc(100dvh - max(24px, env(safe-area-inset-top)) - max(24px, env(safe-area-inset-bottom)))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div className="cc-card cc-card-pad" style={{ width: "100%", maxWidth: 560 }}>
              <div className="cc-stack" style={{ gap: 20 }}>
                <div className="cc-stack" style={{ gap: 10 }}>
                  <div className="cc-brand-lockup">
                    <span className="cc-brand-mark" aria-hidden="true">
                      <Image
                        src="/images/carecircle-watermark.png"
                        alt=""
                        className="cc-brand-mark-img"
                        width={34}
                        height={34}
                      />
                    </span>
                    <span className="cc-brand-copy">
                      <span className="cc-kicker">CareBridge Studios</span>
                      <span className="cc-brand-name">CareCircle</span>
                    </span>
                  </div>
                  <h1 className="cc-h1" style={{ fontSize: 42 }}>
                    {title}
                  </h1>
                  <div style={{ fontSize: 20, lineHeight: 1.4 }}>{subtitle}</div>
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
                  {mode !== "reset" ? (
                    <div className="cc-field">
                      <div className="cc-label">{t(languageCode, "common.your_language")}</div>
                      <select
                        className="cc-select"
                        value={preferredLanguageCode}
                        onChange={(e) => setPreferredLanguageCode(normaliseLanguageCode(e.target.value))}
                        disabled={loading}
                        style={{ minHeight: 54, fontSize: 17 }}
                      >
                        {SUPPORTED_ACCOUNT_LANGUAGES.map((language) => (
                          <option key={language.code} value={language.code}>
                            {language.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <div className="cc-field">
                    <div className="cc-label">{t(languageCode, "common.email")}</div>
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
                      style={{ minHeight: 54, fontSize: 17 }}
                    />
                  </div>

                  {mode !== "reset" ? (
                    <div className="cc-field">
                      <div className="cc-label">{t(languageCode, "common.password")}</div>
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
                        style={{ minHeight: 54, fontSize: 17 }}
                      />
                    </div>
                  ) : null}

                  {mode === "signup" ? (
                    <div className="cc-field">
                      <div className="cc-label">{t(languageCode, "common.confirm_password")}</div>
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
                        style={{ minHeight: 54, fontSize: 17 }}
                      />
                    </div>
                  ) : null}

                  <div className="cc-row">
                    <button
                      type="submit"
                      className="cc-btn cc-btn-primary"
                      disabled={loading}
                      style={{ minHeight: 52, fontSize: 16 }}
                    >
                      {mode === "signup"
                        ? loading
                          ? "Creating account..."
                          : t(languageCode, "common.create_account")
                        : mode === "reset"
                        ? loading
                          ? "Sending..."
                          : t(languageCode, "common.send_reset_email")
                        : loading
                        ? "Signing in..."
                        : t(languageCode, "common.sign_in")}
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
                      style={{ justifyContent: "flex-start", minHeight: 48 }}
                    >
                      {t(languageCode, "common.back_to_sign_in")}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="cc-btn"
                        onClick={() => {
                          setMode("reset");
                          setMsg(null);
                          setError(null);
                        }}
                        style={{ justifyContent: "flex-start", minHeight: 48 }}
                      >
                        {t(languageCode, "common.forgot_password")}
                      </button>

                      <button
                        type="button"
                        className="cc-btn"
                        onClick={() => {
                          setMode("signup");
                          setMsg(null);
                          setError(null);
                        }}
                        style={{ justifyContent: "flex-start", minHeight: 48 }}
                      >
                        {t(languageCode, "common.create_new_account")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
