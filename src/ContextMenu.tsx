import { useLayoutEffect, useRef, type ReactNode } from "react";

/** A pointer-anchored menu with keyboard navigation and focus restoration. */
export default function ContextMenu({
  x,
  y,
  close,
  children,
}: {
  x: number;
  y: number;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const menu = ref.current!;
    const place = () => {
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(12, Math.min(x, innerWidth - rect.width - 12))}px`;
      menu.style.top = `${Math.max(12, Math.min(y, innerHeight - rect.height - 12))}px`;
    };
    place();
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("resize", close);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [x, y]);
  return (
    <div
      className="menu-backdrop"
      onPointerDown={close}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={ref}
        className="context-menu glass"
        role="menu"
        aria-label="Opciones de canción"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          const buttons = [
            ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]:not(:disabled)',
            ),
          ];
          const at = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          if (["Escape", "Tab"].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            buttons[
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? buttons.length - 1
                  : (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                    buttons.length
            ]?.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
