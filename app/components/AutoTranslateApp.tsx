"use client";

import { useEffect, useRef, useState } from "react";
import { getLanguageLabel, LOCAL_LANGUAGE_KEY } from "@/lib/languages";
import { useUserLanguage } from "@/app/components/UserLanguageProvider";

const SELECTOR = [
  "button",
  "a",
  "h1",
  "h2",
  "h3",
  "p",
  "span",
  "div",
  "label",
  "option",
  ".cc-label",
  ".cc-h1",
  ".cc-h2",
  ".cc-mobile-title",
  ".cc-bottom-nav-label",
  ".cc-subtle",
  ".cc-small",
  ".cc-strong",
  ".cc-kicker",
  ".cc-brand-name",
].join(", ");

type TranslationResponse = {
  translations?: string[];
  error?: string;
};

function cacheKey(languageCode: string, text: string) {
  return `${LOCAL_LANGUAGE_KEY}:ui:${languageCode}:${text}`;
}

function normaliseText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function shouldTranslateElement(element: Element) {
  if (!(element instanceof HTMLElement)) return false;
  if (element.dataset.noTranslate === "true") return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return false;
  if (element.classList.contains("cc-bottom-nav-icon")) return false;
  if (element.classList.contains("cc-brand-mark")) return false;
  if (element.closest("svg")) return false;
  if (element.tagName === "CODE") return false;
  if (element.children.length > 0 && !(element instanceof HTMLOptionElement)) return false;

  const text = normaliseText(element.textContent ?? "");
  if (!text) return false;
  if (text.length > 160) return false;
  if (text === "CareCircle" || text === "CareBridge Studios") return false;
  if (/^[0-9\-/:., ]+$/.test(text)) return false;
  if (text.includes("@")) return false;
  if (/^[0-9a-f]{8}-/i.test(text)) return false;
  return true;
}

export default function AutoTranslateApp() {
  const { languageCode } = useUserLanguage();
  const pendingRef = useRef(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  useEffect(() => {
    const root = document.body;
    if (!root) return;

    async function translateVisibleUi() {
      if (pendingRef.current) return;
      pendingRef.current = true;

      try {
        setTranslationError(null);
        const elements = Array.from(root.querySelectorAll(SELECTOR)).filter(shouldTranslateElement) as HTMLElement[];
        const seen = new Map<string, string>();

        for (const element of elements) {
          const sourceText = element.dataset.ccSourceText || normaliseText(element.textContent ?? "");
          if (!sourceText) continue;

          element.dataset.ccSourceText = sourceText;

          if (languageCode === "en") {
            element.textContent = sourceText;
            continue;
          }

          const cached = window.localStorage.getItem(cacheKey(languageCode, sourceText));
          if (cached) {
            element.textContent = cached;
            continue;
          }

          if (!seen.has(sourceText)) seen.set(sourceText, sourceText);
        }

        if (languageCode === "en" || seen.size === 0) return;

        const uncachedTexts = Array.from(seen.keys());
        const res = await fetch("/api/translate/ui", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetLanguageCode: languageCode, texts: uncachedTexts }),
        });

        const json = (await res.json().catch(() => null)) as TranslationResponse | null;
        if (!res.ok) {
          setTranslationError(json?.error ?? "UI translation failed.");
          return;
        }

        if (!json?.translations?.length) {
          setTranslationError("No translated interface text was returned.");
          return;
        }

        const translations = json.translations;
        uncachedTexts.forEach((text, index) => {
          const translated = normaliseText(translations[index] ?? text) || text;
          window.localStorage.setItem(cacheKey(languageCode, text), translated);
        });

        const freshElements = Array.from(root.querySelectorAll(SELECTOR)).filter(shouldTranslateElement) as HTMLElement[];
        for (const element of freshElements) {
          const sourceText = element.dataset.ccSourceText || normaliseText(element.textContent ?? "");
          const cached = window.localStorage.getItem(cacheKey(languageCode, sourceText));
          if (cached) element.textContent = cached;
        }
      } catch (error: any) {
        setTranslationError(error?.message ?? "UI translation failed.");
      } finally {
        pendingRef.current = false;
      }
    }

    translateVisibleUi();

    const observer = new MutationObserver(() => {
      window.setTimeout(() => {
        translateVisibleUi();
      }, 0);
    });

    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    document.documentElement.lang = languageCode;
    document.documentElement.setAttribute("data-language-label", getLanguageLabel(languageCode));

    return () => observer.disconnect();
  }, [languageCode]);

  if (languageCode === "en" || !translationError) return null;

  return (
    <div
      className="cc-card"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 90,
        zIndex: 120,
        padding: 12,
        borderRadius: 16,
        border: "1px solid rgba(220, 38, 38, 0.18)",
        background: "rgba(255, 245, 245, 0.96)",
      }}
    >
      <div className="cc-small" style={{ color: "#991b1b", opacity: 1 }}>
        Translation is not working yet for this language on this device: {translationError}
      </div>
    </div>
  );
}
