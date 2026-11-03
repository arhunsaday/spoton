import { create } from "zustand";
import { persist } from "zustand/middleware";

export type View = "focus" | "feed";

interface UiState {
  setupOpen: boolean;
  helpOpen: boolean;
  /** focus = one track + keyboard; feed = TikTok-style swipe deck */
  view: View;
  /** the feed's gesture hint was dismissed */
  feedHintSeen: boolean;
  setSetupOpen: (v: boolean) => void;
  setHelpOpen: (v: boolean) => void;
  toggleHelp: () => void;
  setView: (v: View) => void;
  dismissFeedHint: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      setupOpen: false,
      helpOpen: false,
      view: "focus",
      feedHintSeen: false,
      setSetupOpen: (v) => set({ setupOpen: v }),
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
