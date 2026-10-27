import type { Queue, ShuffleMode, Track } from "./types";
export function shuffled<T>(values: readonly T[], rng = Math.random): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function mix(
  ids: readonly string[],
  mode: ShuffleMode,
  tracks: readonly Track[],
  previous?: string | null,
): string[] {
  const unique = [...new Set(ids)];
  if (mode === "off") return unique;
  const pool = shuffled(unique);
  if (mode === "random") return pool;
  const artist = new Map(
    tracks.map((t) => [t.id, t.artist.trim().toLocaleLowerCase()]),
  );
  const result: string[] = [];
  let last = previous ? artist.get(previous) : undefined;
  while (pool.length) {
    // Shuffled candidate pool preserves randomness; separate artists whenever possible.
    const different = pool.findIndex((id) => artist.get(id) !== last);
    if (different < 0) {
      result.push(...pool);
      break;
    }
    const index = different;
    const [id] = pool.splice(index, 1);
    result.push(id);
    last = artist.get(id);
  }
  return result;
}
export function startQueue(
  ids: string[],
  current: string,
  mode: ShuffleMode,
  tracks: Track[],
): Queue {
  const context = [...new Set(ids)];
  const index = context.indexOf(current);
  return {
    current,
    history: [],
    context,
    upcoming:
      mode === "off"
        ? context.slice(index + 1)
        : mix(
            context.filter((id) => id !== current),
            mode,
            tracks,
            current,
          ),
  };
}
export function nextQueue(queue: Queue): Queue {
  const [current = null, ...upcoming] = queue.upcoming;
  return {
    ...queue,
    current,
    upcoming,
    history: queue.current
      ? [...queue.history, queue.current].slice(-200)
      : queue.history,
  };
}
export function previousQueue(queue: Queue): Queue {
  if (!queue.history.length) return queue;
  return {
    ...queue,
    current: queue.history.at(-1)!,
    history: queue.history.slice(0, -1),
    upcoming: queue.current
      ? [queue.current, ...queue.upcoming]
      : queue.upcoming,
  };
}
export interface LyricWord {
  time: number;
  text: string;
}
export interface LyricLine {
  time: number;
  text: string;
  words?: LyricWord[];
  voice?: string;
}
function stampSeconds(
  minutes: string,
  seconds: string,
  fraction?: string,
): number {
  return Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction ?? 0}`);
}
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  let offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0) / 1000;
  if (!Number.isFinite(offset)) offset = 0;
  // Enhanced LRC can wrap a physical row in the middle of word timestamps.
  const rows: string[] = [];
  for (const physical of text.split(/\r?\n/)) {
    if (
      !/\[\d+:\d{2}/.test(physical) &&
      /<\d+:\d{2}/.test(physical) &&
      rows.length
    )
      rows[rows.length - 1] += ` ${physical.trim()}`;
    else rows.push(physical);
  }
  for (const row of rows) {
    const stamps = [...row.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    let content = row.replace(/\[[^\]]*\]/g, "").trim();
    const voice = content.match(/^v(\d+):\s*/i)?.[1];
    content = content.replace(/^v\d+:\s*/i, "");
    const tags = [...content.matchAll(/<(\d+):(\d{2})(?:[.:](\d{1,3}))?>/g)];
    const words: LyricWord[] = [];
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i],
        start = tag.index! + tag[0].length,
        end = tags[i + 1]?.index ?? content.length;
      const word = content.slice(start, end).replace(/\s+/g, " ").trim();
      if (word)
        words.push({
          time: Math.max(0, stampSeconds(tag[1], tag[2], tag[3]) + offset),
          text: word,
        });
    }
    const clean = content
      .replace(/<\d+:\d{2}(?:[.:]\d{1,3})?>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const base = stampSeconds(stamps[0][1], stamps[0][2], stamps[0][3]);
    for (const stamp of stamps) {
      const time = stampSeconds(stamp[1], stamp[2], stamp[3]);
      const line: LyricLine = { time: Math.max(0, time + offset), text: clean };
      if (voice) line.voice = voice;
      if (words.length)
        line.words = words.map((word) => ({
          ...word,
          time: Math.max(0, word.time + time - base),
        }));
      lines.push(line);
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}
export function lyricIndex(lines: LyricLine[], position: number): number {
  let lo = 0,
    hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].time <= position) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
export const timeLabel = (seconds: number) => {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};
