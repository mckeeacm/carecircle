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

  useEffect(() => {
    setLanguageCodeState(readStoredLanguageCode());

    let active = true;

    async function loadFromUser() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!active || !user) return;
        const next = normaliseLanguageCode(user.user_metadata?.preferred_language_code);
        setLanguageCodeState(next);
        storeLanguageCode(next);
      } catch {}
    }

    loadFromUser();

    function onChanged(event: Event) {
      const detail = (event as CustomEvent<{ code?: string }>).detail;
      if (!active) return;
      setLanguageCodeState(normaliseLanguageCode(detail?.code));
    }

    window.addEventListener("carecircle:language-changed", onChanged as EventListener);

    return () => {
      active = false;
      window.removeEventListener("carecircle:language-changed", onChanged as EventListener);
    };
  }, [supabase]);

  const value = useMemo<UserLanguageContextValue>(
    () => ({
      languageCode,
      setLanguageCode: (code: string) => {
        const next = normaliseLanguageCode(code);
        setLanguageCodeState(next);
        storeLanguageCode(next);
      },
    }),
    [languageCode]
  );

  return <UserLanguageContext.Provider value={value}>{children}</UserLanguageContext.Provider>;
}
