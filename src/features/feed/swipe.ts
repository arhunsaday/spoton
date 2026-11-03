import { useLibraryStore } from "@/store/useLibraryStore";
import { useSessionStore } from "@/store/useSessionStore";
import type { Target } from "@/types";

export type Side = "left" | "right";

/** The target a swipe files to, or null when that side just skips. */
export function swipeTarget(side: Side): Target | null {
  const { swipe, targets } = useLibraryStore.getState();
  const id = swipe[side];
  if (id === undefined) return side === "right" ? (targets[0] ?? null) : null;
  if (id === null) return null;
  return targets.find((t) => t.id === id) ?? null;
}

/** Commit a swipe on the current track: file it to that side's target (an
 *  ADD — a swipe never removes a track that's already there), then move on.
 *  Returns what happened, for the UI's feedback. */
export function commitSwipe(side: Side): { added: Target | null } {
  const session = useSessionStore.getState();
  const track = session.current();
  if (!track) return { added: null };
  const target = swipeTarget(side);
  let added: Target | null = null;

  const before = { index: session.index, len: session.tracks.length };
  if (target && !session.membership[target.id]?.has(track.id)) {
    // fileToTarget reads the current track synchronously, before any await
    void session.fileToTarget(target.key);
    added = target;
  }
  // filing may already have moved on (auto-advance, move mode) — don't skip
  // a second track
  const after = useSessionStore.getState();
  if (after.index === before.index && after.tracks.length === before.len) {
    after.next();
  }
  return { added };
}

/* The mounted feed registers its animated versions here, so the keyboard
 * triggers the same fly-out a finger would. */
interface FeedControls {
  swipe: (side: Side) => void;
  page: (dir: 1 | -1) => void;
}
let controls: FeedControls | null = null;
export const registerFeedControls = (c: FeedControls | null) => {
  controls = c;
};
export const feedControls = () => controls;
