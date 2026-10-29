import { useEffect, useRef, useState } from "react";
import { getPosition, subscribePosition } from "./playback";
import { t, getLanguage } from "./i18n";
import type { Track } from "./types";
export type ListeningDays = Record<string, Record<string, number>>;
const storageKey = "glass-music-listening-v1";
let history: ListeningDays | undefined;
let dirty = false,
  accumulated = 0;
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function recordListening(
  days: ListeningDays,
  id: string,
  seconds: number,
  ending: Date,
): void {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) return;
  let start = new Date(ending.getTime() - seconds * 1000);
  while (start < ending) {
    const boundary = new Date(start);
    boundary.setHours(24, 0, 0, 0);
    const end = new Date(Math.min(+boundary, +ending)),
      key = dayKey(start);
    days[key] ??= {};
    days[key][id] = (days[key][id] ?? 0) + (+end - +start) / 1000;
    start = end;
  }
}
function read(): ListeningDays {
  if (!history) {
    try {
      history = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    } catch {
      history = {};
    }
  }
  return history && typeof history === "object" ? history : (history = {});
}
function flush() {
  if (!dirty) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(read()));
    dirty = false;
    accumulated = 0;
  } catch {
    /* Keep the unsaved history in memory. */
  }
}
export function listeningSample(delta: number, elapsed: number): number {
  return Number.isFinite(delta) &&
    Number.isFinite(elapsed) &&
    elapsed > 0 &&
    elapsed <= 86400 &&
    delta > 0 &&
    Math.abs(delta - elapsed) < 2
    ? Math.min(delta, elapsed)
    : 0;
}
export function useListeningRecorder(id: string | null, playing: boolean) {
  useEffect(() => {
    if (!id || !playing) return;
    let last = getPosition(),
      lastTime = performance.now();
    const unsubscribe = subscribePosition(() => {
      const now = performance.now(),
        position = getPosition();
      const elapsed = (now - lastTime) / 1000,
        delta = position - last;
      const seconds = listeningSample(delta, elapsed);
      if (seconds > 0) {
        recordListening(read(), id, seconds, new Date());
        dirty = true;
        accumulated += seconds;
        if (accumulated >= 30) flush();
      }
      last = position;
      lastTime = now;
    });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      unsubscribe();
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [id, playing]);
}
export function listeningTotals(
  days: ListeningDays,
  start: Date,
  end: Date,
): Record<string, number> {
  const low = dayKey(start),
    high = dayKey(end),
    totals: Record<string, number> = {};
  for (const [date, songs] of Object.entries(days))
    if (date >= low && date < high)
      for (const [id, seconds] of Object.entries(songs))
        if (Number.isFinite(seconds) && seconds > 0)
          totals[id] = (totals[id] ?? 0) + seconds;
  return totals;
}
export function ListeningDialog({
  tracks,
  close,
}: {
  tracks: Track[];
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [annual, setAnnual] = useState(false),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
    };
  }, []);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (annual) {
    start.setMonth(0, 1);
    start.setFullYear(start.getFullYear() + offset);
  } else
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  const end = new Date(start);
  if (annual) end.setFullYear(end.getFullYear() + 1);
  else end.setDate(end.getDate() + 7);
  const totals = listeningTotals(read(), start, end),
    top = Object.entries(totals)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5);
  return (
    <dialog
      ref={dialog}
      className="editor listening-dialog"
      onCancel={close}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="modal-heading">
        <h2>{t("Tu música en números")}</h2>
        <button className="ghost" onClick={close}>
          {t("Cerrar")}
        </button>
      </div>
      <div className="listening-period">
        <button
          onClick={() => {
            setAnnual(false);
            setOffset(0);
          }}
          aria-pressed={!annual}
        >
          {t("Semana")}
        </button>
        <button
          onClick={() => {
            setAnnual(true);
            setOffset(0);
          }}
          aria-pressed={annual}
        >
          {t("Resumen anual")}
        </button>
      </div>
      <div className="listening-period">
        <button
          onClick={() => setOffset(offset - 1)}
          aria-label={t("Período anterior")}
        >
          ‹
        </button>
        <strong>
          {new Intl.DateTimeFormat(
            getLanguage(),
            annual
              ? { year: "numeric" }
              : { day: "numeric", month: "long", year: "numeric" },
          ).format(start)}
        </strong>
        <button
          onClick={() => setOffset(offset + 1)}
          disabled={offset >= 0}
          aria-label={t("Período siguiente")}
        >
          ›
        </button>
      </div>
      <strong className="listening-total">
        {Math.floor(Object.values(totals).reduce((a, b) => a + b, 0) / 60)} min
      </strong>
      <p>{t("Tiempo escuchado en este dispositivo")}</p>
      <h3>{t("Tus 5 canciones más escuchadas")}</h3>
      {top.length === 0 && (
        <p>{t("Tu historial empieza desde esta actualización.")}</p>
      )}
      <ol>
        {top.map(([id, seconds]) => (
          <li key={id}>
            <span>
              {tracks.find((song) => song.id === id)?.title ??
                t("Canción fuera de la biblioteca")}
            </span>
            <strong>{Math.floor(seconds / 60)} min</strong>
          </li>
        ))}
      </ol>
      <p className="modal-description">
        {t("Historial local. Los minutos de PC e iPhone todavía no se suman.")}
      </p>
    </dialog>
  );
}
