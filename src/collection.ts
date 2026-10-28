import type { Playlist, Track } from "./types";
export type CollectionSource = {
  view: string;
  query: string;
  filter: string;
  sort: string;
};
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
    list = [...list].sort((a, b) =>
      source.sort === "modified"
        ? (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) ||
          a.title.localeCompare(b.title)
        : source.sort === "artist"
          ? a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
          : a.title.localeCompare(b.title),
    );
  return list;
}
