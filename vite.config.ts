import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

// Loopback IP + fixed port so the redirect URI is stable and matches Spotify's
// rules (localhost is banned; 127.0.0.1 over http is allowed for local dev).
export default defineConfig({
  plugins: [
    react(),
    // Installable on iOS / Android. The service worker only precaches the app
    // shell; Spotify / iTunes calls and the playback SDK stay network-only.
    VitePWA({
      // "prompt": a new deploy never reloads you mid-triage — a toast asks.
      registerType: "prompt",
      includeAssets: ["favicon.png", "favicon-32x32.png", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Spoton — fast playlist triage",
        short_name: "Spoton",
        description:
          "Sort tracks into your Spotify playlists fast: preview, swipe or hit a hotkey, next.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#0a0c14",
        background_color: "#0a0c14",
        categories: ["music", "productivity"],
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
