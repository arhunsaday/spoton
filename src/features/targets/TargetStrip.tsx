import { useMemo } from "react";
import { Check, Heart, ListMusic, Loader2, Pencil, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIKED_SOURCE_ID, useLibraryStore } from "@/store/useLibraryStore";
import { countPending, useSessionStore } from "@/store/useSessionStore";
import { useUiStore } from "@/store/useUiStore";

/** Phone-width stand-in for the target rail: one tap files the current track,
 *  no hotkeys needed. Sits right above the player bar so the thumb reaches it,
 *  and carries the batch "Apply" that the desktop top bar shows. */
export function TargetStrip() {
  const targets = useLibraryStore((s) => s.targets);
  const batchMode = useLibraryStore((s) => s.settings.batchMode);
  const openSetup = useUiStore((s) => s.setSetupOpen);
  const file = useSessionStore((s) => s.fileToTarget);
  const membership = useSessionStore((s) => s.membership);
  const baseMembership = useSessionStore((s) => s.baseMembership);
  const applyPending = useSessionStore((s) => s.applyPending);
  const applying = useSessionStore((s) => s.applying);
  const current = useSessionStore((s) => s.tracks[s.index] ?? null);

  const pending = useMemo(
    () => countPending(baseMembership, membership, targets),
    [baseMembership, membership, targets],
  );

  return (
    <nav
      aria-label="Target playlists"
      className="scrollbar-none flex shrink-0 items-center gap-2 overflow-x-auto border-t border-border bg-card/80 px-3 py-2 backdrop-blur md:hidden"
    >
      {batchMode && pending > 0 && (
        <button
          type="button"
          onClick={() => void applyPending()}
          disabled={applying}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-70"
        >
          {applying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Apply {pending}
        </button>
      )}

      {targets.map((tg) => {
        const isIn = current ? membership[tg.id]?.has(current.id) : false;
        return (
          <button
            key={tg.id}
            type="button"
            onClick={() => void file(tg.key)}
            disabled={!current}
            aria-pressed={!!isIn}
            className={cn(
              "flex h-11 max-w-[11rem] shrink-0 items-center gap-2 rounded-full border border-border bg-secondary/60 pl-1.5 pr-3 text-sm transition-colors disabled:opacity-40",
              isIn && "border-success/40 bg-success/15",
            )}
          >
            {tg.imageUrl ? (
              <img
                src={tg.imageUrl}
                alt=""
                className="h-8 w-8 shrink-0 rounded-full object-cover drag-none"
                draggable={false}
              />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background/60">
                {tg.id === LIKED_SOURCE_ID ? (
                  <Heart className="h-4 w-4 text-primary" />
                ) : (
                  <ListMusic className="h-4 w-4 text-muted-foreground" />
                )}
              </span>
            )}
            <span className="truncate">{tg.name}</span>
            {isIn && <Check className="h-4 w-4 shrink-0 text-success" />}
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => openSetup(true)}
        className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border px-4 text-sm text-muted-foreground"
      >
        <Pencil className="h-4 w-4" />
        {targets.length ? "Edit" : "Add targets"}
      </button>
    </nav>
  );
}
