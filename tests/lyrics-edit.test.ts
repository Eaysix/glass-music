import { describe, expect, it } from "vitest";
import {
  editableLyrics,
  lrcStamp,
  serializeLyrics,
  timingError,
} from "../src/lyrics-edit";
import { parseLrc } from "../src/queue";
describe("manual lyric timing", () => {
  it("keeps untimed verses and expands repeated LRC stamps with offsets", () => {
    expect(
      editableLyrics(
        "[ar:Artista]\n[offset:-500]\n[00:01.00][00:04.00]<00:01.00>Hola\nSin tiempo",
      ),
    ).toEqual([
      { text: "Hola", time: 0.5 },
      { text: "Hola", time: 3.5 },
      { text: "Sin tiempo", time: null },
    ]);
  });
  it("rounds across minute boundaries and roundtrips into the playback parser", () => {
    expect(lrcStamp(59.999)).toBe("01:00.00");
    const rows = [
      { text: "Primera", time: 1.25 },
      { text: "Segunda", time: 62.37 },
    ];
    expect(parseLrc(serializeLyrics(rows))).toEqual(
      rows.map((row) => ({ text: row.text, time: row.time })),
    );
  });
  it("rejects incomplete, reversed, identical or out-of-song times", () => {
    expect(
      timingError(
        [
          { text: "Uno", time: 1 },
          { text: "Dos", time: null },
        ],
        10,
      ),
    ).toContain("Faltan");
    for (const time of [0.5, 1, 11, NaN])
      expect(
        timingError(
          [
            { text: "Uno", time: 1 },
            { text: "Dos", time },
          ],
          10,
        ),
      ).not.toBe("");
    expect(
      timingError(
        [
          { text: "Uno", time: 1 },
          { text: "Dos", time: 2 },
        ],
        10,
      ),
    ).toBe("");
    expect(timingError([{ text: "Sin tiempos", time: null }], 10)).toBe("");
  });
});
