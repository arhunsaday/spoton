import { create } from "zustand";
import { toast } from "sonner";
import { addTracksToTarget, getTargetTrackIds, removeTracksFromTarget } from "@/api/spotify";
import { QuotaError } from "@/api/client";
import { LIKED_SOURCE_ID, useLibraryStore } from "@/store/useLibraryStore";
import { useSessionStore } from "@/store/useSessionStore";
import type { SpotifyTrack } from "@/types";

export type Side = "left" | "right";

/* The feed files to ONE playlist, chosen on its own (setup → Feed), not to
 * the hotkey targets. It writes straight through — the feed has no Apply
 * button — and keeps that playlist's track ids so a swipe never adds a
 * duplicate. */

interface FeedState {
  /** ids already in the feed playlist (null until loaded) */
  ids: Set<string> | null;
  loadedFor: string | null;
  load: (playlistId: string) => Promise<void>;
  _mark: (trackId: string, present: boolean) => void;
}

export const useFeedStore = create<FeedState>((set, get) => ({
  ids: null,
  loadedFor: null,
  load: async (playlistId) => {
    if (get().loadedFor === playlistId) return;
    set({ ids: null, loadedFor: playlistId });
    try {
      const ids = await getTargetTrackIds(playlistId, () => get().loadedFor === playlistId);
      if (get().loadedFor === playlistId) set({ ids: new Set(ids) });
    } catch {
      // unknown membership: adds still work, the duplicate check just can't help
      if (get().loadedFor === playlistId) set({ ids: new Set() });
    }
  },
  _mark: (trackId, present) => {
    const ids = new Set(get().ids ?? []);
    if (present) ids.add(trackId);
    else ids.delete(trackId);
    set({ ids });
    // keep the hotkey targets' ticks right when it's also one of them
    const id = get().loadedFor;
    const session = useSessionStore.getState();
    if (id && session.membership[id]) session._setMembership(id, trackId, present, true);
  },
}));

export function feedTarget(): { id: string; name: string } | null {
  const { feedTargetId, playlists } = useLibraryStore.getState();
  if (!feedTargetId) return null;
  if (feedTargetId === LIKED_SOURCE_ID) return { id: feedTargetId, name: "Liked Songs" };
  const p = playlists.find((x) => x.id === feedTargetId);
  return { id: feedTargetId, name: p?.name ?? "your playlist" };
}

async function addToFeed(track: SpotifyTrack, target: { id: string; name: string }) {
  const feed = useFeedStore.getState();
  feed._mark(track.id, true);
  try {
    await addTracksToTarget(target.id, [track.id]);
    toast.success(`Added to ${target.name}`, {
      id: "feed-add",
      description: track.name,
      action: {
        label: "Undo",
        onClick: () => {
          useFeedStore.getState()._mark(track.id, false);
          void removeTracksFromTarget(target.id, [track.id]).catch(() => {
            useFeedStore.getState()._mark(track.id, true);
            toast.error("Couldn't undo");
          });
        },
      },
    });
  } catch (e) {
    useFeedStore.getState()._mark(track.id, false);
    toast.error(
      e instanceof QuotaError ? "Spotify quota exceeded — try again shortly" : `Couldn't add to ${target.name}`,
    );
  }
}

/** Right = add the current track to the feed playlist (never twice), left =
 *  skip. Both move on. Returns what happened, for the UI's feedback. */
export function commitSwipe(side: Side): "added" | "already" | "skipped" | "no-target" {
  const session = useSessionStore.getState();
  const track = session.current();
  if (!track) return "skipped";
  let result: ReturnType<typeof commitSwipe> = "skipped";
  if (side === "right") {
    const target = feedTarget();
    if (!target) return "no-target"; // stay: the user has to pick one first
    if (useFeedStore.getState().ids?.has(track.id)) result = "already";
    else {
      void addToFeed(track, target);
      result = "added";
    }
  }
  session.next();
  return result;
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
