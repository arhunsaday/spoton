/* The Web Playback SDK: this tab registers itself as a Spotify device, so we
 * can play whole tracks instead of 30s iTunes previews.
 *
 * Why the SDK rather than remote-controlling an already-open Spotify client:
 * the SDK *pushes* state (`player_state_changed`) and `seek`/`togglePlay` are
 * local calls, so a precise scrubber costs nothing. Remote control would mean
 * polling `GET /me/player` forever against the shared dev-mode quota bucket.
 *
 * Lifecycle, and why it's built this way:
 *
 * - ONE long-lived player per page. The SDK reconnects by itself after a
 *   network blip or a laptop sleep (`not_ready` … `ready` again), so a dropped
 *   connection is a "reconnecting" state to wait out, not a reason to rebuild.
 *   We only tear the player down when it stays offline past RECONNECT_GRACE_MS
 *   or a fatal error says it can never work.
 *
 * - Errors are classified. No Premium / no browser DRM / missing scopes are
 *   FATAL (retrying can't help — the caller falls back to previews). Timeouts,
 *   script-load hiccups and offline devices are TRANSIENT (retry/rebuild).
 *
 * - State events are filtered by track. After we start track B, the SDK keeps
 *   reporting track A for a moment; trusting those made the scrubber jump and
 *   the play button flicker. Until B shows up (or EXPECT_TIMEOUT_MS passes) we
 *   ignore anything else.
 *
 * - Browser autoplay policy: `activateElement()` must run inside a real user
 *   gesture. The player is created after an `await` (script load), so no call
 *   site can do it reliably — instead every pointer/key gesture on the page
 *   offers it, once per player instance. `autoplay_failed` is surfaced so the
 *   UI shows "paused" instead of a silent "playing".
 *
 * Requires Premium and a browser with EME/Widevine. Filter the console on
 * "[sdk]" when something misbehaves — every lifecycle step is traced. */

import { getDevices } from "@/api/spotify";
import { sleep } from "@/lib/utils";
import { useAuthStore } from "@/store/useAuthStore";

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";
const DEVICE_NAME = "Spoton";
/** Position events are sparse, so we interpolate between them at this rate. */
const TICK_MS = 250;
/** Script load + `ready` normally take well under a few seconds. */
const SCRIPT_TIMEOUT_MS = 15_000;
const READY_TIMEOUT_MS = 15_000;
/** `ready` says the browser player booted; Spotify Connect registers it with
 *  the account a moment later, and anything addressed to the device before then
 *  comes back 404 "Device not found". These are the waits between registration
 *  checks — growing, so a slow registration doesn't cost a burst of requests.
 *  Not seeing the device here is NOT fatal: the play call has its own 404
 *  retries and a transfer fallback. */
const REGISTER_BACKOFF_MS = [300, 500, 800, 1200, 1600];
/** How long a dropped player may take to come back by itself before we
 *  rebuild it from scratch. */
const RECONNECT_GRACE_MS = 10_000;
/** After we move the playhead, the SDK keeps echoing the pre-seek position for
 *  a moment. Trusting those echoes yanks the scrubber back, so we hold our own
 *  position this long. `paused` is never held — it's authoritative at once. */
const SEEK_GRACE_MS = 700;
/** After starting a track, ignore state for any other track this long. */
const EXPECT_TIMEOUT_MS = 5_000;

const trace = (...args: unknown[]) => console.debug("[sdk]", ...args);

export type SdkStatus = "off" | "connecting" | "ready" | "error";

export interface SdkState {
  playing: boolean;
  /** milliseconds */
  position: number;
  duration: number;
}

/** `fatal` = retrying cannot help (no Premium, no DRM, missing scopes). */
export class SdkError extends Error {
  constructor(
    message: string,
    public fatal: boolean,
  ) {
    super(message);
    this.name = "SdkError";
  }
}

/* ------------------------------------------------------------- listeners */

interface SdkListeners {
  state: (s: SdkState) => void;
  status: (s: SdkStatus, error?: string) => void;
  /** the browser blocked sound until the user interacts with the page */
  autoplayBlocked: () => void;
  /** one track failed to play; the player itself is fine */
  playbackError: (message: string) => void;
  /** playback moved to another Spotify client (phone, desktop…) */
  lostDevice: () => void;
  /** a fatal error hit a player that had already connected (e.g. the token
   *  lost its scopes mid-session) — the caller should fall back to previews */
  fatal: (message: string) => void;
}

