export const DISCORD_APPLICATION_ID = ""; // Public application ID, never a token.
export interface Track {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  feats: string;
  duration: number;
  format: string;
  sampleRate: number | null;
  bitDepth: number | null;
  cover: string | null;
  favorite: boolean;
}
export interface Playlist {
  id: string;
  name: string;
  cover: string | null;
  trackIds: string[];
}
export type ShuffleMode = "off" | "random" | "varied";
export interface Queue {
  current: string | null;
  upcoming: string[];
  history: string[];
  context: string[];
}
export interface Settings {
  profile: { name: string; photo: string | null };
  appearance: {
    accent: string;
    glass: number;
    reduced: boolean;
    theme: "dark" | "light";
    animations: boolean;
    albumBackground: boolean;
    opacity: number;
    lyricScale: number;
  };
  player: { autoHide: boolean; volumeStep: number };
  performance: "balanced" | "quality" | "economy";
  discord: { enabled: boolean; applicationId: string; showAlbum: boolean };
  appearanceVersion: number;
  uiScale: number;
  playlists: Playlist[];
  queue: Queue;
  volume: number;
  shuffle: ShuffleMode;
  repeat: "off" | "all" | "one";
  position: number;
}
export interface AudioStatus {
  trackId: string | null;
  position: number;
  playing: boolean;
  ended: boolean;
}
export interface ImportReport {
  tracks: Track[];
  skipped: number;
  errors: string[];
}
export const defaults = (): Settings => ({
  profile: { name: "Mi espacio", photo: null },
  appearance: {
    accent: "#8CCDF3",
    glass: 20,
    reduced: false,
    theme: "dark",
    animations: true,
    albumBackground: true,
    opacity: 45,
    lyricScale: 1,
  },
  appearanceVersion: 1,
  uiScale: 1,
  player: { autoHide: true, volumeStep: 2 },
  performance: "balanced",
  discord: {
    enabled: false,
    applicationId: DISCORD_APPLICATION_ID,
    showAlbum: true,
  },
  playlists: [],
  queue: { current: null, upcoming: [], history: [], context: [] },
  volume: 0.7,
  shuffle: "varied",
  repeat: "off",
  position: 0,
});
