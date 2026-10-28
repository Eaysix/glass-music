import { describe, it, expect } from "vitest";
import {
  startQueue,
  reconcileQueue,
  nextQueue,
  previousQueue,
  enqueueQueue,
  moveQueued,
  removeQueued,
  filterQueue,
  shuffleQueue,
  selectQueued,
} from "../src/queue";
import { collectionTracks } from "../src/collection";
import type { Track } from "../src/types";
const tracks = Array.from({ length: 1500 }, (_, i): Track => ({
  id: String(i),
  path: `${i}.flac`,
  title: `Song ${i}`,
  artist: i < 3 ? "Alpha" : "Beta",
  album: i < 3 ? "One" : "Two",
  feats: "",
  duration: 180,
  format: "FLAC",
  sampleRate: 44100,
  bitDepth: 16,
  cover: null,
  favorite: false,
  modifiedAt: i * 1000,
}));
const source = { view: "library", query: "", filter: "all", sort: "modified" };
const begin = (
  ids: string[],
  current: string,
  mode: "off" | "random" | "varied" = "off",
) => ({ ...startQueue(ids, current, mode, tracks), source });
describe("live playback context", () => {
  it("adds imported tracks before the current song in date order without restarting it", () => {
    const before = begin(["2", "1", "0"], "2");
    const queue = reconcileQueue(
      before,
      ["4", "3", "2", "1", "0"],
      "off",
      tracks,
    );
    expect(queue.current).toBe("2");
    expect(queue.upcoming).toEqual(["4", "3", "1", "0"]);
    expect(queue.history).toEqual([]);
  });
  it("expands an artist/album search to the playlist when cleared and never replays heard automatic songs", () => {
    const filtered = {
      ...begin(["0", "1", "2"], "0"),
      source: { ...source, query: "Alpha" },
    };
    const playing = nextQueue(filtered);
    const all = reconcileQueue(
      playing,
      ["0", "1", "2", "3", "4"],
      "off",
      tracks,
      source,
    );
    expect(all.current).toBe("1");
    expect(all.upcoming).toEqual(["2", "3", "4"]);
    expect(all.upcoming).not.toContain("0");
  });
  it("keeps manual duplicate entries through filtering, reordering, deletion and next/previous", () => {
    let queue = enqueueQueue(begin(["0", "1", "2"], "0"), ["2", "2"], true);
    queue = reconcileQueue(queue, ["0", "1"], "off", tracks, {
      ...source,
      query: "other",
    });
    expect(queue.upcoming).toEqual(["2", "2", "1"]);
    expect(queue.manualIndices).toEqual([0, 1]);
    queue = moveQueued(queue, 0, 2);
    expect(queue.manualIndices).toEqual([0, 2]);
    queue = removeQueued(queue, 0);
    expect(queue.manualIndices).toEqual([1]);
    const restored = previousQueue(nextQueue(queue));
    expect(restored.upcoming).toEqual(queue.upcoming);
    expect(restored.manualIndices).toEqual(queue.manualIndices);
    expect(filterQueue(queue, (id) => id !== "2").manualIndices).toEqual([]);
  });
  it("does not reshuffle the pending sequence or add duplicates when importing in random modes", () => {
    for (const mode of ["random", "varied"] as const) {
      const before = begin(["0", "1", "2"], "0", mode);
      const after = reconcileQueue(
        before,
        ["0", "1", "2", "3", "4"],
        mode,
        tracks,
      );
      expect(after.upcoming.slice(0, before.upcoming.length)).toEqual(
        before.upcoming,
      );
      expect(new Set(after.upcoming).size).toBe(4);
      expect(reconcileQueue(after, after.context, mode, tracks)).toBe(after);
    }
  });
  it("keeps manual entries fixed when switching shuffle and preserves intentional queue clearing", () => {
    const queue = enqueueQueue(begin(["0", "1", "2"], "0"), ["6"], true);
    expect(shuffleQueue(queue, "random", tracks).upcoming[0]).toBe("6");
    const cleared = { ...queue, upcoming: [], manualIndices: [] };
    expect(
      reconcileQueue(cleared, ["0", "1", "2", "3"], "off", tracks).upcoming,
    ).toEqual(["3"]);
  });
  it("uses file modification dates rather than import order and respects manual playlist order", () => {
    const list = tracks.slice(0, 5);
    const playlists = [
      { id: "p", name: "P", cover: null, trackIds: ["1", "4", "0"] },
    ];
    expect(collectionTracks(list, playlists, source).map((t) => t.id)).toEqual([
      "4",
      "3",
      "2",
      "1",
      "0",
    ]);
    expect(
      collectionTracks(list, playlists, {
        ...source,
        view: "playlist:p",
        sort: "added",
      }).map((t) => t.id),
    ).toEqual(["1", "4", "0"]);
    expect(
      collectionTracks(list, playlists, { ...source, query: "One" }).length,
    ).toBe(3);
  });
  it("selects an upcoming manual duplicate without losing the other queued entries", () => {
    const queue = enqueueQueue(begin(["0", "1", "2"], "0"), ["2", "2"], true);
    const selected = selectQueued(queue, 1);
    expect(selected.current).toBe("2");
    expect(selected.currentManual).toBe(true);
    expect(selected.upcoming).toEqual(["2", "1", "2"]);
    expect(selected.manualIndices).toEqual([0]);
    expect(previousQueue(selected).current).toBe("0");
  });
  it("can expand a 1500-song queue, serialize and finish with each automatic song once", () => {
    let queue = reconcileQueue(
      begin(["0", "1"], "0"),
      tracks.map((t) => t.id),
      "varied",
      tracks,
    );
    queue = JSON.parse(JSON.stringify(queue));
    const seen = [];
    while (queue.current) {
      seen.push(queue.current);
      queue = nextQueue(queue);
    }
    expect(seen).toHaveLength(1500);
    expect(new Set(seen).size).toBe(1500);
  });
});
