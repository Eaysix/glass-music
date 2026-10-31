import type { Track } from "./types";
export type LyricResult = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
};
let nextRequest = 0;
let chain: Promise<unknown> = Promise.resolve();
const cache = new Map<string, LyricResult[]>();
export function lyricText(result: LyricResult) {
  return result.syncedLyrics?.trim() || result.plainLyrics?.trim() || "";
}
export function exactLyric(
  result: LyricResult,
  track: Pick<Track, "title" | "artist" | "duration">,
) {
  const norm = (s: string) => s.normalize("NFKC").trim().toLocaleLowerCase();
  return (
    norm(result.trackName) === norm(track.title) &&
    norm(result.artistName) === norm(track.artist) &&
    Math.abs(result.duration - track.duration) <= 2 &&
    !!lyricText(result)
  );
}
export function searchLyrics(
  track: Pick<Track, "title" | "artist">,
): Promise<LyricResult[]> {
  const query = new URLSearchParams({
    track_name: track.title,
    artist_name: track.artist,
  }).toString();
  const work = chain
    .catch(() => {})
    .then(async () => {
      if (cache.has(query)) return cache.get(query)!;
      if (Date.now() < nextRequest)
        throw new Error(
          `LRCLIB: espera ${Math.ceil((nextRequest - Date.now()) / 1000)} segundos antes de buscar otra vez.`,
        );
      nextRequest = Date.now() + 800;
      const response = await fetch(`https://lrclib.net/api/search?${query}`, {
        headers: {
          "Lrclib-Client":
            "Glass Music 1.0.0-rc.9 (https://github.com/Eaysix/glass-music)",
        },
        signal: AbortSignal.timeout(20000),
        credentials: "omit",
        redirect: "error",
      });
      if (response.status === 429 || response.status === 503) {
        const value = response.headers.get("Retry-After") || "60";
        const seconds = Number(value);
        const delay = Number.isFinite(seconds)
          ? Math.max(1, seconds) * 1000
          : Math.max(1000, Date.parse(value) - Date.now()) || 60000;
        nextRequest = Date.now() + delay + 500;
        throw new Error(
          "LRCLIB está ocupado. Espera antes de volver a buscar.",
        );
      }
      if (!response.ok)
        throw new Error(`LRCLIB no pudo responder (${response.status}).`);
      const body = await response.text();
      if (body.length > 4_000_000)
        throw new Error("La respuesta de letras es demasiado grande.");
      const data: unknown = JSON.parse(body);
      if (!Array.isArray(data))
        throw new Error("LRCLIB devolvió una respuesta desconocida.");
      const results = data
        .filter(
          (r): r is LyricResult =>
            typeof r?.id === "number" &&
            typeof r.trackName === "string" &&
            typeof r.artistName === "string" &&
            typeof r.duration === "number" &&
            (typeof r.syncedLyrics === "string" ||
              typeof r.plainLyrics === "string"),
        )
        .slice(0, 20);
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(query, results);
      return results;
    });
  chain = work;
  return work;
}
