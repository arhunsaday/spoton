# Spoton

A fast, keyboard-driven personal tool for triaging Spotify tracks into playlists.
Preview the current track, arrow left/right through a source playlist, and press
a hotkey to add/remove it to/from a target playlist.

Spoton is a static single-page app (Vite + React). There is no backend: login
uses OAuth Authorization Code + PKCE straight from the browser. Because of
that, **you have to create your own Spotify app** and give Spoton its Client ID.
It takes about five minutes.

## Requirements

- **Spotify Premium.** A Spotify app in development mode only works if its
  owner has Premium, and in-tab full-track playback needs Premium too.
- **Node.js 18+** and **pnpm** (`npm i -g pnpm`).
- **A desktop Chromium browser, Firefox or Safari** for full-track playback (the
  Web Playback SDK needs DRM/Widevine). 30s previews work everywhere.

## 1. Create the Spotify app

1. Go to <https://developer.spotify.com/dashboard> and log in with the Spotify
   account you'll use with Spoton.
2. Click **Create app** and fill it in:
   - **App name / description:** anything, e.g. `Spoton`.
   - **Redirect URIs:** add each URL you'll open Spoton from, **exactly**, with
     the trailing slash:
     - local dev: `http://127.0.0.1:5173/`
     - deployed: your HTTPS URL, e.g. `https://spoton.example.com/`

     Spotify rejects `http://localhost` (you must use `127.0.0.1`) and any
     non-HTTPS URL other than a loopback IP. The URI must match character for
     character. The login screen shows the exact value to register.
   - **Which API/SDKs are you planning to use?** tick both **Web API** and
     **Web Playback SDK**. Without the second, full-track mode fails with an
     authentication error.
3. Accept the terms and click **Save**.
4. Open the app's **Settings** and copy the **Client ID**. You don't need the
   client secret, so never put it in this app.
5. Open **User Management** and add every Spotify account that will log in:
   the name plus the **email address of that Spotify account**. That includes
   your own account if it isn't the one that created the app. A development-mode
   app accepts at most **5 users**, and anyone not on this list gets
   `403` errors.

> Individual developers can't get out of development mode (extended quota is
> for organisations only), so the 5-user limit and the shared request quota are
> permanent. That's fine for a personal tool. Spoton caches heavily to stay
> under the quota.

## 2. Run it locally

```bash
pnpm install
```

Optional: pre-fill the Client ID so you don't have to paste it in the UI:

```bash
cp .env.example .env.local
```

Then set `VITE_SPOTIFY_CLIENT_ID=<your client id>` in `.env.local`.

```bash
pnpm dev
```

Open **<http://127.0.0.1:5173/>**, not `localhost`. Spotify would redirect you
back to a different origin and the login would fail. Paste the Client ID if you
didn't set it in `.env.local`, then click **Log in with Spotify** and approve the
permissions.

## 3. Deploy (optional)

```bash
pnpm build
```

Serve `dist/` from any static host with HTTPS (Netlify, Vercel, Cloudflare
Pages, GitHub Pages…), at the **root** of the domain, since the redirect URI is
the origin plus `/`. Add that HTTPS URL to the app's Redirect URIs in the
dashboard, and set `VITE_SPOTIFY_CLIENT_ID` in the host's build environment
(or paste it on the login screen).

## Using it

1. On first login the setup dialog opens: pick a **source** playlist (or Liked
   Songs) and up to 20 **target** playlists. Each target gets a hotkey.
2. Sort:

   | Key | Action |
   | --- | --- |
   | `←` / `→` (or `h` / `l`) | previous / next track |
   | `Space` | play / pause |
   | `1`–`9`, `0`, `q`–`p` | add/remove the current track to/from that target |
   | `Enter` | apply queued changes (batch mode) |
   | `z` | undo last action |
   | `f` | switch between 30s preview and full track |
   | `?` | command palette / all shortcuts |

### Audio: preview vs. full track

- **Preview (default):** a 30s clip found through the iTunes Search API. It
  costs nothing against your Spotify quota and works for about 96% of tracks.
- **Full track:** click the **Preview / Full track** button in the player bar,
  or press `f`. This tab then registers as a Spotify Connect device called
  **"Spoton"** and plays the whole track in the browser, starting about 30% in
  so you land on the hook.
  - The first switch takes a few seconds while the device registers.
  - If the browser blocks autoplay, press `Space` or click play once.
  - If you move playback to your phone/desktop app, press `Space` to bring it
    back to the tab. It resumes where you were.
  - If the connection drops (network loss, laptop sleep), the player reconnects
    by itself. If it can't, the button turns into **Reconnect**.
  - Without Premium, a supported browser or the right permissions, Spoton falls
    back to previews and tells you why.
  - The speaker icon sends the current track to another Spotify device instead.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `INVALID_CLIENT: Invalid redirect URI` | The URL in the address bar doesn't match a registered Redirect URI exactly. Use `http://127.0.0.1:5173/` locally, not `localhost`. |
| `403` / "user not registered" after login | Add the account's email under **User Management** in the dashboard. |
| "Reconnect Spotify to allow in-app playback" | Your token predates the playback permissions. Click **Reconnect** (or log out and in) to approve them. Also check that **Web Playback SDK** is ticked in the app settings. |
| "Spotify Premium is required" | The logged-in account (and the app owner) need Premium for full tracks. Previews still work. |
| "This browser can't run the Spotify player" | The browser lacks DRM (e.g. some Linux Chromium builds, or Widevine disabled). Use Chrome, Edge, Firefox or Safari. |
| "Spotify refused the audio licence" (console: `POST …/widevine-license… 403`, repeated `[sdk] playback_error`) | The player connected, but Spotify won't hand it the decryption key. In order: click **Reconnect** (logins from before full-track mode lack the `streaming` permission, and refreshing never adds it); make sure the account is **Premium** and listed under **User Management**; make sure **Web Playback SDK** is ticked in the app settings; try Chrome or Edge, since the DRM module differs between browsers. Spoton stops after 3 refusals and goes back to previews. |
| Firefox console: `Security Error: Content at https://sdk.scdn.co/… may not load or link to file:///` | Noise from the SDK's own iframe. Harmless. |
| "Spotify quota exceeded" | Development-mode apps share a request budget. Wait a minute. |

Debug logs: open the browser console and filter on `[sdk]` / `[playback]`.
