import { useEffect, useState } from "react";
import type { LyricLine } from "./queue";
function ActiveWords({
  line,
  position,
  playing,
  active,
}: {
  line: LyricLine;
  position: number;
  playing: boolean;
  active: boolean;
}) {
  const [word, setWord] = useState(-1);
  useEffect(() => {
    const words = line.words;
    if (!active || !words?.length) {
      setWord(-1);
      return;
    }
    const anchor = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const now =
        position + (playing ? (performance.now() - anchor) / 1000 : 0);
      const next = words.findIndex((w) => w.time > now);
      setWord(next < 0 ? words.length - 1 : next - 1);
      if (playing && next >= 0)
        timer = setTimeout(
          update,
          Math.max(16, (words[next].time - now) * 1000 + 5),
        );
    };
    update();
    return () => clearTimeout(timer);
  }, [line, position, playing, active]);
  if (!line.words?.length || !active) return <>{line.text || "♪"}</>;
  return (
    <>
      {line.words.map((part, i) => (
        <span key={i} className={i <= word ? "lyric-word sung" : "lyric-word"}>
          {part.text}
          {i < line.words!.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

// Only the active line mounts a word timer. Other lines are plain text.
export function LyricContent(props: Parameters<typeof ActiveWords>[0]) {
  if (!props.active || !props.line.words?.length)
    return <>{props.line.text || "♪"}</>;
  return <ActiveWords {...props} />;
}
