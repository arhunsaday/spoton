/* The Web Audio graph behind the spectrum visualizer.
 *
 *   preview <audio> ─► MediaElementSource ─┬─► speakers
 *                                          └─► tap ─► analyzer(s)
 *   simulated signal (full-track mode) ──────► tap
 *
 * Previews are analysed for real: iTunes serves them with
 * `access-control-allow-origin: *`, so a crossOrigin="anonymous" <audio> can
 * be routed through Web Audio. Full tracks can't be: the Web Playback SDK
 * decodes DRM audio inside Spotify's own cross-origin iframe, and no page can
 * read those samples. For that mode we synthesise a quiet, beat-shaped signal
 * that only feeds the analyzer (never the speakers), so the visualizer still
 * moves with play/pause instead of going dead.
 *
 * Safety rule: once an element is captured by createMediaElementSource its
 * sound ONLY reaches the speakers through this graph — so a suspended
 * AudioContext would mean silence. We therefore capture the preview element
 * only after the context is confirmed running (it needs a user gesture), and
 * until then previews play natively, just without a spectrum. */

let ctx: AudioContext | null = null;
let tap: GainNode | null = null;
let previewEl: HTMLMediaElement | null = null;
let previewCaptured = false;

export function getAudioContext(): AudioContext | null {
  if (ctx) return ctx;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  ctx = new AC({ latencyHint: "playback" });
  tap = ctx.createGain();
  ctx.addEventListener("statechange", tryCapturePreview);
  return ctx;
}

/** The node analyzers listen to. */
export function getTap(): GainNode | null {
  getAudioContext();
  return tap;
}

/** Register the preview element; it's captured once audio is allowed. */
export function registerPreviewElement(el: HTMLMediaElement) {
  previewEl = el;
}

function tryCapturePreview() {
  if (!ctx || !tap || !previewEl || previewCaptured) return;
  if (ctx.state !== "running") return;
  try {
    const src = ctx.createMediaElementSource(previewEl);
    src.connect(ctx.destination);
    src.connect(tap);
    previewCaptured = true;
  } catch (e) {
    // already captured elsewhere, or the browser refused — previews keep
    // playing natively, the spectrum just stays flat for them
    console.debug("[viz] couldn't route the preview through Web Audio:", e);
    previewCaptured = true;
  }
}

/** Resume on any real gesture (autoplay policy), then capture the preview. */
function resumeOnGesture() {
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().then(tryCapturePreview);
  else tryCapturePreview();
}

if (typeof window !== "undefined") {
  for (const ev of ["pointerdown", "keydown", "touchend"] as const) {
    window.addEventListener(ev, resumeOnGesture, { capture: true, passive: true });
  }
}

/* --------------------------------------------- simulated full-track signal */

const BPM = 118;
const BEAT = 60 / BPM;

let synthOn = false;
let synth: {
  out: GainNode;
  bed: GainNode;
  bedFilter: BiquadFilterNode;
  timer: number;
  nextBeat: number;
  beat: number;
} | null = null;

function noiseBuffer(c: AudioContext): AudioBuffer {
  const len = c.sampleRate * 2;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  // pinkish noise (Paul Kellet's economy filter) — closer to a music
  // spectrum than white noise, so the low bars dominate like real tracks
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
  }
  return buf;
}

function startSynth() {
  const c = getAudioContext();
  if (!c || !tap || synth) return;
  const out = c.createGain();
  out.gain.value = 0;
  out.connect(tap); // analyzer only — never the speakers

  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer(c);
  noise.loop = true;
  const bedFilter = c.createBiquadFilter();
  bedFilter.type = "lowpass";
  bedFilter.frequency.value = 3000;
  const bed = c.createGain();
  bed.gain.value = 0.5;
  noise.connect(bedFilter).connect(bed).connect(out);
  noise.start();

  synth = { out, bed, bedFilter, timer: 0, nextBeat: c.currentTime + 0.05, beat: 0 };
  // look-ahead scheduler: queue a few hundred ms of beats at a time
  synth.timer = window.setInterval(scheduleBeats, 100);
}

function scheduleBeats() {
  const c = ctx;
  if (!c || !synth) return;
  if (!synthOn) {
    // silent: don't build nodes nobody hears; just keep the clock current
    synth.nextBeat = Math.max(synth.nextBeat, c.currentTime + 0.05);
    return;
  }
  while (synth.nextBeat < c.currentTime + 0.3) {
    const t = synth.nextBeat;
    const step = synth.beat % 4;
    // kick on every beat
    const kick = c.createOscillator();
    const kg = c.createGain();
    kick.frequency.setValueAtTime(140, t);
    kick.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    kg.gain.setValueAtTime(0.0001, t);
    kg.gain.exponentialRampToValueAtTime(1.4, t + 0.008);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    kick.connect(kg).connect(synth.out);
    kick.start(t);
    kick.stop(t + 0.35);
    // the bed swells on the backbeat and breathes over a 4-bar phrase
    const phrase = 0.7 + 0.3 * Math.sin((synth.beat / 16) * Math.PI * 2);
    synth.bed.gain.setTargetAtTime((step % 2 ? 0.75 : 0.45) * phrase, t, 0.05);
    synth.bedFilter.frequency.setTargetAtTime(1800 + 4500 * phrase * Math.random(), t, 0.12);
    synth.nextBeat += BEAT;
    synth.beat++;
  }
}

/** Fade the simulated signal in/out (full-track mode playing ↔ not). */
export function setSimulatedSignal(on: boolean) {
  const c = getAudioContext();
  if (!c) return;
  synthOn = on;
  if (on) startSynth();
  if (!synth) return;
  synth.out.gain.setTargetAtTime(on ? 0.9 : 0, c.currentTime, on ? 0.08 : 0.25);
}
