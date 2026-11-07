import { useMemo } from "react";
import {
  Check,
  ChevronDown,
  Disc3,
  GalleryVertical,
  Heart,
  Keyboard,
  ListMusic,
  Loader2,
  LogOut,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LIKED_SOURCE_ID, useLibraryStore } from "@/store/useLibraryStore";
import { countPending, useSessionStore } from "@/store/useSessionStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useUiStore } from "@/store/useUiStore";
import { cn } from "@/lib/utils";
import { TrackJump } from "./TrackJump";

/** Focus (one track, keyboard-first) ↔ Feed (swipe deck). */
function ViewToggle() {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const opts = [
    { id: "focus" as const, label: "Focus", Icon: Disc3 },
    { id: "feed" as const, label: "Feed", Icon: GalleryVertical },
  ];
  return (
    <div role="radiogroup" aria-label="View" className="mr-1 flex h-9 items-center rounded-lg bg-secondary p-1">
      {opts.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={view === id}
          onClick={() => setView(id)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-sm sm:px-2.5 font-medium text-muted-foreground transition-colors hover:text-foreground",
            view === id && "bg-background text-foreground shadow-sm",
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

export function TopBar() {
  const sourceId = useLibraryStore((s) => s.sourceId);
  const playlists = useLibraryStore((s) => s.playlists);
  const openSetup = useUiStore((s) => s.setSetupOpen);
  const toggleHelp = useUiStore((s) => s.toggleHelp);

  const index = useSessionStore((s) => s.index);
  const total = useSessionStore((s) => s.tracks.length);
  const syncing = useSessionStore((s) => s.syncing);
  const loadedCount = useSessionStore((s) => s.loaded);
  const sourceTotal = useSessionStore((s) => s.total);
  const filed = useSessionStore((s) => s.stats.filed);
  const membership = useSessionStore((s) => s.membership);
  const baseMembership = useSessionStore((s) => s.baseMembership);
  const applyPending = useSessionStore((s) => s.applyPending);
  const discardPending = useSessionStore((s) => s.discardPending);
  const applying = useSessionStore((s) => s.applying);

  const targets = useLibraryStore((s) => s.targets);
  const batchMode = useLibraryStore((s) => s.settings.batchMode);

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const pending = useMemo(
    () => countPending(baseMembership, membership, targets),
    [baseMembership, membership, targets],
  );

  const isLiked = sourceId === LIKED_SOURCE_ID;
  const sourcePlaylist = playlists.find((p) => p.id === sourceId);
  const sourceName = isLiked
    ? "Liked Songs"
    : (sourcePlaylist?.name ?? "Choose a source");
  const sourceImage = sourcePlaylist?.images?.[0]?.url;

  const pct = total > 0 ? ((index + 1) / total) * 100 : 0;

  return (
    <header className="box-content flex h-14 shrink-0 items-center pt-[env(safe-area-inset-top)] gap-2 border-b border-border px-3 sm:gap-4 sm:px-4">
      {/* <img
        src="/pwa-192x192.png"
        alt="Spoton"
        className="h-7 w-7 shrink-0 rounded-md drag-none"
        draggable={false}
      /> */}
      {/* <div className="h-6 w-px bg-border" /> */}

      <button
        onClick={() => openSetup(true)}
        className="group -my-1 flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2.5 transition-colors hover:bg-accent"
      >
        {isLiked ? (
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15">
            <Heart className="h-5 w-5 text-primary stroke-[0.2rem]" />
          </div>
        ) : sourceImage ? (
          <img
            src={sourceImage}
            alt=""
            className="h-9 w-9 rounded-md object-cover drag-none"
            draggable={false}
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <ListMusic className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="text-left leading-tight">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Source
          </div>
          <div className="flex items-center gap-1">
            <span className="max-w-[24vw] truncate sm:max-w-[32vw] text-sm font-semibold">
              {sourceName}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100" />
          </div>
        </div>
      </button>

      {/* session progress — phones keep the jump-to counter, drop the bar */}
      <div className="flex items-center gap-3 md:flex-1">
        <Progress value={pct} className="hidden h-1.5 max-w-xs md:block" />
        <TrackJump />
      </div>
      <div className="hidden items-center gap-3 md:flex md:flex-1">
        {syncing && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 text-xs text-muted-foreground tabnum">
                <Loader2 className="h-3 w-3 animate-spin" />
                {sourceTotal > loadedCount && loadedCount > 0
                  ? `${loadedCount} / ${sourceTotal}`
                  : null}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Checking Spotify for changes — you can keep sorting
            </TooltipContent>
          </Tooltip>
        )}
        {batchMode
          ? pending > 0 && (
              <div className="flex h-7 items-center overflow-hidden rounded-md">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => void applyPending()}
                      disabled={applying}
                      className="flex h-full items-center gap-1.5 bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-progress disabled:hover:bg-primary"
                    >
                      {applying ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      {applying ? "Applying…" : `Apply ${pending}`}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {applying ? "Applying…" : "Apply queued changes · Enter"}
                  </TooltipContent>
                </Tooltip>
                <div className="h-full w-px bg-primary-foreground/25" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => discardPending()}
                      disabled={applying}
                      aria-label="Discard queued changes"
                      className="flex h-full items-center bg-primary px-2 text-primary-foreground/70 transition-colors hover:bg-primary/90 hover:text-primary-foreground disabled:cursor-progress disabled:hover:bg-primary disabled:hover:text-primary-foreground/70"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Ignore — discard queued</TooltipContent>
                </Tooltip>
              </div>
            )
          : filed > 0 && (
              <Badge variant="success" className="gap-1">
                <Sparkles className="h-3 w-3" /> {filed} changes
              </Badge>
            )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <ViewToggle />

        {user && user.product !== "premium" && (
          <Badge variant="warning">Non premium account</Badge>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="hidden md:inline-flex"
              variant="ghost"
              size="icon-sm"
              onClick={() => toggleHelp()}
              aria-label="Keyboard shortcuts"
            >
              <Keyboard className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Shortcuts (<span className="font-mono">?</span>)
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="hidden md:inline-flex"
              variant="ghost"
              size="icon-sm"
              onClick={logout}
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Log out {user?.display_name ?? ""}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
