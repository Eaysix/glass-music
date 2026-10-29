import { useListeningRecorder, ListeningDialog } from "./listening";
import { t as tr, useLanguage, setLanguage, dateLabel } from "./i18n";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  BarChart3,
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
  Home as HomeIcon,
  FolderOpen,
  Library,
  ListMusic,
  Mic2,
  Maximize2,
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
import { getPosition, setPosition, useActiveLine } from "./playback";
import SeekControl from "./SeekControl";
import VolumeControl from "./VolumeControl";
import Atmosphere from "./Atmosphere";
import SettingsPanel from "./SettingsPanel";
import Home from "./Home";
import PanelResize from "./PanelResize";
import LyricsEditor from "./LyricsEditor";
import { useMarqueeSelection } from "./useMarqueeSelection";
import { useDiscordPresence } from "./useDiscordPresence";
import { useSystemMedia } from "./useSystemMedia";
import {
  collectionTracks,
  savedSongSort,
  rememberSongSort,
} from "./collection";
import FocusStage from "./FocusStage";
import ContextMenu from "./ContextMenu";
import { LyricContent } from "./LyricContent";
import type { Playlist, Queue, Settings, Track } from "./types";
import { defaults } from "./types";
import {
  mix,
  nextQueue,
  parseLrc,
  previousQueue,
  startQueue,
  timeLabel,
  reconcileQueue,
  addManualQueue,
  removeQueued,
  moveQueued,
  filterQueue,
  shuffleQueue,
  selectQueued,
} from "./queue";
const NO_LINES: ReturnType<typeof parseLrc> = [];
const TRACK_DRAG = "application/x-glass-track";
const QUEUE_DRAG = "application/x-glass-queue";
type SongMenu = {
  ids: string[];
  id: string;
  x: number;
  y: number;
  playlistId?: string;
};
type Modal =
  | {
      type: "settings";
    }
  | {
      type: "track";
      track: Track;
    }
  | {
      type: "playlist";
      playlist: Playlist;
    }
  | {
      type: "lyrics";
      id: string;
      text: string;
    }
  | {
      type: "add";
      ids: string[];
    }
  | {
      type: "remove";
      track: Track;
    }
  | {
      type: "removeMany";
      tracks: Track[];
    }
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
        <img
          src={api.coverUrl(cover)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
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
      aria-label={tr(label)}
      title={tr(label)}
      {...props}
    >
      {children}
    </button>
  );
}
export default function App() {
  useLanguage();
  const [settings, setSettings] = useState<Settings>(defaults),
    [tracks, setTracks] = useState<Track[]>([]);
  const [ready, setReady] = useState(false),
    [fatal, setFatal] = useState(""),
    [view, setView] = useState("home");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState(savedSongSort);
  const [showStats, setShowStats] = useState(false);
  const [playing, setPlaying] = useState(false),
    [panel, setPanel] = useState<"lyrics" | "queue" | null>("lyrics");
  useListeningRecorder(settings.queue.current, playing);
  const [transportRevision, setTransportRevision] = useState(0);
  const [homePanel, setHomePanel] = useState(false);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const selectionAnchor = useRef<string | null>(null);
  const [focusView, setFocusView] = useState<"lyrics" | "cover" | null>(null);
  const [lyrics, setLyrics] = useState(""),
    [modal, setModal] = useState<Modal>(null),
    [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false),
    [progress, setProgress] = useState(""),
    [importErrors, setImportErrors] = useState<string[]>([]);
  const [menu, setMenu] = useState<SongMenu | null>(null),
    [scroll, setScroll] = useState(0),
    [listHeight, setListHeight] = useState(400);
  const [queueScroll, setQueueScroll] = useState(0),
    [queueHeight, setQueueHeight] = useState(400);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const queueRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null),
    busy = useRef(false),
    latest = useRef({ settings, tracks, playing });
  latest.current = { settings, tracks, playing };
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
  const assignedIds = useMemo(
    () => new Set(settings.playlists.flatMap((p) => p.trackIds)),
    [settings.playlists],
  );
  const showHome = view === "home" && !query.trim();
  function navigate(next: string) {
    setHomePanel(false);
    setView(next);
    setQuery("");
    setFilter("all");
  }
  function rememberPlaylist(id: string) {
    setSettings((s) => ({
      ...s,
      recentPlaylists: [
        id,
        ...s.recentPlaylists.filter((other) => other !== id),
      ].slice(0, 12),
    }));
  }
  const timed = useMemo(() => parseLrc(lyrics), [lyrics]),
    activeLine = useActiveLine(
      focusView === "lyrics" || (!focusView && panel === "lyrics")
        ? timed
        : NO_LINES,
    );
  const presence = useDiscordPresence(
    ready,
    settings.discord,
    current,
    playing,
    transportRevision,
  );
  useSystemMedia(
    ready,
    current,
    !!current &&
      (!!settings.queue.upcoming.length || settings.repeat === "all"),
    !!current,
    settings.position,
    (event) => {
      const state = latest.current;
      if (event.action === "play" && !state.playing) void togglePlay();
      else if (event.action === "pause" && state.playing) void togglePlay();
      else if (event.action === "next" && !busy.current) void advance();
      else if (event.action === "previous" && !busy.current) back();
      else if (event.action === "stop") {
        void (async () => {
          if (state.playing) await togglePlay();
          await seek(0);
        })();
      } else if (["seek", "forward", "backward"].includes(event.action)) {
        const duration =
          state.tracks.find((t) => t.id === state.settings.queue.current)
            ?.duration ?? 0;
        const position =
          event.action === "seek"
            ? event.position
            : getPosition() + (event.action === "forward" ? 10 : -10);
        if (position !== null && Number.isFinite(position))
          void seek(Math.max(0, Math.min(duration, position)));
      }
    },
    setNotice,
  );
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(volumeTimer.current), []);
  function changeVolume(value: number) {
    const volume = Math.max(0, Math.min(1, value));
    setSettings((s) => ({ ...s, volume }));
    latest.current.settings = { ...latest.current.settings, volume };
    if (volumeTimer.current !== undefined) return;
    volumeTimer.current = setTimeout(() => {
      volumeTimer.current = undefined;
      api
        .audioCommand("volume", null, latest.current.settings.volume)
        .catch((e) => setNotice(String(e)));
    }, 50);
  }
  useEffect(() => {
    const resize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.deltaY)
        setSettings((s) => ({
          ...s,
          uiScale: Math.max(
            0.75,
            Math.min(
              1.5,
              Math.round((s.uiScale + (e.deltaY < 0 ? 0.05 : -0.05)) * 100) /
                100,
            ),
          ),
        }));
    };
    window.addEventListener("resize", resize);
    window.addEventListener("wheel", wheel, { passive: false });
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("wheel", wheel);
    };
  }, []);
  useEffect(() => {
    if (ready) setLanguage(settings.language);
  }, [ready, settings.language]);
  const activeLyricRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([api.loadSettings(), api.loadLibrary()])
      .then(([saved, library]) => {
        if (!alive) return;
        const ids = new Set(library.map((t) => t.id));
        saved.queue = filterQueue(saved.queue, (id) => ids.has(id));
        if (saved.queue.current && !saved.queue.source) {
          const context = new Set(saved.queue.context);
          const wholeLibrary =
            context.size === ids.size &&
            [...context].every((id) => ids.has(id));
          const matches = saved.playlists.filter(
            (p) =>
              p.trackIds.length === context.size &&
              p.trackIds.every((id) => context.has(id)),
          );
          saved.queue.source = {
            view:
              !wholeLibrary && matches.length === 1
                ? `playlist:${matches[0].id}`
                : "library",
            query: "",
            filter: "all",
            sort: "modified",
          };
          saved.queue.played = [...new Set(saved.queue.history)];
          const automatic = new Set<string>();
          saved.queue.manualIndices = saved.queue.upcoming.flatMap((id, i) => {
            if (!context.has(id) || automatic.has(id)) return [i];
            automatic.add(id);
            return [];
          });
        }

        setLanguage(saved.language);
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
        .then((saved) =>
          setSettings((current) => {
            const playlists = api.mergePlaylists(
              settings.playlists,
              current.playlists,
              saved,
            );
            if (
              JSON.stringify(current.playlistBase) === JSON.stringify(saved) &&
              JSON.stringify(current.playlists) === JSON.stringify(playlists)
            )
              return current;
            return { ...current, playlists, playlistBase: saved };
          }),
        )
        .catch((e) =>
          setNotice(
            tr("No se guardaron los cambios: {p0}", {
              p0: e,
            }),
          ),
        );
    }, 350);
    return () => clearTimeout(timer);
  }, [settings, ready]);
  useEffect(() => {
    if (!ready || !api.native) return;
    let alive = true,
      stop: (() => void) | undefined,
      revision = 0;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("lan-library-changed", () => {
          const ticket = ++revision;
          void Promise.all([api.loadLibrary(), api.loadSettings()])
            .then(async ([library, remote]) => {
              if (!alive || ticket !== revision) return;
              setTracks(library);
              setSettings((s) => ({
                ...s,
                playlists: api.mergePlaylists(
                  s.playlistBase ?? [],
                  s.playlists,
                  remote.playlists,
                ),
                playlistBase: remote.playlists,
              }));
              const id = latest.current.settings.queue.current;
              if (id) {
                const text = await api.getLyrics(id);
                if (
                  alive &&
                  ticket === revision &&
                  latest.current.settings.queue.current === id
                )
                  setLyrics(text);
              }
            })
            .catch((e) => {
              if (alive) setNotice(String(e));
            });
        }),
      )
      .then((unlisten) => {
        if (alive) stop = unlisten;
        else unlisten();
      });
    return () => {
      alive = false;
      stop?.();
    };
  }, [ready]);
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
                  : getPosition(),
            });
            await api
              .discordUpdate(
                { ...latest.current.settings.discord, enabled: false },
                null,
                false,
                0,
              )
              .catch(() => {});
            await window.destroy();
          } catch (error) {
            closing = false;
            setNotice(
              tr("No se pudo guardar antes de cerrar: {p0}", {
                p0: error,
              }),
            );
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
        listen<{
          done: number;
          total: number;
        }>("import-progress", (event) => {
          if (alive)
            setProgress(
              tr("{p0} de {p1} archivos", {
                p0: event.payload.done,
                p1: event.payload.total,
              }),
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
    const line = activeLyricRef.current;
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
  }, [activeLine, panel]);
  useEffect(() => {
    if (!playing) return;
    let alive = true,
      polling = false;
    const timer = setInterval(
      async () => {
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
          if (status.outputError)
            setNotice(
              tr(
                "Se perdió la salida de audio. Conecta tus audífonos y pulsa Reproducir para continuar: {p0}",
                { p0: status.outputError },
              ),
            );
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
      },
      settings.performance === "quality" ? 500 : 1000,
    );
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [playing, settings.performance]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "a" &&
        !modal &&
        !focusView &&
        !(e.target as HTMLElement).closest("input,textarea,[contenteditable]")
      ) {
        e.preventDefault();
        setSelection(new Set(visibleTracks.map((t) => t.id)));
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        ["+", "=", "-", "_", "0"].includes(e.key)
      ) {
        e.preventDefault();
        setSettings((s) => ({
          ...s,
          uiScale:
            e.key === "0"
              ? 1
              : Math.max(
                  0.75,
                  Math.min(
                    1.5,
                    Math.round(
                      (s.uiScale + (["+", "="].includes(e.key) ? 0.1 : -0.1)) *
                        100,
                    ) / 100,
                  ),
                ),
        }));
        return;
      }
      if (e.code === "Escape" && menu) {
        setMenu(null);
        return;
      }
      if (e.code === "Escape" && focusView && !modal) {
        setFocusView(null);
        return;
      }
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,button,a,[contenteditable],dialog",
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
    setSelection(new Set());
    selectionAnchor.current = null;
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [view, query, filter, sort]);
  const visibleTracks = useMemo(
    () =>
      collectionTracks(tracks, settings.playlists, {
        view,
        query,
        filter,
        sort,
      }),
    [tracks, settings.playlists, view, query, filter, sort],
  );
  useEffect(() => {
    if (!ready) return;
    setSettings((s) => {
      if (!s.queue.source) return s;
      const sameView =
        s.queue.source.view === (view === "home" ? "library" : view);
      const source = sameView
        ? { view: s.queue.source.view, query, filter, sort }
        : s.queue.source;
      const ids = collectionTracks(tracks, s.playlists, source).map(
        (t) => t.id,
      );
      const queue = reconcileQueue(s.queue, ids, s.shuffle, tracks, source);
      return queue === s.queue ? s : { ...s, queue };
    });
  }, [ready, tracks, settings.playlists, view, query, filter, sort]);
  useLayoutEffect(() => {
    const el = queueRef.current;
    if (!el) return;
    setQueueScroll(0);
    el.scrollTop = 0;
    const observer = new ResizeObserver((entries) =>
      setQueueHeight(entries[0].contentRect.height),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [panel, focusView, ready, homePanel, showHome]);
  const queueStart = Math.max(0, Math.floor(queueScroll / 74) - 3),
    queueEnd = Math.min(
      settings.queue.upcoming.length,
      Math.ceil((queueScroll + queueHeight) / 74) + 3,
    );
  const selectedTracks = useMemo(
    () => visibleTracks.filter((t) => selection.has(t.id)),
    [visibleTracks, selection],
  );
  const selectedIds = selectedTracks.map((t) => t.id);
  const marquee = useMarqueeSelection(
    listRef,
    visibleTracks.map((t) => t.id),
    selection,
    setSelection,
    settings.uiScale,
  );
  function selectTrack(e: MouseEvent<HTMLElement>, id: string) {
    if (e.shiftKey && selectionAnchor.current) {
      const a = visibleTracks.findIndex(
          (t) => t.id === selectionAnchor.current,
        ),
        b = visibleTracks.findIndex((t) => t.id === id);
      if (a >= 0 && b >= 0) {
        const range = visibleTracks
          .slice(Math.min(a, b), Math.max(a, b) + 1)
          .map((t) => t.id);
        setSelection(
          (previous) =>
            new Set(e.ctrlKey || e.metaKey ? [...previous, ...range] : range),
        );
        return;
      }
    }
    selectionAnchor.current = id;
    setSelection((previous) => {
      if (!e.ctrlKey && !e.metaKey) return new Set([id]);
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const totalDuration = visibleTracks.reduce((sum, t) => sum + t.duration, 0);
  const title =
    selectedPlaylist?.name ??
    (view === "favorites"
      ? tr("Tus favoritas")
      : view === "unorganized"
        ? tr("Sin organizar")
        : view === "home"
          ? tr("Resultados de b\u00FAsqueda")
          : tr("Todas las canciones"));
  const start = Math.max(0, Math.floor(scroll / 76) - 4),
    end = Math.min(
      visibleTracks.length,
      Math.ceil((scroll + listHeight) / 76) + 4,
    );
  async function playQueue(queue: Queue, from = 0) {
    if (busy.current || !queue.current) return;
    busy.current = true;
    try {
      const status = await api.audioCommand("play", queue.current, from);
      setSettings((s) => ({ ...s, queue, position: status.position }));
      setPosition(status.position);
      setTransportRevision((n) => n + 1);
      setPlaying(status.playing);
    } catch (e) {
      await api.audioCommand("pause").catch(() => {});
      setNotice(
        tr("No se pudo reproducir: {p0}", {
          p0: e,
        }),
      );
      setPlaying(false);
    } finally {
      busy.current = false;
    }
  }
  function playTrack(track: Track) {
    if (selectedPlaylist) rememberPlaylist(selectedPlaylist.id);
    void playQueue({
      ...startQueue(
        visibleTracks.map((t) => t.id),
        track.id,
        settings.shuffle,
        tracks,
      ),
      source: { view: view === "home" ? "library" : view, query, filter, sort },
    });
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
        duration > 0 && getPosition() >= duration - 0.5 ? 0 : getPosition();
      const status = await api.audioCommand(
        state.playing ? "pause" : "play",
        state.settings.queue.current,
        resumeAt,
      );
      setPlaying(status.playing);
      setPosition(status.position);
      setTransportRevision((n) => n + 1);
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
      queue = nextQueue({
        ...s.queue,
        upcoming,
        played: [],
        manualIndices: [],
      });
    }
    if (queue.current) void playQueue(queue);
    else {
      setPlaying(false);
      const endPosition =
        library.find((t) => t.id === s.queue.current)?.duration ??
        getPosition();
      setPosition(endPosition);
      void api.audioCommand("pause").catch((e) => setNotice(String(e)));
      setSettings((s) => ({ ...s, position: endPosition }));
    }
  }
  advanceRef.current = advance;
  function back() {
    if (getPosition() > 3 || !settings.queue.history.length) void seek(0);
    else void playQueue(previousQueue(settings.queue));
  }
  async function seek(value: number) {
    try {
      const status = await api.audioCommand("seek", null, value);
      setPosition(status.position);
      setTransportRevision((n) => n + 1);
      setSettings((s) => ({ ...s, position: status.position }));
    } catch (e) {
      setNotice(
        tr("No se pudo adelantar: {p0}", {
          p0: e,
        }),
      );
    }
  }
  async function importTracks(folder: boolean, target = selectedPlaylist?.id) {
    if (importing) return;
    setImporting(true);
    setProgress(tr("Leyendo etiquetas y portadas\u2026"));
    setImportErrors([]);
    try {
      const report = await api.importMusic(folder);
      if (report) {
        setTracks(await api.loadLibrary());
        setImportErrors(report.errors);
        const ids = [
          ...new Set([
            ...report.tracks.map((t) => t.id),
            ...(report.existingIds ?? []),
          ]),
        ];
        const destination =
          target &&
          latest.current.settings.playlists.find((p) => p.id === target);
        if (destination) {
          const added = ids.filter((id) => !destination.trackIds.includes(id));
          setSettings((s) => ({
            ...s,
            playlists: s.playlists.map((p) =>
              p.id === target
                ? { ...p, trackIds: [...new Set([...p.trackIds, ...ids])] }
                : p,
            ),
          }));
          setNotice(
            tr("{p0} canciones a\u00F1adidas a \u00AB{p1}\u00BB{p2}", {
              p0: added.length,
              p1: destination.name,
              p2: report.errors.length
                ? tr(" \u00B7 {p0} con error", {
                    p0: report.errors.length,
                  })
                : "",
            }),
          );
        } else {
          setNotice(
            tr("{p0} canciones a\u00F1adidas{p1}{p2}{p3}", {
              p0: report.tracks.length,
              p1: target
                ? tr(
                    " \u00B7 La playlist ya no existe; las encontrar\u00E1s en Sin organizar",
                  )
                : "",
              p2: report.skipped
                ? tr(" \u00B7 {p0} ya importadas o no compatibles", {
                    p0: report.skipped,
                  })
                : "",
              p3: report.errors.length
                ? tr(" \u00B7 {p0} con error", {
                    p0: report.errors.length,
                  })
                : "",
            }),
          );
        }
      }
    } catch (e) {
      setNotice(
        tr("No se pudo importar: {p0}", {
          p0: e,
        }),
      );
    } finally {
      setImporting(false);
      setProgress("");
    }
  }
  async function changeTrack(track: Track) {
    const original = byId.get(track.id);
    const favoriteOnly =
      !!original &&
      original.favorite !== track.favorite &&
      ["title", "artist", "album", "feats", "cover"].every(
        (key) => original[key as keyof Track] === track[key as keyof Track],
      );
    const saved = await api.updateTrack(track, favoriteOnly);
    setTracks((list) => list.map((t) => (t.id === saved.id ? saved : t)));
  }
  async function favorite(track: Track) {
    try {
      await changeTrack({ ...track, favorite: !track.favorite });
    } catch (e) {
      setNotice(String(e));
    }
  }
  function enqueue(value: string | string[]) {
    const ids = typeof value === "string" ? [value] : value;
    setSettings((s) => ({
      ...s,
      queue: addManualQueue(s.queue, ids),
    }));
    setMenu(null);
    setNotice(tr("Añadida a la cola"));
  }
  function openSongMenu(
    e: MouseEvent<HTMLElement>,
    id: string,
    playlistId?: string,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({
      id,
      ids:
        e.currentTarget.closest(".track-row") && selection.has(id)
          ? selectedIds
          : [id],
      playlistId,
      x: e.type === "contextmenu" ? e.clientX : rect.right,
      y: e.type === "contextmenu" ? e.clientY : rect.bottom,
    });
  }
  function beginDrag(
    e: DragEvent<HTMLElement>,
    id: string,
    playlistId?: string,
  ) {
    if (marquee.isSelecting()) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "copyMove";
    const ids =
      e.currentTarget.closest(".track-row") && selection.has(id)
        ? selectedIds
        : [id];
    e.dataTransfer.setData(TRACK_DRAG, JSON.stringify({ id, ids, playlistId }));
    setDragging(id);
    setMenu(null);
  }
  function endDrag() {
    setDragging(null);
    setDropTarget(null);
  }
  function droppedTrack(e: DragEvent<HTMLElement>): {
    id: string;
    ids: string[];
    playlistId?: string;
  } | null {
    try {
      const data = JSON.parse(e.dataTransfer.getData(TRACK_DRAG));
      const ids = Array.isArray(data?.ids)
        ? [
            ...new Set(
              data.ids.filter(
                (id: unknown): id is string =>
                  typeof id === "string" && byId.has(id),
              ),
            ),
          ]
        : typeof data?.id === "string" && byId.has(data.id)
          ? [data.id]
          : [];
      return ids.length
        ? {
            id: ids[0] as string,
            ids: ids as string[],
            playlistId:
              typeof data.playlistId === "string" ? data.playlistId : undefined,
          }
        : null;
    } catch {
      return null;
    }
  }
  function addToPlaylist(playlistId: string, value: string | string[]) {
    const playlist = settings.playlists.find((p) => p.id === playlistId),
      ids = [...new Set(typeof value === "string" ? [value] : value)].filter(
        (id) => byId.has(id),
      );
    if (!playlist || !ids.length) return;
    const added = ids.filter((id) => !playlist.trackIds.includes(id));
    if (!added.length) {
      setNotice(
        tr("Ya est\u00E1{p0} en \u00AB{p1}\u00BB", {
          p0: ids.length > 1 ? "n" : "",
          p1: playlist.name,
        }),
      );
      return;
    }
    setSettings((s) => ({
      ...s,
      playlists: s.playlists.map((p) =>
        p.id === playlistId
          ? { ...p, trackIds: [...new Set([...p.trackIds, ...ids])] }
          : p,
      ),
    }));
    setNotice(
      added.length === 1
        ? tr("A\u00F1adida a \u00AB{p0}\u00BB", {
            p0: playlist.name,
          })
        : tr("{p0} canciones a\u00F1adidas a \u00AB{p1}\u00BB", {
            p0: added.length,
            p1: playlist.name,
          }),
    );
  }
  function allowPlaylistDrop(e: DragEvent<HTMLElement>, target: string) {
    if (!e.dataTransfer.types.includes(TRACK_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropTarget(target);
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
    setSettings((s) => ({
      ...s,
      queue: moveQueued(s.queue, index, destination),
    }));
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
  async function deleteTracks(ids: string[]) {
    if (busy.current)
      throw new Error(tr("Espera a que termine el cambio de canci\u00F3n."));
    const removed = new Set(ids),
      currentRemoved = removed.has(settings.queue.current ?? "");
    if (currentRemoved) {
      await api.audioCommand("stop");
      setPlaying(false);
      setPosition(0);
    }
    await api.removeTracks(ids);
    setTracks((ts) => ts.filter((t) => !removed.has(t.id)));
    setSelection(new Set());
    setSettings((s) => ({
      ...s,
      position: currentRemoved ? 0 : s.position,
      playlists: s.playlists.map((p) => ({
        ...p,
        trackIds: p.trackIds.filter((id) => !removed.has(id)),
      })),
      queue: filterQueue(s.queue, (id) => !removed.has(id)),
    }));
  }
  async function deleteTrack(track: Track) {
    await deleteTracks([track.id]);
  }
  const style = {
    "--ui-scale": settings.uiScale,
    "--panel-width": `${settings.panelWidth}px`,
    "--accent": settings.appearance.accent,
    "--blur": `${settings.appearance.reduced || settings.performance === "economy" ? 0 : Math.min(settings.appearance.glass, settings.performance === "quality" ? 32 : 12)}px`,
    "--surface-alpha": settings.appearance.opacity / 100,
    "--lyrics-scale": settings.appearance.lyricScale,
  } as CSSProperties;
  if (fatal)
    return (
      <div className="boot">
        <Disc3 size={48} />
        <h1>{tr("No se pudo abrir la biblioteca")}</h1>
        <p>{fatal}</p>
        <button onClick={() => location.reload()}>{tr("Reintentar")}</button>
      </div>
    );
  if (!ready)
    return (
      <div className="boot">
        <Disc3 size={48} />
        <p>{tr("Abriendo tu espacio\u2026")}</p>
      </div>
    );
  return (
    <div
      onContextMenu={(e) => {
        if (
          !(e.target as HTMLElement).closest("input,textarea,[contenteditable]")
        )
          e.preventDefault();
      }}
      className={`app ${viewport.width / settings.uiScale < 1250 ? "hud-narrow" : ""} ${viewport.width / settings.uiScale < 850 ? "hud-compact" : ""} ${viewport.height / settings.uiScale < 790 ? "hud-short" : ""} ${playing ? "is-playing" : ""} ${dragging ? "is-dragging" : ""} ${focusView ? "focus-open" : ""} ${settings.appearance.theme} performance-${settings.performance} ${settings.appearance.animations ? "" : "no-motion"} ${settings.player.autoHide ? "player-auto-hide" : ""} ${modal || menu ? "controls-open" : ""} ${settings.appearance.reduced ? "reduced" : ""}`}
      style={style}
    >
      {current?.cover && settings.appearance.albumBackground && (
        <Atmosphere className="album-atmosphere" cover={current.cover} />
      )}
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
          <small>{tr("LOCAL PLAYER")}</small>
        </div>
        <div className="nav-label">{tr("TU ESPACIO")}</div>
        <nav>
          <button
            className={view === "home" ? "selected" : ""}
            onClick={() => navigate("home")}
          >
            <HomeIcon size={19} />
            {tr("Inicio")}
          </button>
          <button
            className={view === "library" ? "selected" : ""}
            onClick={() => navigate("library")}
          >
            <Library size={19} />
            {tr("Todas las canciones")}
            <span>{tracks.length}</span>
          </button>
          <button
            className={view === "favorites" ? "selected" : ""}
            onClick={() => navigate("favorites")}
          >
            <Heart size={19} />
            {tr("Me gusta")}
          </button>
          <button
            className={view === "unorganized" ? "selected" : ""}
            onClick={() => navigate("unorganized")}
          >
            <FolderOpen size={19} />
            {tr("Sin organizar")}
            <span>{tracks.filter((t) => !assignedIds.has(t.id)).length}</span>
          </button>
        </nav>
        <div className="nav-label playlists-label">
          <span>{tr("TUS PLAYLISTS")}</span>
          <IconButton label={tr("Crear playlist")} onClick={newPlaylist}>
            <Plus size={17} />
          </IconButton>
        </div>
        <div className="playlists-nav">
          {settings.playlists.length ? (
            settings.playlists.map((p) => (
              <button
                key={p.id}
                className={`${selectedPlaylist?.id === p.id ? "selected" : ""} ${dropTarget === p.id ? "drop-target" : ""}`}
                aria-label={p.name}
                data-playlist-id={p.id}
                onDragOver={(e) => allowPlaylistDrop(e, p.id)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setDropTarget(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const data = droppedTrack(e);
                  if (data) addToPlaylist(p.id, data.ids);
                  endDrag();
                }}
                onClick={() => navigate(`playlist:${p.id}`)}
              >
                <Cover cover={p.cover} title={p.name} />
                <span>
                  {p.name}
                  <small>
                    {p.trackIds.length}
                    {tr(" canciones")}
                  </small>
                </span>
                {dropTarget === p.id && (
                  <Plus size={16} className="drop-plus" />
                )}
              </button>
            ))
          ) : (
            <p>
              {tr("Organiza tu m\u00FAsica.")}
              <br />
              <button className="text-button" onClick={newPlaylist}>
                {tr("Crea tu primera playlist ")}
                <Plus size={13} />
              </button>
            </p>
          )}
        </div>
        <div className="sidebar-footer">
          <div className="local-status">
            {dragging ? (
              <>
                <Plus size={13} />
                {tr(" Suelta en una playlist")}
              </>
            ) : (
              <>
                <i />
                {tr(" M\u00FAsica local")}
              </>
            )}
          </div>
          <button
            className="profile"
            aria-label={settings.profile.name + tr(" Perfil local")}
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
              <small>{tr("Perfil local")}</small>
            </span>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>
      <main className={`main glass ${showHome ? "home-main" : "songs-main"}`}>
        <header className="topbar">
          <div className="breadcrumbs">
            <Music2 size={16} />
            <span>{tr("Biblioteca local")}</span>
          </div>
          <label className="search">
            <Search size={17} />
            <input
              aria-label={tr("Buscar m\u00FAsica")}
              placeholder={tr("Canciones, artistas, \u00E1lbumes\u2026")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <IconButton
                label={tr("Limpiar b\u00FAsqueda")}
                onClick={() => setQuery("")}
              >
                <X size={14} />
              </IconButton>
            )}
          </label>
          <IconButton
            label={tr("Tu música en números")}
            onClick={() => setShowStats(true)}
          >
            <BarChart3 size={19} />
          </IconButton>
          <IconButton
            label={tr("Ajustes de apariencia y perfil")}
            onClick={() => setModal({ type: "settings" })}
          >
            <SlidersHorizontal size={19} />
          </IconButton>
        </header>
        {showHome ? (
          <Home
            name={settings.profile.name}
            playlists={settings.playlists}
            recent={settings.recentPlaylists}
            byId={byId}
            current={current}
            position={settings.position}
            playing={playing}
            favoriteCount={tracks.filter((t) => t.favorite).length}
            unorganizedCount={
              tracks.filter((t) => !assignedIds.has(t.id)).length
            }
            open={navigate}
            create={newPlaylist}
            resume={() => {
              if (!playing) void togglePlay();
            }}
            dragOver={allowPlaylistDrop}
            dropTarget={dropTarget}
            drop={(e, id) => {
              e.preventDefault();
              const data = droppedTrack(e);
              if (data) addToPlaylist(id, data.ids);
              endDrag();
            }}
          />
        ) : (
          <>
            <section
              className={`hero ${tracks.length ? "has-music" : ""} ${selectedPlaylist ? "playlist-hero" : ""}`}
            >
              {selectedPlaylist && (
                <Cover
                  className="playlist-art"
                  cover={selectedPlaylist.cover}
                  title={selectedPlaylist.name}
                />
              )}
              <div className="hero-copy" key={view}>
                <div className="eyebrow">
                  {selectedPlaylist
                    ? tr("PLAYLIST")
                    : view === "favorites"
                      ? tr("TUS IMPRESCINDIBLES")
                      : tr("TU COLECCI\u00D3N")}
                </div>
                <h1>{title}</h1>
                <p>
                  {visibleTracks.length
                    ? tr("{p0} canciones \u00B7 {p1} min de m\u00FAsica", {
                        p0: visibleTracks.length,
                        p1: Math.floor(totalDuration / 60),
                      })
                    : tr("Todo lo que quieres escuchar, en un solo lugar.")}
                </p>
                <div className="hero-actions">
                  <button
                    className="primary"
                    disabled={!visibleTracks.length}
                    onClick={() =>
                      visibleTracks[0] && playTrack(visibleTracks[0])
                    }
                  >
                    <Play size={16} fill="currentColor" />
                    {tr(" Reproducir")}
                  </button>
                  {selectedPlaylist && (
                    <button
                      className="secondary"
                      disabled={importing}
                      onClick={() => importTracks(false)}
                    >
                      <Plus size={17} />
                      {importing ? "Importando…" : tr("A\u00F1adir canciones")}
                    </button>
                  )}
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
                      {tr(" Editar playlist")}
                    </button>
                  ) : (
                    <button
                      className="secondary"
                      disabled={importing}
                      onClick={() => importTracks(false)}
                    >
                      <Plus size={17} />
                      {importing
                        ? "Importando…"
                        : tr("A\u00F1adir m\u00FAsica")}
                    </button>
                  )}
                </div>
              </div>
              {!selectedPlaylist && (
                <div className="hero-note">
                  <Disc3 size={26} />
                  <span>
                    {tr("Tu m\u00FAsica.")}
                    <br />
                    <strong>{tr("Sin distracciones.")}</strong>
                  </span>
                </div>
              )}
            </section>
            <section className="collection" key={view}>
              <div className="section-heading">
                <div>
                  <h2>{tr("Canciones")}</h2>
                  <span>
                    {visibleTracks.length}
                    {tr(" canciones")}
                    {totalDuration > 0
                      ? tr(" \u00B7 {p0} min", {
                          p0: Math.floor(totalDuration / 60),
                        })
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
                        queue: shuffleQueue(s.queue, shuffle, tracks),
                      }));
                    }}
                    title={tr(
                      "Cambiar aleatorio: desactivado, sin repeticiones o mezcla variada",
                    )}
                  >
                    <Shuffle size={16} />
                    <span>
                      {settings.shuffle === "off"
                        ? tr("En orden")
                        : settings.shuffle === "random"
                          ? tr("Sin repetir")
                          : tr("Mezcla variada")}
                    </span>
                  </button>
                  <IconButton
                    label={tr("Importar carpeta")}
                    disabled={importing}
                    onClick={() => importTracks(true)}
                  >
                    <FolderPlus size={18} />
                  </IconButton>
                </div>
              </div>
              {visibleTracks.length > 0 && (
                <div className="selection-bar" role="status">
                  <span>
                    {selectedTracks.length
                      ? tr("{p0} seleccionada{p1}", {
                          p0: selectedTracks.length,
                          p1: selectedTracks.length === 1 ? "" : "s",
                        })
                      : tr(
                          "Ctrl + clic \u00B7 Shift + clic \u00B7 Arrastra para seleccionar",
                        )}
                  </span>
                  <button
                    disabled={!selectedTracks.length}
                    onClick={() => setModal({ type: "add", ids: selectedIds })}
                  >
                    {tr("A\u00F1adir a playlist")}
                  </button>
                  <button
                    disabled={!selectedTracks.length}
                    onClick={() => enqueue(selectedIds)}
                  >
                    {tr("A\u00F1adir a cola")}
                  </button>
                  <button
                    disabled={!selectedTracks.length}
                    className="danger"
                    onClick={() =>
                      setModal({ type: "removeMany", tracks: selectedTracks })
                    }
                  >
                    {tr("Eliminar")}
                  </button>
                  <button
                    disabled={!selectedTracks.length}
                    aria-label={tr("Limpiar selecci\u00F3n")}
                    onClick={() => setSelection(new Set())}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <div className="filters">
                <div className="chips">
                  {[
                    ["all", tr("Todo")],
                    ["FLAC", "FLAC"],
                    ["MP3", "MP3"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={filter === id ? "selected" : ""}
                      onClick={() => setFilter(id)}
                    >
                      {tr(label)}
                    </button>
                  ))}
                </div>
                <label className="sort">
                  {tr("Ordenar por")}{" "}
                  <select
                    aria-label={tr("Orden de canciones")}
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value);
                      rememberSongSort(e.target.value);
                    }}
                  >
                    <option value="modified">
                      {tr("Fecha: nuevas primero")}
                    </option>
                    <option value="modified-oldest">
                      {tr("Fecha: antiguas primero")}
                    </option>
                    <option value="added">
                      {selectedPlaylist ? tr("Tu orden") : tr("A\u00F1adidas")}
                    </option>
                    <option value="title">{tr("T\u00EDtulo")}</option>
                    <option value="artist">{tr("Artista")}</option>
                  </select>
                </label>
              </div>
              {importing && (
                <div className="import-progress" role="status">
                  <span className="pulse-dot" />
                  {tr("Importando \u00B7 ")}
                  {progress}
                </div>
              )}
              {importErrors.length > 0 && (
                <details className="import-errors">
                  <summary>
                    {importErrors.length}
                    {tr(" archivos no se pudieron importar")}
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
                    <span>{tr("T\u00CDTULO")}</span>
                    <span className="album-col">
                      {sort.startsWith("modified")
                        ? tr("MODIFICADO")
                        : tr("ÁLBUM")}
                    </span>
                    <span>{tr("FORMATO")}</span>
                    <span />
                    <Clock3 size={13} />
                    <span />
                  </div>
                  <div
                    className={`track-list ${marquee.box ? "selecting-area" : ""}`}
                    ref={listRef}
                    onPointerDown={marquee.onPointerDown}
                    onPointerMove={marquee.onPointerMove}
                    onPointerUp={marquee.onPointerUp}
                    onPointerCancel={marquee.onPointerCancel}
                    onLostPointerCapture={marquee.onPointerCancel}
                    onClickCapture={marquee.onClickCapture}
                    onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
                  >
                    <div
                      className="track-canvas"
                      style={{
                        height: visibleTracks.length * 76,
                        position: "relative",
                      }}
                    >
                      {visibleTracks.slice(start, end).map((track, offset) => {
                        const index = start + offset,
                          isCurrent = current?.id === track.id;
                        return (
                          <div
                            key={track.id}
                            data-track-id={track.id}
                            className={`track-row ${isCurrent ? "current" : ""} ${selection.has(track.id) ? "selected-track" : ""} ${dragging === track.id ? "drag-source" : ""} ${dropTarget === `track:${track.id}` ? "reorder-target" : ""}`}
                            draggable
                            onDragStart={(e) =>
                              beginDrag(e, track.id, selectedPlaylist?.id)
                            }
                            onDragEnd={endDrag}
                            onContextMenu={(e) =>
                              openSongMenu(e, track.id, selectedPlaylist?.id)
                            }
                            onDragOver={(e) => {
                              if (
                                selectedPlaylist &&
                                sort === "added" &&
                                e.dataTransfer.types.includes(TRACK_DRAG)
                              ) {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                setDropTarget(`track:${track.id}`);
                              }
                            }}
                            onDragLeave={() => setDropTarget(null)}
                            onDrop={(e) => {
                              e.preventDefault();
                              const data = droppedTrack(e);
                              if (
                                selectedPlaylist &&
                                sort === "added" &&
                                data &&
                                !data.ids.includes(track.id)
                              ) {
                                if (data.playlistId === selectedPlaylist.id) {
                                  setSettings((s) => ({
                                    ...s,
                                    playlists: s.playlists.map((p) => {
                                      if (p.id !== selectedPlaylist.id)
                                        return p;
                                      const ids = p.trackIds.filter(
                                        (id) => !data.ids.includes(id),
                                      );
                                      ids.splice(
                                        ids.indexOf(track.id),
                                        0,
                                        ...data.ids,
                                      );
                                      return { ...p, trackIds: ids };
                                    }),
                                  }));
                                } else
                                  addToPlaylist(selectedPlaylist.id, data.ids);
                              }
                              endDrag();
                            }}
                            style={{
                              position: "absolute",
                              top: index * 76,
                              left: 0,
                              right: 0,
                            }}
                            onClick={(e) => {
                              if (!(e.target as HTMLElement).closest("button"))
                                selectTrack(e, track.id);
                            }}
                            onDoubleClick={(e) => {
                              if (!e.ctrlKey && !e.metaKey && !e.shiftKey)
                                playTrack(track);
                            }}
                          >
                            <button
                              className="track-number"
                              aria-label={tr("Reproducir {p0}", {
                                p0: track.title,
                              })}
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
                              aria-pressed={selection.has(track.id)}
                              onClick={(e) => selectTrack(e, track.id)}
                            >
                              <Cover cover={track.cover} title={track.album} />
                              <span>
                                <strong>{track.title}</strong>
                                <small>
                                  {track.artist}
                                  {track.feats
                                    ? tr(" \u00B7 feat. {p0}", {
                                        p0: track.feats,
                                      })
                                    : ""}
                                </small>
                              </span>
                            </button>
                            <span
                              className="album-col ellipsis"
                              title={
                                sort.startsWith("modified")
                                  ? track.album
                                  : undefined
                              }
                            >
                              {sort.startsWith("modified")
                                ? dateLabel(track.modifiedAt)
                                : track.album}
                            </span>
                            <span
                              className={`format ${track.format.toLowerCase()}`}
                            >
                              {track.format}
                            </span>
                            <IconButton
                              label={
                                track.favorite
                                  ? tr("Quitar Me gusta a {p0}", {
                                      p0: track.title,
                                    })
                                  : tr("Me gusta {p0}", {
                                      p0: track.title,
                                    })
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
                              label={tr("Opciones de {p0}", {
                                p0: track.title,
                              })}
                              onClick={(e) =>
                                openSongMenu(e, track.id, selectedPlaylist?.id)
                              }
                            >
                              <Ellipsis size={19} />
                            </IconButton>
                          </div>
                        );
                      })}
                    </div>
                    {marquee.box && (
                      <div
                        className="selection-rectangle"
                        style={marquee.box}
                        aria-hidden="true"
                      />
                    )}
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
                      ? tr("No hay coincidencias")
                      : selectedPlaylist
                        ? tr("Dale un sonido a esta playlist")
                        : view === "favorites"
                          ? tr("Aqu\u00ED van las que te encantan")
                          : tr("Tu colecci\u00F3n empieza aqu\u00ED")}
                  </h3>
                  <p>
                    {query || filter !== "all"
                      ? tr("Prueba con otra b\u00FAsqueda o formato.")
                      : selectedPlaylist
                        ? tr(
                            "A\u00F1ade archivos directamente a esta playlist o arrastra canciones desde otra lista.",
                          )
                        : view === "favorites"
                          ? tr(
                              "Toca el coraz\u00F3n de una canci\u00F3n para guardarla.",
                            )
                          : tr(
                              "A\u00F1ade tus FLAC y MP3. Nosotros ponemos el espacio.",
                            )}
                  </p>
                  {view === "library" && !query && (
                    <button
                      className="secondary"
                      disabled={importing}
                      onClick={() => importTracks(true)}
                    >
                      <FolderPlus size={17} />
                      {tr("Elegir carpeta")}
                    </button>
                  )}
                </div>
              )}
            </section>
            <footer className="library-footer">
              <span>
                <i />
                {tr(" BIBLIOTECA LOCAL")}
              </span>
              <span>
                {tracks.filter((t) => t.format === "FLAC").length}
                {tr(" FLAC \u00B7")}{" "}
                {tracks.filter((t) => t.format === "MP3").length} MP3
              </span>
            </footer>
          </>
        )}
      </main>
      {panel && !focusView && (!showHome || homePanel) && (
        <aside className="right-panel glass" key={panel}>
          <PanelResize
            width={settings.panelWidth}
            scale={settings.uiScale}
            change={(panelWidth) => setSettings((s) => ({ ...s, panelWidth }))}
          />
          <div className="panel-tabs">
            <button
              className={panel === "lyrics" ? "selected" : ""}
              onClick={() => setPanel("lyrics")}
            >
              <Mic2 size={16} />
              {tr("Letra")}
            </button>
            <button
              className={panel === "queue" ? "selected" : ""}
              onClick={() => setPanel("queue")}
            >
              <ListMusic size={17} />
              {tr("Cola")}
              <span>{settings.queue.upcoming.length}</span>
            </button>
            {panel === "lyrics" && (
              <IconButton
                label={tr("Ampliar letra")}
                disabled={!current}
                onClick={() => setFocusView("lyrics")}
              >
                <Maximize2 size={16} />
              </IconButton>
            )}
            <IconButton
              label={tr("Cerrar panel")}
              onClick={() => setPanel(null)}
            >
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
                          ? tr("LETRA SINCRONIZADA")
                          : lyrics
                            ? tr("LETRA")
                            : tr("TU VOZ TAMBI\u00C9N CUENTA")}
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
                        {lyrics ? tr("Editar") : tr("A\u00F1adir")}
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
                          <LyricContent
                            line={line}
                            playing={playing}
                            active={i === activeLine}
                          />
                        </button>
                      ))
                    ) : lyrics ? (
                      <p className="plain-lyrics">{lyrics}</p>
                    ) : (
                      <div className="panel-empty">
                        <Mic2 size={28} />
                        <h3>{tr("Cada canci\u00F3n tiene algo que decir.")}</h3>
                        <p>
                          {tr(
                            "Pega su letra o importa un archivo .lrc para seguirla a tu ritmo.",
                          )}
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
                          {tr("A\u00F1adir letra")}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="panel-footnote">
                    {timed.length
                      ? tr("Toca una l\u00EDnea para ir a ese momento.")
                      : tr("Las letras se guardan en tu biblioteca.")}
                  </div>
                </>
              ) : (
                <div className="panel-empty">
                  <div className="line-art">
                    <Mic2 size={38} />
                  </div>
                  <h3>
                    {tr("La letra,")}
                    <br />
                    {tr("en primer plano.")}
                  </h3>
                  <p>
                    {tr(
                      "Reproduce una canci\u00F3n para ver su letra o a\u00F1adir la tuya.",
                    )}
                  </p>
                  <span className="tiny-label">
                    {tr("AQU\u00CD, CADA PALABRA IMPORTA")}
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="queue-heading">
                <h3>{tr("A continuaci\u00F3n")}</h3>
                {settings.queue.upcoming.length > 0 && (
                  <button
                    className="text-button"
                    onClick={() =>
                      setSettings((s) => ({
                        ...s,
                        queue: { ...s.queue, upcoming: [], manualIndices: [] },
                      }))
                    }
                  >
                    {tr("Vaciar")}
                  </button>
                )}
              </div>
              {current && (
                <div className="now-queue">
                  <span className="eyebrow">{tr("SONANDO AHORA")}</span>
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
                            className={`queue-row ${dropTarget === `queue:${index}` ? "reorder-target" : ""}`}
                            onContextMenu={(e) => openSongMenu(e, id)}
                            style={{
                              position: "absolute",
                              top: index * 74,
                              left: 0,
                              right: 0,
                              height: 74,
                            }}
                            key={`${id}:${index}`}
                            draggable
                            onDragStart={(e) => {
                              beginDrag(e, id);
                              e.dataTransfer.setData(QUEUE_DRAG, String(index));
                            }}
                            onDragEnd={endDrag}
                            onDragOver={(e) => {
                              if (e.dataTransfer.types.includes(QUEUE_DRAG)) {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                setDropTarget(`queue:${index}`);
                              }
                            }}
                            onDragLeave={() => setDropTarget(null)}
                            onDrop={(e) => {
                              e.preventDefault();
                              const value = e.dataTransfer.getData(QUEUE_DRAG);
                              if (/^\d+$/.test(value))
                                moveQueue(Number(value), index);
                              endDrag();
                            }}
                          >
                            <span className="queue-index">{index + 1}</span>
                            <Cover cover={t.cover} title={t.album} />
                            <button
                              className="queue-title"
                              onClick={() =>
                                playQueue(selectQueued(settings.queue, index))
                              }
                            >
                              <strong>{t.title}</strong>
                              <small>{t.artist}</small>
                            </button>
                            <div className="queue-tools">
                              <IconButton
                                label={tr("Subir {p0}", {
                                  p0: t.title,
                                })}
                                disabled={index === 0}
                                onClick={() => moveQueue(index, index - 1)}
                              >
                                <ArrowUp size={12} />
                              </IconButton>
                              <IconButton
                                label={tr("Bajar {p0}", {
                                  p0: t.title,
                                })}
                                disabled={
                                  index === settings.queue.upcoming.length - 1
                                }
                                onClick={() => moveQueue(index, index + 1)}
                              >
                                <ArrowDown size={12} />
                              </IconButton>
                              <IconButton
                                label={tr("Quitar {p0} de la cola", {
                                  p0: t.title,
                                })}
                                onClick={() =>
                                  setSettings((s) => ({
                                    ...s,
                                    queue: removeQueued(s.queue, index),
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
                    <h3>{tr("Tu siguiente canci\u00F3n te espera.")}</h3>
                    <p>
                      {tr(
                        "A\u00F1ade canciones desde sus opciones o reproduce una lista.",
                      )}
                    </p>
                  </div>
                )}
              </div>
              <div className="panel-footnote">
                {tr("Arrastra o usa las flechas para cambiar el orden.")}
              </div>
            </>
          )}
        </aside>
      )}
      {focusView && (
        <FocusStage
          track={current}
          mode={focusView}
          setMode={setFocusView}
          lyrics={lyrics}
          lines={timed}
          active={activeLine}
          playing={playing}
          albumBackground={settings.appearance.albumBackground}
          seek={seek}
          close={() => setFocusView(null)}
          edit={() =>
            current &&
            setModal({ type: "lyrics", id: current.id, text: lyrics })
          }
        />
      )}
      {settings.player.autoHide && (
        <button
          className="player-reveal"
          aria-label={tr("Mostrar controles de reproducci\u00F3n")}
          title={tr("Acerca el mouse para mostrar el reproductor")}
        >
          <span />
        </button>
      )}
      <footer className="player glass">
        <div
          className="player-track"
          onContextMenu={(e) => current && openSongMenu(e, current.id)}
          draggable={!!current}
          onDragStart={(e) => current && beginDrag(e, current.id)}
          onDragEnd={endDrag}
        >
          <button
            className="player-art-button"
            aria-label={tr("Ampliar portada")}
            disabled={!current}
            onClick={() => setFocusView("cover")}
          >
            <Cover
              cover={current?.cover ?? null}
              title={current?.album ?? ""}
            />
            <Maximize2 size={15} />
          </button>
          <div key={current?.id} className="player-track-info">
            <strong>{current?.title ?? tr("Dale play a tu espacio")}</strong>
            <small>
              {current?.artist ?? tr("Tu m\u00FAsica, siempre contigo")}
            </small>
          </div>
          {current && (
            <IconButton
              label={
                current.favorite
                  ? tr("Quitar de favoritas")
                  : tr("Guardar en favoritas")
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
              label={tr("Alternar aleatorio")}
              active={settings.shuffle !== "off"}
              onClick={() => {
                const shuffle = settings.shuffle === "off" ? "varied" : "off";
                setSettings((s) => ({
                  ...s,
                  shuffle,
                  queue: shuffleQueue(s.queue, shuffle, tracks),
                }));
              }}
            >
              <Shuffle size={17} />
            </IconButton>
            <IconButton
              label={tr("Anterior")}
              disabled={!current}
              onClick={back}
            >
              <SkipBack size={19} fill="currentColor" />
            </IconButton>
            <button
              className="play-main"
              aria-label={playing ? tr("Pausar") : tr("Reproducir")}
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
              label={tr("Siguiente")}
              disabled={
                !current ||
                (!settings.queue.upcoming.length && settings.repeat !== "all")
              }
              onClick={() => advance()}
            >
              <SkipForward size={19} fill="currentColor" />
            </IconButton>
            <IconButton
              label={tr("Repetir: {p0}", {
                p0:
                  settings.repeat === "off"
                    ? tr("desactivado")
                    : settings.repeat === "one"
                      ? tr("una canci\u00F3n")
                      : tr("todo"),
              })}
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
          <SeekControl
            duration={current?.duration ?? 0}
            enabled={!!current}
            seek={seek}
          />
        </div>
        <div className="player-extras">
          <IconButton
            label={focusView ? tr("Volver a biblioteca") : tr("Vista grande")}
            active={!!focusView}
            disabled={!current}
            onClick={() => setFocusView(focusView ? null : "lyrics")}
          >
            <Maximize2 size={18} />
          </IconButton>
          {current && (
            <span className="player-quality">
              {current.format}
              {current.bitDepth ? (
                <small>
                  {current.bitDepth}
                  {tr(" bit \u00B7")}{" "}
                  {((current.sampleRate ?? 44100) / 1000).toFixed(1)}
                  {tr(" kHz")}
                </small>
              ) : null}
            </span>
          )}
          <IconButton
            label={tr("Mostrar letra")}
            active={
              focusView
                ? focusView === "lyrics"
                : panel === "lyrics" && (!showHome || homePanel)
            }
            onClick={() => {
              if (focusView) setFocusView("lyrics");
              else if (showHome) {
                setHomePanel(!(homePanel && panel === "lyrics"));
                setPanel("lyrics");
              } else setPanel(panel === "lyrics" ? null : "lyrics");
            }}
          >
            <Mic2 size={18} />
          </IconButton>
          <IconButton
            label={tr("Mostrar cola")}
            active={!focusView && panel === "queue" && (!showHome || homePanel)}
            onClick={() => {
              if (showHome && !focusView) {
                setHomePanel(!(homePanel && panel === "queue"));
                setPanel("queue");
              } else {
                setHomePanel(true);
                setPanel(
                  focusView ? "queue" : panel === "queue" ? null : "queue",
                );
              }
              setFocusView(null);
            }}
          >
            <ListMusic size={19} />
          </IconButton>
          <VolumeControl
            value={settings.volume}
            step={settings.player.volumeStep}
            change={changeVolume}
          />
        </div>
      </footer>
      {menu && byId.get(menu.id) && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          scale={settings.uiScale}
          close={() => setMenu(null)}
        >
          {menu.ids.length === 1 ? (
            <>
              <strong>
                {byId.get(menu.id)!.title}
                <small>{byId.get(menu.id)!.artist}</small>
              </strong>
              <button
                role="menuitem"
                onClick={() => {
                  playTrack(byId.get(menu.id)!);
                  setMenu(null);
                }}
              >
                <Play size={15} />
                {tr(" Reproducir ahora")}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  void favorite(byId.get(menu.id)!);
                  setMenu(null);
                }}
              >
                <Heart size={15} />{" "}
                {byId.get(menu.id)!.favorite
                  ? tr("Quitar de Me gusta")
                  : tr("Guardar en Me gusta")}
              </button>
              <button role="menuitem" onClick={() => enqueue(menu.id)}>
                <SkipForward size={15} />
                {tr("Añadir a la cola")}
              </button>

              <button
                role="menuitem"
                onClick={() => {
                  setModal({ type: "add", ids: [menu.id] });
                  setMenu(null);
                }}
              >
                <Plus size={15} />
                {tr(" A\u00F1adir a playlist")}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setModal({ type: "track", track: { ...byId.get(menu.id)! } });
                  setMenu(null);
                }}
              >
                <Settings2 size={15} />
                {tr(" Editar informaci\u00F3n y portada")}
              </button>
              <button
                role="menuitem"
                onClick={async () => {
                  const id = menu.id;
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
                <Mic2 size={15} />
                {tr(" Editar letra")}
              </button>
              {selectedPlaylist && menu.playlistId === selectedPlaylist.id && (
                <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      movePlaylist(menu.id, -1);
                      setMenu(null);
                    }}
                  >
                    {tr("Subir en la playlist")}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      movePlaylist(menu.id, 1);
                      setMenu(null);
                    }}
                  >
                    {tr("Bajar en la playlist")}
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
                                trackIds: p.trackIds.filter(
                                  (id) => id !== menu.id,
                                ),
                              }
                            : p,
                        ),
                      }));
                      setMenu(null);
                    }}
                  >
                    {tr("Quitar de esta playlist")}
                  </button>
                </>
              )}
              <button
                className="danger"
                role="menuitem"
                onClick={() => {
                  setModal({ type: "remove", track: byId.get(menu.id)! });
                  setMenu(null);
                }}
              >
                {tr("Quitar de la biblioteca\u2026")}
              </button>
            </>
          ) : (
            <>
              <strong>
                {menu.ids.length}
                {tr(" canciones seleccionadas")}
                <small>{tr("Acciones para toda la selecci\u00F3n")}</small>
              </strong>
              <button
                role="menuitem"
                onClick={() => {
                  void playQueue(
                    startQueue(menu.ids, menu.ids[0], settings.shuffle, tracks),
                  );
                  setMenu(null);
                }}
              >
                <Play size={15} />
                {tr("Reproducir selecci\u00F3n")}
              </button>
              <button role="menuitem" onClick={() => enqueue(menu.ids)}>
                {tr("Añadir a la cola")}
              </button>

              <button
                role="menuitem"
                onClick={() => {
                  setModal({ type: "add", ids: menu.ids });
                  setMenu(null);
                }}
              >
                {tr("A\u00F1adir a playlist")}
              </button>
              {selectedPlaylist && menu.playlistId === selectedPlaylist.id && (
                <button
                  role="menuitem"
                  onClick={() => {
                    const ids = new Set(menu.ids);
                    setSettings((s) => ({
                      ...s,
                      playlists: s.playlists.map((p) =>
                        p.id === selectedPlaylist.id
                          ? {
                              ...p,
                              trackIds: p.trackIds.filter((id) => !ids.has(id)),
                            }
                          : p,
                      ),
                    }));
                    setSelection(new Set());
                    setMenu(null);
                  }}
                >
                  {tr("Quitar de esta playlist")}
                </button>
              )}
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  setModal({
                    type: "removeMany",
                    tracks: menu.ids
                      .map((id) => byId.get(id))
                      .filter((t): t is Track => !!t),
                  });
                  setMenu(null);
                }}
              >
                {tr("Quitar selecci\u00F3n de la biblioteca\u2026")}
              </button>
            </>
          )}
        </ContextMenu>
      )}
      {showStats && (
        <ListeningDialog tracks={tracks} close={() => setShowStats(false)} />
      )}
      {modal && (
        <Editor
          modal={modal}
          settings={settings}
          presence={presence}
          setSettings={setSettings}
          onClose={() => setModal(null)}
          openPlaylist={(id) => navigate(id ? `playlist:${id}` : "home")}
          resumePhone={(id, position) => {
            if (!byId.has(id)) {
              setNotice(tr("La canción ya no está en tu biblioteca."));
              return;
            }
            const context = collectionTracks(tracks, settings.playlists, {
              view: "library",
              query: "",
              filter: "all",
              sort,
            });
            void playQueue(
              {
                ...startQueue(
                  context.map((t) => t.id),
                  id,
                  settings.shuffle,
                  tracks,
                ),
                source: {
                  view: "library",
                  query: "",
                  filter: "all",
                  sort,
                },
              },
              position,
            );
            setModal(null);
          }}
          lyricTrack={modal.type === "lyrics" ? byId.get(modal.id) : undefined}
          lyricActive={modal.type === "lyrics" && modal.id === current?.id}
          lyricPlaying={playing}
          toggleLyrics={() => {
            if (modal.type !== "lyrics") return;
            if (modal.id === current?.id) void togglePlay();
            else
              void playQueue(startQueue([modal.id], modal.id, "off", tracks));
          }}
          seekLyrics={seek}
          changeTrack={changeTrack}
          deleteTrack={deleteTrack}
          deleteTracks={deleteTracks}
          onLyrics={async (id, text) => {
            await api.saveLyrics(
              id,
              text,
              modal.type === "lyrics" ? modal.text : undefined,
            );
            if (id === settings.queue.current) setLyrics(text);
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <IconButton label={tr("Cerrar aviso")} onClick={() => setNotice("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
function Editor({
  modal,
  presence,
  settings,
  setSettings,
  onClose,
  changeTrack,
  deleteTrack,
  deleteTracks,
  onLyrics,
  lyricTrack,
  lyricActive,
  lyricPlaying,
  toggleLyrics,
  seekLyrics,
  openPlaylist,
  resumePhone,
}: {
  modal: NonNullable<Modal>;
  presence: api.PresenceStatus;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  onClose: () => void;
  changeTrack: (t: Track) => Promise<void>;
  deleteTrack: (t: Track) => Promise<void>;
  deleteTracks: (ids: string[]) => Promise<void>;
  onLyrics: (id: string, text: string) => Promise<void>;
  lyricTrack: Track | undefined;
  lyricActive: boolean;
  lyricPlaying: boolean;
  toggleLyrics: () => void;
  seekLyrics: (position: number) => void;
  openPlaylist: (id: string) => void;
  resumePhone: (id: string, position: number) => void;
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
  const [lyricError, setLyricError] = useState("");
  useEffect(() => {
    if (!lyricError) setError("");
  }, [lyricError]);
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
          throw new Error(tr("Escribe el t\u00EDtulo de la canci\u00F3n."));
        await changeTrack({ ...track, title: track.title.trim() });
      }
      if (playlist) {
        if (!playlist.name.trim())
          throw new Error(tr("Escribe un nombre para la playlist."));
        const updated = { ...playlist, name: playlist.name.trim() };
        setSettings((s) => ({
          ...s,
          playlists: s.playlists.some((p) => p.id === updated.id)
            ? s.playlists.map((p) => (p.id === updated.id ? updated : p))
            : [...s.playlists, updated],
        }));
      }
      if (playlist) openPlaylist(playlist.id);
      if (modal.type === "lyrics") {
        if (lyricError) throw new Error(lyricError);
        await onLyrics(modal.id, text);
      }
      if (modal.type === "remove") await deleteTrack(modal.track);
      if (modal.type === "removeMany")
        await deleteTracks(modal.tracks.map((t) => t.id));
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  const title =
    modal.type === "settings"
      ? tr("Hazlo tuyo")
      : modal.type === "track"
        ? tr("Los detalles tambi\u00E9n suenan")
        : modal.type === "playlist"
          ? settings.playlists.some((p) => p.id === modal.playlist.id)
            ? tr("Editar playlist")
            : tr("Una playlist, mil momentos")
          : modal.type === "lyrics"
            ? tr("Palabra por palabra")
            : modal.type === "remove" || modal.type === "removeMany"
              ? tr("Quitar de tu biblioteca")
              : tr("Elige su pr\u00F3ximo lugar");
  return (
    <dialog
      ref={dialog}
      className={`editor ${settings.appearance.theme} ${modal.type === "lyrics" ? "editor-lyrics" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current && !saving) onClose();
      }}
    >
      <form onSubmit={save}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{tr("GLASS MUSIC")}</span>
            <h2>{title}</h2>
          </div>
          <IconButton
            label={tr("Cerrar")}
            type="button"
            disabled={saving}
            onClick={onClose}
          >
            <X size={20} />
          </IconButton>
        </div>
        {modal.type === "settings" && (
          <SettingsPanel
            settings={settings}
            setSettings={setSettings}
            photo={() => image("profile")}
            presence={presence}
            resumePhone={resumePhone}
          />
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
                  {tr("Cambiar portada")}
                </button>
                <p>{tr("PNG, JPG o WebP \u00B7 hasta 20 MB")}</p>
              </div>
            </div>
            <label>
              {tr("T\u00EDtulo")}
              <input
                maxLength={500}
                value={track.title}
                onChange={(e) => setTrack({ ...track, title: e.target.value })}
              />
            </label>
            <div className="form-grid">
              <label>
                {tr("Artista")}
                <input
                  maxLength={500}
                  value={track.artist}
                  onChange={(e) =>
                    setTrack({ ...track, artist: e.target.value })
                  }
                />
              </label>
              <label>
                {tr("Artistas invitados")}
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
              {tr("\u00C1lbum")}
              <input
                maxLength={500}
                value={track.album}
                onChange={(e) => setTrack({ ...track, album: e.target.value })}
              />
            </label>
            <p className="privacy-note">
              {tr(
                "Se guarda en la biblioteca. El archivo original conserva sus etiquetas.",
              )}
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
                {tr("Elegir portada")}
              </button>
            </div>
            <label>
              {tr("Nombre de la playlist")}
              <input
                autoFocus
                maxLength={100}
                value={playlist.name}
                onChange={(e) =>
                  setPlaylist({ ...playlist, name: e.target.value })
                }
                placeholder={tr("Para manejar de noche\u2026")}
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
                    recentPlaylists: s.recentPlaylists.filter(
                      (id) => id !== playlist.id,
                    ),
                  }));
                  openPlaylist("");
                  onClose();
                }}
              >
                {tr("Eliminar playlist (conserva tus canciones)")}
              </button>
            )}
          </>
        )}
        {modal.type === "lyrics" && (
          <LyricsEditor
            text={text}
            setText={setText}
            active={lyricActive}
            playing={lyricPlaying}
            duration={lyricTrack?.duration ?? 0}
            title={lyricTrack?.title ?? tr("Letra de la canci\u00F3n")}
            trackId={modal.id}
            toggle={toggleLyrics}
            seek={seekLyrics}
            validate={setLyricError}
          />
        )}
        {modal.type === "remove" && (
          <p className="modal-description">
            {tr("Se quitar\u00E1 \u00AB")}
            {modal.track.title}
            {tr(
              "\u00BB de la biblioteca, playlists y cola. Tu archivo de m\u00FAsica permanecer\u00E1 en su carpeta.",
            )}
          </p>
        )}
        {modal.type === "removeMany" && (
          <div className="bulk-remove">
            <p>
              {tr("Se quitar\u00E1n ")}
              {modal.tracks.length}
              {tr(" canciones de la biblioteca, las playlists y la cola.")}{" "}
              <strong>
                {tr(
                  "Los archivos de m\u00FAsica permanecer\u00E1n en sus carpetas.",
                )}
              </strong>
            </p>
            <ul>
              {modal.tracks.slice(0, 5).map((t) => (
                <li key={t.id}>
                  {t.title} · {t.artist}
                </li>
              ))}
            </ul>
            {modal.tracks.length > 5 && (
              <small>
                {tr("Y ")}
                {modal.tracks.length - 5}
                {tr(" canciones m\u00E1s.")}
              </small>
            )}
          </div>
        )}
        {modal.type === "add" && (
          <div className="add-playlist-list">
            {settings.playlists.length ? (
              settings.playlists.map((p) => (
                <button
                  key={p.id}
                  aria-label={p.name}
                  type="button"
                  onClick={() => {
                    setSettings((s) => ({
                      ...s,
                      playlists: s.playlists.map((item) =>
                        item.id === p.id
                          ? {
                              ...item,
                              trackIds: [
                                ...new Set([...item.trackIds, ...modal.ids]),
                              ],
                            }
                          : item,
                      ),
                    }));
                    onClose();
                  }}
                >
                  <Cover cover={p.cover} title={p.name} />
                  <span>
                    {p.name}
                    <small>
                      {p.trackIds.length}
                      {tr(" canciones")}
                    </small>
                  </span>
                  {modal.ids.every((id) => p.trackIds.includes(id)) ? (
                    <Check size={18} />
                  ) : (
                    <Plus size={18} />
                  )}
                </button>
              ))
            ) : (
              <p>
                {tr(
                  "Crea primero una playlist desde el bot\u00F3n + de la barra lateral.",
                )}
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
              ? tr("Los cambios se guardan autom\u00E1ticamente")
              : ""}
          </span>
          {(modal.type === "remove" ||
            modal.type === "removeMany" ||
            modal.type === "lyrics") && (
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={onClose}
            >
              {tr("Cancelar")}
            </button>
          )}
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
                ? tr("Listo")
                : modal.type === "removeMany"
                  ? tr("Quitar {p0} canciones", {
                      p0: modal.tracks.length,
                    })
                  : modal.type === "remove"
                    ? tr("Quitar")
                    : tr("Guardar")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
