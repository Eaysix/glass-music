import { describe, expect, it } from "vitest";
import {
  lyricIndex,
  mix,
  nextQueue,
  parseLrc,
  previousQueue,
  shuffled,
  startQueue,
  timeLabel,
} from "../src/queue";
import type { Track } from "../src/types";
const tracks = Array.from({ length: 100 }, (_, i): Track => ({
  id: String(i),
  path: `${i}.flac`,
  title: `Canción ${i}`,
  artist: `Artista ${i % 5}`,
  album: "Álbum",
  feats: "",
  duration: 180,
  format: "FLAC",
  sampleRate: 44100,
  bitDepth: 16,
  cover: null,
  favorite: false,
}));
describe("cola y mezcla", () => {
  it("recorre toda la selección una sola vez en ambos modos aleatorios", () => {
    for (const mode of ["random", "varied"] as const) {
      let queue = startQueue(
        tracks.map((t) => t.id),
        "37",
        mode,
        tracks,
      );
      const played: string[] = [];
      while (queue.current) {
        played.push(queue.current);
        queue = nextQueue(queue);
      }
      expect(played).toHaveLength(100);
      expect(new Set(played).size).toBe(100);
      expect(played[0]).toBe("37");
    }
  });
  it("separa artistas cuando hay alternativas y conserva todos los temas", () => {
    const mixed = mix(
      tracks.map((t) => t.id),
      "varied",
      tracks,
      "0",
    );
    const artists = new Map(tracks.map((t) => [t.id, t.artist]));
    let previous = "Artista 0";
    for (let i = 0; i < mixed.length; i++) {
      const artist = artists.get(mixed[i])!;
      if (artist === previous)
        expect(mixed.slice(i).every((id) => artists.get(id) === previous)).toBe(
          true,
        );
      previous = artist;
    }
    expect(new Set(mixed)).toEqual(new Set(tracks.map((t) => t.id)));
  });
  it("no pierde temas cuando todos son del mismo artista", () => {
    const input = tracks.map((t) => ({ ...t, artist: "Uno" }));
    expect(
      mix(
        input.map((t) => t.id),
        "varied",
        input,
      ),
    ).toHaveLength(100);
  });
  it("conserva orden al serializar, permite volver y mantiene la cola manual", () => {
    const queue = startQueue(["0", "1", "2"], "0", "off", tracks);
    const resumed = JSON.parse(JSON.stringify(queue));
    expect(nextQueue(resumed).current).toBe("1");
    expect(previousQueue(nextQueue(resumed))).toEqual(queue);
    expect(
      nextQueue({ ...queue, upcoming: ["8", ...queue.upcoming] }).current,
    ).toBe("8");
  });
  it("mezcla Fisher-Yates sin alterar el arreglo original", () => {
    const source = [1, 2, 3, 4];
    expect(shuffled(source, () => 0)).toEqual([2, 3, 4, 1]);
    expect(source).toEqual([1, 2, 3, 4]);
  });
  it("la reproducción ordenada empieza desde la canción elegida", () => {
    expect(startQueue(["0", "1", "2"], "1", "off", tracks).upcoming).toEqual([
      "2",
    ]);
  });
});
describe("LRC", () => {
  it("admite marcas múltiples, centésimas, milésimas y offset", () => {
    expect(
      parseLrc(
        "[ar:Alguien]\n[offset:-500]\n[00:01.50][00:10.250] Hola\n[01:05] Adiós",
      ),
    ).toEqual([
      { time: 1, text: "Hola" },
      { time: 9.75, text: "Hola" },
      { time: 64.5, text: "Adiós" },
    ]);
  });
  it("no resalta antes de la primera línea y busca por tiempo", () => {
    const lines = parseLrc("[00:05] Uno\n[00:10] Dos");
    expect(lyricIndex(lines, 0)).toBe(-1);
    expect(lyricIndex(lines, 5)).toBe(0);
    expect(lyricIndex(lines, 9.99)).toBe(0);
    expect(lyricIndex(lines, 10)).toBe(1);
    expect(parseLrc("Letra sin tiempos")).toEqual([]);
    expect(lyricIndex([], 30)).toBe(-1);
  });
  it("formatea tiempos inválidos sin NaN", () => {
    expect(timeLabel(NaN)).toBe("0:00");
    expect(timeLabel(-10)).toBe("0:00");
    expect(timeLabel(184.8)).toBe("3:04");
  });
});
