import { create } from "zustand";
import { persist } from "zustand/middleware";

export type View = "focus" | "feed";

interface UiState {
  setupOpen: boolean;
  /** which tab the setup dialog shows */
  setupTab: "playlists" | "feed" | "settings";
  helpOpen: boolean;
  /** focus = one track + keyboard; feed = TikTok-style swipe deck */
  view: View;
  /** the feed's gesture hint was dismissed */
  feedHintSeen: boolean;
  setSetupOpen: (v: boolean, tab?: UiState["setupTab"]) => void;
  setSetupTab: (t: UiState["setupTab"]) => void;
  setHelpOpen: (v: boolean) => void;
  toggleHelp: () => void;
  setView: (v: View) => void;
  dismissFeedHint: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      setupOpen: false,
      setupTab: "playlists",
      helpOpen: false,
      view: "focus",
      feedHintSeen: false,
      // opening without a tab lands on Playlists, the common case
      setSetupOpen: (v, tab) =>
        set(v ? { setupOpen: true, setupTab: tab ?? "playlists" } : { setupOpen: false }),
      setSetupTab: (setupTab) => set({ setupTab }),
      setHelpOpen: (v) => set({ helpOpen: v }),
      toggleHelp: () => set({ helpOpen: !get().helpOpen }),
      setView: (view) => set({ view }),
      dismissFeedHint: () => set({ feedHintSeen: true }),
    }),
    {
      name: "spoton.ui",
      partialize: (s) => ({ view: s.view, feedHintSeen: s.feedHintSeen }),
    },
  ),
);
