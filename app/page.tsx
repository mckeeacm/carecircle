"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function Home() {
  const supabase = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendLink() {
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });

    if (error) setError(error.message);
    else setSent(true);

    setLoading(false);
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 420, width: "100%", padding: 24, border: "1px solid #ddd", borderRadius: 12, background: "#fff" }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>CareCircle</h1>
        <p style={{ marginBottom: 16 }}>
          Shared meds, appointments, and care notes — without confusion.
        </p>

        {sent ? (
          <p>Check your email for the sign-in link.</p>
        ) : (
          <>
            <input
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: "100%", padding: 12, marginBottom: 12 }}
            />

            <button
              onClick={sendLink}
              disabled={!email.includes("@") || loading}
              style={{
                width: "100%",
                padding: 12,
                background: "black",
                color: "white",
                borderRadius: 8,
                opacity: email.includes("@") && !loading ? 1 : 0.5,
                cursor: email.includes("@") && !loading ? "pointer" : "not-allowed",
              }}
            >
              {loading ? "Sending…" : "Send sign-in link"}
            </button>
          </>
        )}

        {error && <p style={{ color: "crimson", marginTop: 12 }}>{error}</p>}
      </div>
    </main>
  );
}