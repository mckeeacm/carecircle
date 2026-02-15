"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink() {
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 420, width: "100%", padding: 24, border: "1px solid #ddd", borderRadius: 12 }}>
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
              disabled={!email.includes("@")}
              style={{
                width: "100%",
                padding: 12,
                background: "black",
                color: "white",
                borderRadius: 8,
                opacity: email.includes("@") ? 1 : 0.5,
              }}
            >
              Send sign-in link
            </button>
          </>
        )}

        {error && <p style={{ color: "crimson", marginTop: 12 }}>{error}</p>}
      </div>
    </main>
  );
}
