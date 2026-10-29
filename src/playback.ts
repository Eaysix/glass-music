import { useCallback, useSyncExternalStore } from "react";
import { lyricIndex, type LyricLine } from "./queue";
let position = 0;
const listeners = new Set<() => void>();
export const subscribePosition = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getPosition = () => position;
export function setPosition(value: number) {
  const next = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (next === position) return;
  position = next;
  for (const listener of listeners) listener();
}
export const usePosition = () =>
  useSyncExternalStore(subscribePosition, getPosition);
export function useActiveLine(lines: LyricLine[]) {
  return useSyncExternalStore(
    subscribePosition,
    useCallback(() => lyricIndex(lines, position), [lines]),
  );
}
