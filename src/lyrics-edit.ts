export type EditableLyric = { text: string; time: number | null };
const timestamp = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g;
export function editableLyrics(source: string): EditableLyric[] {
  const offset =
    Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0) / 1000;
  const rows: EditableLyric[] = [];
  for (const raw of source.split(/\r?\n/)) {
    if (/^\s*\[(?:ar|al|ti|au|by|offset|length|re|ve):/i.test(raw)) continue;
    const stamps = [...raw.matchAll(timestamp)];
    const text = raw
      .replace(timestamp, "")
      .replace(/<\d+:\d{2}(?:[.:]\d{1,3})?>/g, "")
      .replace(/^v\d+:\s*/i, "")
      .trim();
    if (!text && !stamps.length) continue;
    if (!stamps.length) rows.push({ text, time: null });
    for (const stamp of stamps)
      rows.push({
        text,
        time: Math.max(
          0,
          Number(stamp[1]) * 60 +
            Number(stamp[2]) +
            Number(`0.${stamp[3] ?? "0"}`) +
            offset,
        ),
      });
  }
  return rows;
}
export function lrcStamp(seconds: number): string {
  const ticks = Math.round(Math.max(0, seconds) * 100);
  return `${String(Math.floor(ticks / 6000)).padStart(2, "0")}:${String(Math.floor(ticks / 100) % 60).padStart(2, "0")}.${String(ticks % 100).padStart(2, "0")}`;
}
export function serializeLyrics(rows: EditableLyric[]): string {
  return rows
    .map(
      (row) =>
        `${row.time === null ? "" : `[${lrcStamp(row.time)}]`}${row.text}`,
    )
    .join("\n");
}
export function timingError(rows: EditableLyric[], duration: number): string {
  if (!rows.some((row) => row.time !== null)) return "";
  if (rows.some((row) => row.time === null))
    return "Faltan líneas por marcar. Completa los tiempos antes de guardar la letra sincronizada.";
  for (let i = 0; i < rows.length; i++) {
    const time = rows[i].time!;
    if (!Number.isFinite(time) || time < 0 || (duration > 0 && time > duration))
      return `Revisa el tiempo de la línea ${i + 1}.`;
    if (i && time <= rows[i - 1].time!)
      return `La línea ${i + 1} debe comenzar después de la anterior.`;
  }
  return "";
}
