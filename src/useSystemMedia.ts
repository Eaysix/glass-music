import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { native } from "./api";
import type { Track } from "./types";
export type SystemControl = {
  action:
    | "play"
    | "pause"
    | "next"
    | "previous"
    | "stop"
    | "seek"
    | "forward"
    | "backward";
  position: number | null;
};
export function useSystemMedia(
  ready: boolean,
  track: Track | undefined,
  canNext: boolean,
  canPrevious: boolean,
  position: number,
  control: (event: SystemControl) => void,
  error: (message: string) => void,
) {
  const handler = useRef(control);
  handler.current = control;
  const report = useRef(error);
  report.current = error;
  useEffect(() => {
    if (!ready || !native) return;
    let alive = true;
    let stop: (() => void) | undefined;
    void listen<SystemControl>("media-control", (event) => {
      if (alive) handler.current(event.payload);
    })
      .then((unlisten) => {
        if (alive) stop = unlisten;
        else unlisten();
      })
      .catch((e) =>
        report.current(`No se activaron las teclas multimedia: ${e}`),
      );
    return () => {
      alive = false;
      stop?.();
    };
  }, [ready]);
  useEffect(() => {
    if (!ready || !native) return;
    let alive = true;
    void invoke("media_update", {
      trackId: track?.id ?? null,
      canNext,
      canPrevious,
      position,
    }).catch((e) => {
      if (alive) report.current(`Controles de Windows: ${e}`);
    });
    return () => {
      alive = false;
    };
  }, [
    ready,
    track?.id,
    track?.title,
    track?.artist,
    track?.album,
    track?.cover,
    track?.duration,
    canNext,
    canPrevious,
    position,
  ]);
}
