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
    manualIndices: [],
    currentManual: false,
    historyManual: [],
    played: [],
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
    currentManual: (queue.manualIndices ?? []).includes(0),
    manualIndices: (queue.manualIndices ?? [])
      .filter((i) => i > 0)
      .map((i) => i - 1),
    historyManual: queue.current
      ? [
          ...(queue.historyManual ?? queue.history.map(() => false)),
          !!queue.currentManual,
        ].slice(-200)
      : queue.historyManual,
    played:
      queue.current && !queue.currentManual
        ? [...new Set([...(queue.played ?? []), queue.current])]
        : queue.played,
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
    currentManual: queue.historyManual?.at(-1) ?? false,
    historyManual: queue.historyManual?.slice(0, -1),
    manualIndices: [
      ...(queue.current && queue.currentManual ? [0] : []),
      ...(queue.manualIndices ?? []).map((i) => i + (queue.current ? 1 : 0)),
    ],
    played: (queue.played ?? []).filter((id) => id !== queue.history.at(-1)),
    history: queue.history.slice(0, -1),
    upcoming: queue.current
      ? [queue.current, ...queue.upcoming]
      : queue.upcoming,
  };
}
// Manual entries are tagged by position so duplicate songs and user ordering survive context changes.
export function enqueueQueue(
  queue: Queue,
  ids: string[],
  first: boolean,
): Queue {
  const offset = first ? 0 : queue.upcoming.length;
  return {
    ...queue,
    upcoming: first ? [...ids, ...queue.upcoming] : [...queue.upcoming, ...ids],
    manualIndices: [
      ...(queue.manualIndices ?? []).map((i) => i + (first ? ids.length : 0)),
      ...ids.map((_, i) => offset + i),
    ].sort((a, b) => a - b),
  };
}
// A single FIFO group chosen by the listener, before the automatic context.
export function addManualQueue(queue: Queue, ids: string[]): Queue {
  const pins = new Set(queue.manualIndices ?? []);
  const manual = queue.upcoming.filter((_, i) => pins.has(i));
  const automatic = queue.upcoming.filter((_, i) => !pins.has(i));
  return {
    ...queue,
    upcoming: [...manual, ...ids, ...automatic],
    manualIndices: Array.from(
      { length: manual.length + ids.length },
      (_, i) => i,
    ),
  };
}
export function removeQueued(queue: Queue, index: number): Queue {
  return {
    ...queue,
    upcoming: queue.upcoming.filter((_, i) => i !== index),
    manualIndices: (queue.manualIndices ?? [])
      .filter((i) => i !== index)
      .map((i) => (i > index ? i - 1 : i)),
  };
}
export function selectQueued(queue: Queue, index: number): Queue {
  if (index < 0 || index >= queue.upcoming.length) return queue;
  const next = removeQueued(queue, index);
  return {
    ...next,
    current: queue.upcoming[index],
    currentManual: (queue.manualIndices ?? []).includes(index),
    history: queue.current
      ? [...queue.history, queue.current].slice(-200)
      : queue.history,
    historyManual: queue.current
      ? [
          ...(queue.historyManual ?? queue.history.map(() => false)),
          !!queue.currentManual,
        ].slice(-200)
      : queue.historyManual,
    played:
      queue.current && !queue.currentManual
        ? [...new Set([...(queue.played ?? []), queue.current])]
        : queue.played,
  };
}
export function moveQueued(queue: Queue, index: number, to: number): Queue {
  if (
    index < 0 ||
    to < 0 ||
    index >= queue.upcoming.length ||
    to >= queue.upcoming.length
  )
    return queue;
  const pins = new Set(queue.manualIndices ?? []),
    entries = queue.upcoming.map((id, i) => ({ id, manual: pins.has(i) }));
  const [item] = entries.splice(index, 1);
  entries.splice(to, 0, item);
  return {
    ...queue,
    upcoming: entries.map((e) => e.id),
    manualIndices: entries.flatMap((e, i) => (e.manual ? [i] : [])),
  };
}
export function filterQueue(
  queue: Queue,
  keep: (id: string) => boolean,
): Queue {
  const pins = new Set(queue.manualIndices ?? []),
    entries = queue.upcoming
      .map((id, i) => ({ id, manual: pins.has(i) }))
      .filter((e) => keep(e.id));
  const history = queue.history
    .map((id, i) => ({ id, manual: queue.historyManual?.[i] ?? false }))
    .filter((e) => keep(e.id));
  return {
    ...queue,
    current: queue.current && keep(queue.current) ? queue.current : null,
    upcoming: entries.map((e) => e.id),
    manualIndices: entries.flatMap((e, i) => (e.manual ? [i] : [])),
    context: queue.context.filter(keep),
    history: history.map((e) => e.id),
    historyManual: history.map((e) => e.manual),
    played: queue.played?.filter(keep),
  };
}
function combineQueue(queue: Queue, automatic: string[]): Queue {
  const pins = new Set(queue.manualIndices ?? []),
    manual = queue.upcoming.flatMap((id, i) =>
      pins.has(i) ? [{ id, index: i }] : [],
    );
  const result = automatic.map((id) => ({ id, manual: false }));
  for (const item of manual)
    result.splice(Math.min(item.index, result.length), 0, {
      id: item.id,
      manual: true,
    });
  return {
    ...queue,
    upcoming: result.map((e) => e.id),
    manualIndices: result.flatMap((e, i) => (e.manual ? [i] : [])),
  };
}
export function reconcileQueue(
  queue: Queue,
  ids: string[],
  mode: ShuffleMode,
  tracks: Track[],
  source = queue.source,
): Queue {
  if (!queue.source || !source) return queue;
  const context = [...new Set(ids)];
  if (
    context.length === queue.context.length &&
    context.every((id, i) => id === queue.context[i]) &&
    JSON.stringify(source) === JSON.stringify(queue.source)
  )
    return queue;
  const old = new Set(queue.context),
    allowed = new Set(context),
    pins = new Set(queue.manualIndices ?? []),
    played = new Set(queue.played ?? queue.history);
  const remaining = queue.upcoming.filter(
    (id, i) => !pins.has(i) && allowed.has(id),
  );
  const eligible = new Set(remaining);
  const additions = context.filter(
    (id) =>
      !old.has(id) &&
      id !== queue.current &&
      !played.has(id) &&
      !eligible.has(id),
  );
  const automatic =
    mode === "off"
      ? context.filter((id) => eligible.has(id) || additions.includes(id))
      : [
          ...remaining,
          ...mix(additions, mode, tracks, remaining.at(-1) ?? queue.current),
        ];
  return { ...combineQueue(queue, automatic), context, source };
}
export function shuffleQueue(
  queue: Queue,
  mode: ShuffleMode,
  tracks: Track[],
): Queue {
  const pins = new Set(queue.manualIndices ?? []),
    automatic = queue.upcoming.filter((_, i) => !pins.has(i));
  const pending = new Set(automatic);
  return combineQueue(
    queue,
    mode === "off"
      ? [
          ...queue.context.filter((id) => pending.has(id)),
          ...automatic.filter((id) => !queue.context.includes(id)),
        ]
      : mix(automatic, mode, tracks, queue.current),
  );
}
export interface LyricWord {
  time: number;
  text: string;
  spaceAfter?: string;
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
export function parseLrc(text: string, preserveOrder = false): LyricLine[] {
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
    const pieces = tags.map((tag, i) =>
      content
        .slice(tag.index! + tag[0].length, tags[i + 1]?.index ?? content.length)
        .replace(/\s+/g, " "),
    );
    const lastWord = pieces.reduce(
      (last, piece, i) => (piece.trim() ? i : last),
      -1,
    );
    const words: LyricWord[] = [];
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i],
        rawWord = pieces[i],
        word = rawWord.trim();
      if (word)
        words.push({
          time: stampSeconds(tag[1], tag[2], tag[3]) + offset,
          text: word,
          ...(i < lastWord && !/\s$/.test(rawWord) ? { spaceAfter: "" } : {}),
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
  return preserveOrder ? lines : lines.sort((a, b) => a.time - b.time);
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
