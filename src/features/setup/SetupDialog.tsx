import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Heart,
  ListMusic,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { LIKED_SOURCE_ID, useLibraryStore } from "@/store/useLibraryStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useUiStore } from "@/store/useUiStore";
import { useAuthStore } from "@/store/useAuthStore";
import type { SpotifyPlaylist } from "@/types";
import type { Settings } from "@/store/useLibraryStore";
import { MAX_TARGETS } from "@/lib/hotkeys";
import { clearAllCaches } from "@/lib/cache";

/* Spotify's Web API doesn't expose playlist folders, so the library is
 * grouped by what it CAN tell us: who owns each playlist and whether it's
 * collaborative. That also decides what can be a target — Spotify refuses
 * writes to playlists you merely follow. */
type GroupId = "mine" | "collab" | "spotify" | "followed";

const GROUPS: { id: GroupId; label: string; hint?: string }[] = [
  { id: "mine", label: "Created by you" },
  { id: "collab", label: "Collaborative" },
  { id: "spotify", label: "Made by Spotify", hint: "source only" },
  { id: "followed", label: "Followed", hint: "source only" },
];

function groupOf(p: SpotifyPlaylist, me: string | undefined): GroupId {
  if (me && p.owner.id === me) return "mine";
  if (p.collaborative) return "collab";
  if (p.owner.id === "spotify") return "spotify";
  return "followed";
}

/** Spotify accepts adds/removes only on your own or collaborative lists. */
const editable = (g: GroupId) => g === "mine" || g === "collab";

