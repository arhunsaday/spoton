import { toast } from "sonner";
import { ApiError, QuotaError } from "@/api/client";
import {
  playTrackOnDevice,
  transferPlayback,
  type SpotifyDevice,
} from "@/api/spotify";
import {
  activateSdkElement,
  connectSdk,
  disconnectSdk,
  getDeviceId,
  getSdkStatus,
  registerSdkListeners,
  SdkError,
  sdkDetach,
  sdkExpect,
  sdkExpectFailed,
  sdkIsOn,
  sdkIsStarting,
  sdkLastPositionFor,
  sdkPause,
  sdkResume,
  sdkSeek,
  sdkStarted,
} from "@/lib/spotify-sdk";
import { useAuthStore } from "@/store/useAuthStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { registerFullTrackControls, usePlayerStore } from "@/store/usePlayerStore";
import { useSessionStore } from "@/store/useSessionStore";
import { sleep } from "@/lib/utils";
import type { SpotifyTrack } from "@/types";

/** Drop in this far through the track — the substitute for the dead 30s
 *  preview_url, per the preview strategy in CLAUDE.md: far enough in to land
 *  on the hook rather than an intro. */
const HOOK_FRACTION = 0.3;

/** A freshly registered device can answer 404 "Device not found" for a few
 *  seconds, and Spotify's player endpoints throw the odd 502/503. Both are
 *  worth waiting out rather than surfacing. */
const START_BACKOFF_MS = [300, 600, 1000, 1600, 2400];
/** After this many 404s, transfer playback to the device once — that forces
 *  Spotify Connect to acknowledge it. */
const TRANSFER_AFTER = 2;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const trace = (...args: unknown[]) => console.debug("[playback]", ...args);
const fullTracksOn = () => useLibraryStore.getState().settings.fullTracks;
const currentTrack = (): SpotifyTrack | null => {
  const s = useSessionStore.getState();
  return s.tracks[s.index] ?? null;
};
const hookOf = (t: SpotifyTrack) => Math.round(t.duration_ms * HOOK_FRACTION);

/* Every start request takes a ticket; a newer request (or a pause) makes older
 * ones stale. Without this, browsing while the player was still connecting
 * fired every queued start at once and whichever landed last "won". */
let playSeq = 0;
/** What the user last asked for — a start that lands after a pause re-pauses. */
let wantPlaying = false;

class Stale extends Error {}

function retryable(e: unknown): boolean {
  if (e instanceof QuotaError) return false; // client already waited once
  if (e instanceof ApiError) return e.status === 404 || e.status >= 500;
  return e instanceof TypeError; // fetch network failure
}

async function startOnDevice(
  deviceId: string,
  uri: string,
  positionMs: number,
  seq: number,
): Promise<void> {
  let transferred = false;
  for (let attempt = 0; ; attempt++) {
    if (seq !== playSeq) throw new Stale();
    try {
      return await playTrackOnDevice(deviceId, uri, positionMs);
    } catch (e) {
      if (!retryable(e) || attempt >= START_BACKOFF_MS.length) throw e;
      trace(`start attempt ${attempt + 1} failed:`, msg(e));
      if (
        !transferred &&
        attempt + 1 >= TRANSFER_AFTER &&
        e instanceof ApiError &&
        e.status === 404
      ) {
        transferred = true;
        await transferPlayback(deviceId, false).catch(() => {});
      }
      await sleep(START_BACKOFF_MS[attempt]);
    }
  }
}

/* ------------------------------------------------- full-track mode (SDK) */

/** Connect the in-app player, or give up on full-track mode entirely.
 *  A transient failure (timeout, flaky network) gets one rebuild-and-retry; a
 *  fatal one (no Premium, no browser DRM, stale scopes) falls straight back to
 *  previews, because silence is worse than a 30s clip. */
let sdkAttempt: Promise<string | null> | null = null;

function ensureSdk(): Promise<string | null> {
  const ready = getDeviceId();
  if (ready) return Promise.resolve(ready);
  if (!sdkAttempt) {
    sdkAttempt = attemptSdk().finally(() => {
      sdkAttempt = null;
    });
  }
  return sdkAttempt;
}

/** Things we can rule out before spending seconds on a connection that is
 *  bound to fail. Old tokens carry no `scope`, so they pass — the playback
 *  error limiter below catches those. */
function preflight(): string | null {
  const { tokens, user } = useAuthStore.getState();
  if (user?.product && user.product !== "premium") {
    return "Spotify Premium is required for in-app playback";
  }
  if (tokens?.scope && !tokens.scope.split(" ").includes("streaming")) {
    return "Reconnect Spotify to allow in-app playback";
  }
  return null;
}

