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
import { useMarqueeSelection } from "./useMarqueeSelection";
import { useDiscordPresence } from "./useDiscordPresence";
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
  | { type: "settings" }
  | { type: "track"; track: Track }
  | { type: "playlist"; playlist: Playlist }
  | { type: "lyrics"; id: string; text: string }
  | { type: "add"; ids: string[] }
  | { type: "remove"; track: Track }
  | { type: "removeMany"; tracks: Track[] }
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
    [panel, setPanel] = useState<"lyrics" | "queue" | null>("lyrics");
  const [transportRevision, setTransportRevision] = useState(0);
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
  }, [panel, focusView, ready]);
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
      setTransportRevision((n) => n + 1);
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
      queue = nextQueue({ ...s.queue, upcoming });
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
  function enqueue(value: string | string[], first: boolean) {
    const ids = typeof value === "string" ? [value] : value;
    setSettings((s) => ({
      ...s,
      queue: {
        ...s.queue,
        upcoming: first
          ? [...ids, ...s.queue.upcoming]
          : [...s.queue.upcoming, ...ids],
      },
    }));
    setMenu(null);
    setNotice(first ? "Sonará después" : "Añadida al final de la cola");
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
  function droppedTrack(
    e: DragEvent<HTMLElement>,
  ): { id: string; ids: string[]; playlistId?: string } | null {
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
      setNotice(`Ya está${ids.length > 1 ? "n" : ""} en «${playlist.name}»`);
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
        ? `Añadida a «${playlist.name}»`
        : `${added.length} canciones añadidas a «${playlist.name}»`,
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
    setSettings((s) => {
      const upcoming = [...s.queue.upcoming];
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= upcoming.length ||
        destination < 0 ||
        destination >= upcoming.length
      )
        return s;
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
  async function deleteTracks(ids: string[]) {
    if (busy.current)
      throw new Error("Espera a que termine el cambio de canción.");
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
      queue: {
        current: removed.has(s.queue.current ?? "") ? null : s.queue.current,
        upcoming: s.queue.upcoming.filter((id) => !removed.has(id)),
        history: s.queue.history.filter((id) => !removed.has(id)),
        context: s.queue.context.filter((id) => !removed.has(id)),
      },
    }));
  }
  async function deleteTrack(track: Track) {
    await deleteTracks([track.id]);
  }
  const style = {
    "--ui-scale": settings.uiScale,
    "--accent": settings.appearance.accent,
    "--blur": `${settings.appearance.reduced || settings.performance === "economy" ? 0 : Math.min(settings.appearance.glass, settings.performance === "quality" ? 32 : 12)}px`,
    "--surface-alpha": settings.appearance.opacity / 100,
    "--lyrics-scale": settings.appearance.lyricScale,
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
                onClick={() => setView(`playlist:${p.id}`)}
              >
                <Cover cover={p.cover} title={p.name} />
                <span>
                  {p.name}
                  <small>{p.trackIds.length} canciones</small>
                </span>
                {dropTarget === p.id && (
                  <Plus size={16} className="drop-plus" />
                )}
              </button>
            ))
          ) : (
            <p>
              Organiza tu música.
              <br />
              <button className="text-button" onClick={newPlaylist}>
                Crea tu primera playlist <Plus size={13} />
              </button>
            </p>
          )}
        </div>
        <div className="sidebar-footer">
          <div className="local-status">
            {dragging ? (
              <>
                <Plus size={13} /> Suelta en una playlist
              </>
            ) : (
              <>
                <i /> Música local
              </>
            )}
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
            <span>Biblioteca local</span>
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
                ? "PLAYLIST"
                : view === "favorites"
                  ? "TUS IMPRESCINDIBLES"
                  : "TU COLECCIÓN"}
            </div>
            <h1>{title}</h1>
            <p>
              {visibleTracks.length
                ? `${visibleTracks.length} canciones · ${Math.floor(totalDuration / 60)} min de música`
                : "Todo lo que quieres escuchar, en un solo lugar."}
            </p>
            <div className="hero-actions">
              <button
                className="primary"
                disabled={!visibleTracks.length}
                onClick={() => visibleTracks[0] && playTrack(visibleTracks[0])}
              >
                <Play size={16} fill="currentColor" /> Reproducir
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
                  <Settings2 size={16} /> Editar playlist
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
          {!selectedPlaylist && (
            <div className="hero-note">
              <Disc3 size={26} />
              <span>
                Tu música.
                <br />
                <strong>Sin distracciones.</strong>
              </span>
            </div>
          )}
        </section>
        <section className="collection" key={view}>
          <div className="section-heading">
            <div>
              <h2>Canciones</h2>
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
          {visibleTracks.length > 0 && (
            <div className="selection-bar" role="status">
              <span>
                {selectedTracks.length
                  ? `${selectedTracks.length} seleccionada${selectedTracks.length === 1 ? "" : "s"}`
                  : "Ctrl + clic · Shift + clic · Arrastra para seleccionar"}
              </span>
              <button
                disabled={!selectedTracks.length}
                onClick={() => setModal({ type: "add", ids: selectedIds })}
              >
                Añadir a playlist
              </button>
              <button
                disabled={!selectedTracks.length}
                onClick={() => enqueue(selectedIds, false)}
              >
                Añadir a cola
              </button>
              <button
                disabled={!selectedTracks.length}
                className="danger"
                onClick={() =>
                  setModal({ type: "removeMany", tracks: selectedTracks })
                }
              >
                Eliminar
              </button>
              <button
                disabled={!selectedTracks.length}
                aria-label="Limpiar selección"
                onClick={() => setSelection(new Set())}
              >
                <X size={14} />
              </button>
            </div>
          )}
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
                                  if (p.id !== selectedPlaylist.id) return p;
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
                            } else addToPlaylist(selectedPlaylist.id, data.ids);
                          }
                          endDrag();
                        }}
                        style={{
                          position: "absolute",
                          top: index * 68,
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
                          aria-pressed={selection.has(track.id)}
                          onClick={(e) => selectTrack(e, track.id)}
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
                    ? "Arrastra canciones al nombre de esta playlist en la barra lateral o usa «Añadir a playlist»."
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
      {panel && !focusView && (
        <aside className="right-panel glass" key={panel}>
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
            {panel === "lyrics" && (
              <IconButton
                label="Ampliar letra"
                disabled={!current}
                onClick={() => setFocusView("lyrics")}
              >
                <Maximize2 size={16} />
              </IconButton>
            )}
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
          aria-label="Mostrar controles de reproducción"
          title="Acerca el mouse para mostrar el reproductor"
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
            aria-label="Ampliar portada"
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
          <SeekControl
            duration={current?.duration ?? 0}
            enabled={!!current}
            seek={seek}
          />
        </div>
        <div className="player-extras">
          <IconButton
            label={focusView ? "Volver a biblioteca" : "Vista grande"}
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
                  {current.bitDepth} bit ·{" "}
                  {((current.sampleRate ?? 44100) / 1000).toFixed(1)} kHz
                </small>
              ) : null}
            </span>
          )}
          <IconButton
            label="Mostrar letra"
            active={focusView ? focusView === "lyrics" : panel === "lyrics"}
            onClick={() => {
              if (focusView) setFocusView("lyrics");
              else setPanel(panel === "lyrics" ? null : "lyrics");
            }}
          >
            <Mic2 size={18} />
          </IconButton>
          <IconButton
            label="Mostrar cola"
            active={!focusView && panel === "queue"}
            onClick={() => {
              setPanel(
                focusView ? "queue" : panel === "queue" ? null : "queue",
              );
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
                <Play size={15} /> Reproducir ahora
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
                  ? "Quitar de Me gusta"
                  : "Guardar en Me gusta"}
              </button>
              <button role="menuitem" onClick={() => enqueue(menu.id, true)}>
                <SkipForward size={15} /> Reproducir después
              </button>
              <button role="menuitem" onClick={() => enqueue(menu.id, false)}>
                <ListMusic size={15} /> Agregar al final de la cola
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setModal({ type: "add", ids: [menu.id] });
                  setMenu(null);
                }}
              >
                <Plus size={15} /> Añadir a playlist
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setModal({ type: "track", track: { ...byId.get(menu.id)! } });
                  setMenu(null);
                }}
              >
                <Settings2 size={15} /> Editar información y portada
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
                <Mic2 size={15} /> Editar letra
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
                    Subir en la playlist
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      movePlaylist(menu.id, 1);
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
                    Quitar de esta playlist
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
                Quitar de la biblioteca…
              </button>
            </>
          ) : (
            <>
              <strong>
                {menu.ids.length} canciones seleccionadas
                <small>Acciones para toda la selección</small>
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
                Reproducir selección
              </button>
              <button role="menuitem" onClick={() => enqueue(menu.ids, true)}>
                Reproducir después
              </button>
              <button role="menuitem" onClick={() => enqueue(menu.ids, false)}>
                Agregar al final de la cola
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setModal({ type: "add", ids: menu.ids });
                  setMenu(null);
                }}
              >
                Añadir a playlist
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
                  Quitar de esta playlist
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
                Quitar selección de la biblioteca…
              </button>
            </>
          )}
        </ContextMenu>
      )}
      {modal && (
        <Editor
          modal={modal}
          settings={settings}
          presence={presence}
          setSettings={setSettings}
          onClose={() => setModal(null)}
          changeTrack={changeTrack}
          deleteTrack={deleteTrack}
          deleteTracks={deleteTracks}
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
  presence,
  settings,
  setSettings,
  onClose,
  changeTrack,
  deleteTrack,
  deleteTracks,
  onLyrics,
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
      ? "Hazlo tuyo"
      : modal.type === "track"
        ? "Los detalles también suenan"
        : modal.type === "playlist"
          ? settings.playlists.some((p) => p.id === modal.playlist.id)
            ? "Editar playlist"
            : "Una playlist, mil momentos"
          : modal.type === "lyrics"
            ? "Palabra por palabra"
            : modal.type === "remove" || modal.type === "removeMany"
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
          <SettingsPanel
            settings={settings}
            setSettings={setSettings}
            photo={() => image("profile")}
            presence={presence}
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
        {modal.type === "removeMany" && (
          <div className="bulk-remove">
            <p>
              Se quitarán {modal.tracks.length} canciones de la biblioteca, las
              playlists y la cola.{" "}
              <strong>
                Los archivos de música permanecerán en sus carpetas.
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
              <small>Y {modal.tracks.length - 5} canciones más.</small>
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
                    <small>{p.trackIds.length} canciones</small>
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
          {(modal.type === "remove" || modal.type === "removeMany") && (
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={onClose}
            >
              Cancelar
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
                ? "Listo"
                : modal.type === "removeMany"
                  ? `Quitar ${modal.tracks.length} canciones`
                  : modal.type === "remove"
                    ? "Quitar"
                    : "Guardar"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
