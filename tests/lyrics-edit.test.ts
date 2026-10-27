import { describe, expect, it } from "vitest";
import {
  editableLyrics,
  lrcStamp,
  serializeLyrics,
  timingError,
  wordsForLyrics,
  retimeLine,
  retimeWord,
  wordTimingError,
} from "../src/lyrics-edit";
import { parseLrc } from "../src/queue";
describe("manual lyric timing", () => {
  it("keeps untimed verses and expands repeated LRC stamps with offsets", () => {
    expect(
      editableLyrics(
        "[ar:Artista]\n[offset:-500]\n[00:01.00][00:04.00]<00:01.00>Hola\nSin tiempo",
      ),
    ).toEqual([
      { text: "Hola", time: 0.5, words: [{ text: "Hola", time: 0.5 }] },
      { text: "Hola", time: 3.5, words: [{ text: "Hola", time: 3.5 }] },
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

describe("word timing", () => {
  it("marks words and derives the line start from the first word without inventing times", () => {
    let rows = wordsForLyrics(editableLyrics("Hola, mundo\nOtra línea"));
    expect(rows[0].words?.map((w) => w.text)).toEqual(["Hola,", "mundo"]);
    expect(serializeLyrics(rows)).toBe("Hola, mundo\nOtra línea");
    for (const [line, word, time] of [
      [0, 0, 1.25],
      [0, 1, 2.5],
      [1, 0, 5],
      [1, 1, 6],
    ])
      rows = retimeWord(rows, line, word, time);
    expect(wordTimingError(rows, 10)).toBe("");
    const parsed = parseLrc(serializeLyrics(rows));
    expect(parsed[0]).toMatchObject({
      time: 1.25,
      text: "Hola, mundo",
      words: [
        { text: "Hola,", time: 1.25 },
        { text: "mundo", time: 2.5 },
      ],
    });
    expect(parsed[1].time).toBe(5);
  });
  it("preserves millisecond timing, voices and all other verses when adjusting a line", () => {
    const text =
      "[offset:100]\n[00:01.123]v2:<00:01.123>Hola <00:02.456>mundo\n[00:05.00]Otra línea";
    const rows = editableLyrics(text);
    expect(parseLrc(serializeLyrics(rows))).toEqual(parseLrc(text));
    rows[0] = retimeLine(rows[0], 2.223);
    expect(parseLrc(serializeLyrics(rows))[0]).toMatchObject({
      voice: "2",
      time: 2.223,
      words: [{ time: 2.223 }, { time: 3.556 }],
    });
    expect(wordTimingError(rows, 10, false)).toBe("");
    expect(rows[1].time).toBe(5.1);
  });
  it("preserves adjacent Chinese text without inserting spaces", () => {
    let rows = wordsForLyrics(editableLyrics("你好世界"));
    for (let i = 0; i < rows[0].words!.length; i++)
      rows = retimeWord(rows, 0, i, i + 1);
    const parsed = parseLrc(serializeLyrics(rows));
    expect(parsed[0].text).toBe("你好世界");
    expect(
      parsed[0].words
        ?.map(
          (w, i, all) =>
            w.text + (i < all.length - 1 ? (w.spaceAfter ?? " ") : ""),
        )
        .join(""),
    ).toBe("你好世界");
  });
  it("blocks partial word timing even if line times are already complete", () => {
    const rows = wordsForLyrics(
      editableLyrics("[00:01]Hola mundo\n[00:05]Otra línea"),
    );
    expect(wordTimingError(rows, 10)).toContain("Faltan palabras");
    expect(wordTimingError(rows, 10, false)).toContain("Faltan palabras");
  });
  it("rejects reversed, duplicate, nonfinite, out-of-song or next-verse word times", () => {
    const rows = wordsForLyrics(
      editableLyrics("[00:01]Hola mundo\n[00:05]Fin"),
    );
    for (const time of [0, 1, 5, 12, NaN])
      expect(wordTimingError(retimeWord(rows, 0, 1, time), 10)).not.toBe("");
    expect(wordTimingError(retimeWord(rows, 0, 1, 2), 10)).toBe("");
    expect(retimeLine(rows[0], null).words?.every((w) => w.time === null)).toBe(
      true,
    );
  });
  it("keeps repeated verses and negative offsets consistent with playback", () => {
    const source = "[offset:-2000]\n[00:01][00:04]<00:01>Uno <00:02>dos";
    expect(parseLrc(serializeLyrics(editableLyrics(source)))).toEqual(
      parseLrc(source),
    );
    expect(editableLyrics("[00:05][00:02]Hola").map((row) => row.time)).toEqual(
      [5, 2],
    );
  });
});
