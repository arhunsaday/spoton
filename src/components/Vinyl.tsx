import { useEffect, useState } from "react";
import { Music2 } from "lucide-react";
import { dominantColor } from "@/lib/color";
import { cn } from "@/lib/utils";

/** Fallback label tint while the cover's colour is still being read. */
const NEUTRAL = "120, 120, 132";

/**
 * An LP half out of its sleeve. Fills a square box: the sleeve is the album
 * cover, the record slides out to the right once per track and turns at
 * 33⅓ rpm while `spinning`. Pausing freezes it where it is rather than
 * snapping back. The label is tinted with the cover's dominant colour and
 * carries the art, so the rotation is actually visible.
 */
export function Vinyl({
  cover,
  spinning,
  className,
}: {
  cover?: string;
  spinning: boolean;
  className?: string;
}) {
  const tint = useDominant(cover);

  return (
    <div className={cn("relative h-full w-full", className)}>
      {/* sleeve + record, centred as a group inside the square */}
      <div className="absolute left-[3%] top-[14%] aspect-square w-[72%]">
        {/* the record: slides out (outer) and spins (inner) separately so the
            two transforms never fight */}
        <div className="vinyl-out absolute inset-[2.5%] z-0">
          <div
            className="vinyl-spin relative h-full w-full rounded-full shadow-[0_10px_40px_-6px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.04)]"
            style={{
              animationPlayState: spinning ? "running" : "paused",
              background:
                // grooves over a near-black disc, with the dead wax near the label
                "radial-gradient(circle, transparent 0 33%, rgba(0,0,0,0.55) 33.5% 36%, transparent 36.5% 47%, rgba(255,255,255,0.05) 47.3%, transparent 47.8% 70%, rgba(255,255,255,0.05) 70.3%, transparent 70.8% 96.5%, rgba(255,255,255,0.08) 97%, transparent 98%)," +
                "repeating-radial-gradient(circle, #121212 0 1px, #1b1b1b 1.5px, #0f0f0f 2.5px)",
            }}
          >
            {/* label */}
            <div
              className="absolute inset-[33%] overflow-hidden rounded-full"
              style={{
                background: `radial-gradient(circle, rgb(${tint}) 0 64%, rgba(0,0,0,0.25) 64.5% 66%, rgb(${tint}) 66.5% 100%)`,
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12), inset 0 0 12px rgba(0,0,0,0.35)",
              }}
            >
              {cover && (
                <img
                  src={cover}
                  alt=""
                  draggable={false}
                  className="absolute inset-[18%] h-[64%] w-[64%] rounded-full object-cover opacity-95 drag-none"
                />
              )}
              {/* a little off-centre mark, like printed label text */}
              <span className="absolute left-1/2 top-[6%] h-[5%] w-[22%] -translate-x-1/2 rounded-full bg-white/35" />
              {/* spindle hole */}
              <span className="absolute left-1/2 top-1/2 h-[7%] w-[7%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0b0b0b] shadow-[inset_0_1px_1px_rgba(255,255,255,0.25)]" />
            </div>
          </div>
          {/* light doesn't turn with the record: the sheen stays put */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full mix-blend-screen"
            style={{
              background:
                "conic-gradient(from 20deg, transparent 0 6%, rgba(255,255,255,0.13) 11%, transparent 18% 50%, rgba(255,255,255,0.1) 61%, transparent 68% 100%)",
              WebkitMaskImage: "radial-gradient(circle, transparent 0 34%, black 35%)",
              maskImage: "radial-gradient(circle, transparent 0 34%, black 35%)",
            }}
          />
        </div>

        {/* sleeve */}
        <div className="absolute inset-0 z-10 overflow-hidden rounded-[4px] bg-secondary shadow-[6px_0_24px_0_rgba(0,0,0,0.6),inset_0_0_10px_4px_rgba(255,255,255,0.12),inset_0_0_3px_1px_rgba(0,0,0,0.25)]">
          {cover ? (
            <img src={cover} alt="" draggable={false} className="h-full w-full object-cover drag-none" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Music2 className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          {/* printed-card sheen + worn edges */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 mix-blend-screen"
            style={{
              background:
                "linear-gradient(115deg, rgba(255,255,255,0.14) 0%, transparent 28%, transparent 70%, rgba(255,255,255,0.06) 100%)",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),inset_-8px_0_14px_-8px_rgba(0,0,0,0.6)]"
          />
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
