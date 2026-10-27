import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
type Box = { left: number; top: number; width: number; height: number };
type Drag = {
  pointerId: number;
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  moved: boolean;
  base: Set<string>;
};
export function useMarqueeSelection(
  ref: RefObject<HTMLDivElement | null>,
  ids: string[],
  selection: Set<string>,
  change: (ids: Set<string>) => void,
  scale: number,
) {
  const [box, setBox] = useState<Box | null>(null),
    drag = useRef<Drag | null>(null),
    frame = useRef<number | undefined>(undefined),
    suppress = useRef(false),
    latest = useRef({ ids, selection, change, scale });
  latest.current = { ids, selection, change, scale };
  const finish = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    drag.current = null;
    setBox(null);
  };
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );
  function update() {
    const d = drag.current,
      el = ref.current;
    if (!d || !el || !d.moved) return;
    const s = latest.current,
      r = el.getBoundingClientRect();
    const x = Math.max(
        0,
        Math.min(el.clientWidth, (d.clientX - r.left) / s.scale),
      ),
      y =
        el.scrollTop +
        Math.max(0, Math.min(el.clientHeight, (d.clientY - r.top) / s.scale)),
      top = Math.min(d.y, y),
      bottom = Math.max(d.y, y);
    setBox({
      left: Math.min(d.x, x),
      top,
      width: Math.abs(d.x - x),
      height: bottom - top,
    });
    const a = Math.max(0, Math.floor(top / 68)),
      b = Math.min(s.ids.length - 1, Math.floor(bottom / 68));
    s.change(new Set([...d.base, ...s.ids.slice(a, b + 1)]));
  }
  function scroll() {
    const d = drag.current,
      el = ref.current;
    if (!d || !el || !d.moved) return;
    const r = el.getBoundingClientRect(),
      edge = 24 * latest.current.scale,
      delta =
        d.clientY < r.top + edge ? -8 : d.clientY > r.bottom - edge ? 8 : 0;
    if (delta) {
      el.scrollTop += delta;
      update();
    }
    frame.current = requestAnimationFrame(scroll);
  }
  return {
    box,
    isSelecting: () => !!drag.current,
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      suppress.current = false;
      if (
        e.button !== 0 ||
        (e.target as HTMLElement).closest(
          "button,input,img,svg,[data-track-id]",
        )
      )
        return;
      const el = e.currentTarget,
        r = el.getBoundingClientRect(),
        s = latest.current;
      drag.current = {
        pointerId: e.pointerId,
        x: (e.clientX - r.left) / s.scale,
        y: el.scrollTop + (e.clientY - r.top) / s.scale,
        clientX: e.clientX,
        clientY: e.clientY,
        moved: false,
        base: new Set(e.ctrlKey || e.metaKey ? s.selection : []),
      };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      const d = drag.current;
      if (!d) return;
      d.clientX = e.clientX;
      d.clientY = e.clientY;
      const r = e.currentTarget.getBoundingClientRect();
      if (
        !d.moved &&
        Math.abs((e.clientX - r.left) / latest.current.scale - d.x) +
          Math.abs(
            e.currentTarget.scrollTop +
              (e.clientY - r.top) / latest.current.scale -
              d.y,
          ) >
          4
      ) {
        d.moved = true;
        frame.current = requestAnimationFrame(scroll);
      }
      update();
    },
    onPointerUp(e: PointerEvent<HTMLDivElement>) {
      const d = drag.current;
      if (!d) return;
      if (d.moved) update();
      else latest.current.change(d.base);
      suppress.current = true;
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
      finish();
    },
    onPointerCancel: finish,
    onClickCapture(e: MouseEvent<HTMLDivElement>) {
      if (suppress.current) {
        suppress.current = false;
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };
}