let listeners: SdkListeners = {
  state: () => {},
  status: () => {},
  autoplayBlocked: () => {},
  playbackError: () => {},
  lostDevice: () => {},
  fatal: () => {},
};

/** The player store / playback layer register here (same pattern as
 *  `registerTokenProvider`). Partial so each layer wires only what it owns. */
export function registerSdkListeners(l: Partial<SdkListeners>) {
  listeners = { ...listeners, ...l };
}

/* ----------------------------------------------------------------- state */

let player: Spotify.Player | null = null;
let deviceId: string | null = null;
/** the device is booted AND addressable right now */
let online = false;
let status: SdkStatus = "off";
let lastError: string | null = null;

let scriptPromise: Promise<void> | null = null;
/** In-flight connection (boot or reconnect wait), shared by every caller. */
let connecting: Promise<string> | null = null;
/** Resolvers waiting for the next `ready` (after a `not_ready`). */
let readyWaiters: Array<(id: string | null) => void> = [];
/** Rejects the in-flight boot when the player is torn down under it —
 *  otherwise that promise would never settle and block every later connect. */
let abortBoot: (() => void) | null = null;
let reconnectTimer: number | null = null;
let ticker: number | null = null;

/** Last known state, plus when — the ticker extrapolates position from it. */
let anchor = { playing: false, position: 0, duration: 0, at: 0 };
/** When we last moved the playhead ourselves. See SEEK_GRACE_MS. */
let seekAt = 0;
/** uris (incl. relinked origin) of the track the SDK is actually on; null
 *  when this tab isn't the active device. */
let currentUris: string[] | null = null;
/** The track we just asked for, until the SDK confirms it. */
let expected: { uri: string; at: number } | null = null;
/** Set while the focused track is NOT the one the SDK holds (browsing with
 *  autoplay off): state events for the old track must not paint the scrubber. */
let detached = false;
/** Where we were when the SDK lost its track (device moved, went offline,
 *  detached) — so starting it again resumes instead of jumping to the hook. */
let lastKnown: { uris: string[]; position: number } | null = null;
/** Which player instance has had `activateElement()` run in a gesture. */
let activatedFor: Spotify.Player | null = null;

const livePosition = () =>
  anchor.playing
    ? Math.min(anchor.position + (Date.now() - anchor.at), anchor.duration)
    : anchor.position;

function setStatus(s: SdkStatus, error?: string) {
  status = s;
  lastError = s === "error" ? (error ?? lastError) : null;
  listeners.status(s, error);
}

export const getDeviceId = () => (online ? deviceId : null);
export const getSdkStatus = () => status;
export const getSdkError = () => lastError;

/** The pending start, if it's still worth waiting for. */
function pending() {
  if (expected && Date.now() - expected.at > EXPECT_TIMEOUT_MS) expected = null;
  return expected;
}

/** Is the in-app player loaded with this track right now (confirmed)? */
export function sdkIsOn(uri: string): boolean {
  return !detached && !pending() && !!currentUris && currentUris.includes(uri);
}

/** Has this track been requested but not confirmed by the SDK yet? */
export function sdkIsStarting(uri: string): boolean {
  return pending()?.uri === uri;
}

/** Where we left this track, if the SDK held it at some point. */
export function sdkLastPositionFor(uri: string): number | null {
  if (sdkIsOn(uri)) return livePosition();
  return lastKnown && lastKnown.uris.includes(uri) ? lastKnown.position : null;
}

function rememberPosition() {
  if (currentUris && !detached) {
    lastKnown = { uris: currentUris, position: livePosition() };
  }
}

/* -------------------------------------------------------------- plumbing */

function loadScript(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new SdkError("Spotify player script timed out", false)),
      SCRIPT_TIMEOUT_MS,
    );
    // The SDK calls this global once it has parsed; it must exist beforehand.
    window.onSpotifyWebPlaybackSDKReady = () => {
      window.clearTimeout(timer);
      resolve();
    };
    const el = document.createElement("script");
    el.src = SDK_SRC;
    el.async = true;
    el.onerror = () => {
      window.clearTimeout(timer);
      el.remove();
      reject(new SdkError("Spotify player script failed to load", false));
    };
    document.head.appendChild(el);
  });
  // a failed load must be retryable — don't cache the rejection
  scriptPromise.catch(() => {
    scriptPromise = null;
  });
  return scriptPromise;
}

