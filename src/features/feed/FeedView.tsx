import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "framer-motion";
import {
  Check,
  Heart,
  Loader2,
  Music2,
  SkipForward,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Vinyl } from "@/components/Vinyl";
import { coverUrl } from "@/lib/cover";
import { useLibraryStore } from "@/store/useLibraryStore";
import { useSessionStore } from "@/store/useSessionStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { useUiStore } from "@/store/useUiStore";
import { Spectrum } from "@/features/focus/Spectrum";
import type { SpotifyTrack } from "@/types";
import {
  commitSwipe,
  feedTarget,
  registerFeedControls,
  useFeedStore,
  type Side,
} from "./swipe";

/* TikTok-style deck: one track per screen. Drag up/down (or wheel, ↑/↓) to
 * page through the source; drag right/left (or →/←, or double-tap for right)
 * to file the track and move on.
 *
 * Gestures are hand-rolled on pointer events rather than framer's drag: one
 * pointer has to drive two different things (the column vertically, the top
 * card horizontally), with an axis lock decided by the first few pixels. */

/** Pointer travel before we decide which axis the gesture is on. */
const LOCK_PX = 10;
/** Velocity (px/ms) is projected this far ahead when judging a release. */
const PROJECT_MS = 160;
const DOUBLE_TAP_MS = 260;
const FLY = { duration: 0.26, ease: [0.32, 0.72, 0, 1] as const };
const PAGE = { type: "spring" as const, stiffness: 320, damping: 36, restDelta: 0.5 };
const SNAP = { type: "spring" as const, stiffness: 500, damping: 34 };

export function FeedView() {
  const tracks = useSessionStore((s) => s.tracks);
  const index = useSessionStore((s) => s.index);
  const status = useSessionStore((s) => s.status);
  const loaded = useSessionStore((s) => s.loaded);
  const total = useSessionStore((s) => s.total);
  const visualizer = useLibraryStore((s) => s.settings.visualizer !== false);
  const openSetup = useUiStore((s) => s.setSetupOpen);

  const feedTargetId = useLibraryStore((s) => s.feedTargetId);
  const loadFeedIds = useFeedStore((s) => s.load);
  const track = tracks[index] ?? null;
  const cover = coverUrl(track, 600);

  // what's already in the feed playlist, so a swipe never adds it twice
  useEffect(() => {
    if (feedTargetId) void loadFeedIds(feedTargetId);
  }, [feedTargetId, loadFeedIds]);

  // warm covers a few cards ahead: paging must never show an empty square
  useEffect(() => {
    for (const t of tracks.slice(index + 1, index + 5)) {
      const url = coverUrl(t, 600);
      if (url) new Image().src = url;
    }
  }, [tracks, index]);

  if (status === "loading" && tracks.length === 0) {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground tabnum">
          {total > 0 ? `Loading source… ${loaded} / ${total}` : "Loading source…"}
        </p>
      </Centered>
    );
  }
  if (!track) {
    return (
      <Centered>
        <Music2 className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {status === "ready" ? "Nothing to sort in this source." : "Pick a source to start swiping."}
        </p>
        <button
          type="button"
          onClick={() => openSetup(true, "playlists")}
          className="mt-2 h-11 rounded-full bg-secondary px-5 text-sm font-medium"
        >
          Choose a playlist to explore
        </button>
      </Centered>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Backdrop />
      {visualizer && <Spectrum coverUrl={cover} className="h-[14%] max-h-32" />}
      <Deck tracks={tracks} index={index} />
      {feedTargetId ? <Hint /> : <PickTarget />}
    </div>
  );
}

/* --------------------------------------------------------------- the deck */

