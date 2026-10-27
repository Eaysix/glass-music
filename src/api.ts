import { invoke, convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AudioStatus, ImportReport, Settings, Track } from "./types";
import { defaults } from "./types";
export const native = isTauri();

// Browser adapter is for local development. The Windows app stores paths, never audio blobs.
let webDb: Promise<IDBDatabase> | undefined;
function db() {
  return (webDb ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("glass-music-dev", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("data");
      req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
async function read<T>(store: string, key: string): Promise<T | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const r = database.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function write(store: string, key: string, value: unknown) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export const loadSettings = async (): Promise<Settings> => {
  const saved = native
    ? await invoke<Partial<Settings> | null>("load_settings")
    : await read<Partial<Settings>>("data", "settings");
  const base = defaults();
  return {
    ...base,
    ...saved,
    profile: { ...base.profile, ...saved?.profile },
    appearance: {
      ...base.appearance,
      ...saved?.appearance,
      accent: saved?.appearanceVersion
        ? (saved.appearance?.accent ?? base.appearance.accent)
        : base.appearance.accent,
    },
    appearanceVersion: 1,
    player: { ...base.player, ...saved?.player },
    discord: { ...base.discord, ...saved?.discord },
    queue: { ...base.queue, ...saved?.queue },
  };
};
export const saveSettings = (settings: Settings) =>
  native
    ? invoke<void>("save_settings", { settings })
    : write("data", "settings", settings);
export const loadLibrary = async (): Promise<Track[]> =>
  native
    ? invoke("load_library")
    : ((await read<Track[]>("data", "tracks")) ?? []);
export async function updateTrack(track: Track) {
  if (native) return invoke<void>("update_track", { track });
  const tracks = await loadLibrary();
  await write(
    "data",
    "tracks",
    tracks.map((t) => (t.id === track.id ? track : t)),
  );
}
export const getLyrics = async (id: string): Promise<string> =>
  native
    ? invoke("get_lyrics", { id })
    : ((await read<string>("data", `lyrics:${id}`)) ?? "");
export const saveLyrics = (id: string, lyrics: string) =>
  native
    ? invoke<void>("save_lyrics", { id, lyrics })
    : write("data", `lyrics:${id}`, lyrics);
export async function removeTrack(id: string) {
  if (native) return invoke<void>("remove_track", { id });
  await write(
    "data",
    "tracks",
    (await loadLibrary()).filter((t) => t.id !== id),
  );
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(["files", "data"], "readwrite");
    tx.objectStore("files").delete(id);
    tx.objectStore("data").delete(`lyrics:${id}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export function pickFiles(
  accept: string,
  multiple = false,
  directory = false,
): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    if (directory) input.setAttribute("webkitdirectory", "");
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}
export async function importMusic(
  folder = false,
): Promise<ImportReport | null> {
  if (native) {
    const paths = await open({
      directory: folder,
      multiple: true,
      filters: folder
        ? undefined
        : [{ name: "Música FLAC y MP3", extensions: ["flac", "mp3"] }],
    });
    if (!paths) return null;
    return invoke("import_music", {
      paths: typeof paths === "string" ? [paths] : paths,
    });
  }
  const files = await pickFiles(
    ".flac,.mp3,audio/flac,audio/mpeg",
    true,
    folder,
  );
  if (!files.length) return null;
  const { parseBlob } = await import("music-metadata");
  const tracks = await loadLibrary(),
    report: ImportReport = {
      tracks: [],
      skipped: 0,
      existingIds: [],
      errors: [],
    };
  for (const file of files) {
    if (!/\.(flac|mp3)$/i.test(file.name)) {
      report.skipped++;
      continue;
    }
    const path = file.webkitRelativePath || file.name;
    const id = `${path}:${file.size}:${file.lastModified}`;
    if (tracks.some((t) => t.id === id)) {
      report.existingIds.push(id);
      report.skipped++;
      continue;
    }
    try {
      const { common, format } = await parseBlob(file);
      let cover: string | null = null;
      if (common.picture?.[0]) {
        const picture = common.picture[0];
        cover = await imageData(
          new Blob([new Uint8Array(picture.data)], { type: picture.format }),
        );
      }
      const track: Track = {
        id,
        path,
        title: common.title || file.name.replace(/\.[^.]+$/, ""),
        artist: common.artist || "Artista desconocido",
        album: common.album || "Sin álbum",
        feats: "",
        duration: format.duration ?? 0,
        format: /\.flac$/i.test(file.name) ? "FLAC" : "MP3",
        sampleRate: format.sampleRate ?? null,
        bitDepth: format.bitsPerSample ?? null,
        cover,
        favorite: false,
      };
      await write("files", id, file);
      const lyric = common.lyrics?.[0];
      const lyricText =
        lyric?.timeStampFormat === 2 && lyric.syncText?.length
          ? lyric.syncText
              .flatMap((line) => {
                if (line.timestamp === undefined) return [];
                const seconds = line.timestamp / 1000;
                return `[${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(3).padStart(6, "0")}] ${line.text}`;
              })
              .join("\n")
          : (lyric?.text ?? "");
      await saveLyrics(id, lyricText);
      tracks.push(track);
      report.tracks.push(track);
    } catch (error) {
      report.errors.push(`${file.name}: ${String(error)}`);
    }
  }
  await write("data", "tracks", tracks);
  return report;
}
function imageData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob),
      image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas"),
        ratio = Math.min(1, 512 / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      canvas
        .getContext("2d")!
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };
    image.src = url;
  });
}
export async function pickImage(): Promise<string | null> {
  if (native) {
    const path = await open({
      multiple: false,
      filters: [{ name: "Imagen", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (!path || typeof path !== "string") return null;
    return invoke("import_image", { path });
  }
  const [file] = await pickFiles("image/png,image/jpeg,image/webp");
  if (!file) return null;
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Elige una imagen de menos de 20 MB.");
  return imageData(file);
}
export async function pickLyrics(): Promise<string | null> {
  if (native) {
    const path = await open({
      multiple: false,
      filters: [{ name: "Letras", extensions: ["lrc", "txt"] }],
    });
    return typeof path === "string"
      ? invoke("read_lyrics_file", { path })
      : null;
  }
  const [file] = await pickFiles(".lrc,.txt");
  return file ? file.text() : null;
}
export const coverUrl = (path: string | null) =>
  path ? (native ? convertFileSrc(path) : path) : undefined;

const audio = new Audio();
audio.preload = "metadata";
let webId: string | null = null,
  blobUrl: string | null = null;
export async function audioCommand(
  action: string,
  trackId?: string | null,
  value?: number,
): Promise<AudioStatus> {
  if (native)
    return invoke("audio_command", {
      action,
      trackId: trackId ?? null,
      value: value ?? null,
    });
  if (action === "play" && trackId && trackId !== webId) {
    const file = await read<Blob>("files", trackId);
    if (!file) throw new Error("Archivo no disponible. Vuelve a importarlo.");
    audio.pause();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(file);
    audio.src = blobUrl;
    webId = trackId;
    audio.currentTime = value ?? 0;
    await audio.play();
  } else if (action === "play") {
    if (audio.ended) audio.currentTime = 0;
    await audio.play();
  } else if (action === "pause") audio.pause();
  else if (action === "seek") audio.currentTime = Math.max(0, value ?? 0);
  else if (action === "volume")
    audio.volume = Math.max(0, Math.min(1, value ?? 0.7));
  else if (action === "stop") {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    webId = null;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }
  return {
    trackId: webId,
    position: audio.currentTime || 0,
    playing: !!webId && !audio.paused && !audio.ended,
    ended: audio.ended,
  };
}

export interface PresenceStatus {
  state:
    | "disabled"
    | "needs-id"
    | "paused"
    | "connected"
    | "unavailable"
    | "browser";
  message: string;
}
export async function discordUpdate(
  config: Settings["discord"],
  trackId: string | null,
  playing: boolean,
  position: number,
): Promise<PresenceStatus> {
  if (!native)
    return {
      state: "browser",
      message:
        "La conexión con Discord está disponible en la aplicación de Windows.",
    };
  return invoke("discord_update", { config, trackId, playing, position });
}
export async function openDiscordPortal() {
  if (native) return invoke<void>("open_discord_portal");
  window.open(
    "https://discord.com/developers/applications",
    "_blank",
    "noopener,noreferrer",
  );
}

export async function removeTracks(ids: string[]) {
  if (native) return invoke<void>("remove_tracks", { ids });
  const removed = new Set(ids),
    tracks = (await loadLibrary()).filter((t) => !removed.has(t.id)),
    database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(["files", "data"], "readwrite");
    tx.objectStore("data").put(tracks, "tracks");
    for (const id of removed) {
      tx.objectStore("files").delete(id);
      tx.objectStore("data").delete(`lyrics:${id}`);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
