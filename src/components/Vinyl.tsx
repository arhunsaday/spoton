import { useEffect, useState } from "react";
import { Music2 } from "lucide-react";
import { dominantColor } from "@/lib/color";
import { cn } from "@/lib/utils";

/** Fallback label tint while the cover's colour is still being read. */
const NEUTRAL = "150, 150, 150";

/** Fine film grain (stands in for the photo textures of a real sleeve/disc). */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** The record itself: grooves, glossy highlights that turn with it (like a
 *  photo of a real LP spinning), a few track gaps, and the printed label. */
const DISC =
  // two glossy highlight wedges
  "conic-gradient(from 0deg, rgba(255,255,255,0) 0deg, rgba(255,255,255,0.16) 28deg, rgba(255,255,255,0) 62deg, rgba(255,255,255,0) 180deg, rgba(255,255,255,0.12) 212deg, rgba(255,255,255,0) 246deg, rgba(255,255,255,0) 360deg)," +
  // track gaps + lead-in / run-out bands
  "radial-gradient(circle, transparent 0 35%, rgba(255,255,255,0.05) 35.5% 37%, transparent 37.5% 52%, rgba(255,255,255,0.06) 52.4%, transparent 52.9% 63%, rgba(255,255,255,0.06) 63.4%, transparent 63.9% 78%, rgba(255,255,255,0.06) 78.4%, transparent 78.9% 95%, rgba(255,255,255,0.1) 95.5% 97%, #050505 97.5%)," +
  // the grooves
  "repeating-radial-gradient(circle, #0c0c0c 0 0.6px, #1d1d1d 1px, #0a0a0a 1.6px)";

/**
 * An LP pulled half out of its sleeve, after the classic CSS "album + vinyl"
 * look. Fills a 3:2 box: the sleeve (album cover) is the left two-thirds, the
 * record slides out to the right once per track and turns while `spinning`;
 * pausing freezes it where it is. The centre print is the cover art, ringed
 * with the cover's dominant colour. `children` render over the sleeve
 * (badges, swipe stamps…).
 */
export function Vinyl({
  cover,
  spinning,
  className,
  children,
}: {
  cover?: string;
  spinning: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const tint = useDominant(cover);

  return (
    <div className={cn("relative aspect-[3/2] w-full", className)}>
      <div className="absolute inset-y-0 left-0 aspect-square">
        {/* record: slides out (outer) and spins (inner) on separate elements
            so the two transforms never fight */}
        <div className="vinyl-out absolute inset-[2.5%] z-0">
          <div
            className="vinyl-spin relative h-full w-full rounded-full shadow-[0_0_20px_4px_rgba(0,0,0,0.6)]"
            style={{ animationPlayState: spinning ? "running" : "paused", background: DISC }}
          >
            {/* surface texture */}
            <div
              aria-hidden
              className="absolute inset-[2.5%] rounded-full opacity-[0.12] mix-blend-screen"
              style={{ backgroundImage: GRAIN }}
            />
            {/* print (label) */}
            <div
              className="absolute inset-[33%] overflow-hidden rounded-full"
              style={{
                background: `rgb(${tint})`,
                boxShadow: `inset 0 0 0 5px rgba(${tint}, 0.85), inset 0 0 0 6px rgba(0,0,0,0.25)`,
              }}
            >
              {cover && (
                <img
                  src={cover}
                  alt=""
                  draggable={false}
                  className="absolute inset-[9%] h-[82%] w-[82%] rounded-full object-cover drag-none"
                />
              )}
              <span className="absolute left-1/2 top-1/2 h-[8%] w-[8%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#111] shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]" />
            </div>
          </div>
        </div>

        {/* sleeve */}
        <div className="absolute inset-0 z-10 overflow-hidden rounded-[4px] bg-secondary shadow-[5px_0_20px_0_rgba(0,0,0,0.6)]">
          {cover ? (
            <img src={cover} alt="" draggable={false} className="h-full w-full object-cover drag-none" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Music2 className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          {/* worn card: soft light falloff + grain, screened like the photo
              textures in the original */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-50 mix-blend-screen"
            style={{
              background:
                "radial-gradient(120% 90% at 15% 10%, rgba(255,255,255,0.22), transparent 55%), linear-gradient(100deg, transparent 70%, rgba(255,255,255,0.08))",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-20 mix-blend-screen"
            style={{ backgroundImage: GRAIN }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[4px] shadow-[inset_0_0_10px_5px_rgba(255,255,255,0.2),inset_0_0_4px_2px_rgba(0,0,0,0.2)]"
          />
          {children}
        </div>
      </div>
    </div>
  );
}

function useDominant(url?: string) {
  const [tint, setTint] = useState(NEUTRAL);
  useEffect(() => {
    let live = true;
    if (!url) {
      setTint(NEUTRAL);
      return;
    }
    void dominantColor(url).then((c) => {
      if (live) setTint(c ?? NEUTRAL);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return tint;
}