function Deck({ tracks, index }: { tracks: SpotifyTrack[]; index: number }) {
  const box = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const dismissHint = useUiStore((s) => s.dismissFeedHint);

  // column offset: written straight to the DOM so a page turn can swap the
  // cards and reset the offset in the same frame (no flash of the wrong card)
  const colY = useMotionValue(0);
  useEffect(
    () =>
      colY.on("change", (v) => {
        if (column.current) column.current.style.transform = `translate3d(0,${v}px,0)`;
      }),
    [colY],
  );

  const cardX = useMotionValue(0);
  const enter = useMotionValue(1);

  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const [flash, setFlash] = useState<{ id: number; text: string; ok: boolean } | null>(null);

  // the confirmation lingers a moment, then leaves
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 1100);
    return () => window.clearTimeout(t);
  }, [flash]);

  const height = () => box.current?.clientHeight ?? window.innerHeight;
  const width = () => box.current?.clientWidth ?? window.innerWidth;

  const page = useCallback(
    (dir: 1 | -1) => {
      const s = useSessionStore.getState();
      const target = s.index + dir;
      if (busy.current) return;
      if (target < 0 || target >= s.tracks.length) {
        void animate(colY, 0, SNAP); // nothing there — settle back
        return;
      }
      busy.current = true;
      void animate(colY, -dir * height(), PAGE).then(() => {
        flushSync(() => (dir === 1 ? s.next() : s.prev()));
        colY.jump(0);
        busy.current = false;
      });
    },
    [colY],
  );

  const swipe = useCallback(
    (side: Side) => {
      if (busy.current || !useSessionStore.getState().current()) return;
      const target = feedTarget();
      if (side === "right" && !target) {
        // nowhere to add yet: bounce back and ask
        void animate(cardX, 0, SNAP);
        useUiStore.getState().setSetupOpen(true, "feed");
        return;
      }
      busy.current = true;
      dismissHint();
      navigator.vibrate?.(12);
      const dx = (side === "right" ? 1 : -1) * width() * 1.25;
      void animate(cardX, dx, FLY).then(() => {
        enter.jump(0.9);
        let result = "skipped";
        flushSync(() => {
          result = commitSwipe(side);
        });
        cardX.jump(0);
        void animate(enter, 1, SNAP);
        if (result === "added") setFlash({ id: Date.now(), text: target!.name, ok: true });
        else if (result === "already")
          setFlash({ id: Date.now(), text: `Already in ${target!.name}`, ok: false });
        busy.current = false;
      });
    },
    [cardX, enter, dismissHint],
  );

  // keyboard (and anything else) drives the same animations
  useEffect(() => {
    registerFeedControls({ swipe, page });
    return () => registerFeedControls(null);
  }, [swipe, page]);

  // a track change from outside (player bar, keys, undo) lands centred
  useLayoutEffect(() => {
    if (!busy.current) {
      colY.jump(0);
      cardX.jump(0);
    }
  }, [index, colY, cardX]);

  /* ---- pointer gestures ---- */
  const g = useRef<{
    id: number;
    x0: number;
    y0: number;
    axis: "x" | "y" | null;
    lx: number;
    ly: number;
    lt: number;
    vx: number;
    vy: number;
  } | null>(null);
  const lastTap = useRef(0);
  const tapTimer = useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy.current || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, lx: e.clientX, ly: e.clientY, lt: e.timeStamp, vx: 0, vy: 0 };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    const dt = Math.max(1, e.timeStamp - s.lt);
    s.vx = (e.clientX - s.lx) / dt;
    s.vy = (e.clientY - s.ly) / dt;
    s.lx = e.clientX;
    s.ly = e.clientY;
    s.lt = e.timeStamp;
    if (!s.axis) {
      if (Math.hypot(dx, dy) < LOCK_PX) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (s.axis === "x") cardX.set(dx);
    else {
      // rubber-band past either end of the source
      const st = useSessionStore.getState();
      const edge = (dy > 0 && st.index === 0) || (dy < 0 && st.index >= st.tracks.length - 1);
      colY.set(edge ? dy * 0.28 : dy);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = g.current;
    g.current = null;
    if (!s || s.id !== e.pointerId) return;
    if (!s.axis) return onTap(e);
    if (s.axis === "x") {
      const projected = e.clientX - s.x0 + s.vx * PROJECT_MS;
      const need = Math.min(130, width() * 0.28);
      if (projected > need) swipe("right");
      else if (projected < -need) swipe("left");
      else void animate(cardX, 0, SNAP);
    } else {
      const projected = e.clientY - s.y0 + s.vy * PROJECT_MS;
      const need = height() * 0.16;
      if (projected < -need) page(1);
      else if (projected > need) page(-1);
      else void animate(colY, 0, SNAP);
    }
  };

  const onPointerCancel = () => {
    g.current = null;
    void animate(cardX, 0, SNAP);
    void animate(colY, 0, SNAP);
  };

  /** single tap = play/pause, double tap = like (swipe right) with a heart */
  const onTap = (e: React.PointerEvent) => {
    const now = e.timeStamp;
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
      const r = box.current!.getBoundingClientRect();
      setHearts((h) => [...h, { id: now, x: e.clientX - r.left, y: e.clientY - r.top }]);
      swipe("right");
      return;
    }
    lastTap.current = now;
    tapTimer.current = window.setTimeout(() => {
      usePlayerStore.getState().toggle();
    }, DOUBLE_TAP_MS);
  };

  /* ---- wheel / trackpad ---- */
  const wheel = useRef({ acc: 0, until: 0 });
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const w = wheel.current;
    if (e.timeStamp < w.until) return; // one page per flick, not per event
    w.acc += e.deltaY;
    if (Math.abs(w.acc) > 60) {
      page(w.acc > 0 ? 1 : -1);
      w.acc = 0;
      w.until = e.timeStamp + 520;
    }
  };

  const slots = [-1, 0, 1]
    .map((o) => ({ o, t: tracks[index + o] }))
    .filter((s): s is { o: number; t: SpotifyTrack } => !!s.t);

  return (
    <div
      ref={box}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
      className="absolute inset-0 z-10 touch-none select-none overflow-hidden"
      aria-roledescription="swipe deck"
    >
      <div ref={column} className="absolute inset-0 will-change-transform">
        {slots.map(({ o, t }) => (
          <div
            key={t.id}
            className="absolute inset-0"
            style={{ transform: `translateY(${o * 100}%)` }}
            aria-hidden={o !== 0}
          >
            {/* same component in every slot: a card moving into the centre
                must keep its DOM (images, vinyl spin) — swapping component
                types would remount it and flash */}
            <DeckCard track={t} active={o === 0} x={cardX} enter={enter} />
          </div>
        ))}
      </div>

      {/* double-tap hearts */}
      <AnimatePresence>
        {hearts.map((h) => (
          <motion.div
            key={h.id}
            initial={{ scale: 0.2, opacity: 0, rotate: -15 }}
            animate={{ scale: [0.2, 1.25, 1], opacity: [0, 1, 1], rotate: [-15, 8, 0], y: [0, 0, -40] }}
            exit={{ opacity: 0, scale: 1.4, y: -90 }}
            transition={{ duration: 0.55 }}
            onAnimationComplete={() => setHearts((all) => all.filter((x) => x.id !== h.id))}
            className="pointer-events-none absolute z-30 -ml-12 -mt-12"
            style={{ left: h.x, top: h.y }}
          >
            <Heart className="h-24 w-24 fill-rose-500 text-rose-500 drop-shadow-[0_8px_24px_rgba(244,63,94,0.55)]" />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* what the swipe did */}
      <AnimatePresence>
        {flash && (
          <motion.div
            key={flash.id}
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "pointer-events-none absolute left-1/2 top-6 z-30 flex max-w-[80%] -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg backdrop-blur",
              flash.ok ? "bg-success/90 text-success-foreground" : "bg-secondary/90 text-foreground",
            )}
          >
            <Check className="h-4 w-4 shrink-0" />
            <span className="truncate">{flash.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* --------------------------------------------------------------- the cards */

/** A deck card. The active (centre) one follows the finger, tilts and
 *  stamps; the others sit still on their own resting motion values. */
function DeckCard({
  track,
  active,
  x: sharedX,
  enter: sharedEnter,
}: {
  track: SpotifyTrack;
  active: boolean;
  x: MotionValue<number>;
  enter: MotionValue<number>;
}) {
  const restX = useMotionValue(0);
  const restEnter = useMotionValue(1);
  const x = active ? sharedX : restX;
  const enter = active ? sharedEnter : restEnter;
  const rotate = useTransform(x, [-400, 0, 400], [-14, 0, 14]);
  const right = useTransform(x, [20, 120], [0, 1]);
  const left = useTransform(x, [-120, -20], [1, 0]);
  const opacity = useTransform(enter, [0.9, 1], [0, 1]);
  const target = feedTarget();
  const vinyl = useLibraryStore((s) => !!s.settings.vinyl);
  // vinyl: the stopped record already says "paused" — no button over the art
  const paused =
    usePlayerStore((s) => !s.playing && !s.buffering && s.previewVia !== "none") && !vinyl && active;

  return (
    <motion.div style={{ x, rotate, scale: enter, opacity }} className="h-full w-full origin-bottom">
      <Card track={track}>
        {active && <Stamp side="right" style={right} label={target?.name ?? "Pick a playlist"} />}
        {active && <Stamp side="left" style={left} label="Skip" />}
        <AnimatePresence>
          {paused && (
            <motion.span
              initial={{ opacity: 0, scale: 1.3 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.18 }}
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <Play className="h-16 w-16 fill-white/85 text-white/85 drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)]" />
            </motion.span>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

function Card({ track, children }: { track: SpotifyTrack; children?: React.ReactNode }) {
  const cover = coverUrl(track, 600);
  const inFeed = useFeedStore((s) => !!s.ids?.has(track.id));
  const vinyl = useLibraryStore((s) => !!s.settings.vinyl);
  // only the card on screen spins — its neighbours sit still
  const playing = usePlayerStore((s) => s.playing);
  const onScreen = useSessionStore((s) => s.tracks[s.index]?.id === track.id);
  const spinning = playing && onScreen;
  const check = inFeed && (
    <span
      title="Already in your feed playlist"
      // frosted, not a solid green blob: it's a hint, not an alert
      className="absolute right-2.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/30 text-success/90 shadow-sm backdrop-blur-md"
    >
      <Check className="h-3.5 w-3.5" strokeWidth={2.75} />
    </span>
  );

  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6 pb-10 pt-8">
      {vinyl ? (
        <div className="relative w-[min(100%,calc((100dvh-17rem)*1.5),840px)] min-w-[270px]">
          <Vinyl cover={cover} spinning={spinning}>
            {check}
            {children}
          </Vinyl>
        </div>
      ) : (
        <div className="relative aspect-square w-[min(100%,calc(100dvh-17rem),560px)] min-w-[180px] overflow-hidden rounded-3xl border border-white/10 shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)]">
          {cover ? (
            <img src={cover} alt="" draggable={false} className="h-full w-full object-cover drag-none" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-secondary">
              <Music2 className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
          {check}
          {children}
        </div>
      )}

      <div className="mt-6 w-full max-w-xl text-center">
        <h2 className="line-clamp-2 text-balance text-2xl font-bold tracking-tight md:text-3xl">
          {track.name}
        </h2>
        <p className="mt-1 truncate text-lg text-muted-foreground">
          {track.artists.map((a) => a.name).join(", ")}
        </p>
      </div>
    </div>
  );
}

function Stamp({
  side,
  style,
  label,
}: {
  side: Side;
  style: MotionValue<number>;
  label: string;
}) {
  const add = side === "right";
  return (
    <motion.div
      style={{ opacity: style }}
      className={cn(
        "pointer-events-none absolute inset-0 flex items-start p-5",
        add
          ? "justify-start bg-gradient-to-br from-success/35 via-transparent to-transparent"
          : "justify-end bg-gradient-to-bl from-black/50 via-transparent to-transparent",
      )}
    >
      <span
        className={cn(
          "flex max-w-[80%] items-center gap-1.5 truncate rounded-xl border-[3px] px-3 py-1.5 text-lg font-extrabold uppercase tracking-wide shadow-lg",
          add ? "-rotate-12 border-success bg-success/20 text-success" : "rotate-12 border-white/80 bg-black/30 text-white",
        )}
      >
        {add ? <Check className="h-5 w-5 shrink-0" /> : <SkipForward className="h-5 w-5 shrink-0" />}
        <span className="truncate">{label}</span>
      </span>
    </motion.div>
  );
}

/* ------------------------------------------------------------- the chrome */

/** Fixed ambient glow. Deliberately not tied to the cover: the deck moves
 *  fast and a background that re-tints on every swipe is distracting. */
function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(70% 55% at 15% 0%, hsl(var(--primary) / 0.16), transparent 70%)," +
          "radial-gradient(60% 50% at 90% 15%, hsl(292 70% 55% / 0.1), transparent 70%)," +
          "linear-gradient(to bottom, transparent 40%, hsl(var(--background)))",
      }}
    />
  );
}

/** First-run gesture hint. */
function Hint() {
  const seen = useUiStore((s) => s.feedHintSeen);
  const dismiss = useUiStore((s) => s.dismissFeedHint);
  const target = feedTarget();
  return (
    <AnimatePresence>
      {!seen && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="absolute inset-x-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-sm rounded-2xl border border-white/10 bg-popover/90 p-4 text-sm shadow-2xl backdrop-blur md:bottom-10"
        >
          <ul className="space-y-1.5 text-muted-foreground">
            <li><b className="text-foreground">Swipe up / down</b> (↑ ↓, wheel) — next / previous</li>
            <li><b className="text-foreground">Swipe right</b> (→) or <b className="text-foreground">double-tap</b> — add to {target?.name ?? "your playlist"}</li>
            <li><b className="text-foreground">Swipe left</b> (←) — skip</li>
            <li><b className="text-foreground">Tap</b> — play / pause</li>
          </ul>
          <button
            type="button"
            onClick={dismiss}
            className="mt-3 h-10 w-full rounded-xl bg-primary text-sm font-medium text-primary-foreground"
          >
            Got it
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** No feed playlist yet: the one thing to decide before swiping. */
function PickTarget() {
  const open = useUiStore((s) => s.setSetupOpen);
  return (
    <div className="absolute inset-x-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-sm rounded-2xl border border-white/10 bg-popover/90 p-4 text-center text-sm shadow-2xl backdrop-blur md:bottom-10">
      <p className="text-muted-foreground">
        Pick the playlist that swiping right adds to.
      </p>
      <button
        type="button"
        onClick={() => open(true, "feed")}
        className="mt-3 h-10 w-full rounded-xl bg-primary text-sm font-medium text-primary-foreground"
      >
        Choose feed playlist
      </button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
      {children}
    </div>
  );
}
