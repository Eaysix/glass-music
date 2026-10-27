import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Disc3,
  Ellipsis,
  FolderPlus,
  Heart,
  Library,
  ListMusic,
  Mic2,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Upload,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import * as api from "./api";
import type { Playlist, Queue, Settings, Track } from "./types";
import { defaults } from "./types";
import {
  lyricIndex,
  mix,
  nextQueue,
  parseLrc,
  previousQueue,
  startQueue,
  timeLabel,
} from "./queue";

type Modal =
  | { type: "settings" }
  | { type: "track"; track: Track }
  | { type: "playlist"; playlist: Playlist }
  | { type: "lyrics"; id: string; text: string }
  | { type: "add"; id: string }
  | { type: "remove"; track: Track }
  | null;
function Cover({
  cover,
  title = "",
  className = "",
}: {
  cover: string | null;
  title?: string;
  className?: string;
}) {
  const hue = [...title].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className={`cover ${className}`}
      style={{ "--cover-hue": hue } as CSSProperties}
    >
      {cover ? (
        <img src={api.coverUrl(cover)} alt="" loading="lazy" decoding="async" />
      ) : (
        <Disc3 aria-hidden="true" />
      )}
    </div>
  );
}
function IconButton({
  label,
  children,
  active = false,
  ...props
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
export default function App() {
  const [settings, setSettings] = useState<Settings>(defaults),
    [tracks, setTracks] = useState<Track[]>([]);
  const [ready, setReady] = useState(false),
    [fatal, setFatal] = useState(""),
    [view, setView] = useState("library");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("added");
  const [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [panel, setPanel] = useState<"lyrics" | "queue" | null>("lyrics");
  const [scrub, setScrub] = useState<number | null>(null);
  const [lyrics, setLyrics] = useState(""),
    [modal, setModal] = useState<Modal>(null),
    [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false),
    [progress, setProgress] = useState(""),
    [importErrors, setImportErrors] = useState<string[]>([]);
  const [menu, setMenu] = useState<string | null>(null),
    [scroll, setScroll] = useState(0),
    [listHeight, setListHeight] = useState(400);
  const [queueScroll, setQueueScroll] = useState(0),
    [queueHeight, setQueueHeight] = useState(400);
  const queueRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null),
    busy = useRef(false),
    latest = useRef({ settings, tracks, position, playing });
  latest.current = { settings, tracks, position, playing };
  const saveChain = useRef(Promise.resolve()),
    advanceRef = useRef<(automatic?: boolean) => void>(() => {});
  const current = useMemo(
    () => tracks.find((t) => t.id === settings.queue.current),
    [tracks, settings.queue.current],
  );
  const selectedPlaylist = settings.playlists.find(
    (p) => view === `playlist:${p.id}`,
  );
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const timed = useMemo(() => parseLrc(lyrics), [lyrics]),
    activeLine = lyricIndex(timed, position);
  const activeLyricRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.loadSettings(), api.loadLibrary()])
      .then(([saved, library]) => {
        if (!alive) return;
        const ids = new Set(library.map((t) => t.id));
        saved.queue = {
          ...saved.queue,
          current: ids.has(saved.queue.current ?? "")
            ? saved.queue.current
            : null,
          upcoming: saved.queue.upcoming.filter((id) => ids.has(id)),
          history: saved.queue.history.filter((id) => ids.has(id)),
          context: saved.queue.context.filter((id) => ids.has(id)),
        };
        setSettings(saved);
        setTracks(library);
        setPosition(saved.position);
        setReady(true);
        api
          .audioCommand("volume", null, saved.volume)
          .catch((e) => setNotice(String(e)));
      })
      .catch((e) => {
        if (alive) setFatal(String(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      saveChain.current = saveChain.current
        .catch(() => {})
        .then(() => api.saveSettings(settings))
        .catch((e) => setNotice(`No se guardaron los cambios: ${e}`));
    }, 350);
    return () => clearTimeout(timer);
  }, [settings, ready]);
  useEffect(() => {
    if (!ready || !api.native) return;
    let alive = true,
      closing = false,
      unlisten: (() => void) | undefined;
    import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const window = getCurrentWindow();
        const stop = await window.onCloseRequested(async (event) => {
          event.preventDefault();
          if (closing) return;
          closing = true;
          try {
            const status = await api.audioCommand("pause");
            await saveChain.current.catch(() => {});
            const snapshot = latest.current.settings;
            await api.saveSettings({
              ...snapshot,
              position:
                status.trackId === snapshot.queue.current
                  ? status.position
                  : latest.current.position,
            });
            await window.destroy();
          } catch (error) {
            closing = false;
            setNotice(`No se pudo guardar antes de cerrar: ${error}`);
          }
        });
        if (alive) unlisten = stop;
        else stop();
      })
      .catch((error) => setNotice(String(error)));
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [ready]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    if (!api.native) return;
    let unlisten: (() => void) | undefined,
      alive = true;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ done: number; total: number }>("import-progress", (event) => {
          if (alive)
            setProgress(
              `${event.payload.done} de ${event.payload.total} archivos`,
            );
        }),
      )
      .then((fn) => {
        if (alive) unlisten = fn;
        else fn();
      });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (!current) {
      setLyrics("");
      return;
    }
    let alive = true;
    setLyrics("");
    api
      .getLyrics(current.id)
      .then((text) => {
        if (alive) setLyrics(text);
      })
      .catch((e) => setNotice(String(e)));
    return () => {
      alive = false;
    };
  }, [current?.id]);
  useEffect(() => {
    activeLyricRef.current?.scrollIntoView({
      block: "center",
      behavior: "instant",
    });
  }, [activeLine, panel]);
  useEffect(() => {
    if (!playing) return;
    let alive = true,
      polling = false;
    const timer = setInterval(async () => {
      if (polling || busy.current) return;
      polling = true;
      try {
        const status = await api.audioCommand("status");
        if (
          !alive ||
          busy.current ||
          status.trackId !== latest.current.settings.queue.current
        )
          return;
        setPosition(status.position);
        if (status.ended) advanceRef.current(true);
        else if (!status.playing) setPlaying(false);
      } catch (e) {
        if (alive) {
          setPlaying(false);
          setNotice(String(e));
        }
      } finally {
        polling = false;
      }
    }, 500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [playing]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable],dialog",
        ) ||
        modal
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        void togglePlay();
      }
      if (e.code === "Escape") {
        setMenu(null);
        setPanel(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) =>
      setListHeight(entries[0].contentRect.height),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready, view, tracks.length]);
  useEffect(() => {
    setScroll(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [view, query, filter, sort]);

  const visibleTracks = useMemo(() => {
    let list = selectedPlaylist
      ? selectedPlaylist.trackIds
          .map((id) => byId.get(id))
          .filter((t): t is Track => !!t)
      : view === "favorites"
        ? tracks.filter((t) => t.favorite)
        : tracks;
    const q = query.trim().toLocaleLowerCase();
    list = list.filter(
      (t) =>
        (!q ||
          `${t.title} ${t.artist} ${t.album} ${t.feats}`
            .toLocaleLowerCase()
            .includes(q)) &&
        (filter === "all" || t.format === filter),
    );
    if (sort !== "added")
      list = [...list].sort(
        (a, b) =>
          (sort === "artist"
            ? a.artist.localeCompare(b.artist)
            : a.title.localeCompare(b.title)) || a.title.localeCompare(b.title),
      );
    return list;
  }, [tracks, view, selectedPlaylist, byId, query, filter, sort]);
  useEffect(() => {
    const el = queueRef.current;
    if (!el) return;
    setQueueScroll(0);
    el.scrollTop = 0;
    const observer = new ResizeObserver((entries) =>
      setQueueHeight(entries[0].contentRect.height),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [panel]);
  const queueStart = Math.max(0, Math.floor(queueScroll / 74) - 3),
    queueEnd = Math.min(
      settings.queue.upcoming.length,
      Math.ceil((queueScroll + queueHeight) / 74) + 3,
    );
  const totalDuration = visibleTracks.reduce((sum, t) => sum + t.duration, 0);
  const title =
    selectedPlaylist?.name ??
    (view === "favorites" ? "Tus favoritas" : "Tu biblioteca");
  const start = Math.max(0, Math.floor(scroll / 68) - 4),
    end = Math.min(
      visibleTracks.length,
      Math.ceil((scroll + listHeight) / 68) + 4,
    );

  async function playQueue(queue: Queue, from = 0) {
    if (busy.current || !queue.current) return;
    busy.current = true;
    try {
      const status = await api.audioCommand("play", queue.current, from);
      setSettings((s) => ({ ...s, queue, position: status.position }));
      setPosition(status.position);
      setPlaying(status.playing);
    } catch (e) {
      await api.audioCommand("pause").catch(() => {});
      setNotice(`No se pudo reproducir: ${e}`);
      setPlaying(false);
    } finally {
      busy.current = false;
    }
  }
  function playTrack(track: Track) {
    void playQueue(
      startQueue(
        visibleTracks.map((t) => t.id),
        track.id,
        settings.shuffle,
        tracks,
      ),
    );
  }
  async function togglePlay() {
    if (busy.current) return;
    const state = latest.current;
    if (!state.settings.queue.current) {
      if (state.settings.queue.upcoming.length)
        void playQueue(nextQueue(state.settings.queue));
      else if (visibleTracks[0]) playTrack(visibleTracks[0]);
      return;
    }
    busy.current = true;
    try {
      const duration =
        state.tracks.find((t) => t.id === state.settings.queue.current)
          ?.duration ?? 0;
      const resumeAt =
        duration > 0 && state.position >= duration - 0.5 ? 0 : state.position;
      const status = await api.audioCommand(
        state.playing ? "pause" : "play",
        state.settings.queue.current,
        resumeAt,
      );
      setPlaying(status.playing);
      setPosition(status.position);
      setSettings((s) => ({ ...s, position: status.position }));
    } catch (e) {
      setNotice(String(e));
      setPlaying(false);
    } finally {
      busy.current = false;
    }
  }
  function advance(automatic = false) {
    if (busy.current) return;
    const { settings: s, tracks: library } = latest.current;
    if (automatic && s.repeat === "one" && s.queue.current) {
      void playQueue(s.queue, 0);
      return;
    }
    let queue = nextQueue(s.queue);
    if (!queue.current && s.repeat === "all" && s.queue.context.length) {
      const upcoming = mix(
        s.queue.context,
        s.shuffle,
        library,
        s.queue.current,
      );
      if (upcoming.length > 1 && upcoming[0] === s.queue.current)
        [upcoming[0], upcoming[1]] = [upcoming[1], upcoming[0]];
      queue = nextQueue({ ...s.queue, upcoming });
    }
    if (queue.current) void playQueue(queue);
    else {
      setPlaying(false);
      const endPosition =
        library.find((t) => t.id === s.queue.current)?.duration ??
        latest.current.position;
      setPosition(endPosition);
      void api.audioCommand("pause").catch((e) => setNotice(String(e)));
      setSettings((s) => ({ ...s, position: endPosition }));
    }
  }
  advanceRef.current = advance;
  function back() {
    if (position > 3 || !settings.queue.history.length) void seek(0);
    else void playQueue(previousQueue(settings.queue));
  }
  async function seek(value: number) {
    try {
      const status = await api.audioCommand("seek", null, value);
      setPosition(status.position);
      setSettings((s) => ({ ...s, position: status.position }));
    } catch (e) {
      setNotice(`No se pudo adelantar: ${e}`);
    }
  }
  async function importTracks(folder: boolean) {
    if (importing) return;
    setImporting(true);
    setProgress("Leyendo etiquetas y portadas…");
    setImportErrors([]);
    try {
      const report = await api.importMusic(folder);
      if (report) {
        setTracks(await api.loadLibrary());
        setImportErrors(report.errors);
        setNotice(
          `${report.tracks.length} canciones añadidas${report.skipped ? ` · ${report.skipped} ya importadas o no compatibles` : ""}${report.errors.length ? ` · ${report.errors.length} con error` : ""}`,
        );
      }
    } catch (e) {
      setNotice(`No se pudo importar: ${e}`);
    } finally {
      setImporting(false);
      setProgress("");
    }
  }
  async function changeTrack(track: Track) {
    await api.updateTrack(track);
    setTracks((list) => list.map((t) => (t.id === track.id ? track : t)));
  }
  async function favorite(track: Track) {
    try {
      await changeTrack({ ...track, favorite: !track.favorite });
    } catch (e) {
      setNotice(String(e));
    }
  }
  function enqueue(id: string, first: boolean) {
    setSettings((s) => ({
      ...s,
      queue: {
        ...s.queue,
        upcoming: first ? [id, ...s.queue.upcoming] : [...s.queue.upcoming, id],
      },
    }));
    setMenu(null);
    setNotice(first ? "Sonará después" : "Añadida al final de la cola");
  }
  function newPlaylist() {
    setModal({
      type: "playlist",
      playlist: {
        id: crypto.randomUUID(),
        name: "",
        cover: null,
        trackIds: [],
      },
    });
  }
  function moveQueue(index: number, destination: number) {
    setSettings((s) => {
      const upcoming = [...s.queue.upcoming];
      if (destination < 0 || destination >= upcoming.length) return s;
      const [id] = upcoming.splice(index, 1);
      upcoming.splice(destination, 0, id);
      return { ...s, queue: { ...s.queue, upcoming } };
    });
  }
  function movePlaylist(id: string, delta: number) {
    if (!selectedPlaylist) return;
    setSettings((s) => ({
      ...s,
      playlists: s.playlists.map((p) => {
        if (p.id !== selectedPlaylist.id) return p;
        const ids = [...p.trackIds],
          at = ids.indexOf(id),
          to = at + delta;
        if (at < 0 || to < 0 || to >= ids.length) return p;
        [ids[at], ids[to]] = [ids[to], ids[at]];
        return { ...p, trackIds: ids };
      }),
    }));
  }
  async function deleteTrack(track: Track) {
    if (busy.current)
      throw new Error("Espera a que termine el cambio de canción.");
    if (settings.queue.current === track.id) {
      await api.audioCommand("stop");
      setPlaying(false);
      setPosition(0);
    }
    await api.removeTrack(track.id);
    setTracks((ts) => ts.filter((t) => t.id !== track.id));
    setSettings((s) => ({
      ...s,
      playlists: s.playlists.map((p) => ({
        ...p,
        trackIds: p.trackIds.filter((id) => id !== track.id),
      })),
      queue: {
        current: s.queue.current === track.id ? null : s.queue.current,
        upcoming: s.queue.upcoming.filter((id) => id !== track.id),
        history: s.queue.history.filter((id) => id !== track.id),
        context: s.queue.context.filter((id) => id !== track.id),
      },
    }));
  }
  const style = {
    "--accent": settings.appearance.accent,
    "--blur": `${settings.appearance.reduced ? 0 : settings.appearance.glass}px`,
  } as CSSProperties;
  if (fatal)
    return (
      <div className="boot">
        <Disc3 size={48} />
        <h1>No se pudo abrir la biblioteca</h1>
        <p>{fatal}</p>
        <button onClick={() => location.reload()}>Reintentar</button>
      </div>
    );
  if (!ready)
    return (
      <div className="boot">
        <Disc3 size={48} />
        <p>Abriendo tu espacio…</p>
      </div>
    );
  return (
    <div
      className={`app ${settings.appearance.theme} ${settings.appearance.reduced ? "reduced" : ""}`}
      style={style}
    >
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <aside className="sidebar glass">
        <div className="brand">
          <div className="brand-mark">
            <span />
            <span />
            <span />
          </div>
          <span>
            glass<span className="brand-light">music</span>
          </span>
          <small>LOCAL PLAYER</small>
        </div>
        <div className="nav-label">TU ESPACIO</div>
        <nav>
          <button
            className={view === "library" ? "selected" : ""}
            onClick={() => setView("library")}
          >
            <Library size={19} />
            Biblioteca<span>{tracks.length}</span>
          </button>
          <button
            className={view === "favorites" ? "selected" : ""}
            onClick={() => setView("favorites")}
          >
            <Heart size={19} />
            Me gusta
          </button>
        </nav>
        <div className="nav-label playlists-label">
          <span>TUS PLAYLISTS</span>
          <IconButton label="Crear playlist" onClick={newPlaylist}>
            <Plus size={17} />
          </IconButton>
        </div>
        <div className="playlists-nav">
          {settings.playlists.length ? (
            settings.playlists.map((p) => (
              <button
                key={p.id}
                className={selectedPlaylist?.id === p.id ? "selected" : ""}
                onClick={() => setView(`playlist:${p.id}`)}
              >
                <Cover cover={p.cover} title={p.name} />
                <span>{p.name}</span>
              </button>
            ))
          ) : (
            <p>
              Un lugar para cada mood.
              <br />
              <button className="text-button" onClick={newPlaylist}>
                Crea tu primera playlist <Plus size={13} />
              </button>
            </p>
          )}
        </div>
        <div className="sidebar-footer">
          <div className="local-status">
            <i /> Tu música se queda contigo
          </div>
          <button
            className="profile"
            onClick={() => setModal({ type: "settings" })}
          >
            {settings.profile.photo ? (
              <img src={api.coverUrl(settings.profile.photo)} alt="" />
            ) : (
              <div className="avatar">
                <UserRound size={20} />
              </div>
            )}
            <span>
              <strong>{settings.profile.name}</strong>
              <small>Perfil local</small>
            </span>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>
      <main className="main glass">
        <header className="topbar">
          <div className="breadcrumbs">
            <Music2 size={16} />
            <span>Tu música, sin límites</span>
          </div>
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Buscar música"
              placeholder="Canciones, artistas, álbumes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <IconButton label="Limpiar búsqueda" onClick={() => setQuery("")}>
                <X size={14} />
              </IconButton>
            )}
          </label>
          <IconButton
            label="Ajustes de apariencia y perfil"
            onClick={() => setModal({ type: "settings" })}
          >
            <SlidersHorizontal size={19} />
          </IconButton>
        </header>
        <section className={`hero ${selectedPlaylist ? "playlist-hero" : ""}`}>
          <div className="hero-copy">
            <div className="eyebrow">
              {selectedPlaylist
                ? "HECHA POR TI"
                : view === "favorites"
                  ? "SIEMPRE EN REPEAT"
                  : "EL SONIDO DE TU ESPACIO"}
            </div>
            <h1>
              {selectedPlaylist ? (
                title
              ) : view === "favorites" ? (
                <>
                  Lo que más
                  <br />
                  <em>te mueve.</em>
                </>
              ) : (
                <>
                  Tu música.
                  <br />
                  <em>A tu manera.</em>
                </>
              )}
            </h1>
            <p>
              {selectedPlaylist
                ? `${visibleTracks.length} canciones · Tu propia selección`
                : "Tus archivos. Tus letras. Tu momento."}
            </p>
            <div className="hero-actions">
              <button
                className="primary"
                disabled={!visibleTracks.length}
                onClick={() => visibleTracks[0] && playTrack(visibleTracks[0])}
              >
                <Play size={16} fill="currentColor" />
                Reproducir
              </button>
              {selectedPlaylist ? (
                <button
                  className="secondary"
                  onClick={() =>
                    setModal({
                      type: "playlist",
                      playlist: { ...selectedPlaylist },
                    })
                  }
                >
                  <Settings2 size={16} />
                  Editar playlist
                </button>
              ) : (
                <button
                  className="secondary"
                  disabled={importing}
                  onClick={() => importTracks(false)}
                >
                  <Plus size={17} />
                  {importing ? "Importando…" : "Añadir música"}
                </button>
              )}
            </div>
          </div>
          {selectedPlaylist ? (
            <Cover
              className="playlist-art"
              cover={selectedPlaylist.cover}
              title={selectedPlaylist.name}
            />
          ) : (
            <div className="hero-art" aria-hidden="true">
              <div className="orbital orbital-a" />
              <div className="orbital orbital-b" />
              <div className="record">
                <div className="record-label">
                  <div className="mini-wave">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <span>
                    YOUR OWN
                    <br />
                    FREQUENCY
                  </span>
                </div>
              </div>
              <div className="quality-tag">
                <i /> FLAC & MP3 <span>·</span> 100% TUYO
              </div>
            </div>
          )}
        </section>
        <section className="collection">
          <div className="section-heading">
            <div>
              <h2>{title}</h2>
              <span>
                {visibleTracks.length} canciones
                {totalDuration > 0
                  ? ` · ${Math.floor(totalDuration / 60)} min`
                  : ""}
              </span>
            </div>
            <div className="collection-actions">
              <button
                className={`shuffle-button ${settings.shuffle !== "off" ? "active" : ""}`}
                onClick={() => {
                  const shuffle =
                    settings.shuffle === "off"
                      ? "random"
                      : settings.shuffle === "random"
                        ? "varied"
                        : "off";
                  setSettings((s) => ({
                    ...s,
                    shuffle,
                    queue: {
                      ...s.queue,
                      upcoming:
                        shuffle === "off"
                          ? s.queue.upcoming
                          : mix(
                              s.queue.upcoming,
                              shuffle,
                              tracks,
                              s.queue.current,
                            ),
                    },
                  }));
                }}
                title="Cambiar aleatorio: desactivado, sin repeticiones o mezcla variada"
              >
                <Shuffle size={16} />
                <span>
                  {settings.shuffle === "off"
                    ? "En orden"
                    : settings.shuffle === "random"
                      ? "Sin repetir"
                      : "Mezcla variada"}
                </span>
              </button>
              <IconButton
                label="Importar carpeta"
                disabled={importing}
                onClick={() => importTracks(true)}
              >
                <FolderPlus size={18} />
              </IconButton>
            </div>
          </div>
          <div className="filters">
            <div className="chips">
              {[
                ["all", "Todo"],
                ["FLAC", "FLAC"],
                ["MP3", "MP3"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={filter === id ? "selected" : ""}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="sort">
              Ordenar por{" "}
              <select
                aria-label="Orden de canciones"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="added">
                  {selectedPlaylist ? "Tu orden" : "Añadidas"}
                </option>
                <option value="title">Título</option>
                <option value="artist">Artista</option>
              </select>
            </label>
          </div>
          {importing && (
            <div className="import-progress" role="status">
              <span className="pulse-dot" />
              Importando · {progress}
            </div>
          )}
          {importErrors.length > 0 && (
            <details className="import-errors">
              <summary>
                {importErrors.length} archivos no se pudieron importar
              </summary>
              {importErrors.map((error, i) => (
                <p key={i}>{error}</p>
              ))}
            </details>
          )}
          {visibleTracks.length > 0 ? (
            <>
              <div className="table-heading">
                <span>#</span>
                <span>TÍTULO</span>
                <span className="album-col">ÁLBUM</span>
                <span>FORMATO</span>
                <span />
                <Clock3 size={13} />
                <span />
              </div>
              <div
                className="track-list"
                ref={listRef}
                onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
              >
                <div
                  style={{
                    height: visibleTracks.length * 68,
                    position: "relative",
                  }}
                >
                  {visibleTracks.slice(start, end).map((track, offset) => {
                    const index = start + offset,
                      isCurrent = current?.id === track.id;
                    return (
                      <div
                        key={track.id}
                        className={`track-row ${isCurrent ? "current" : ""}`}
                        style={{
                          position: "absolute",
                          top: index * 68,
                          left: 0,
                          right: 0,
                        }}
                        onDoubleClick={() => playTrack(track)}
                      >
                        <button
                          className="track-number"
                          aria-label={`Reproducir ${track.title}`}
                          onClick={() =>
                            isCurrent ? togglePlay() : playTrack(track)
                          }
                        >
                          {isCurrent && playing ? (
                            <Pause size={14} />
                          ) : (
                            <>
                              <span>{index + 1}</span>
                              <Play className="row-play" size={14} />
                            </>
                          )}
                        </button>
                        <button
                          className="track-title"
                          onClick={() => playTrack(track)}
                        >
                          <Cover cover={track.cover} title={track.album} />
                          <span>
                            <strong>{track.title}</strong>
                            <small>
                              {track.artist}
                              {track.feats ? ` · feat. ${track.feats}` : ""}
                            </small>
                          </span>
                        </button>
                        <span className="album-col ellipsis">
                          {track.album}
                        </span>
                        <span
                          className={`format ${track.format.toLowerCase()}`}
                        >
                          {track.format}
                        </span>
                        <IconButton
                          label={
                            track.favorite
                              ? `Quitar Me gusta a ${track.title}`
                              : `Me gusta ${track.title}`
                          }
                          active={track.favorite}
                          onClick={() => favorite(track)}
                        >
                          <Heart
                            size={16}
                            fill={track.favorite ? "currentColor" : "none"}
                          />
                        </IconButton>
                        <span className="duration">
                          {timeLabel(track.duration)}
                        </span>
                        <IconButton
                          label={`Opciones de ${track.title}`}
                          onClick={() =>
                            setMenu(menu === track.id ? null : track.id)
                          }
                        >
                          <Ellipsis size={19} />
                        </IconButton>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="empty-library">
              <div className="empty-icon">
                {view === "favorites" ? (
                  <Heart size={29} />
                ) : (
                  <Music2 size={29} />
                )}
              </div>
              <h3>
                {query || filter !== "all"
                  ? "No hay coincidencias"
                  : selectedPlaylist
                    ? "Dale un sonido a esta playlist"
                    : view === "favorites"
                      ? "Aquí van las que te encantan"
                      : "Tu colección empieza aquí"}
              </h3>
              <p>
                {query || filter !== "all"
                  ? "Prueba con otra búsqueda o formato."
                  : selectedPlaylist
                    ? "Añade canciones desde las opciones de tu biblioteca."
                    : view === "favorites"
                      ? "Toca el corazón de una canción para guardarla."
                      : "Añade tus FLAC y MP3. Nosotros ponemos el espacio."}
              </p>
              {view === "library" && !query && (
                <button
                  className="secondary"
                  disabled={importing}
                  onClick={() => importTracks(true)}
                >
                  <FolderPlus size={17} />
                  Elegir carpeta
                </button>
              )}
            </div>
          )}
        </section>
        <footer className="library-footer">
          <span>
            <i /> BIBLIOTECA LOCAL
          </span>
          <span>
            {tracks.filter((t) => t.format === "FLAC").length} FLAC ·{" "}
            {tracks.filter((t) => t.format === "MP3").length} MP3
          </span>
        </footer>
      </main>
      {panel && (
        <aside className="right-panel glass">
          <div className="panel-tabs">
            <button
              className={panel === "lyrics" ? "selected" : ""}
              onClick={() => setPanel("lyrics")}
            >
              <Mic2 size={16} />
              Letra
            </button>
            <button
              className={panel === "queue" ? "selected" : ""}
              onClick={() => setPanel("queue")}
            >
              <ListMusic size={17} />
              Cola<span>{settings.queue.upcoming.length}</span>
            </button>
            <IconButton label="Cerrar panel" onClick={() => setPanel(null)}>
              <X size={15} />
            </IconButton>
          </div>
          {panel === "lyrics" ? (
            <>
              {current ? (
                <>
                  <div className="lyric-track">
                    <Cover cover={current.cover} title={current.album} />
                    <h3>{current.title}</h3>
                    <p>{current.artist}</p>
                    <div className="lyric-caption">
                      <span>
                        {timed.length
                          ? "LETRA SINCRONIZADA"
                          : lyrics
                            ? "LETRA"
                            : "TU VOZ TAMBIÉN CUENTA"}
                      </span>
                      <button
                        onClick={() =>
                          setModal({
                            type: "lyrics",
                            id: current.id,
                            text: lyrics,
                          })
                        }
                      >
                        {lyrics ? "Editar" : "Añadir"}
                      </button>
                    </div>
                  </div>
                  <div className="lyrics-body">
                    {timed.length ? (
                      timed.map((line, i) => (
                        <button
                          ref={i === activeLine ? activeLyricRef : undefined}
                          className={`lyric-line ${i === activeLine ? "highlight" : ""} ${i < activeLine ? "past" : ""}`}
                          key={`${line.time}:${i}`}
                          onClick={() => seek(line.time)}
                        >
                          {line.text || "♪"}
                        </button>
                      ))
                    ) : lyrics ? (
                      <p className="plain-lyrics">{lyrics}</p>
                    ) : (
                      <div className="panel-empty">
                        <Mic2 size={28} />
                        <h3>Cada canción tiene algo que decir.</h3>
                        <p>
                          Pega su letra o importa un archivo .lrc para seguirla
                          a tu ritmo.
                        </p>
                        <button
                          className="secondary"
                          onClick={() =>
                            setModal({
                              type: "lyrics",
                              id: current.id,
                              text: "",
                            })
                          }
                        >
                          <Plus size={16} />
                          Añadir letra
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="panel-footnote">
                    {timed.length
                      ? "Toca una línea para ir a ese momento."
                      : "Las letras se guardan en tu biblioteca."}
                  </div>
                </>
              ) : (
                <div className="panel-empty">
                  <div className="line-art">
                    <Mic2 size={38} />
                  </div>
                  <h3>
                    La letra,
                    <br />
                    en primer plano.
                  </h3>
                  <p>
                    Reproduce una canción para ver su letra o añadir la tuya.
                  </p>
                  <span className="tiny-label">AQUÍ, CADA PALABRA IMPORTA</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="queue-heading">
                <h3>A continuación</h3>
                {settings.queue.upcoming.length > 0 && (
                  <button
                    className="text-button"
                    onClick={() =>
                      setSettings((s) => ({
                        ...s,
                        queue: { ...s.queue, upcoming: [] },
                      }))
                    }
                  >
                    Vaciar
                  </button>
                )}
              </div>
              {current && (
                <div className="now-queue">
                  <span className="eyebrow">SONANDO AHORA</span>
                  <div>
                    <Cover cover={current.cover} title={current.album} />
                    <span>
                      <strong>{current.title}</strong>
                      <small>{current.artist}</small>
                    </span>
                  </div>
                </div>
              )}
              <div
                className="queue-list"
                ref={queueRef}
                onScroll={(e) => setQueueScroll(e.currentTarget.scrollTop)}
              >
                {settings.queue.upcoming.length ? (
                  <div
                    style={{
                      height: settings.queue.upcoming.length * 74,
                      position: "relative",
                    }}
                  >
                    {settings.queue.upcoming
                      .slice(queueStart, queueEnd)
                      .map((id, offset) => {
                        const index = queueStart + offset;
                        const t = byId.get(id);
                        return t ? (
                          <div
                            className="queue-row"
                            style={{
                              position: "absolute",
                              top: index * 74,
                              left: 0,
                              right: 0,
                              height: 74,
                            }}
                            key={`${id}:${index}`}
                            draggable
                            onDragStart={(e) =>
                              e.dataTransfer.setData(
                                "text/plain",
                                String(index),
                              )
                            }
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const value =
                                e.dataTransfer.getData("text/plain");
                              if (/^\d+$/.test(value))
                                moveQueue(Number(value), index);
                            }}
                          >
                            <span className="queue-index">{index + 1}</span>
                            <Cover cover={t.cover} title={t.album} />
                            <button
                              className="queue-title"
                              onClick={() =>
                                playQueue({
                                  ...settings.queue,
                                  current: id,
                                  upcoming: settings.queue.upcoming.filter(
                                    (_, i) => i !== index,
                                  ),
                                  history: current
                                    ? [...settings.queue.history, current.id]
                                    : settings.queue.history,
                                })
                              }
                            >
                              <strong>{t.title}</strong>
                              <small>{t.artist}</small>
                            </button>
                            <div className="queue-tools">
                              <IconButton
                                label={`Subir ${t.title}`}
                                disabled={index === 0}
                                onClick={() => moveQueue(index, index - 1)}
                              >
                                <ArrowUp size={12} />
                              </IconButton>
                              <IconButton
                                label={`Bajar ${t.title}`}
                                disabled={
                                  index === settings.queue.upcoming.length - 1
                                }
                                onClick={() => moveQueue(index, index + 1)}
                              >
                                <ArrowDown size={12} />
                              </IconButton>
                              <IconButton
                                label={`Quitar ${t.title} de la cola`}
                                onClick={() =>
                                  setSettings((s) => ({
                                    ...s,
                                    queue: {
                                      ...s.queue,
                                      upcoming: s.queue.upcoming.filter(
                                        (_, i) => i !== index,
                                      ),
                                    },
                                  }))
                                }
                              >
                                <X size={12} />
                              </IconButton>
                            </div>
                          </div>
                        ) : null;
                      })}
                  </div>
                ) : (
                  <div className="panel-empty">
                    <ListMusic size={30} />
                    <h3>Tu siguiente canción te espera.</h3>
                    <p>
                      Añade canciones desde sus opciones o reproduce una lista.
                    </p>
                  </div>
                )}
              </div>
              <div className="panel-footnote">
                Arrastra o usa las flechas para cambiar el orden.
              </div>
            </>
          )}
        </aside>
      )}
      <footer className="player glass">
        <div className="player-track">
          <Cover cover={current?.cover ?? null} title={current?.album ?? ""} />
          <div>
            <strong>{current?.title ?? "Dale play a tu espacio"}</strong>
            <small>{current?.artist ?? "Tu música, siempre contigo"}</small>
          </div>
          {current && (
            <IconButton
              label={
                current.favorite
                  ? "Quitar de favoritas"
                  : "Guardar en favoritas"
              }
              active={current.favorite}
              onClick={() => favorite(current)}
            >
              <Heart
                size={17}
                fill={current.favorite ? "currentColor" : "none"}
              />
            </IconButton>
          )}
        </div>
        <div className="transport">
          <div className="transport-buttons">
            <IconButton
              label="Alternar aleatorio"
              active={settings.shuffle !== "off"}
              onClick={() => {
                const shuffle = settings.shuffle === "off" ? "varied" : "off";
                setSettings((s) => ({
                  ...s,
                  shuffle,
                  queue: {
                    ...s.queue,
                    upcoming: mix(
                      s.queue.upcoming,
                      shuffle,
                      tracks,
                      s.queue.current,
                    ),
                  },
                }));
              }}
            >
              <Shuffle size={17} />
            </IconButton>
            <IconButton label="Anterior" disabled={!current} onClick={back}>
              <SkipBack size={19} fill="currentColor" />
            </IconButton>
            <button
              className="play-main"
              aria-label={playing ? "Pausar" : "Reproducir"}
              disabled={
                !current &&
                !visibleTracks.length &&
                !settings.queue.upcoming.length
              }
              onClick={togglePlay}
            >
              {playing ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" />
              )}
            </button>
            <IconButton
              label="Siguiente"
              disabled={
                !current ||
                (!settings.queue.upcoming.length && settings.repeat !== "all")
              }
              onClick={() => advance()}
            >
              <SkipForward size={19} fill="currentColor" />
            </IconButton>
            <IconButton
              label={`Repetir: ${settings.repeat === "off" ? "desactivado" : settings.repeat === "one" ? "una canción" : "todo"}`}
              active={settings.repeat !== "off"}
              onClick={() =>
                setSettings((s) => ({
                  ...s,
                  repeat:
                    s.repeat === "off"
                      ? "all"
                      : s.repeat === "all"
                        ? "one"
                        : "off",
                }))
              }
            >
              {settings.repeat === "one" ? (
                <Repeat1 size={17} />
              ) : (
                <Repeat size={17} />
              )}
            </IconButton>
          </div>
          <div className="seek">
            <span>{timeLabel(position)}</span>
            <input
              aria-label="Posición de reproducción"
              type="range"
              min="0"
              max={current?.duration || 1}
              step="0.1"
              value={Math.min(scrub ?? position, current?.duration || 1)}
              disabled={!current}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={(e) => {
                void seek(Number(e.currentTarget.value));
                setScrub(null);
              }}
              onPointerCancel={() => setScrub(null)}
              onKeyUp={(e) => {
                if (
                  [
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    "Home",
                    "End",
                    "PageUp",
                    "PageDown",
                  ].includes(e.key)
                ) {
                  void seek(Number(e.currentTarget.value));
                  setScrub(null);
                }
              }}
              onBlur={(e) => {
                if (scrub !== null) {
                  void seek(Number(e.currentTarget.value));
                  setScrub(null);
                }
              }}
            />
            <span>{timeLabel(current?.duration ?? 0)}</span>
          </div>
        </div>
        <div className="player-extras">
          {current && (
            <span className="player-quality">
              {current.format}
              {current.bitDepth ? (
                <small>
                  {current.bitDepth} bit ·{" "}
                  {((current.sampleRate ?? 44100) / 1000).toFixed(1)} kHz
                </small>
              ) : null}
            </span>
          )}
          <IconButton
            label="Mostrar letra"
            active={panel === "lyrics"}
            onClick={() => setPanel(panel === "lyrics" ? null : "lyrics")}
          >
            <Mic2 size={18} />
          </IconButton>
          <IconButton
            label="Mostrar cola"
            active={panel === "queue"}
            onClick={() => setPanel(panel === "queue" ? null : "queue")}
          >
            <ListMusic size={19} />
          </IconButton>
          <IconButton
            label={settings.volume ? "Silenciar" : "Activar sonido"}
            onClick={() => {
              const volume = settings.volume ? 0 : 0.7;
              setSettings((s) => ({ ...s, volume }));
              api
                .audioCommand("volume", null, volume)
                .catch((e) => setNotice(String(e)));
            }}
          >
            {settings.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </IconButton>
          <input
            className="volume"
            aria-label="Volumen"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={settings.volume}
            onChange={(e) => {
              const volume = Number(e.target.value);
              setSettings((s) => ({ ...s, volume }));
              api
                .audioCommand("volume", null, volume)
                .catch((e) => setNotice(String(e)));
            }}
          />
        </div>
      </footer>
      {menu && byId.get(menu) && (
        <div className="menu-backdrop" onClick={() => setMenu(null)}>
          <div
            className="context-menu glass"
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <strong>{byId.get(menu)!.title}</strong>
            <button role="menuitem" onClick={() => enqueue(menu, true)}>
              Reproducir después
            </button>
            <button role="menuitem" onClick={() => enqueue(menu, false)}>
              Agregar al final de la cola
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setModal({ type: "add", id: menu });
                setMenu(null);
              }}
            >
              Añadir a playlist
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setModal({ type: "track", track: { ...byId.get(menu)! } });
                setMenu(null);
              }}
            >
              Editar información y portada
            </button>
            <button
              role="menuitem"
              onClick={async () => {
                const id = menu;
                setMenu(null);
                try {
                  setModal({
                    type: "lyrics",
                    id,
                    text: await api.getLyrics(id),
                  });
                } catch (e) {
                  setNotice(String(e));
                }
              }}
            >
              Editar letra
            </button>
            {selectedPlaylist && (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    movePlaylist(menu, -1);
                    setMenu(null);
                  }}
                >
                  Subir en la playlist
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    movePlaylist(menu, 1);
                    setMenu(null);
                  }}
                >
                  Bajar en la playlist
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setSettings((s) => ({
                      ...s,
                      playlists: s.playlists.map((p) =>
                        p.id === selectedPlaylist.id
                          ? {
                              ...p,
                              trackIds: p.trackIds.filter((id) => id !== menu),
                            }
                          : p,
                      ),
                    }));
                    setMenu(null);
                  }}
                >
                  Quitar de esta playlist
                </button>
              </>
            )}
            <button
              className="danger"
              role="menuitem"
              onClick={() => {
                setModal({ type: "remove", track: byId.get(menu)! });
                setMenu(null);
              }}
            >
              Quitar de la biblioteca…
            </button>
          </div>
        </div>
      )}
      {modal && (
        <Editor
          modal={modal}
          settings={settings}
          setSettings={setSettings}
          onClose={() => setModal(null)}
          changeTrack={changeTrack}
          deleteTrack={deleteTrack}
          onLyrics={async (id, text) => {
            await api.saveLyrics(id, text);
            if (id === settings.queue.current) setLyrics(text);
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <IconButton label="Cerrar aviso" onClick={() => setNotice("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

function Editor({
  modal,
  settings,
  setSettings,
  onClose,
  changeTrack,
  deleteTrack,
  onLyrics,
}: {
  modal: NonNullable<Modal>;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  onClose: () => void;
  changeTrack: (t: Track) => Promise<void>;
  deleteTrack: (t: Track) => Promise<void>;
  onLyrics: (id: string, text: string) => Promise<void>;
}) {
  const [track, setTrack] = useState(
    modal.type === "track" ? modal.track : null,
  );
  const [playlist, setPlaylist] = useState(
    modal.type === "playlist" ? modal.playlist : null,
  );
  const [text, setText] = useState(modal.type === "lyrics" ? modal.text : ""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  async function image(target: "profile" | "track" | "playlist") {
    try {
      const cover = await api.pickImage();
      if (!cover) return;
      if (target === "profile")
        setSettings((s) => ({ ...s, profile: { ...s.profile, photo: cover } }));
      else if (target === "track") setTrack((t) => t && { ...t, cover });
      else setPlaylist((p) => p && { ...p, cover });
    } catch (e) {
      setError(String(e));
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (track) {
        if (!track.title.trim())
          throw new Error("Escribe el título de la canción.");
        await changeTrack({ ...track, title: track.title.trim() });
      }
      if (playlist) {
        if (!playlist.name.trim())
          throw new Error("Escribe un nombre para la playlist.");
        const updated = { ...playlist, name: playlist.name.trim() };
        setSettings((s) => ({
          ...s,
          playlists: s.playlists.some((p) => p.id === updated.id)
            ? s.playlists.map((p) => (p.id === updated.id ? updated : p))
            : [...s.playlists, updated],
        }));
      }
      if (modal.type === "lyrics") await onLyrics(modal.id, text);
      if (modal.type === "remove") await deleteTrack(modal.track);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  const title =
    modal.type === "settings"
      ? "Hazlo tuyo"
      : modal.type === "track"
        ? "Los detalles también suenan"
        : modal.type === "playlist"
          ? settings.playlists.some((p) => p.id === modal.playlist.id)
            ? "Editar playlist"
            : "Una playlist, mil momentos"
          : modal.type === "lyrics"
            ? "Palabra por palabra"
            : modal.type === "remove"
              ? "Quitar de tu biblioteca"
              : "Elige su próximo lugar";
  return (
    <dialog
      ref={dialog}
      className={`editor ${settings.appearance.theme}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current && !saving) onClose();
      }}
    >
      <form onSubmit={save}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">GLASS MUSIC</span>
            <h2>{title}</h2>
          </div>
          <IconButton
            label="Cerrar"
            type="button"
            disabled={saving}
            onClick={onClose}
          >
            <X size={20} />
          </IconButton>
        </div>
        {modal.type === "settings" && (
          <>
            <p className="modal-description">
              Tu espacio personal. Todo se guarda en este equipo.
            </p>
            <div className="profile-editor">
              <button
                type="button"
                className="photo-picker"
                onClick={() => image("profile")}
              >
                {settings.profile.photo ? (
                  <img
                    src={api.coverUrl(settings.profile.photo)}
                    alt="Foto de perfil"
                  />
                ) : (
                  <UserRound size={28} />
                )}
                <span>
                  <Plus size={14} />
                </span>
              </button>
              <label>
                Nombre del perfil
                <input
                  maxLength={60}
                  value={settings.profile.name}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      profile: { ...s.profile, name: e.target.value },
                    }))
                  }
                  placeholder="¿Cómo te llamas?"
                />
              </label>
              {settings.profile.photo && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      profile: { ...s.profile, photo: null },
                    }))
                  }
                >
                  Quitar foto
                </button>
              )}
            </div>
            <div className="settings-section">
              <h3>Tu color</h3>
              <div className="swatches">
                {["#c9ed87", "#c2a4ff", "#f6a6c7", "#8ccdf3", "#ffbd88"].map(
                  (color) => (
                    <button
                      key={color}
                      type="button"
                      style={{ background: color }}
                      aria-label={`Color ${color}`}
                      aria-pressed={settings.appearance.accent === color}
                      onClick={() =>
                        setSettings((s) => ({
                          ...s,
                          appearance: { ...s.appearance, accent: color },
                        }))
                      }
                    >
                      {settings.appearance.accent === color && (
                        <Check size={18} />
                      )}
                    </button>
                  ),
                )}
                <label className="custom-color" title="Elegir otro color">
                  <Plus size={17} />
                  <input
                    type="color"
                    aria-label="Color personalizado"
                    value={settings.appearance.accent}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        appearance: { ...s.appearance, accent: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
            </div>
            <div className="settings-section">
              <h3>Ambiente</h3>
              <div className="theme-options">
                {(["dark", "light"] as const).map((theme) => (
                  <button
                    type="button"
                    className={
                      settings.appearance.theme === theme ? "selected" : ""
                    }
                    key={theme}
                    onClick={() =>
                      setSettings((s) => ({
                        ...s,
                        appearance: { ...s.appearance, theme },
                      }))
                    }
                  >
                    {theme === "dark" ? "Noche" : "Día"}
                  </button>
                ))}
              </div>
              <label className="range-label">
                Intensidad del vidrio <span>{settings.appearance.glass}px</span>
                <input
                  aria-label="Intensidad del vidrio"
                  type="range"
                  min="0"
                  max="32"
                  step="4"
                  disabled={settings.appearance.reduced}
                  value={settings.appearance.glass}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      appearance: {
                        ...s.appearance,
                        glass: Number(e.target.value),
                      },
                    }))
                  }
                />
              </label>
              <label className="toggle-label">
                <span>
                  <strong>Reducir efectos</strong>
                  <small>Desactiva desenfoques, sombras y transiciones.</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.appearance.reduced}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      appearance: {
                        ...s.appearance,
                        reduced: e.target.checked,
                      },
                    }))
                  }
                />
              </label>
            </div>
            <p className="privacy-note">
              Sin registro, sin login y sin telemetría. Tu perfil es solo tuyo.
            </p>
          </>
        )}
        {track && (
          <>
            <div className="art-editor">
              <Cover cover={track.cover} title={track.album} />
              <div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => image("track")}
                >
                  <Upload size={15} />
                  Cambiar portada
                </button>
                <p>PNG, JPG o WebP · hasta 20 MB</p>
              </div>
            </div>
            <label>
              Título
              <input
                maxLength={500}
                value={track.title}
                onChange={(e) => setTrack({ ...track, title: e.target.value })}
              />
            </label>
            <div className="form-grid">
              <label>
                Artista
                <input
                  maxLength={500}
                  value={track.artist}
                  onChange={(e) =>
                    setTrack({ ...track, artist: e.target.value })
                  }
                />
              </label>
              <label>
                Artistas invitados
                <input
                  maxLength={500}
                  value={track.feats}
                  onChange={(e) =>
                    setTrack({ ...track, feats: e.target.value })
                  }
                  placeholder="feat."
                />
              </label>
            </div>
            <label>
              Álbum
              <input
                maxLength={500}
                value={track.album}
                onChange={(e) => setTrack({ ...track, album: e.target.value })}
              />
            </label>
            <p className="privacy-note">
              Se guarda en la biblioteca. El archivo original conserva sus
              etiquetas.
            </p>
          </>
        )}
        {playlist && (
          <>
            <div className="art-editor">
              <Cover cover={playlist.cover} title={playlist.name} />
              <button
                type="button"
                className="secondary"
                onClick={() => image("playlist")}
              >
                <Upload size={15} />
                Elegir portada
              </button>
            </div>
            <label>
              Nombre de la playlist
              <input
                autoFocus
                maxLength={100}
                value={playlist.name}
                onChange={(e) =>
                  setPlaylist({ ...playlist, name: e.target.value })
                }
                placeholder="Para manejar de noche…"
              />
            </label>
            {settings.playlists.some((p) => p.id === playlist.id) && (
              <button
                type="button"
                className="text-button danger"
                onClick={() => {
                  setSettings((s) => ({
                    ...s,
                    playlists: s.playlists.filter((p) => p.id !== playlist.id),
                  }));
                  onClose();
                }}
              >
                Eliminar playlist (conserva tus canciones)
              </button>
            )}
          </>
        )}
        {modal.type === "lyrics" && (
          <>
            <p className="modal-description">
              Pega una letra o importa un .lrc con tiempos para sincronizarla.
            </p>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                try {
                  const content = await api.pickLyrics();
                  if (content !== null) setText(content);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              <Upload size={16} />
              Importar .lrc o .txt
            </button>
            <textarea
              className="lyrics-editor"
              aria-label="Letra de la canción"
              value={text}
              maxLength={1024 * 1024}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "[00:12.30] La primera línea…\n[00:17.00] Y la siguiente…"
              }
            />
            <p className="privacy-note">
              Puedes escribir texto sin tiempos. Se guarda aparte de tu archivo
              de música.
            </p>
          </>
        )}
        {modal.type === "remove" && (
          <p className="modal-description">
            Se quitará «{modal.track.title}» de la biblioteca, playlists y cola.
            Tu archivo de música permanecerá en su carpeta.
          </p>
        )}
        {modal.type === "add" && (
          <div className="add-playlist-list">
            {settings.playlists.length ? (
              settings.playlists.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSettings((s) => ({
                      ...s,
                      playlists: s.playlists.map((item) =>
                        item.id === p.id
                          ? {
                              ...item,
                              trackIds: [
                                ...new Set([...item.trackIds, modal.id]),
                              ],
                            }
                          : item,
                      ),
                    }));
                    onClose();
                  }}
                >
                  <Cover cover={p.cover} title={p.name} />
                  <span>{p.name}</span>
                  {p.trackIds.includes(modal.id) ? (
                    <Check size={18} />
                  ) : (
                    <Plus size={18} />
                  )}
                </button>
              ))
            ) : (
              <p>
                Crea primero una playlist desde el botón + de la barra lateral.
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <span>
            {modal.type === "settings"
              ? "Los cambios se guardan automáticamente"
              : ""}
          </span>
          <button
            type={
              modal.type === "settings" || modal.type === "add"
                ? "button"
                : "submit"
            }
            onClick={
              modal.type === "settings" || modal.type === "add"
                ? onClose
                : undefined
            }
            disabled={saving}
            className="primary"
          >
            {saving
              ? "Guardando…"
              : modal.type === "settings" || modal.type === "add"
                ? "Listo"
                : modal.type === "remove"
                  ? "Quitar"
                  : "Guardar"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