export function SetupDialog() {
  const open = useUiStore((s) => s.setupOpen);
  const setOpen = useUiStore((s) => s.setSetupOpen);

  const playlists = useLibraryStore((s) => s.playlists);
  const loading = useLibraryStore((s) => s.loadingPlaylists);
  const loadPlaylists = useLibraryStore((s) => s.loadPlaylists);
  const sourceId = useLibraryStore((s) => s.sourceId);
  const setSource = useLibraryStore((s) => s.setSource);
  const targets = useLibraryStore((s) => s.targets);
  const toggleTarget = useLibraryStore((s) => s.toggleTarget);
  const collapsed = useLibraryStore((s) => s.collapsedGroups);
  const toggleGroup = useLibraryStore((s) => s.toggleGroup);
  const me = useAuthStore((s) => s.user?.id);

  const [q, setQ] = useState("");

  useEffect(() => {
    if (open && playlists.length === 0) void loadPlaylists();
  }, [open, playlists.length, loadPlaylists]);

  const filtered = useMemo(
    () =>
      playlists.filter((p) =>
        p.name.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [playlists, q],
  );

  const grouped = useMemo(() => {
    const by: Record<GroupId, SpotifyPlaylist[]> = {
      mine: [],
      collab: [],
      spotify: [],
      followed: [],
    };
    for (const p of filtered) by[groupOf(p, me)].push(p);
    return by;
  }, [filtered, me]);
  const searching = q.trim().length > 0;

  const targetKey = (id: string) => targets.find((t) => t.id === id)?.key;
  const targetsFull = (id: string) =>
    targets.length >= MAX_TARGETS && !targetKey(id);

  /** Throw away every cached list and re-read everything from Spotify. */
  const hardRefresh = async () => {
    await clearAllCaches();
    await loadPlaylists(true);
    const sid = useLibraryStore.getState().sourceId;
    if (sid) void useSessionStore.getState().loadSource(sid, { force: true });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(86vh,780px)] max-w-2xl flex-col gap-0 p-0">
        <Tabs defaultValue="playlists" className="flex min-h-0 flex-1 flex-col">
        <DialogHeader className="space-y-3 p-6 pb-4">
          <div>
            <DialogTitle>Set up your session</DialogTitle>
            <DialogDescription className="mt-1.5">
              Pick a source to triage, then choose target playlists — each gets
              a hotkey.
            </DialogDescription>
          </div>
          <TabsList className="self-start">
            <TabsTrigger value="playlists">
              <ListMusic className="h-4 w-4" /> Playlists
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings2 className="h-4 w-4" /> Settings
            </TabsTrigger>
          </TabsList>
        </DialogHeader>

        <TabsContent
          value="playlists"
          className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
        <div className="flex items-center gap-2 px-6 pb-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search playlists"
              className="pl-8"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => void hardRefresh()}
            disabled={loading}
            aria-label="Refresh from Spotify"
            title="Refresh from Spotify — clears the local cache and re-reads everything"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border scrollbar-thin">
          <div className="space-y-1 p-3">
            {/* Liked Songs — usable as a source *and* as a target */}
            {"liked songs".includes(q.trim().toLowerCase()) && (
              <Row
                title="Liked Songs"
                subtitle="your saved tracks"
                icon={
                  <Heart className="h-5 w-5 text-primary stroke-[0.2rem]" />
                }
                isSource={sourceId === LIKED_SOURCE_ID}
                onSource={() => setSource(LIKED_SOURCE_ID)}
                targetKey={targetKey(LIKED_SOURCE_ID)}
                onToggleTarget={() =>
                  toggleTarget({ id: LIKED_SOURCE_ID, name: "Liked Songs" })
                }
                targetsFull={targetsFull(LIKED_SOURCE_ID)}
              />
            )}

            {GROUPS.map((g) => {
              const items = grouped[g.id];
              if (items.length === 0) return null;
              // a search always shows its hits, folded or not
              const open = searching || !collapsed.includes(g.id);
              return (
                <section key={g.id} className="pt-2">
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.id)}
                    aria-expanded={open}
                    className="sticky top-0 z-10 flex w-full items-center gap-2 rounded-md bg-background/95 px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur hover:text-foreground"
                  >
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        !open && "-rotate-90",
                      )}
                    />
                    {g.label}
                    <span className="tabnum font-normal normal-case tracking-normal">
                      {items.length}
                    </span>
                    {g.hint && (
                      <span className="ml-auto font-normal normal-case tracking-normal text-muted-foreground/70">
                        {g.hint}
                      </span>
                    )}
                  </button>
                  {open && (
                    <div className="space-y-1 pt-1">
                      {items.map((p) => (
                        <Row
                          key={p.id}
                          title={p.name}
                          subtitle={`${p.tracks.total} tracks${
                            g.id === "mine"
                              ? ""
                              : ` · ${p.owner.display_name ?? p.owner.id}`
                          }`}
                          imageUrl={p.images?.[0]?.url}
                          isSource={sourceId === p.id}
                          onSource={() => setSource(p.id)}
                          targetKey={targetKey(p.id)}
                          // read-only lists can't be targets — but one picked
                          // before this rule must still be removable
                          onToggleTarget={
                            editable(g.id) || targetKey(p.id)
                              ? () =>
                                  toggleTarget({
                                    id: p.id,
                                    name: p.name,
                                    imageUrl: p.images?.[0]?.url,
                                  })
                              : undefined
                          }
                          targetsFull={targetsFull(p.id)}
                          readOnly={!editable(g.id)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}

            {!loading && filtered.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No playlists match “{q}”.
              </p>
            )}
          </div>
        </div>

        </TabsContent>

        <TabsContent
          value="settings"
          className="mt-0 min-h-0 flex-1 overflow-y-auto border-t border-border scrollbar-thin data-[state=inactive]:hidden"
        >
          <SettingsSection />
        </TabsContent>
        </Tabs>

        <div className="flex justify-end border-t border-border p-4">
          <Button onClick={() => setOpen(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row(props: {
  title: string;
  subtitle: string;
  imageUrl?: string;
  icon?: React.ReactNode;
  isSource: boolean;
  onSource: () => void;
  targetKey?: string;
  onToggleTarget?: () => void;
  targetsFull?: boolean;
  /** shown, but disabled: Spotify won't accept writes to this playlist */
  readOnly?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-transparent p-2 transition-colors hover:bg-accent",
        props.isSource && "border-primary/40 bg-primary/5",
      )}
    >
      {props.imageUrl ? (
        <img
          src={props.imageUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded-md object-cover drag-none"
          draggable={false}
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
          {props.icon ?? (
            <ListMusic className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{props.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {props.subtitle}
        </p>
      </div>

      <Button
        variant={props.isSource ? "default" : "outline"}
        size="sm"
        onClick={props.onSource}
      >
        {props.isSource ? "Source" : "Set source"}
      </Button>

      {props.readOnly && !props.onToggleTarget && (
        <Button
          variant="ghost"
          size="sm"
          className="min-w-[84px]"
          disabled
          title="You can only add tracks to playlists you own or collaborate on"
        >
          <Lock className="mr-1 h-3.5 w-3.5" /> target
        </Button>
      )}

      {props.onToggleTarget && (
        <Button
          variant={props.targetKey ? "secondary" : "ghost"}
          size="sm"
          className="min-w-[84px]"
          onClick={props.onToggleTarget}
          disabled={props.targetsFull}
          title={props.targetsFull ? `Max ${MAX_TARGETS} targets` : undefined}
        >
          {props.targetKey ? (
            <>
              <Kbd className="mr-1 h-5 min-w-5">{props.targetKey}</Kbd> target
            </>
          ) : (
            <>
              <Plus className="mr-1 h-4 w-4" /> target
            </>
          )}
        </Button>
      )}
    </div>
  );
}

function SettingsSection() {
  const settings = useLibraryStore((s) => s.settings);
  const setSetting = useLibraryStore((s) => s.setSetting);

  const rows: {
    key: keyof Settings;
    label: string;
    hint: string;
    /** for settings whose absence means "on" */
    defaultOn?: boolean;
  }[] = [
    {
      key: "autoAdvance",
      label: "Auto-advance",
      hint: "Jump to the next track after filing one.",
    },
    {
      key: "reverse",
      label: "Reverse order",
      hint: "Go through the source last-added first, instead of first-added.",
    },
    {
      key: "onlyUnfiled",
      label: "Only unsorted tracks",
      hint: "Hide tracks that are already in one of your target playlists.",
    },
    {
      key: "batchMode",
      label: "Batch mode",
      hint: "Queue adds/removes and apply them together (avoids the dev-mode quota)",
    },
    {
      key: "moveMode",
      label: "Move (remove from source)",
      hint: "Filing also removes the track from the source (ignored in batch mode)",
    },
    {
      key: "previewAutoplay",
      label: "Autoplay preview",
      hint: "Start the preview automatically on each track.",
    },
    {
      key: "visualizer",
      label: "Visualizer",
      hint: "Spectrum behind the track and a 3D tilt on the cover.",
      defaultOn: true,
    },
  ];

  return (
    <div className="grid gap-x-8 gap-y-5 p-6">
      {rows.map((r) => (
        <label key={r.key} className="flex cursor-pointer items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{r.label}</p>
            <p className="text-xs text-muted-foreground">{r.hint}</p>
          </div>
          <Switch
            checked={r.defaultOn ? settings[r.key] !== false : !!settings[r.key]}
            onCheckedChange={(v) => setSetting(r.key, v)}
          />
        </label>
      ))}
    </div>
  );
}
