import { useEffect, useMemo, useRef } from "react";
import { motion, Reorder, useDragControls } from "framer-motion";
import { Check, Heart, ListMusic, Loader2, Pencil, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIKED_SOURCE_ID, useLibraryStore } from "@/store/useLibraryStore";
import { countPending, useSessionStore } from "@/store/useSessionStore";
import { useUiStore } from "@/store/useUiStore";
import type { Target } from "@/types";

/** Hold this long (without moving) to pick a chip up. */
const HOLD_MS = 380;
/** Moving further than this before the hold completes = a scroll, not a drag. */
const SLOP_PX = 8;

/** Phone-width stand-in for the target rail: one tap files the current track,
 *  no hotkeys needed. Sits right above the player bar so the thumb reaches it,
 *  and carries the batch "Apply" that the desktop top bar shows. */
export function TargetStrip() {
  const targets = useLibraryStore((s) => s.targets);
  const reorderTargets = useLibraryStore((s) => s.reorderTargets);
  const batchMode = useLibraryStore((s) => s.settings.batchMode);
  const openSetup = useUiStore((s) => s.setSetupOpen);
  const membership = useSessionStore((s) => s.membership);
  const baseMembership = useSessionStore((s) => s.baseMembership);
  const applyPending = useSessionStore((s) => s.applyPending);
  const applying = useSessionStore((s) => s.applying);

  const pending = useMemo(
    () => countPending(baseMembership, membership, targets),
    [baseMembership, membership, targets],
  );

  return (
    <motion.nav
      // lets Reorder measure correctly while the strip is scrolled
      layoutScroll
      aria-label="Target playlists"
      className="scrollbar-none flex shrink-0 items-center gap-2 overflow-x-auto border-t border-border bg-card/80 px-3 py-2 backdrop-blur md:hidden"
    >
      {batchMode && pending > 0 && (
        <button
          type="button"
          onClick={() => void applyPending()}
          disabled={applying}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-70"
        >
          {applying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Apply {pending}
        </button>
      )}

      <Reorder.Group
        as="div"
        axis="x"
        values={targets}
        onReorder={reorderTargets}
        className="flex shrink-0 items-center gap-2"
      >
        {targets.map((tg) => (
          <TargetChip key={tg.id} tg={tg} />
        ))}
      </Reorder.Group>

      <button
        type="button"
        onClick={() => openSetup(true)}
        className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border px-4 text-sm text-muted-foreground"
      >
        <Pencil className="h-4 w-4" />
        {targets.length ? "Edit" : "Add targets"}
      </button>
    </motion.nav>
  );
}

/** One target. Tap files the current track; press and hold, then drag, to
 *  reorder — a sideways swipe without the hold still scrolls the strip. */
function TargetChip({ tg }: { tg: Target }) {
  const file = useSessionStore((s) => s.fileToTarget);
  const current = useSessionStore((s) => s.tracks[s.index] ?? null);
  const isIn = useSessionStore((s) =>
    current ? !!s.membership[tg.id]?.has(current.id) : false,
  );
  const controls = useDragControls();

  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const dragging = useRef(false);
  /** swallow the click that ends a drag */
  const justDragged = useRef(false);

  // once picked up, stop the page/strip from scrolling under the finger
  useEffect(() => {
    const block = (e: TouchEvent) => {
      if (dragging.current) e.preventDefault();
    };
    window.addEventListener("touchmove", block, { passive: false });
    return () => window.removeEventListener("touchmove", block);
  }, []);

  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const native = e.nativeEvent;
    cancelHold();
    hold.current = {
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        hold.current = null;
        dragging.current = true;
        navigator.vibrate?.(10);
        controls.start(native);
      }, HOLD_MS),
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const h = hold.current;
    if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > SLOP_PX) cancelHold();
  };

  const endPress = () => {
    cancelHold();
    if (dragging.current) {
      dragging.current = false;
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 350);
    }
  };

  return (
    <Reorder.Item
      as="div"
      value={tg}
      dragListener={false}
      dragControls={controls}
      onDragEnd={endPress}
      className="relative shrink-0"
      whileDrag={{ zIndex: 10 }}
    >
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (justDragged.current || dragging.current) return;
          void file(tg.key);
        }}
        disabled={!current}
        aria-pressed={isIn}
        className={cn(
          "flex h-11 max-w-[11rem] select-none items-center gap-2 rounded-full border border-border bg-secondary/60 pl-1.5 pr-3 text-sm transition-colors [-webkit-touch-callout:none] disabled:opacity-40",
          isIn && "border-success/40 bg-success/15",
        )}
      >
        {tg.imageUrl ? (
          <img
            src={tg.imageUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover drag-none"
            draggable={false}
          />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background/60">
            {tg.id === LIKED_SOURCE_ID ? (
              <Heart className="h-4 w-4 text-primary" />
            ) : (
              <ListMusic className="h-4 w-4 text-muted-foreground" />
            )}
          </span>
        )}
        <span className="truncate">{tg.name}</span>
        {isIn && <Check className="h-4 w-4 shrink-0 text-success" />}
      </button>
    </Reorder.Item>
  );
}
