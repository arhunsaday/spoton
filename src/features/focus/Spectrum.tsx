import { useEffect, useRef } from "react";
import AudioMotionAnalyzer from "audiomotion-analyzer";
import { getAudioContext, getTap, setSimulatedSignal } from "@/lib/audio-graph";
import { dominantColor } from "@/lib/color";
import { usePlayerStore } from "@/store/usePlayerStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { cn } from "@/lib/utils";

/** Fallback tint: the app's indigo accent (243 75% 63%). */
const DEFAULT_RGB = "109, 99, 234";
/** Keep drawing this long after playback stops so the bars fall, not freeze. */
const SETTLE_MS = 1200;

/** Full-width spectrum rising from the player bar, behind the focus view.
 *  Real FFT for previews; a simulated beat for full tracks (see audio-graph). */
export function Spectrum({
  coverUrl,
  className,
}: {
  coverUrl: string;
  /** override the default height */
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const am = useRef<AudioMotionAnalyzer | null>(null);
  const playing = usePlayerStore((s) => s.playing);
  const fullTracks = useLibraryStore((s) => s.settings.fullTracks);

  // one analyzer per mount, on the shared context
  useEffect(() => {
    const ctx = getAudioContext();
    const tap = getTap();
    if (!box.current || !ctx || !tap) return;
    const a = new AudioMotionAnalyzer(box.current, {
      audioCtx: ctx,
      connectSpeakers: false, // the graph already routes previews to speakers
      overlay: true,
      showBgColor: false,
      bgAlpha: 0,
      mode: 3, // 1/8-octave bands: ~80 bars across the view
      barSpace: 0.3,
      roundBars: true,
      frequencyScale: "log",
      minFreq: 30,
      maxFreq: 16000,
      weightingFilter: "D",
      // dB scale with a narrow window: mastered music sits high in it, so
      // the bars use the whole height instead of hugging the floor
      minDecibels: -80,
      maxDecibels: -22,
      smoothing: 0.7,
      showScaleX: false,
      showPeaks: false, // just the bars, no lingering peak markers
      reflexRatio: 0,
      channelLayout: "single",
      maxFPS: 60,
      loRes: false,
      start: false,
    });
    a.connectInput(tap);
    registerTint(a, DEFAULT_RGB);
    am.current = a;
    return () => {
      am.current = null;
      a.disconnectInput(tap);
      a.destroy();
    };
  }, []);

  // tint from the album art
  useEffect(() => {
    let alive = true;
    void dominantColor(coverUrl).then((rgb) => {
      if (alive && am.current) registerTint(am.current, rgb ?? DEFAULT_RGB);
    });
    return () => {
      alive = false;
    };
  }, [coverUrl]);

  // draw only while there's something to show — an idle 60fps canvas costs
  // battery for nothing
  useEffect(() => {
    setSimulatedSignal(fullTracks && playing);
    const a = am.current;
    if (!a) return;
    if (playing) {
      a.toggleAnalyzer(true);
      return;
    }
    const t = window.setTimeout(() => a.toggleAnalyzer(false), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [playing, fullTracks]);

  useEffect(() => () => setSimulatedSignal(false), []);

  return (
    <div
      ref={box}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 h-[30%] max-h-64 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]",
        className,
      )}
    />
  );
}

function registerTint(a: AudioMotionAnalyzer, rgb: string) {
  // brighten toward white at the tips so dark covers still read on the dark UI
  a.registerGradient("spoton", {
    bgColor: "transparent",
    colorStops: [
      { color: `rgba(${mix(rgb, 0.45)}, 0.95)`, pos: 0 },
      { color: `rgba(${mix(rgb, 0.15)}, 0.8)`, pos: 0.4 },
      { color: `rgba(${rgb}, 0.35)`, pos: 1 },
    ],
  });
  a.gradient = "spoton";
}

/** Blend an "r, g, b" string toward white by `t`. */
function mix(rgb: string, t: number): string {
  return rgb
    .split(",")
    .map((v) => Math.round(Number(v) + (255 - Number(v)) * t))
    .join(", ");
}
