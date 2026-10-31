import { describe, expect, it } from "vitest";
import { exactLyric, lyricText } from "../src/lyrics-search";
describe("lyrics matching", () => {
  const r = {
    id: 1,
    trackName: "Canción (En Vivo)",
    artistName: "Artista",
    albumName: "",
    duration: 200,
    plainLyrics: "texto",
    syncedLyrics: "[00:01]texto",
  };
  it("prefers supplied timing and does not invent word timestamps", () =>
    expect(lyricText(r)).toBe("[00:01]texto"));
  it("does not silently match a studio recording to the live version", () =>
    expect(
      exactLyric(r, { title: "Canción", artist: "Artista", duration: 200 }),
    ).toBe(false));
  it("rejects another duration and accepts the matching recording", () => {
    expect(
      exactLyric(r, {
        title: r.trackName,
        artist: r.artistName,
        duration: 230,
      }),
    ).toBe(false);
    expect(
      exactLyric(r, {
        title: r.trackName,
        artist: r.artistName,
        duration: 201,
      }),
    ).toBe(true);
  });
});