let lastEmitted = "";
function emitNow() {
  const s: SdkState = {
    playing: anchor.playing,
    position: livePosition(),
    duration: anchor.duration,
  };
  // the ticker runs all the time; don't re-render the bar when nothing moved
  const key = `${s.playing}|${Math.round(s.position / 100)}|${s.duration}`;
  if (key === lastEmitted) return;
  lastEmitted = key;
  listeners.state(s);
}

function startTicker() {
  if (ticker !== null) return;
  ticker = window.setInterval(emitNow, TICK_MS);
}

function stopTicker() {
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function trackUris(t: Spotify.Track): string[] {
  return [t.uri, t.linked_from?.uri].filter((u): u is string => !!u);
}

function applyState(state: Spotify.PlaybackState | null) {
  if (!state) {
    // null = this tab is no longer the active device (playback was moved to
    // another client, or the session ended). Stop the scrubber instead of
    // letting it extrapolate forever.
    const wasOurs = currentUris !== null;
    rememberPosition();
    currentUris = null;
    expected = null;
    anchor = { ...anchor, playing: false, position: livePosition(), at: Date.now() };
    emitNow();
    if (wasOurs) listeners.lostDevice();
    return;
  }
  const uris = trackUris(state.track_window.current_track);
  if (detached) {
    currentUris = uris; // still know what's loaded, but don't paint it
    return;
  }
  if (expected) {
    const stale = !uris.includes(expected.uri);
    if (stale && Date.now() - expected.at < EXPECT_TIMEOUT_MS) return;
    expected = null; // confirmed (or we gave up waiting — trust the SDK)
  }
  currentUris = uris;
  const holdPosition = Date.now() - seekAt < SEEK_GRACE_MS;
  anchor = {
    playing: !state.paused,
    duration: state.duration || anchor.duration,
    position: holdPosition ? livePosition() : state.position,
    at: Date.now(),
  };
  emitNow();
}

/* ---------------------------------------------------------------- connect */

/** Connect (idempotent) and resolve with the device id once it's usable.
 *  The connection outlives a switch back to previews — registering costs
 *  seconds and a handful of requests, so we keep the device and just silence
 *  it. Rejects with an `SdkError`; check `.fatal`. */
export function connectSdk(initialVolume: number): Promise<string> {
  if (player && online && deviceId) return Promise.resolve(deviceId);
  if (connecting) return connecting;

  // offline past the grace period already: don't wait again, rebuild now
  const task = !player
    ? boot(initialVolume)
    : status === "error"
      ? (teardown(), boot(initialVolume))
      : awaitReconnect();
  const c = task.finally(() => {
    if (connecting === c) connecting = null;
  });
  connecting = c;
  return c;
}

/** The player exists but is offline: give the SDK's own reconnect a chance,
 *  then rebuild. */
async function awaitReconnect(): Promise<string> {
  setStatus("connecting");
  trace("waiting for the player to come back");
  const id = await new Promise<string | null>((resolve) => {
    const t = window.setTimeout(() => resolve(null), RECONNECT_GRACE_MS);
    readyWaiters.push((id) => {
      window.clearTimeout(t);
      resolve(id);
    });
  });
  if (id) return id;
  if (!player) throw new SdkError("In-app player was reset", false);
  trace("player didn't come back — rebuilding");
  const volume = anchorVolume;
  teardown();
  return boot(volume);
}

let anchorVolume = 0.8;

async function boot(initialVolume: number): Promise<string> {
  anchorVolume = initialVolume;
  setStatus("connecting");
  try {
    await loadScript();
  } catch (e) {
    const err = e instanceof SdkError ? e : new SdkError(String(e), false);
    setStatus("error", err.message);
    throw err;
  }

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const p = new window.Spotify.Player({
      name: DEVICE_NAME,
      getOAuthToken: (cb) => {
        void useAuthStore
          .getState()
          .getValidAccessToken()
          .then((t) => {
            if (t) cb(t);
            else fail(new SdkError("Reconnect Spotify to allow in-app playback", true));
          });
      },
      volume: initialVolume,
    });
    player = p;

    const timer = window.setTimeout(
      () => fail(new SdkError("Spotify player timed out while connecting", false)),
      READY_TIMEOUT_MS,
    );
    abortBoot = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new SdkError("In-app player was reset", false));
    };

    function succeed(id: string) {
      if (player !== p) return;
      online = true;
      clearReconnectTimer();
      setStatus("ready");
      const waiters = readyWaiters;
      readyWaiters = [];
      waiters.forEach((w) => w(id));
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        abortBoot = null;
        resolve(id);
      }
    }

    function fail(err: SdkError) {
      if (player !== p) return; // a superseded instance — ignore
      trace("failed:", err.message, err.fatal ? "(fatal)" : "");
      window.clearTimeout(timer);
      setStatus("error", err.message);
      const afterBoot = settled;
      if (!settled) {
        settled = true;
        reject(err);
      }
      if (err.fatal) {
        teardown(true);
        if (afterBoot) listeners.fatal(err.message);
      }
    }

    p.addListener("ready", ({ device_id }) => {
      if (player !== p) return;
      deviceId = device_id;
      trace("player booted, device", device_id, "— awaiting registration");
      startTicker();
      // Don't report ready until the device is addressable — "connected" has
      // to mean "usable", or the first play lands in the 404 window. A slow
      // registration is tolerated (play retries on 404), so this never fails.
      void awaitRegistration(device_id).then((seen) => {
        if (player !== p || deviceId !== device_id) return;
        trace(seen ? "registered and ready" : "not listed yet — going ahead anyway");
        succeed(device_id);
      });
    });

    p.addListener("not_ready", ({ device_id }) => {
      if (player !== p) return;
      trace("device went offline", device_id);
      online = false;
      rememberPosition();
      currentUris = null;
      expected = null;
      anchor = { ...anchor, playing: false, position: livePosition(), at: Date.now() };
      emitNow();
      // the SDK usually comes back on its own — show "reconnecting", and only
      // call it an error if it doesn't
      setStatus("connecting");
      clearReconnectTimer();
      reconnectTimer = window.setTimeout(() => {
        if (player === p && !online) {
          setStatus("error", "Spotify player went offline");
        }
      }, RECONNECT_GRACE_MS);
    });

    p.addListener("player_state_changed", (state) => {
      if (player !== p) return;
      applyState(state);
    });

    p.addListener("autoplay_failed", () => {
      if (player !== p) return;
      trace("autoplay blocked by the browser");
      activatedFor = null; // the next gesture must activate again
      anchor = { ...anchor, playing: false, position: livePosition(), at: Date.now() };
      emitNow();
      listeners.autoplayBlocked();
    });

    // Premium and browser-DRM failures land here, before `ready`.
    p.addListener("account_error", () =>
      fail(new SdkError("Spotify Premium is required for in-app playback", true)),
    );
    p.addListener("initialization_error", ({ message }) =>
      fail(new SdkError(`This browser can't run the Spotify player: ${message}`, true)),
    );
    p.addListener("authentication_error", ({ message }) => {
      trace("authentication_error:", message);
      fail(new SdkError("Reconnect Spotify to allow in-app playback", true));
    });
    // one track failed (region lock, unavailable…) — the player is fine
    p.addListener("playback_error", ({ message }) => {
      if (player !== p) return;
      trace("playback_error:", message);
      expected = null;
      listeners.playbackError(message);
    });

    void p
      .connect()
      .then((ok) => {
        if (!ok) fail(new SdkError("Spotify player refused to connect", false));
      })
      .catch((e) => fail(new SdkError(String(e), false)));
  });
}

