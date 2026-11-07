import { useSessionStore } from "@/store/useSessionStore";
import { cn } from "@/lib/utils";

/** "12 / 340" where the 12 is editable: type a number, Enter (or blur) jumps
 *  there. Lives in the top bar so it's reachable in both views and on phones. */
export function TrackJump({ className }: { className?: string }) {
  const index = useSessionStore((s) => s.index);
  const total = useSessionStore((s) => s.tracks.length);
  const goTo = useSessionStore((s) => s.goTo);

  if (total === 0) {
    return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  }

  const jump = (el: HTMLInputElement) => {
    const n = parseInt(el.value, 10);
    if (Number.isNaN(n)) el.value = String(index + 1);
    else if (n - 1 !== index) goTo(n - 1);
  };

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <input
        // remount on every move so the field always shows the live position
        key={index}
        type="number"
        inputMode="numeric"
        min={1}
        max={total}
        defaultValue={index + 1}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          // keep ←/→ and the playlist hotkeys from firing while typing
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = String(index + 1);
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => jump(e.currentTarget)}
        className="h-7 w-11 rounded-md border border-border bg-background/50 px-1 text-center text-base text-foreground md:text-xs tabnum outline-none focus:border-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        aria-label={`Jump to track number (1–${total})`}
      />
      <span className="whitespace-nowrap tabnum">/ {total}</span>
    </div>
  );
}
