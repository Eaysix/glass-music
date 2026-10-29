import type { Playlist } from "./types";
// Apply only local changes since the acknowledged snapshot, preserving incoming changes.
export function mergePlaylists(
  base: Playlist[],
  local: Playlist[],
  remote: Playlist[],
): Playlist[] {
  const result = remote.filter(
    (p) =>
      !base.some((b) => b.id === p.id) || local.some((p2) => p2.id === p.id),
  );
  for (const item of local) {
    if (
      JSON.stringify(base.find((p) => p.id === item.id)) ===
      JSON.stringify(item)
    )
      continue;
    const index = result.findIndex((p) => p.id === item.id);
    // A remotely deleted existing playlist stays deleted.
    if (index < 0 && base.some((p) => p.id === item.id)) continue;
    if (index < 0) result.push(item);
    else result[index] = item;
  }
  return result;
}