async function attemptSdk(): Promise<string | null> {
  const blocked = preflight();
  if (blocked) {
    fallBackToPreviews(blocked);
    return null;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await connectSdk(usePlayerStore.getState().volume);
    } catch (e) {
      const fatal = e instanceof SdkError && e.fatal;
      if (!fullTracksOn()) return null; // user left full-track mode meanwhile
      if (fatal || attempt === 1) {
        fallBackToPreviews(msg(e));
        return null;
      }
      trace("connect failed, rebuilding:", msg(e));
      disconnectSdk();
      await sleep(1000);
    }
  }
  return null;
}

function fallBackToPreviews(description: string) {
  ++playSeq;
  wantPlaying = false;
  useLibraryStore.getState().setSetting("fullTracks", false);
  disconnectSdk();
  usePlayerStore.setState({ buffering: false });
  const reconnect = /reconnect/i.test(description);
  toast.error("Full-track playback unavailable — back to previews", {
    id: "sdk-fallback",
    description,
    duration: 12_000,
    action: reconnect
      ? {
          label: "Reconnect",
          onClick: () => void useAuthStore.getState().login(),
        }
      : /premium|browser/i.test(description)
        ? undefined
        : { label: "Retry", onClick: () => setFullTracks(true) },
  });
}

/** Turn full-track mode on/off. Called from a click or a key, which is what
 *  lets the SDK produce sound at all. */
export function setFullTracks(on: boolean) {
  ++playSeq; // whatever was starting belongs to the old mode
  wantPlaying = false;
  // silence the outgoing engine before the swap, never two sources at once.
  // Leaving full mode only pauses the player: keeping the device registered is
  // what makes toggling back instant instead of a multi-second reconnect.
  if (on) usePlayerStore.getState().stopPreview();
  else sdkPause();
  // neither engine reports "stopped" on the way out, so clear the transport by
  // hand and let the incoming engine report its own state
  usePlayerStore.setState({ playing: false, currentTime: 0, buffering: false });
  useLibraryStore.getState().setSetting("fullTracks", on);
  if (on) {
    activateSdkElement();
    void ensureSdk();
  }
}

export function toggleFullTracks() {
  setFullTracks(!fullTracksOn());
}

/** The player is stuck in an error state: rebuild it and restart the track. */
export function reconnectFullTracks() {
  disconnectSdk();
  const track = currentTrack();
  if (track) void playFullTrack(track);
  else void ensureSdk();
}

export type StartResult = "ok" | "failed" | "stale" | "unavailable";

/** Start a track in-app — at `positionMs`, or at the hook by default. */
export async function playFullTrack(
  track: SpotifyTrack,
  opts: { positionMs?: number } = {},
): Promise<StartResult> {
  const seq = ++playSeq;
  wantPlaying = true;
  const position = Math.max(
    0,
    Math.min(opts.positionMs ?? hookOf(track), track.duration_ms - 1000),
  );
  usePlayerStore.setState({ buffering: true });
  const done = (r: StartResult) => {
    if (seq === playSeq) usePlayerStore.setState({ buffering: false });
    return r;
  };

  const deviceId = await ensureSdk();
  if (seq !== playSeq || !fullTracksOn()) return done("stale");
  if (!deviceId) return done("unavailable");

  sdkExpect(track.uri, position, track.duration_ms);
  try {
    await startOnDevice(deviceId, track.uri, position, seq);
  } catch (e) {
    if (e instanceof Stale) return done("stale");
    if (seq !== playSeq) return done("stale");
    sdkExpectFailed();
    reportStartFailure(e);
    return done("failed");
  }
  if (seq !== playSeq) {
    // a pause arrived while the request was in flight, and the track started
    // anyway — honour the pause
    if (!wantPlaying) sdkPause();
    return done("stale");
  }
  sdkStarted(track.uri, position, track.duration_ms);
  return done("ok");
}

function reportStartFailure(e: unknown) {
  if (e instanceof QuotaError) {
    toast.error("Spotify quota exceeded — try again shortly", { id: "start" });
    return;
  }
  if (e instanceof ApiError && e.status === 403) {
    toast.error(
      /premium/i.test(e.message)
        ? "Spotify Premium is required for in-app playback"
        : "Spotify refused to play that track",
      { id: "start", description: e.message },
    );
    return;
  }
  const unregistered = e instanceof ApiError && e.status === 404;
  toast.error(
    unregistered
      ? "Spotify can't reach the in-app player"
      : "Couldn't start that track",
    {
      id: "start",
      description: unregistered
        ? "Press Space to retry, or pick a device from the speaker menu."
        : `${msg(e)} — press Space to retry.`,
    },
  );
}

/** Focused track changed with autoplay off: stop the old one, show the new one
 *  idle. Space (or the scrubber) starts it. */
export function holdFullTrack(track: SpotifyTrack) {
  ++playSeq;
  wantPlaying = false;
  usePlayerStore.setState({ buffering: false });
  sdkDetach(sdkLastPositionFor(track.uri) ?? hookOf(track), track.duration_ms);
  void ensureSdk(); // warm the connection so the first Space is quick
}

