export type SupportedLanguage = {
  code: string;
  label: string;
};

export const SUPPORTED_ACCOUNT_LANGUAGES: SupportedLanguage[] = [
  { code: "en", label: "English" },
  { code: "pl", label: "Polish" },
  { code: "ro", label: "Romanian" },
  { code: "pa", label: "Punjabi" },
  { code: "ur", label: "Urdu" },
  { code: "pt", label: "Portuguese" },
  { code: "es", label: "Spanish" },
  { code: "ar", label: "Arabic (Modern Standard)" },
  { code: "arz", label: "Arabic (Egyptian)" },
  { code: "bn", label: "Bengali" },
  { code: "gu", label: "Gujarati" },
  { code: "it", label: "Italian" },
  { code: "ckb", label: "Kurdish (Sorani)" },
  { code: "fa", label: "Persian (Farsi)" },
  { code: "tr", label: "Turkish" },
  { code: "ta", label: "Tamil" },
  { code: "cy", label: "Welsh" },
  { code: "uk", label: "Ukrainian" },
];

export const DEFAULT_ACCOUNT_LANGUAGE_CODE = "en";
export const LOCAL_LANGUAGE_KEY = "carecircle:preferred-language-code:v1";

export function getSupportedLanguage(code: string | null | undefined) {
  return SUPPORTED_ACCOUNT_LANGUAGES.find((language) => language.code === code) ?? null;
}

export function getLanguageLabel(code: string | null | undefined) {
  return getSupportedLanguage(code)?.label ?? "English";
}

export function normaliseLanguageCode(code: string | null | undefined) {
  const value = (code ?? "").trim().toLowerCase();
  return getSupportedLanguage(value)?.code ?? DEFAULT_ACCOUNT_LANGUAGE_CODE;
}

export function detectPreferredLanguageCode(locale: string | null | undefined) {
  const clean = (locale ?? "").trim().toLowerCase();
  if (!clean) return DEFAULT_ACCOUNT_LANGUAGE_CODE;

  const direct = getSupportedLanguage(clean);
  if (direct) return direct.code;

  const base = clean.split("-")[0] ?? "";
  return normaliseLanguageCode(base);
}

export function readStoredLanguageCode() {
  if (typeof window === "undefined") return DEFAULT_ACCOUNT_LANGUAGE_CODE;
  try {
    return normaliseLanguageCode(window.localStorage.getItem(LOCAL_LANGUAGE_KEY));
  } catch {
    return DEFAULT_ACCOUNT_LANGUAGE_CODE;
  }
}

export function storeLanguageCode(code: string) {
  if (typeof window === "undefined") return;
  try {
    const next = normaliseLanguageCode(code);
    window.localStorage.setItem(LOCAL_LANGUAGE_KEY, next);
    window.dispatchEvent(new CustomEvent("carecircle:language-changed", { detail: { code: next } }));
  } catch {}
}
