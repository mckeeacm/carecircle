"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function AuthCallback() {
  const [msg, setMsg] = useState("Signing you in…");

  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href);

        // 1) Newer Supabase links often arrive as ?code=...
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setMsg("Sign-in failed: " + error.message);
            return;
          }
          window.location.replace("/app");
          return;
        }

        // 2) Some links arrive as #access_token=... in the hash
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const access_token = hash.get("access_token");
        const refresh_token = hash.get("refresh_token");

        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (error) {
            setMsg("Sign-in failed: " + error.message);
            return;
          }
          window.location.replace("/app");
          return;
        }

        // 3) If we got here, the URL lost its params (common with some email clients/safe links)
        setMsg(
          "Sign-in failed: missing parameters in the URL.\n\n" +
            "Tip: open the magic link on the SAME laptop + same browser where you requested it.\n" +
            "If your email app opens a 'safe link' preview, copy the link and paste it into Chrome."
        );
      } catch (e: any) {
        setMsg("Sign-in failed: " + (e?.message ?? String(e)));
      }
    })();
  }, []);

  return (
    <main style={{ padding: 24, whiteSpace: "pre-wrap" }}>
      {msg}
    </main>
  );
}
