import { t } from "./i18n";
import { useState } from "react";
import { usePosition } from "./playback";
import { timeLabel } from "./queue";
export default function SeekControl({
  duration,
  enabled,
  seek,
}: {
  duration: number;
  enabled: boolean;
  seek: (value: number) => void;
}) {
  const position = usePosition(),
    [scrub, setScrub] = useState<number | null>(null);
  const commit = (value: string) => {
    seek(Number(value));
    setScrub(null);
  };
  return (
    <div className="seek">
      <span>{timeLabel(position)}</span>
      <input
        aria-label={t("Posici\u00F3n de reproducci\u00F3n")}
        type="range"
        min="0"
        max={duration || 1}
        step="0.1"
        value={Math.min(scrub ?? position, duration || 1)}
        disabled={!enabled}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={(e) => commit(e.currentTarget.value)}
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
          )
            commit(e.currentTarget.value);
        }}
        onBlur={(e) => {
          if (scrub !== null) commit(e.currentTarget.value);
        }}
      />
      <span>{timeLabel(duration)}</span>
    </div>
  );
}
