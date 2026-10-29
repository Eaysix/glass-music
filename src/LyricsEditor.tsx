import { t } from "./i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Undo2, Upload } from "lucide-react";
import * as api from "./api";
import { usePosition } from "./playback";
import SeekControl from "./SeekControl";
import {
  editableLyrics,
  lrcStamp,
  serializeLyrics,
  timingError,
  wordsForLyrics,
  wordTimingError,
  retimeLine,
  retimeWord,
  type EditableLyric,
} from "./lyrics-edit";
function Clock({ active }: { active: boolean }) {
  const position = usePosition();
  return (
    <output className="sync-clock" aria-label={t("Tiempo para sincronizar")}>
      {lrcStamp(active ? position : 0)}
    </output>
  );
}
export default function LyricsEditor({
  text,
  setText,
  active,
  playing,
  duration,
  title,
  trackId,
  toggle,
  seek,
  validate,
}: {
  text: string;
  setText: (value: string) => void;
  active: boolean;
  playing: boolean;
  duration: number;
  title: string;
  trackId: string;
  toggle: () => void;
  seek: (position: number) => void;
  validate: (error: string) => void;
}) {
  const [mode, setMode] = useState<"write" | "sync" | "words">("write");
  const [selected, setSelected] = useState(0);
  const [word, setWord] = useState(0);
  const [draft, setDraft] = useState<EditableLyric[] | null>(null);
  const [undo, setUndo] = useState<
    {
      text: string;
      selected: number;
      word: number;
      rows: EditableLyric[] | null;
    }[]
  >([]);
  const [error, setError] = useState("");
  const parsed = useMemo(() => editableLyrics(text), [text]);
  const rows = draft ?? parsed;
  const latest = useRef({ rows, selected, word, mode });
  latest.current = { rows, selected, word, mode };
  const list = useRef<HTMLDivElement>(null);
  const problem =
    mode === "words" || draft?.some((row) => row.words?.length)
      ? wordTimingError(rows, duration, mode === "words")
      : mode === "sync" || draft
        ? timingError(rows, duration)
        : "";
  useEffect(() => {
    validate(problem);
  }, [problem, validate]);
  useEffect(() => {
    list.current
      ?.querySelector(
        mode === "words"
          ? `.word-chip[aria-pressed="true"]`
          : `[data-sync-row="${selected}"]`,
      )
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, word, mode]);
  function change(next: EditableLyric[], advance = false) {
    setUndo((history) => [
      ...history.slice(-49),
      { text, selected, word, rows: draft },
    ]);
    setDraft(next);
    setText(serializeLyrics(next));
    if (advance && mode === "words") {
      if (word + 1 < (next[selected]?.words?.length ?? 0)) setWord(word + 1);
      else {
        const following = next.findIndex(
          (row, i) => i > selected && row.words?.length,
        );
        if (following >= 0) {
          setSelected(following);
          setWord(0);
        } else setWord(next[selected]?.words?.length ?? 0);
      }
    } else if (advance)
      setSelected((index) => Math.min(index + 1, rows.length - 1));
  }
  const marking = useRef(false);
  async function mark() {
    if (!active || !rows[selected] || marking.current) return;
    marking.current = true;
    try {
      const status = await api.audioCommand("status");
      if (status.trackId !== trackId)
        throw new Error(
          t("Vuelve a reproducir esta canci\u00F3n para marcarla."),
        );
      const current = latest.current;
      if (
        current.rows !== rows ||
        current.selected !== selected ||
        current.word !== word ||
        current.mode !== mode
      )
        return;
      const time = Math.round(status.position * 100) / 100;
      change(
        mode === "words"
          ? retimeWord(rows, selected, word, time)
          : rows.map((row, i) =>
              i === selected ? retimeLine(row, time) : row,
            ),
        true,
      );
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      marking.current = false;
    }
  }
  return (
    <div className="lyric-workshop">
      <p className="modal-description">
        {t(
          "Escribe tu letra y marca líneas o palabras mientras escuchas. Se guarda en tu biblioteca, sin modificar el audio.",
        )}
      </p>
      <div
        className="lyric-modes"
        role="tablist"
        aria-label={t("Editor de letras")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "write"}
          onClick={() => setMode("write")}
        >
          {t("Escribir letra")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "sync"}
          onClick={() => {
            setMode("sync");
            setSelected(
              Math.max(
                0,
                rows.findIndex((row) => row.time === null),
              ),
            );
          }}
        >
          {t("Sincronizar l\u00EDneas")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "words"}
          onClick={() => {
            const next = wordsForLyrics(rows);
            setDraft(next);
            setMode("words");
            const line = next.findIndex((row) =>
              row.words?.some((part) => part.time === null),
            );
            const index =
              line >= 0
                ? line
                : Math.max(
                    0,
                    next.findIndex((row) => row.words?.length),
                  );
            setSelected(index);
            setWord(
              Math.max(
                0,
                next[index]?.words?.findIndex((part) => part.time === null) ??
                  0,
              ),
            );
          }}
        >
          {t("Sincronizar palabras")}
        </button>
      </div>
      {mode === "write" ? (
        <>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              try {
                const value = await api.pickLyrics();
                if (value !== null) {
                  setText(value);
                  setUndo([]);
                  setDraft(null);
                  setSelected(0);
                  setWord(0);
                }
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <Upload size={16} />
            {t("Importar .lrc o .txt")}
          </button>
          <textarea
            className="lyrics-editor"
            aria-label={t("Letra de la canci\u00F3n")}
            value={text}
            maxLength={1024 * 1024}
            onChange={(e) => {
              setText(e.target.value);
              setUndo([]);
              setDraft(null);
              setSelected(0);
              setWord(0);
            }}
            placeholder={t(
              "Una l\u00EDnea por verso\u2026\nTambi\u00E9n puedes pegar una letra con tiempos LRC.",
            )}
          />
          <p className="privacy-note">
            {t(
              "Para añadir tiempos, elige «Sincronizar líneas» o «Sincronizar palabras». Importar y guardar sin editar conserva el LRC original.",
            )}
          </p>
        </>
      ) : (
        <>
          <div className="sync-transport">
            <div>
              <strong>{title}</strong>
              <small>
                {active
                  ? playing
                    ? t("Escuchando para sincronizar")
                    : t("En pausa")
                  : t("Reproduce esta canci\u00F3n para marcar tiempos")}
              </small>
            </div>
            <Clock active={active} />
            <button
              type="button"
              className="secondary"
              aria-label={
                playing && active
                  ? t("Pausar sincronizaci\u00F3n")
                  : t("Reproducir para sincronizar")
              }
              onClick={toggle}
            >
              {playing && active ? <Pause size={17} /> : <Play size={17} />}
              {playing && active ? t("Pausar") : t("Reproducir")}
            </button>
          </div>
          <SeekControl
            key={`${trackId}:${active}`}
            duration={duration}
            enabled={active}
            seek={seek}
          />
          <p className="privacy-note">
            {mode === "words"
              ? t(
                  "Pulsa «Marcar palabra y seguir» al escuchar cada palabra. También puedes usar Espacio con el botón enfocado, corregir segundos y deshacer. El resaltado usa tu color personalizado.",
                )
              : t(
                  "Selecciona la primera línea y pulsa «Marcar línea y seguir» cuando empiece a cantarse. El botón avanza a la siguiente; también funciona con Espacio si lo dejas enfocado. La sincronización manual se guarda por línea.",
                )}
          </p>
          <div
            className="sync-lines"
            role="list"
            aria-label={t("L\u00EDneas para sincronizar")}
            ref={list}
          >
            {rows.map((row, index) => (
              <div
                key={index}
                role="listitem"
                data-sync-row={index}
                className={
                  selected === index ? "sync-row selected" : "sync-row"
                }
              >
                <button
                  type="button"
                  className="sync-line-select"
                  aria-label={t("Seleccionar l\u00EDnea {p0}", {
                    p0: index + 1,
                  })}
                  aria-pressed={selected === index}
                  onClick={() => {
                    setSelected(index);
                    setWord(0);
                  }}
                >
                  <small>{index + 1}</small>
                  <span>{row.text || t("Pausa instrumental")}</span>
                </button>
                <label>
                  <input
                    aria-label={t("Tiempo de l\u00EDnea {p0} en segundos", {
                      p0: index + 1,
                    })}
                    type="number"
                    min="0"
                    max={duration || undefined}
                    step="0.01"
                    value={row.time ?? ""}
                    placeholder={t("Sin marcar")}
                    onChange={(e) => {
                      const value = e.target.value;
                      change(
                        rows.map((item, i) =>
                          i === index
                            ? {
                                ...retimeLine(
                                  item,
                                  value === "" ? null : Number(value),
                                ),
                              }
                            : item,
                        ),
                      );
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  aria-label={t("Escuchar l\u00EDnea {p0}", {
                    p0: index + 1,
                  })}
                  disabled={!active || row.time === null}
                  onClick={() => {
                    setSelected(index);
                    seek(row.time!);
                  }}
                >
                  {t("Ir")}
                </button>
                {mode === "words" && row.words?.length ? (
                  <div
                    className="sync-words"
                    aria-label={t("Palabras de la línea {p0}", {
                      p0: index + 1,
                    })}
                  >
                    {row.words.map((part, at) => (
                      <button
                        type="button"
                        key={at}
                        aria-label={t(
                          "Seleccionar palabra {p0} de la línea {p1}: {p2}",
                          { p0: at + 1, p1: index + 1, p2: part.text },
                        )}
                        aria-pressed={selected === index && word === at}
                        className={
                          part.time === null ? "word-chip" : "word-chip timed"
                        }
                        onClick={() => {
                          setSelected(index);
                          setWord(at);
                        }}
                      >
                        <span>{part.text}</span>
                        <small>
                          {part.time === null
                            ? t("Sin marcar")
                            : lrcStamp(part.time)}
                        </small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {!rows.length && <p>{t("Escribe o importa la letra primero.")}</p>}
          </div>
          {mode === "words" && rows[selected]?.words?.[word] && (
            <div className="word-correction">
              <label>
                {t("Palabra seleccionada: {p0}", {
                  p0: rows[selected].words![word].text,
                })}
                <input
                  type="number"
                  min="0"
                  max={duration || undefined}
                  step="0.01"
                  aria-label={t(
                    "Tiempo de la palabra seleccionada en segundos",
                  )}
                  value={rows[selected].words![word].time ?? ""}
                  placeholder={t("Sin marcar")}
                  onChange={(e) =>
                    change(
                      retimeWord(
                        rows,
                        selected,
                        word,
                        e.target.value === "" ? null : Number(e.target.value),
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="text-button"
                disabled={!active || rows[selected].words![word].time === null}
                onClick={() => seek(rows[selected].words![word].time!)}
              >
                {t("Escuchar palabra")}
              </button>
            </div>
          )}
          <div className="sync-actions">
            <button
              type="button"
              className="secondary"
              disabled={!undo.length}
              onClick={() => {
                const last = undo.at(-1)!;
                setText(last.text);
                setSelected(last.selected);
                setWord(last.word);
                setDraft(last.rows);
                setUndo((history) => history.slice(0, -1));
              }}
            >
              <Undo2 size={16} />
              {t("Deshacer marca")}
            </button>
            <span>
              {mode === "words" ? (
                <>
                  {
                    rows
                      .flatMap((row) => row.words ?? [])
                      .filter((part) => part.time !== null).length
                  }{" "}
                  / {rows.flatMap((row) => row.words ?? []).length}{" "}
                  {t("palabras")}
                </>
              ) : (
                <>
                  {rows.filter((row) => row.time !== null).length} /{" "}
                  {rows.length} {t("líneas")}
                </>
              )}
            </span>
            <button
              type="button"
              className="primary"
              disabled={
                !active ||
                !rows.length ||
                (mode === "words" && !rows[selected]?.words?.[word])
              }
              onKeyDown={(e) => {
                if (e.repeat && (e.key === " " || e.key === "Enter"))
                  e.preventDefault();
              }}
              onClick={mark}
            >
              {mode === "words"
                ? t("Marcar palabra y seguir")
                : t("Marcar línea y seguir")}
            </button>
          </div>
          {mode === "words" && (
            <button
              type="button"
              className="text-button word-reset"
              onClick={() => {
                change(rows.map(({ words: _words, ...row }) => row));
                setMode("sync");
                setWord(0);
              }}
            >
              {t("Quitar tiempos por palabra")}
            </button>
          )}
          {problem && (
            <p className="form-error" role="status">
              {problem}
            </p>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
