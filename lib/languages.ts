export type SupportedLanguage = {
  code: string;
  label: string;
};

export const SUPPORTED_ACCOUNT_LANGUAGES: SupportedLanguage[] = [
  { code: "en", label: "English" },
  { code: "pl", label: "Polski" },
  { code: "ro", label: "Romana" },
  { code: "pa", label: "Punjabi - ਪੰਜਾਬੀ" },
  { code: "ur", label: "اردو" },
  { code: "pt", label: "Portugues" },
  { code: "es", label: "Espanol" },
  { code: "ar", label: "العربية الفصحى" },
  { code: "arz", label: "العربية المصرية" },
  { code: "bn", label: "বাংলা" },
  { code: "gu", label: "ગુજરાતી" },
  { code: "it", label: "Italiano" },
  { code: "ckb", label: "کوردی سۆرانی" },
  { code: "fa", label: "فارسی" },
  { code: "tr", label: "Turkce" },
  { code: "ta", label: "தமிழ்" },
  { code: "cy", label: "Cymraeg" },
  { code: "uk", label: "Українська" },
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
  if (!value) return DEFAULT_ACCOUNT_LANGUAGE_CODE;

  const direct = getSupportedLanguage(value);
  if (direct) return direct.code;

  const base = value.split("-")[0]?.trim();
  if (base) {
    const fromBase = getSupportedLanguage(base);
    if (fromBase) return fromBase.code;
  }

  return DEFAULT_ACCOUNT_LANGUAGE_CODE;
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
