import { useEffect, useRef } from "react";
import { ArrowLeft, Disc3, Image, Mic2 } from "lucide-react";
import type { Track } from "./types";
import type { LyricLine } from "./queue";
import { coverUrl } from "./api";
import { LyricContent } from "./LyricContent";
export default function FocusStage({
  track,
  mode,
  setMode,
  lyrics,
  lines,
  active,
  position,
  playing,
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
  position: number;
  playing: boolean;
  seek: (time: number) => void;
  close: () => void;
  edit: () => void;
}) {
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selected.current?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [track?.id, active, mode]);
  return (
    <section
      className={`focus-stage ${mode === "cover" ? "cover-mode" : "lyrics-mode"}`}
      aria-label="Reproductor ampliado"
    >
      {track?.cover && (
        <img className="focus-backdrop" src={coverUrl(track.cover)} alt="" />
      )}
      <header className="focus-header">
        <button className="secondary" onClick={close}>
          <ArrowLeft size={17} />
          Biblioteca
        </button>
        <div className="focus-switch">
          <button
            className={mode === "cover" ? "selected" : ""}
            onClick={() => setMode("cover")}
          >
            <Image size={17} />
            Portada
          </button>
          <button
            className={mode === "lyrics" ? "selected" : ""}
            onClick={() => setMode("lyrics")}
          >
            <Mic2 size={17} />
            Letra
          </button>
        </div>
        <span>SONANDO EN TU ESPACIO</span>
      </header>
      <div className="focus-layout">
        <div className="focus-art-info">
          <div className="focus-art">
            {track?.cover ? (
              <img
                src={coverUrl(track.cover)}
                alt={`Portada de ${track.album}`}
              />
            ) : (
              <Disc3 />
            )}
          </div>
          <div>
            <span className="eyebrow">{track?.format ?? "TU MÚSICA"}</span>
            <h1>{track?.title ?? "Elige tu próxima canción"}</h1>
            <p>{track?.artist ?? "Reproduce algo desde tu biblioteca"}</p>
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
                    position={position}
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
                <h2>Haz espacio para la letra.</h2>
                <p>Pega el texto o importa un archivo .lrc.</p>
                <button className="secondary" disabled={!track} onClick={edit}>
                  Añadir letra
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="focus-hint">
        {mode === "lyrics" && lines.length
          ? "Toca una línea para ir a ese momento · Esc para volver"
          : "La portada cambia con cada canción · Esc para volver"}
      </div>
    </section>
  );
}
