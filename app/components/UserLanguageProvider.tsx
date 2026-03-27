"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  DEFAULT_ACCOUNT_LANGUAGE_CODE,
  normaliseLanguageCode,
  readStoredLanguageCode,
  storeLanguageCode,
} from "@/lib/languages";

type UserLanguageContextValue = {
  languageCode: string;
  setLanguageCode: (code: string) => void;
};

const UserLanguageContext = createContext<UserLanguageContextValue>({
  languageCode: DEFAULT_ACCOUNT_LANGUAGE_CODE,
  setLanguageCode: () => undefined,
});

export function useUserLanguage() {
  return useContext(UserLanguageContext);
}

export default function UserLanguageProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [languageCode, setLanguageCodeState] = useState(DEFAULT_ACCOUNT_LANGUAGE_CODE);

  function applyLanguageCode(code: string | null | undefined) {
    const next = normaliseLanguageCode(code);
    setLanguageCodeState(next);
    storeLanguageCode(next);
  }

  useEffect(() => {
    applyLanguageCode(readStoredLanguageCode());

    let active = true;

    async function loadFromUser() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!active || !user) return;
        applyLanguageCode(user.user_metadata?.preferred_language_code);
      } catch {}
    }

    loadFromUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return;
      applyLanguageCode(session?.user?.user_metadata?.preferred_language_code);
    });

    function onChanged(event: Event) {
      const detail = (event as CustomEvent<{ code?: string }>).detail;
      if (!active) return;
      applyLanguageCode(detail?.code);
    }

    window.addEventListener("carecircle:language-changed", onChanged as EventListener);

    return () => {
      active = false;
      subscription.unsubscribe();
      window.removeEventListener("carecircle:language-changed", onChanged as EventListener);
    };
  }, [supabase]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = languageCode;
  }, [languageCode]);

  const value = useMemo<UserLanguageContextValue>(
    () => ({
      languageCode,
      setLanguageCode: applyLanguageCode,
    }),
    [languageCode]
  );

  return <UserLanguageContext.Provider value={value}>{children}</UserLanguageContext.Provider>;
}
