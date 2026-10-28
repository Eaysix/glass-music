import type { Playlist, Track } from "./types";
export type CollectionSource = {
  view: string;
  query: string;
  filter: string;
  sort: string;
};
export const songSorts = [
  "modified",
  "modified-oldest",
  "added",
  "title",
  "artist",
];
export function savedSongSort(): string {
  try {
    const saved = localStorage.getItem("glass-music-song-sort");
    if (saved && songSorts.includes(saved)) return saved;
  } catch {
    /* Storage can be unavailable in a restricted webview. */
  }
  return "modified-oldest";
}
export function rememberSongSort(sort: string): void {
  try {
    localStorage.setItem("glass-music-song-sort", sort);
  } catch {}
}
export function collectionTracks(
  tracks: Track[],
  playlists: Playlist[],
  source: CollectionSource,
): Track[] {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const playlist = playlists.find((p) => source.view === `playlist:${p.id}`);
  let list = source.view.startsWith("playlist:")
    ? (playlist?.trackIds ?? [])
        .map((id) => byId.get(id))
        .filter((t): t is Track => !!t)
    : source.view === "favorites"
      ? tracks.filter((t) => t.favorite)
      : source.view === "unorganized"
        ? tracks.filter(
            (t) => !playlists.some((p) => p.trackIds.includes(t.id)),
          )
        : tracks;
  const q = source.query.trim().toLocaleLowerCase();
  list = list.filter(
    (t) =>
      (!q ||
        `${t.title} ${t.artist} ${t.album} ${t.feats}`
          .toLocaleLowerCase()
          .includes(q)) &&
      (source.filter === "all" || t.format === source.filter),
  );
  if (source.sort !== "added")
    list = [...list].sort((a, b) => {
      const title = () =>
        a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
      if (source.sort === "modified" || source.sort === "modified-oldest") {
        const left = a.modifiedAt,
          right = b.modifiedAt;
        if (left == null || !Number.isFinite(left))
          return right == null || !Number.isFinite(right) ? title() : 1;
        if (right == null || !Number.isFinite(right)) return -1;
        return (
          (source.sort === "modified-oldest" ? left - right : right - left) ||
          title()
        );
      }
      return source.sort === "artist"
        ? a.artist.localeCompare(b.artist) || title()
        : title();
    });
  return list;
}
