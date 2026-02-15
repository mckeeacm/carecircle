"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function AcceptInvitePage() {
  const [msg, setMsg] = useState("Accepting invite…");

  useEffect(() => {
    (async () => {
      const sp = new URLSearchParams(window.location.search);
      const token = sp.get("token");

      if (!token) {
        setMsg("Missing token.");
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        // send them to login; after login, they can revisit this link
        window.location.href = "/";
        return;
      }

      const { data, error } = await supabase.rpc("accept_invite", { p_token: token });

      if (error) {
        setMsg("Invite failed: " + error.message);
        return;
      }

      setMsg("Invite accepted! Redirecting…");
      window.location.href = `/app/patients/${data}?tab=overview`;
    })();
  }, []);

  return <main style={{ padding: 24, whiteSpace: "pre-wrap" }}>{msg}</main>;
}
