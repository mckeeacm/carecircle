"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

const INVITE_STORAGE_KEY = "carecircle:pending_invite";

type StoredInvite = {
  token: string;
  createdAt: number;
};

export default function OnboardingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [message, setMessage] = useState("Preparing onboarding…");
  const [busy, setBusy] = useState(true);

  function saveInvite(token: string) {
    const payload: StoredInvite = {
      token,
      createdAt: Date.now(),
    };

    localStorage.setItem(INVITE_STORAGE_KEY, JSON.stringify(payload));
  }

  function loadInvite(): StoredInvite | null {
    try {
      const raw = localStorage.getItem(INVITE_STORAGE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed?.token) return null;

      return parsed;
    } catch {
      return null;
    }
  }

  function clearInvite() {
    localStorage.removeItem(INVITE_STORAGE_KEY);
  }

  async function acceptInvite(token: string) {
    setMessage("Joining circle…");

    const { error } = await supabase.rpc("patient_invite_accept", {
      p_token: token,
    });

    if (error) {
      throw error;
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const urlToken = searchParams.get("invite");

        if (urlToken) {
          saveInvite(urlToken);
        }

        const stored = loadInvite();

        if (!stored?.token) {
          setBusy(false);
          setMessage("No invite token found.");
          return;
        }

        const { data } = await supabase.auth.getSession();

        const session = data.session;

        if (!session) {
          setMessage("Please sign in to join the circle.");

          router.replace(
            `/?next=${encodeURIComponent("/app/onboarding")}`
          );

          return;
        }

        await acceptInvite(stored.token);

        if (cancelled) return;

        clearInvite();

        setMessage("Circle joined successfully!");

        router.replace("/app/hub");
      } catch (e: any) {
        setMessage(e?.message ?? "Invite acceptance failed.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams, supabase]);

  return (
    <div className="cc-page">
      <div className="cc-container cc-card cc-card-pad cc-stack">

        <div>
          <div className="cc-kicker">CareCircle</div>
          <h1 className="cc-h1">Joining circle</h1>
        </div>

        <div className="cc-panel">
          {busy ? "Processing invite…" : message}
        </div>

      </div>
    </div>
  );
}