import { describe, expect, it, vi, afterEach } from "vitest";
import { exactLyric, lyricText, searchLyrics } from "../src/lyrics-search";
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

describe("provider failures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("honors Retry-After across subsequent requests without retrying a different song", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2040-01-01"));
    const fetcher = vi.fn().mockResolvedValue(
      new Response("busy", {
        status: 429,
        headers: { "Retry-After": "120" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      searchLyrics({ title: "rate-test-one", artist: "test" }),
    ).rejects.toThrow("ocupado");
    await expect(
      searchLyrics({ title: "rate-test-two", artist: "test" }),
    ).rejects.toThrow("espera");
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(121000);
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 6,
            trackName: "rate-test-two",
            artistName: "test",
            albumName: "",
            duration: 16,
            plainLyrics: "Synthetic verse",
          },
        ]),
        { status: 200 },
      ),
    );
    expect(
      await searchLyrics({ title: "rate-test-two", artist: "test" }),
    ).toHaveLength(1);
    expect(
      await searchLyrics({ title: "rate-test-two", artist: "test" }),
    ).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