/** Poll until Spotify itself lists the device, so callers can address it. */
async function awaitRegistration(id: string): Promise<boolean> {
  for (const wait of REGISTER_BACKOFF_MS) {
    await sleep(wait);
    if (deviceId !== id) return false;
    try {
      const devices = await getDevices();
      if (devices.some((d) => d.id === id)) return true;
      trace("registration probe:", devices.map((d) => d.name));
    } catch {
      // a failed probe says nothing about the device — keep waiting
    }
  }
  return false;
}

function teardown(keepError = false) {
  stopTicker();
  clearReconnectTimer();
  const leaving = player;
  player = null;
  deviceId = null;
  online = false;
  currentUris = null;
  expected = null;
  detached = false;
  activatedFor = null;
  anchor = { playing: false, position: 0, duration: 0, at: 0 };
  lastEmitted = "";
  const waiters = readyWaiters;
  readyWaiters = [];
  waiters.forEach((w) => w(null));
  const abort = abortBoot;
  abortBoot = null;
  abort?.();
  connecting = null;
  // pause first: `disconnect()` on its own can leave the last buffer sounding,
  // which would overlap the preview we're switching back to
  if (leaving) {
    void leaving
      .pause()
      .catch(() => {})
      .finally(() => leaving.disconnect());
  }
  if (!keepError) setStatus("off");
}

