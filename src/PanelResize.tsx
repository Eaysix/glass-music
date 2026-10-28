import { t } from "./i18n";
import { useRef } from "react";
export default function PanelResize({
  width,
  scale,
  change,
}: {
  width: number;
  scale: number;
  change: (width: number) => void;
}) {
  const drag = useRef<{
    x: number;
    width: number;
  } | null>(null);
  const set = (value: number) =>
    change(Math.max(260, Math.min(480, Math.round(value))));
  return (
    <div
      className="panel-resize"
      role="separator"
      tabIndex={0}
      aria-label={t("Ancho del panel de letras y cola")}
      aria-orientation="vertical"
      aria-valuemin={260}
      aria-valuemax={480}
      aria-valuenow={width}
      title={t(
        "Arrastra para ajustar el panel. Doble clic restablece el ancho.",
      )}
      onDoubleClick={() => set(320)}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          set(
            e.key === "Home"
              ? 260
              : e.key === "End"
                ? 480
                : width + (e.key === "ArrowLeft" ? 20 : -20),
          );
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current)
          set(drag.current.width - (e.clientX - drag.current.x) / scale);
      }}
      onPointerUp={(e) => {
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}
