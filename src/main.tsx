import "@/lib/storage-rename"; // must stay first: runs before the stores hydrate
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";
import "./index.css";

// Installed-app updates: never reload mid-session on our own — offer it.
const updateSW = registerSW({
  onNeedRefresh() {
    toast("A new version of Spoton is ready", {
      duration: Infinity,
      action: { label: "Reload", onClick: () => void updateSW(true) },
    });
  },
});

if (import.meta.env.DEV) {
  // handy for debugging in the console: window.__spoton.session.getState()
  void (async () => {
    const [auth, lib, session, player, ui] = await Promise.all([
      import("@/store/useAuthStore"),
      import("@/store/useLibraryStore"),
      import("@/store/useSessionStore"),
      import("@/store/usePlayerStore"),
      import("@/store/useUiStore"),
    ]);
    (window as unknown as { __spoton: unknown }).__spoton = {
      auth: auth.useAuthStore,
      lib: lib.useLibraryStore,
      session: session.useSessionStore,
      player: player.usePlayerStore,
      ui: ui.useUiStore,
    };
  })();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <Toaster />
  </React.StrictMode>,
);
