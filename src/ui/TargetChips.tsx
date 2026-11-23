// A player's priority targets, as a row of names to read and to click (server decision 73).
//
// A name is an enemy's, exactly as the leader typed it. Clicking one puts it on the clipboard, spelled
// right, for whatever the game does with a name. The chat shows this row at its top, in the main window
// and in the chat window over the game; the folded strip shows it as one line.

import { useEffect, useRef, useState } from "react";
import type { ChatTarget } from "../control";
import { d, t } from "../words";

/** Puts text on the clipboard; false when the window is not allowed to. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function TargetChips({
  targets,
  compact = false,
  oneLine = false,
  onCopied,
}: {
  targets: ChatTarget[];
  /** Over the game: smaller. */
  compact?: boolean;
  /** The folded strip: one line, cut off at its end. */
  oneLine?: boolean;
  /** A name was clicked (the chat window hands the keyboard back to the game). */
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = (target: ChatTarget) => {
    void copyText(target.name).then((ok) => {
      if (ok) {
        setCopied(target.id);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(null), 1500);
      }
      onCopied?.();
    });
  };
  return (
    <span className={`min-w-0 flex-1 ${oneLine ? "flex items-baseline gap-x-2 overflow-hidden whitespace-nowrap" : "flex flex-wrap items-baseline gap-x-2 gap-y-0.5"}`}>
      {targets.map((target) => (
        <button
          key={target.id}
          type="button"
          className={`cursor-pointer rounded-sm border border-danger/50 px-1.5 text-left font-semibold text-text hover:border-danger ${oneLine ? "shrink-0" : "break-all"} ${compact || oneLine ? "leading-[18px]" : ""}`}
          onClick={() => copy(target)}
          aria-label={t(`Copy the name ${d(target.name)}`)}
          data-target={target.name}
          data-target-scope={target.scope}
        >
          {target.name}
          {target.note && <span className="ml-1 font-normal text-text-muted">{target.note}</span>}
          {copied === target.id && <span className="ml-1 text-[10px] font-normal uppercase tracking-wider text-gold" data-target-copied>{t("copied")}</span>}
        </button>
      ))}
    </span>
  );
}
