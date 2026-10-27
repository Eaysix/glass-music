import {
  Heart,
  ListMusic,
  Play,
  Plus,
  FolderOpen,
  ChevronRight,
} from "lucide-react";
import type { Playlist, Track } from "./types";
import * as api from "./api";
import { timeLabel } from "./queue";
export default function Home({
  name,
  playlists,
  recent,
  byId,
  current,
  position,
  playing,
  favoriteCount,
  unorganizedCount,
  open,
  create,
  resume,
  dragOver,
  drop,
  dropTarget,
}: {
  name: string;
  playlists: Playlist[];
  recent: string[];
  byId: Map<string, Track>;
  current?: Track;
  position: number;
  playing: boolean;
  favoriteCount: number;
  unorganizedCount: number;
  open: (view: string) => void;
  create: () => void;
  resume: () => void;
  dragOver: (e: React.DragEvent<HTMLElement>, id: string) => void;
  drop: (e: React.DragEvent<HTMLElement>, id: string) => void;
  dropTarget: string | null;
}) {
  function cards(items: Playlist[]) {
    return (
      <div className="playlist-grid">
        {items.map((playlist) => {
          const cover =
            playlist.cover ??
            playlist.trackIds.map((id) => byId.get(id)?.cover).find(Boolean);
          return (
            <button
              key={playlist.id}
              className={`playlist-card ${dropTarget === playlist.id ? "drop-target" : ""}`}
              aria-label={`Abrir playlist ${playlist.name}`}
              onClick={() => open(`playlist:${playlist.id}`)}
              onDragOver={(e) => dragOver(e, playlist.id)}
              onDrop={(e) => drop(e, playlist.id)}
            >
              <div className="playlist-card-art">
                {cover ? (
                  <img src={api.coverUrl(cover)} alt="" loading="lazy" />
                ) : (
                  <ListMusic size={42} />
                )}
                <span className="playlist-card-open">
                  <ChevronRight size={19} />
                </span>
              </div>
              <strong>{playlist.name}</strong>
              <small>{playlist.trackIds.length} canciones</small>
            </button>
          );
        })}
      </div>
    );
  }
  const recentlyPlayed = recent
    .map((id) => playlists.find((p) => p.id === id))
    .filter((p): p is Playlist => !!p)
    .slice(0, 4);
  return (
    <div className="home-content">
      <section className="home-welcome">
        <div>
          <span className="eyebrow">TU ESPACIO</span>
          <h1>Tu música, {name}.</h1>
          <p>Elige una playlist y encuentra tu ritmo.</p>
        </div>
        <button className="secondary" onClick={create}>
          <Plus size={17} />
          Crear playlist
        </button>
      </section>
      {current && (
        <section className="resume-card" aria-label="Seguir escuchando">
          <div className="resume-art">
            {current.cover ? (
              <img src={api.coverUrl(current.cover)} alt="" />
            ) : (
              <ListMusic size={28} />
            )}
          </div>
          <div>
            <small>
              {playing
                ? "SONANDO AHORA"
                : `SEGUIR ESCUCHANDO · ${timeLabel(position)}`}
            </small>
            <strong>{current.title}</strong>
            <span>{current.artist}</span>
          </div>
          <button className="primary" onClick={resume} disabled={playing}>
            <Play size={16} fill="currentColor" />
            {playing ? "Escuchando" : "Continuar"}
          </button>
        </section>
      )}
      <div className="home-shortcuts">
        {favoriteCount > 0 && (
          <button onClick={() => open("favorites")}>
            <Heart size={20} />
            <span>
              Me gusta<small>{favoriteCount} canciones</small>
            </span>
          </button>
        )}
        {unorganizedCount > 0 && (
          <button onClick={() => open("unorganized")}>
            <FolderOpen size={20} />
            <span>
              Sin organizar<small>{unorganizedCount} sin playlist</small>
            </span>
          </button>
        )}
      </div>
      {recentlyPlayed.length > 0 && (
        <section className="home-section">
          <h2>Escuchadas recientemente</h2>
          {cards(recentlyPlayed)}
        </section>
      )}
      <section className="home-section">
        <div className="home-section-heading">
          <h2>Tus playlists</h2>
          <span>
            {playlists.length
              ? `${playlists.length} playlists`
              : "Todo empieza con una selección"}
          </span>
        </div>
        {playlists.length ? (
          cards(playlists)
        ) : (
          <div className="home-empty">
            <ListMusic size={42} />
            <h3>Hazle espacio a tu música</h3>
            <p>
              Crea tu primera playlist y añade tus archivos FLAC o MP3
              directamente dentro de ella.
            </p>
            <button className="primary" onClick={create}>
              <Plus size={17} />
              Crear mi primera playlist
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
