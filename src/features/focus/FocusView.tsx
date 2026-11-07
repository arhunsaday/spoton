import { AnimatePresence, motion } from "framer-motion";
import { Music2 } from "lucide-react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/useSessionStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { coverUrl } from "@/lib/cover";
import { Spectrum } from "./Spectrum";
import { TiltCover } from "./TiltCover";
import { Vinyl } from "@/components/Vinyl";

/** Horizontal travel (px, velocity-weighted) that counts as a swipe. */
const SWIPE_PX = 70;
/** Touch-first device: swipe instead of tilt. */
const isCoarse = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(pointer: coarse)").matches;

export function FocusView() {
  const tracks = useSessionStore((s) => s.tracks);
  const index = useSessionStore((s) => s.index);
  const dir = useSessionStore((s) => s.dir);
  const status = useSessionStore((s) => s.status);
  const loaded = useSessionStore((s) => s.loaded);
  const total = useSessionStore((s) => s.total);
  const next = useSessionStore((s) => s.next);
  const prev = useSessionStore((s) => s.prev);
  const visualizer = useLibraryStore((s) => s.settings.visualizer !== false);
  const vinyl = useLibraryStore((s) => !!s.settings.vinyl);

  const playing = usePlayerStore((s) => s.playing);
  const toggle = usePlayerStore((s) => s.toggle);
  const previewVia = usePlayerStore((s) => s.previewVia);

  const track = tracks[index] ?? null;
  const coarse = isCoarse();
  const noPreview = previewVia === "none";

  const cover = coverUrl(track);

  if (status === "loading") {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground tabnum">
          {total > 0
            ? `Loading source… ${loaded} / ${total}`
            : "Loading source…"}
        </p>
      </Centered>
    );
  }

  if (status === "ready" && tracks.length === 0) {
    return (
      <Centered>
        <Music2 className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Nothing to sort in this source.
        </p>
      </Centered>
    );
  }

  if (!track) {
    return (
      <Centered>
        <Music2 className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Pick a source to start sorting.
        </p>
      </Centered>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {/* blurred album-art backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <AnimatePresence>
          {cover && (
            <motion.img
              key={cover}
              src={cover}
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeInOut" }}
              className="absolute left-1/2 top-1/2 h-[150%] w-[150%] -translate-x-1/2 -translate-y-1/2 object-cover blur-[100px] saturate-[1.4]"
            />
          )}
        </AnimatePresence>
        <div className="absolute inset-0 bg-background/75" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background" />
      </div>

      {visualizer && <Spectrum coverUrl={cover} />}

      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center px-6 pb-[8vh]">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={track.id}
            custom={dir}
            initial={{ opacity: 0, x: dir * 56 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -56 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            // touch: swipe the track away to move on (desktop keeps ← / →)
            drag={coarse ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.35}
            onDragEnd={(_, info) => {
              const swipe = info.offset.x + info.velocity.x * 0.2;
              if (swipe < -SWIPE_PX) next();
              else if (swipe > SWIPE_PX) prev();
            }}
            className="flex w-full flex-col items-center"
          >
            <div className="flex w-full justify-center">
              {/* the box is the cover's size; the album spine hangs off its
                  right edge, so it can never be taller than the cover or move
                  anything when the album name changes */}
              <div className="relative aspect-square w-[calc(100%-4rem)] max-w-[min(56vh,560px)]">
              {vinyl ? (
                <button
                  type="button"
                  onClick={toggle}
                  disabled={noPreview}
                  aria-label={playing ? "Pause" : "Play"}
                  title={noPreview ? "No preview available" : playing ? "Pause (Space)" : "Play (Space)"}
                  className={cn(
                    "block h-full w-full cursor-pointer transition-[filter,opacity] duration-300 disabled:cursor-default",
                    noPreview && "opacity-70 grayscale",
                  )}
                >
                  <Vinyl cover={cover} spinning={playing} />
                </button>
              ) : (
                <TiltCover
                  enabled={visualizer && !coarse}
                  className={cn(
                    "h-full w-full transition-[filter,opacity] duration-300",
                    noPreview && "opacity-70 grayscale",
                  )}
                >
                  {/* the cover is the play button — the bar below has the rest */}
                  <button
                    type="button"
                    onClick={toggle}
                    disabled={noPreview}
                    aria-label={playing ? "Pause" : "Play"}
                    title={noPreview ? "No preview available" : playing ? "Pause (Space)" : "Play (Space)"}
                    className="group/cover relative block h-full w-full cursor-pointer disabled:cursor-default"
                  >
                  {cover ? (
                    <img
                      src={cover}
                      alt=""
                      className="h-full w-full object-cover drag-none"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-secondary">
                      <Music2 className="h-10 w-10 text-muted-foreground" />
                    </div>
                  )}
                  </button>
                </TiltCover>
              )}
              {/* album name set like a book spine, reading top to bottom */}
              {!vinyl && <p
                title={track.album.name}
                className="absolute inset-y-2 left-full ml-3 w-5 truncate tracking-wide text-muted-foreground/70 [writing-mode:vertical-rl]"
              >
                {track.album.name}
              </p>}
              </div>
            </div>

            <h1 className="mt-6 line-clamp-2 text-balance text-center text-2xl font-bold tracking-tight hover:text-white/60 md:text-3xl xl:text-4xl">
              <a
                href={`https://open.spotify.com/track/${track.id}`}
                target="_blank"
                rel="noreferrer"
                title="Open in Spotify"
                className="cursor-pointer text-inherit no-underline outline-none"
              >
                {track.name}
              </a>
            </h1>
            <p className="mt-1.5 w-full truncate text-center text-lg text-muted-foreground xl:text-xl">
              <a
                href={`https://open.spotify.com/artist/${track.artists[0].id}`}
                target="_blank"
                rel="noreferrer"
                title="Open in Spotify"
                className="cursor-pointer text-inherit no-underline outline-none hover:text-white/80"
              >
                {track.artists.map((a) => a.name).join(", ")}
              </a>
            </p>
          </motion.div>
        </AnimatePresence>

      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      {children}
    </div>
  );
}

export function MaterialSymbolsPlayArrowRounded(
  props: React.SVGProps<SVGSVGElement>,
) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      {...props}
    >
      {/* Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE */}
      <path
        fill="currentColor"
        d="M8 17.175V6.825q0-.425.3-.713t.7-.287q.125 0 .263.037t.262.113l8.15 5.175q.225.15.338.375t.112.475t-.112.475t-.338.375l-8.15 5.175q-.125.075-.262.113T9 18.175q-.4 0-.7-.288t-.3-.712"
      />
    </svg>
  );
}

export function MaterialSymbolsPauseRounded(
  props: React.SVGProps<SVGSVGElement>,
) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      {...props}
    >
      {/* Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE */}
      <path
        fill="currentColor"
        d="M16 19q-.825 0-1.412-.587T14 17V7q0-.825.588-1.412T16 5t1.413.588T18 7v10q0 .825-.587 1.413T16 19m-8 0q-.825 0-1.412-.587T6 17V7q0-.825.588-1.412T8 5t1.413.588T10 7v10q0 .825-.587 1.413T8 19"
      />
    </svg>
  );
}