/* Transport for full-track mode. The key rule: if the SDK isn't holding the
 * focused track (never started, failed, moved to another device, reconnected),
 * "play" means START it — resuming where we left off — not resume nothing. */
registerFullTrackControls({
  toggle: () => {
    const track = currentTrack();
    if (!track) return;
    if (sdkIsStarting(track.uri) || usePlayerStore.getState().buffering) {
      // pressing pause while it's still starting = cancel the start
      ++playSeq;
      wantPlaying = false;
      usePlayerStore.setState({ buffering: false });
      sdkPause();
      return;
    }
    if (sdkIsOn(track.uri) && getDeviceId()) {
      if (usePlayerStore.getState().playing) {
        wantPlaying = false;
        sdkPause();
      } else {
        wantPlaying = true;
        sdkResume();
      }
      return;
    }
    void playFullTrack(track, {
      positionMs: sdkLastPositionFor(track.uri) ?? undefined,
    });
  },
  play: () => {
    const track = currentTrack();
    if (!track) return;
    if (sdkIsOn(track.uri) && getDeviceId()) {
      wantPlaying = true;
      sdkResume();
    } else if (!sdkIsStarting(track.uri)) {
      void playFullTrack(track, {
        positionMs: sdkLastPositionFor(track.uri) ?? undefined,
      });
    }
  },
  pause: () => {
    ++playSeq;
    wantPlaying = false;
    usePlayerStore.setState({ buffering: false });
    sdkPause();
  },
  seek: (ms) => {
    const track = currentTrack();
    if (!track) return;
    if (sdkIsOn(track.uri) && getDeviceId()) sdkSeek(ms);
    else void playFullTrack(track, { positionMs: ms });
  },
});

/* SDK events the user should hear about. */
let handingOffUntil = 0;

/** A player that connects fine but whose audio licence Spotify refuses
 *  (`POST /widevine-license` → 403) reports one `playback_error` per attempt,
 *  forever. Repeated failures in a short window mean it will never play
 *  here, so stop the loop and fall back instead of spamming errors. */
const ERROR_LIMIT = 3;
const ERROR_WINDOW_MS = 20_000;
let playbackErrors: number[] = [];
const LICENCE_REFUSED =
  "Spotify refused the audio licence for this player. Reconnect Spotify " +
  "(old logins lack the streaming permission), check the account has " +
  "Premium, or try Chrome / Edge — previews still work.";
registerSdkListeners({
  autoplayBlocked: () => {
    if (!fullTracksOn()) return;
    toast.info("Your browser blocked autoplay", {
      id: "autoplay",
      description: "Press Space or click play to start the track.",
    });
  },
  playbackError: (message) => {
    if (!fullTracksOn()) return;
    usePlayerStore.setState({ buffering: false });
    const now = Date.now();
    playbackErrors = playbackErrors
      .filter((t) => now - t < ERROR_WINDOW_MS)
      .concat(now);
    if (playbackErrors.length >= ERROR_LIMIT) {
      playbackErrors = [];
      toast.dismiss("start");
      fallBackToPreviews(LICENCE_REFUSED);
      return;
    }
    toast.error("Spotify couldn't play this track", {
      id: "start",
      description: `${message} — press Space to retry.`,
    });
  },
  lostDevice: () => {
    if (!fullTracksOn() || Date.now() < handingOffUntil) return;
    toast.info("Playback moved to another Spotify device", {
      id: "lost-device",
      description: "Press Space to bring it back here.",
    });
  },
  fatal: (message) => {
    if (fullTracksOn()) fallBackToPreviews(message);
  },
});

if (typeof window !== "undefined") {
  // back online after a drop: rebuild a dead player right away rather than on
  // the next keypress
  window.addEventListener("online", () => {
    if (fullTracksOn() && getSdkStatus() === "error") void ensureSdk();
  });
}

/* ---------------------------------------------------- explicit device pick */

/** Send the current track to a device the user picked by name. Unlike the old
 *  "guess the active device" path, a failure here is unambiguous. */
export async function playOnDevice(
  track: SpotifyTrack,
  device: SpotifyDevice,
): Promise<void> {
  if (!device.id) return;
  // the in-app player will report losing playback — that's the point here
  handingOffUntil = Date.now() + 5000;
  try {
    await playTrackOnDevice(device.id, track.uri);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      // Old tokens predate the playback scopes; a refresh keeps the old set,
      // so the only fix is a fresh authorization.
      if (/scope/i.test(e.message)) {
        toast.error("Reconnect Spotify to allow playback control", {
          action: {
            label: "Reconnect",
            onClick: () => void useAuthStore.getState().login(),
          },
        });
      } else {
        toast.error("Spotify Premium is required to control playback");
      }
      return;
    }
    toast.error(
      e instanceof QuotaError
        ? "Spotify quota exceeded — try again shortly"
        : `Couldn't play on ${device.name}`,
      { description: e instanceof QuotaError ? undefined : msg(e) },
    );
  }
}
