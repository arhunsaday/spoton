import { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { cn } from "@/lib/utils";

/** Max tilt in degrees. */
const TILT = 12;
const SPRING = { stiffness: 220, damping: 22, mass: 0.6 };

/** Album cover that tilts toward the pointer in 3D, with a glare following
 *  the cursor. The art itself never moves or crops inside the frame, so the
 *  whole cover stays visible. */
export function TiltCover({
  children,
  className,
  enabled = true,
}: {
  children: React.ReactNode;
  className?: string;
  enabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const live = enabled && !reduced;

  // pointer position over the cover, -0.5 … 0.5 on each axis
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const hover = useMotionValue(0);
  const x = useSpring(px, SPRING);
  const y = useSpring(py, SPRING);
  const h = useSpring(hover, SPRING);

  const rotateY = useTransform(x, [-0.5, 0.5], [-TILT, TILT]);
  const rotateX = useTransform(y, [-0.5, 0.5], [TILT, -TILT]);
  const scale = useTransform(h, [0, 1], [1, 1.03]);
  const glareX = useTransform(x, [-0.5, 0.5], [0, 100]);
  const glareY = useTransform(y, [-0.5, 0.5], [0, 100]);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255,255,255,0.35), rgba(255,255,255,0) 60%)`;

  const onMove = (e: React.PointerEvent) => {
    if (!live || e.pointerType === "touch" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
    hover.set(1);
  };
  const onLeave = () => {
    px.set(0);
    py.set(0);
    hover.set(0);
  };

  return (
    <div style={{ perspective: 900 }} className={className}>
      <motion.div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        style={
          live
            ? { rotateX, rotateY, scale, transformStyle: "preserve-3d", willChange: "transform" }
            : undefined
        }
        className={cn(
          "relative h-full w-full overflow-hidden rounded-2xl border border-white/10 shadow-[0_28px_90px_-28px_rgba(0,0,0,0.85)] outline outline-1 outline-transparent [backface-visibility:hidden]",
        )}
      >
        {children}
        {live && (
          <motion.div
            aria-hidden
            style={{ backgroundImage: glare, opacity: h }}
            className="pointer-events-none absolute inset-0 mix-blend-soft-light"
          />
        )}
      </motion.div>
    </div>
  );
}
