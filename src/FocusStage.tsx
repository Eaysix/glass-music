import { t } from "./i18n";
import { useEffect, useRef } from "react";
import { ArrowLeft, Disc3, Image, Mic2 } from "lucide-react";
import type { Track } from "./types";
import type { LyricLine } from "./queue";
import { coverUrl } from "./api";
import Atmosphere from "./Atmosphere";
import { LyricContent } from "./LyricContent";
export default function FocusStage({
  track,
  mode,
  setMode,
  lyrics,
  lines,
  active,
  playing,
  albumBackground,
  seek,
  close,
  edit,
}: {
  track: Track | undefined;
  mode: "cover" | "lyrics";
  setMode: (mode: "cover" | "lyrics") => void;
  lyrics: string;
  lines: LyricLine[];
  active: number;
  playing: boolean;
  albumBackground: boolean;
  seek: (time: number) => void;
  close: () => void;
  edit: () => void;
}) {
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const line = selected.current;
    const container = line?.parentElement;
    if (line && container)
      container.scrollTo({
        top:
          container.scrollTop +
          line.getBoundingClientRect().top -
          container.getBoundingClientRect().top -
          container.clientHeight / 2 +
          line.clientHeight / 2,
        behavior: "auto",
      });
  }, [track?.id, active, mode]);
  return (
    <section
      className={`focus-stage ${mode === "cover" ? "cover-mode" : "lyrics-mode"}`}
      aria-label={t("Reproductor ampliado")}
    >
      {track?.cover && albumBackground && (
        <Atmosphere className="focus-backdrop" cover={track.cover} />
      )}
      <header className="focus-header">
        <button className="secondary" onClick={close}>
          <ArrowLeft size={17} />
          {t("Biblioteca")}
        </button>
        <div className="focus-switch">
          <button
            className={mode === "cover" ? "selected" : ""}
            onClick={() => setMode("cover")}
          >
            <Image size={17} />
            {t("Portada")}
          </button>
          <button
            className={mode === "lyrics" ? "selected" : ""}
            onClick={() => setMode("lyrics")}
          >
            <Mic2 size={17} />
            {t("Letra")}
          </button>
        </div>
        <span>{t("SONANDO EN TU ESPACIO")}</span>
      </header>
      <div className="focus-layout" key={`${track?.id}:${mode}`}>
        <div className="focus-art-info">
          <div className="focus-art">
            {track?.cover ? (
              <img
                src={coverUrl(track.cover)}
                alt={t("Portada de {p0}", {
                  p0: track.album,
                })}
              />
            ) : (
              <Disc3 />
            )}
          </div>
          <div>
            <span className="eyebrow">
              {track?.format ?? t("TU M\u00DASICA")}
            </span>
            <h1>{track?.title ?? t("Elige tu pr\u00F3xima canci\u00F3n")}</h1>
            <p>{track?.artist ?? t("Reproduce algo desde tu biblioteca")}</p>
            <small>{track?.album}</small>
          </div>
        </div>
        {mode === "lyrics" && (
          <div className="focus-lyrics">
            {lines.length ? (
              lines.map((line, i) => (
                <button
                  ref={i === active ? selected : undefined}
                  key={`${track?.id}:${line.time}:${i}`}
                  className={`focus-line ${i === active ? "highlight" : ""} ${i < active ? "past" : ""}`}
                  onClick={() => seek(line.time)}
                >
                  <LyricContent
                    line={line}
                    playing={playing}
                    active={i === active}
                  />
                </button>
              ))
            ) : lyrics ? (
              <p className="focus-plain">{lyrics}</p>
            ) : (
              <div className="focus-no-lyrics">
                <Mic2 size={42} />
                <h2>{t("Haz espacio para la letra.")}</h2>
                <p>{t("Pega el texto o importa un archivo .lrc.")}</p>
                <button className="secondary" disabled={!track} onClick={edit}>
                  {t("A\u00F1adir letra")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="focus-hint">
        {mode === "lyrics" && lines.length
          ? t(
              "Toca una l\u00EDnea para ir a ese momento \u00B7 Esc para volver",
            )
          : t("La portada cambia con cada canci\u00F3n \u00B7 Esc para volver")}
      </div>
    </section>
  );
}
