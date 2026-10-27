import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Volume2, VolumeX, X } from "lucide-react";
export default function VolumeControl({
  value,
  change,
  step,
}: {
  value: number;
  change: (value: number) => void;
  step: number;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    last = useRef(value || 0.7),
    latest = useRef({ value, change, step });
  latest.current = { value, change, step };
  if (value > 0) last.current = value;
  useEffect(() => {
    const el = root.current!;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || !e.deltaY) return;
      e.preventDefault();
      const s = latest.current;
      s.change(
        Math.max(
          0,
          Math.min(1, s.value + ((e.deltaY < 0 ? 1 : -1) * s.step) / 100),
        ),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const percent = Math.round(value * 100),
    set = (n: number) => change(Math.max(0, Math.min(100, n)) / 100);
  return (
    <div
      className="volume-controls"
      ref={root}
      data-volume-open={open}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        className="icon-button"
        aria-label={value ? "Silenciar" : "Activar sonido"}
        title={value ? "Silenciar" : "Activar sonido"}
        onClick={() => change(value ? 0 : last.current)}
      >
        {value ? <Volume2 size={19} /> : <VolumeX size={19} />}
      </button>
      <input
        className="volume"
        aria-label="Volumen"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(e) => change(Number(e.target.value))}
      />
      <button
        className="volume-percent"
        aria-label="Ajustar volumen"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {percent}%
      </button>
      {open && (
        <div
          className="volume-popover glass"
          role="dialog"
          aria-label="Control de volumen"
        >
          <header>
            <strong>Volumen</strong>
            <button
              className="icon-button"
              aria-label="Cerrar volumen"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          <input
            aria-label="Volumen ampliado"
            type="range"
            min="0"
            max="100"
            step="1"
            value={percent}
            onChange={(e) => set(Number(e.target.value))}
          />
          <div className="volume-exact">
            <button
              aria-label="Bajar volumen"
              onClick={() => set(percent - step)}
            >
              <Minus size={18} />
            </button>
            <label>
              <input
                aria-label="Porcentaje de volumen"
                type="number"
                min="0"
                max="100"
                value={percent}
                onChange={(e) => {
                  if (e.target.value !== "") set(Number(e.target.value));
                }}
              />
              %
            </label>
            <button
              aria-label="Subir volumen"
              onClick={() => set(percent + step)}
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="volume-presets">
            {[25, 50, 75, 100].map((n) => (
              <button key={n} onClick={() => set(n)}>
                {n}%
              </button>
            ))}
          </div>
          <small>Rueda del mouse: pasos de {step}%</small>
        </div>
      )}
    </div>
  );
}
