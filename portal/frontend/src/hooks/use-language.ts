"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export type Language = "en" | "zh";

export const LANGUAGES: { value: Language; label: string; native: string }[] = [
  { value: "en", label: "English", native: "English" },
  { value: "zh", label: "Chinese", native: "中文" },
];

const STORAGE_KEY = "research-corpus:language";
const DEFAULT: Language = "en";

function read(): Language {
  if (typeof window === "undefined") return DEFAULT;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "zh" || v === "en" ? v : DEFAULT;
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function setLanguage(lang: Language) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, lang);
  listeners.forEach((cb) => cb());
}

export function useLanguage(): [Language, (lang: Language) => void] {
  const lang = useSyncExternalStore(subscribe, read, () => DEFAULT);
  return [lang, setLanguage];
}

/**
 * Hook for components that need the language but want to render a stable
 * server value on first paint (avoids hydration mismatch). Returns the
 * default until mounted.
 */
export function useLanguageMounted(): Language {
  const [lang, setLang] = useState<Language>(DEFAULT);
  useEffect(() => {
    setLang(read());
    const unsubscribe = subscribe(() => setLang(read()));
    return unsubscribe;
  }, []);
  return lang;
}

export function languageInstructionEn(lang: Language): string {
  return lang === "zh"
    ? "Always respond in Simplified Chinese (中文), regardless of the language of the question."
    : "Always respond in English, regardless of the language of the question.";
}
