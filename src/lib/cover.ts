import type { SpotifyTrack } from "@/types";

/** Prefer a mid-size cover — the 640px original is wasted on a small box. */
export function coverUrl(track: SpotifyTrack | null, minWidth = 300): string {
  if (!track) return "";
  return (
    track.album.images.find((i) => (i.width ?? 0) >= minWidth)?.url ??
    track.album.images[0]?.url ??
    ""
  );
}
