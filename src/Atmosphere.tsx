import { memo, useEffect, useRef } from "react";
import { coverUrl } from "./api";
// Prepare a small blurred texture once, avoiding full-window filter work.
export default memo(function Atmosphere({
  cover,
  className,
}: {
  cover: string;
  className: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const image = new Image();
    let alive = true;
    image.onload = () => {
      const ctx = alive ? ref.current?.getContext("2d") : null;
      if (!ctx) return;
      ctx.clearRect(0, 0, 32, 32);
      ctx.filter = "blur(5px)";
      ctx.drawImage(image, -12, -12, 56, 56);
    };
    image.src = coverUrl(cover)!;
    return () => {
      alive = false;
      image.onload = null;
    };
  }, [cover]);
  return (
    <canvas
      ref={ref}
      className={className}
      width={32}
      height={32}
      aria-hidden="true"
    />
  );
});
