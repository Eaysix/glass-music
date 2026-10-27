import { t } from "./i18n";
import { parseLrc } from "./queue";
export type EditableWord = {
  text: string;
  time: number | null;
  spaceAfter?: string;
};
export type EditableLyric = {
  text: string;
  time: number | null;
  words?: EditableWord[];
  voice?: string;
};
const timestamp = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g;
export function editableLyrics(source: string): EditableLyric[] {
  const rows: EditableLyric[] = [],
    physical: string[] = [];
  const offset = source.match(/\[offset:([+-]?\d+)\]/i)?.[1];
  for (const line of source.split(/\r?\n/)) {
    if (!/\[\d+:\d{2}/.test(line) && /<\d+:\d{2}/.test(line) && physical.length)
      physical[physical.length - 1] += ` ${line.trim()}`;
    else physical.push(line);
  }
  for (const raw of physical) {
    if (/^\s*\[(?:ar|al|ti|au|by|offset|length|re|ve):/i.test(raw)) continue;
    const stamps = [...raw.matchAll(timestamp)];
    if (stamps.length) {
      const timed = parseLrc(
        `${offset ? `[offset:${offset}]\n` : ""}${raw}`,
        true,
      );
      rows.push(
        ...timed.map((line) => ({
          text: line.text,
          time: line.time,
          ...(line.words ? { words: line.words } : {}),
          ...(line.voice ? { voice: line.voice } : {}),
        })),
      );
    } else if (raw.trim()) rows.push({ text: raw.trim(), time: null });
  }
  return rows;
}
export function lrcStamp(seconds: number, precision = 2): string {
  const scale = 10 ** precision,
    ticks = Math.round(Math.max(0, seconds) * scale);
  return `${String(Math.floor(ticks / (60 * scale))).padStart(2, "0")}:${String(Math.floor(ticks / scale) % 60).padStart(2, "0")}.${String(ticks % scale).padStart(precision, "0")}`;
}
const exactStamp = (time: number) =>
  lrcStamp(
    time,
    Math.abs(time * 100 - Math.round(time * 100)) > 0.00001 ? 3 : 2,
  );
export function serializeLyrics(rows: EditableLyric[]): string {
  return rows
    .map(
      (row) =>
        `${row.time === null ? "" : `[${exactStamp(row.time)}]`}${row.voice ? `v${row.voice}:` : ""}${
          row.words?.length
            ? row.words
                .map(
                  (word, index) =>
                    `${word.time === null ? "" : `<${exactStamp(word.time)}>`}${word.text}${index < row.words!.length - 1 ? (word.spaceAfter ?? " ") : ""}`,
                )
                .join("")
            : row.text
        }`,
    )
    .join("\n");
}
export function wordsForLyrics(rows: EditableLyric[]): EditableLyric[] {
  return rows.map((row) => {
    if (row.words?.length || !row.text.trim()) return row;
    const words: EditableWord[] = [];
    for (const chunk of row.text.matchAll(/(\S+)(\s*)/gu)) {
      const pieces =
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(chunk[1])
          ? [
              ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(
                chunk[1],
              ),
            ].reduce<string[]>((parts, part) => {
              if (!part.isWordLike && parts.length)
                parts[parts.length - 1] += part.segment;
              else parts.push(part.segment);
              return parts;
            }, [])
          : [chunk[1]];
      for (const text of pieces)
        words.push({ text, time: null, spaceAfter: "" });
      if (words.length) words[words.length - 1].spaceAfter = chunk[2];
    }
    if (words[0]) words[0].time = row.time;
    return { ...row, words };
  });
}
export function retimeLine(
  row: EditableLyric,
  time: number | null,
): EditableLyric {
  const delta = time !== null && row.time !== null ? time - row.time : null;
  return {
    ...row,
    time,
    ...(row.words
      ? {
          words: row.words.map((word, i) => ({
            ...word,
            time:
              time === null
                ? null
                : i === 0
                  ? time
                  : word.time !== null && delta !== null
                    ? Math.round((word.time + delta) * 1000) / 1000
                    : null,
          })),
        }
      : {}),
  };
}
export function retimeWord(
  rows: EditableLyric[],
  line: number,
  word: number,
  time: number | null,
): EditableLyric[] {
  return rows.map((row, i) =>
    i !== line
      ? row
      : {
          ...row,
          time: word === 0 ? time : row.time,
          words: row.words?.map((part, j) =>
            j !== word ? part : { ...part, time },
          ),
        },
  );
}
export function timingError(rows: EditableLyric[], duration: number): string {
  if (!rows.some((row) => row.time !== null)) return "";
  if (rows.some((row) => row.time === null))
    return t(
      "Faltan líneas por marcar. Completa los tiempos antes de guardar la letra sincronizada.",
    );
  for (let i = 0; i < rows.length; i++) {
    const time = rows[i].time!;
    if (!Number.isFinite(time) || time < 0 || (duration > 0 && time > duration))
      return t("Revisa el tiempo de la línea {p0}.", { p0: i + 1 });
    if (i && time <= rows[i - 1].time!)
      return t("La línea {p0} debe comenzar después de la anterior.", {
        p0: i + 1,
      });
  }
  return "";
}
export function wordTimingError(
  rows: EditableLyric[],
  duration: number,
  requireAll = true,
): string {
  if (
    rows.some(
      (row) =>
        row.text.trim() &&
        (requireAll || row.words?.length) &&
        (!row.words?.length || row.words.some((w) => w.time === null)),
    )
  )
    return t(
      "Faltan palabras por marcar. Completa sus tiempos antes de guardar.",
    );
  const lineError = timingError(rows, duration);
  if (lineError) return lineError;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i],
      words = row.words ?? [];
    for (let j = 0; j < words.length; j++) {
      const time = words[j].time!;
      if (
        !Number.isFinite(time) ||
        time < (row.time ?? 0) ||
        (duration > 0 && time > duration) ||
        (j > 0 && time <= words[j - 1].time!) ||
        (rows[i + 1]?.time != null && time >= rows[i + 1].time!)
      )
        return t(
          "Revisa la palabra {p0} de la línea {p1}: sus tiempos deben ir en orden y dentro del verso.",
          { p0: j + 1, p1: i + 1 },
        );
    }
  }
  return "";
}
