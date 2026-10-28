import { useEffect, useState } from "react";
import * as api from "./api";
import { getPosition } from "./playback";
import type { Settings, Track } from "./types";
export function useDiscordPresence(
  ready: boolean,
  config: Settings["discord"],
  track: Track | undefined,
  playing: boolean,
  revision: number,
) {
  const [status, setStatus] = useState<api.PresenceStatus>({
    state: "disabled",
    message: "Actividad de Discord desactivada.",
  });
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = async () => {
      try {
        const result = await api.discordUpdate(
          config,
          track?.id ?? null,
          playing,
          getPosition(),
        );
        if (!alive) return;
        setStatus(result);
        if (
          api.native &&
          config.enabled &&
          config.applicationId &&
          playing &&
          (result.state === "unavailable" || result.state === "connected")
        )
          timer = setTimeout(update, 15000);
      } catch (e) {
        if (alive) setStatus({ state: "unavailable", message: String(e) });
      }
    };
    void update();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    ready,
    config.enabled,
    config.applicationId,
    config.showAlbum,
    track?.id,
    track?.title,
    track?.artist,
    track?.album,
    playing,
    revision,
  ]);
  return status;
}