/** Tear the player down for good. Switching back to previews does NOT do this
 *  — see `connectSdk`; this is for a player that failed and must be rebuilt. */
export function disconnectSdk() {
  teardown();
}

/* --------------------------------------------------------------- gestures */

/** Satisfies the browser autoplay policy. Must ride a real user gesture; safe
 *  to call anywhere — it's a no-op outside one, and runs once per player. */
export function activateSdkElement() {
  if (!player || activatedFor === player) return;
  activatedFor = player;
  void player.activateElement().catch(() => {
    activatedFor = null;
  });
}

if (typeof window !== "undefined") {
  // every real gesture offers activation; capture phase so nothing can
  // swallow it first
  for (const ev of ["pointerdown", "keydown", "touchend"] as const) {
    window.addEventListener(ev, activateSdkElement, { capture: true, passive: true });
  }
  // background tabs throttle timers and the SDK may have drifted (or slept) —
  // resync from the source of truth when we're visible again
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !player || !online) return;
    void player.getCurrentState().then((s) => {
      // null here can also mean "nothing loaded yet" — only treat it as a
      // device loss if we thought we had a track
      if (s || currentUris) applyState(s);
    });
  });
}

/* Local commands — no network, no quota.
 *
 * Only seeking updates the anchor optimistically, so the scrubber answers on
 * the same frame. Play/pause deliberately does NOT: these are local operations
 * the SDK confirms within a frame or two, and predicting them meant our guess
 * and the SDK's echo took turns winning — which is what made the button flicker.
 *
 * They also address the transport explicitly rather than toggling, so a command
 * can't invert into its opposite when our idea of the state has drifted. */

export function sdkSeek(ms: number) {
  if (!player) return;
  const clamped = Math.max(0, Math.min(ms, anchor.duration || ms));
  seekAt = Date.now();
  anchor = { ...anchor, position: clamped, at: Date.now() };
  emitNow();
  void player.seek(clamped).catch(() => {});
}

export function sdkResume() {
  activateSdkElement();
  void player?.resume().catch(() => {});
}

export function sdkPause() {
  void player?.pause().catch(() => {});
}

export function sdkSetVolume(v: number) {
  anchorVolume = v;
  void player?.setVolume(v).catch(() => {});
}

/** Called just before a new track is requested, so the scrubber shows the new
 *  one and stale events from the old one are ignored. */
export function sdkExpect(uri: string, positionMs: number, durationMs: number) {
  detached = false;
  expected = { uri, at: Date.now() };
  seekAt = Date.now(); // a new track is a playhead move like any other
  anchor = { playing: false, position: positionMs, duration: durationMs, at: Date.now() };
  emitNow();
}

/** The start request failed — stop waiting for that track. */
export function sdkExpectFailed() {
  expected = null;
}

/** The start request succeeded: show "playing" right away (the SDK confirms
 *  within a beat, or `autoplay_failed` corrects it). */
export function sdkStarted(uri: string, positionMs: number, durationMs: number) {
  if (expected && expected.uri !== uri) return; // superseded meanwhile
  anchor = { playing: true, position: positionMs, duration: durationMs, at: Date.now() };
  emitNow();
}

/** The focused track changed but shouldn't start (autoplay off): pause
 *  whatever the SDK holds and show the new track idle at `positionMs`. */
export function sdkDetach(positionMs: number, durationMs: number) {
  rememberPosition();
  detached = true;
  expected = null;
  void player?.pause().catch(() => {});
  anchor = { playing: false, position: positionMs, duration: durationMs, at: Date.now() };
  emitNow();
}
