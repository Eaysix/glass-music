import { useSyncExternalStore } from "react";
import { messages } from "./locales";
export type Language = "es" | "en" | "de" | "zh-CN";
export const languages: readonly Language[] = ["es", "en", "de", "zh-CN"];
let language: Language = "es";
const listeners = new Set<() => void>();
export function getLanguage() {
  return language;
}
export function setLanguage(value: Language) {
  if (!languages.includes(value) || value === language) return;
  language = value;
  if (typeof document !== "undefined") document.documentElement.lang = value;
  for (const listener of listeners) listener();
}
export function useLanguage() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, getLanguage);
}
export function translate(
  locale: Language,
  key: string,
  values: Record<string, unknown> = {},
): string {
  const normalized = key.trim();
  const entry = messages[normalized];
  const pattern =
    locale === "es" ? normalized : (entry?.[locale] ?? normalized);
  const result = pattern.replace(/\{(\w+)\}/g, (token, name) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : token,
  );
  return (
    key.slice(0, key.length - key.trimStart().length) +
    result +
    key.slice(key.trimEnd().length)
  );
}
export function t(key: string, values?: Record<string, unknown>) {
  return translate(language, key, values);
}
export function dateLabel(value: number | undefined) {
  return value
    ? new Intl.DateTimeFormat(language, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(value)
    : t("Fecha desconocida");
}
