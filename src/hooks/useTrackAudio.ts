import { useEffect, useRef } from "react";
import { holdFullTrack } from "@/lib/playback";
import { sdkIsOn } from "@/lib/spotify-sdk";
import { prefetchPreviews, resolvePreview } from "@/lib/preview";
import { coverUrl } from "@/lib/cover";
import { useSessionStore } from "@/store/useSessionStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { usePlayerStore } from "@/store/usePlayerStore";

/** How long browsing has to settle before a full track is actually started. */
const START_DEBOUNCE_MS = 300;

/** Plays the current track — whichever view (focus or feed) is showing it.
 *  Mounted once in the app shell so switching views never restarts audio. */
export function useTrackAudio() {
  const tracks = useSessionStore((s) => s.tracks);
  const index = useSessionStore((s) => s.index);
  const autoplay = useLibraryStore((s) => s.settings.previewAutoplay);
  const fullTracks = useLibraryStore((s) => s.settings.fullTracks);
  const load = usePlayerStore((s) => s.load);
  const stopPreview = usePlayerStore((s) => s.stopPreview);
  const setPreviewVia = usePlayerStore((s) => s.setPreviewVia);

  const track = tracks[index] ?? null;
  const reqId = useRef(0);
  const lastMode = useRef(fullTracks);

  // start audio for the current track — the whole track via the SDK in
  // full-track mode, otherwise the iTunes preview
  useEffect(() => {
    if (!track) {
      load(null, false);
      setPreviewVia("none");
      return;
    }
    const id = ++reqId.current;
    const modeSwitch = lastMode.current !== fullTracks;
    lastMode.current = fullTracks;
    if (fullTracks) {
      stopPreview();
      // the play button must stay live in full-track mode: even when a start
      // fails, Space is how you retry it
      setPreviewVia("spotify");
      // already holding this track (switching back into full-track mode, or
      // the effect re-ran) — resume it rather than restarting at the hook
      if (sdkIsOn(track.uri)) {
        if (modeSwitch) usePlayerStore.getState().play();
        return;
      }
      // cut the outgoing track at once and show this one idle; with autoplay
      // off that's all — Space starts it
      holdFullTrack(track);
      if (!(autoplay || modeSwitch)) return;
      // Each start is a Spotify write, so holding → would fire one per track
      // and burn the shared dev-mode quota. Wait for the browsing to settle;
      // playFullTrack itself drops any start that a newer one superseded.
      usePlayerStore.setState({ buffering: true });
      const t = window.setTimeout(() => {
        if (id === reqId.current) usePlayerStore.getState().play();
      }, START_DEBOUNCE_MS);
      return () => window.clearTimeout(t);
    }
    setPreviewVia("loading");
    resolvePreview(track).then((res) => {
      if (id !== reqId.current) return; // stale
      setPreviewVia(res.url ? res.via : "none");
      load(res.url, autoplay || modeSwitch);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, fullTracks]);

  // warm the next few tracks so → is instant: iTunes lookup + cover image.
  // Debounced so holding the arrow key doesn't queue a lookup per track.
  useEffect(() => {
    const upcoming = tracks.slice(index + 1, index + 4);
    if (upcoming.length === 0) return;
    const t = window.setTimeout(() => {
      // full-track mode never touches iTunes — only the covers are worth warming
      if (!fullTracks) void prefetchPreviews(upcoming);
      for (const u of upcoming) {
        const url = coverUrl(u);
        if (url) new Image().src = url;
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [tracks, index, fullTracks]);

}
