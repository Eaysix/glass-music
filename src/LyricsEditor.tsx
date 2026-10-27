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
  const [mode, setMode] = useState<"write" | "sync">("write");
  const [selected, setSelected] = useState(0);
  const [undo, setUndo] = useState<
    {
      text: string;
      selected: number;
    }[]
  >([]);
  const [error, setError] = useState("");
  const rows = useMemo(() => editableLyrics(text), [text]);
  const list = useRef<HTMLDivElement>(null);
  const problem = mode === "sync" ? timingError(rows, duration) : "";
  useEffect(() => {
    validate(problem);
  }, [problem, validate]);
  useEffect(() => {
    list.current
      ?.querySelector(`[data-sync-row="${selected}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  function change(next: EditableLyric[], advance = false) {
    setUndo((history) => [...history.slice(-49), { text, selected }]);
    setText(serializeLyrics(next));
    if (advance) setSelected((index) => Math.min(index + 1, rows.length - 1));
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
      change(
        rows.map((row, i) =>
          i === selected
            ? { ...row, time: Math.round(status.position * 100) / 100 }
            : row,
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
          "Escribe tu letra y marca cada l\u00EDnea mientras escuchas. Se guarda en tu biblioteca, sin modificar el audio.",
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
                  setSelected(0);
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
            }}
            placeholder={t(
              "Una l\u00EDnea por verso\u2026\nTambi\u00E9n puedes pegar una letra con tiempos LRC.",
            )}
          />
          <p className="privacy-note">
            {t(
              "Para a\u00F1adir tiempos, abre \u00ABSincronizar l\u00EDneas\u00BB. Importar y guardar sin editar conserva el LRC original, incluidos los tiempos por palabra.",
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
          <SeekControl duration={duration} enabled={active} seek={seek} />
          <p className="privacy-note">
            {t(
              "Selecciona la primera l\u00EDnea y pulsa \u00ABMarcar l\u00EDnea y seguir\u00BB cuando empiece a cantarse. El bot\u00F3n avanza a la siguiente; tambi\u00E9n funciona con Espacio si lo dejas enfocado. La sincronizaci\u00F3n manual se guarda por l\u00EDnea.",
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
                  onClick={() => setSelected(index)}
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
                                ...item,
                                time: value === "" ? null : Number(value),
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
              </div>
            ))}
            {!rows.length && <p>{t("Escribe o importa la letra primero.")}</p>}
          </div>
          <div className="sync-actions">
            <button
              type="button"
              className="secondary"
              disabled={!undo.length}
              onClick={() => {
                const last = undo.at(-1)!;
                setText(last.text);
                setSelected(last.selected);
                setUndo((history) => history.slice(0, -1));
              }}
            >
              <Undo2 size={16} />
              {t("Deshacer marca")}
            </button>
            <span>
              {rows.filter((row) => row.time !== null).length} / {rows.length}{" "}
              {t("l\u00EDneas")}
            </span>
            <button
              type="button"
              className="primary"
              disabled={!active || !rows.length}
              onClick={mark}
            >
              {t("Marcar l\u00EDnea y seguir")}
            </button>
          </div>
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
