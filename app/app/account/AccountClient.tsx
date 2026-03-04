"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function AccountClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [email, setEmail] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) return setMsg(error.message);
      setEmail(data.user?.email ?? "");
    })();
  }, [supabase]);

  async function signOut() {
    setMsg(null);
    const { error } = await supabase.auth.signOut();
    if (error) setMsg(error.message);
    // you likely have middleware redirect; leaving it simple
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Account</h1>
            <div className="cc-subtle cc-wrap">{email || "—"}</div>
          </div>
          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">
              Hub
            </Link>
          </div>
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Error</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-strong">Quick links</div>

          <div className="cc-row">
            <Link className="cc-btn cc-btn-primary" href="/app/hub">
              Go to Hub
            </Link>

            <Link className="cc-btn" href="/app/account/permissions">
              Permissions
            </Link>

            <button className="cc-btn cc-btn-danger" onClick={signOut}>
              Sign out
            </button>
          </div>

          <div className="cc-small cc-subtle">
            The Permissions page will show only circles where you are a controller (or patient, if you keep that rule).
          </div>
        </div>
      </div>
    </div>
  );
}