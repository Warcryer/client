// The alliance's quick calls: the short lines its players send into their
// party's chat with one key. For its admins, on the Alliance tab.

import { useEffect, useState } from "react";
import { rpc } from "../api";
import { d, t } from "../words";
import { useAct } from "./app-context";

// t() where shown.
export const QUICK_CALLS_HELP = [
  "A quick call is a short line a player sends into their party's chat with one key, without typing: \"Need res\", \"Out of mana\". The others see it in the chat and on their strip, and hear a short sound.",
  "This is your alliance's list: write the calls that fit your game, up to eight. Each player binds keys to the ones they want, in Settings.",
  "A call keeps its place: change the text in a line and the keys players bound to that line send the new text. Empty a line to take a call away.",
  "Calls go to the caller's party, or to Reserve while they have none. They are kept with the chat.",
].join("\n");

export function QuickCalls({ calls, limits, onChange }: { calls: string[]; limits: { slots: number; max: number }; onChange: () => void }) {
  const act = useAct();
  const stored = Array.from({ length: limits.slots }, (_, i) => calls[i] ?? "");
  const [draft, setDraft] = useState(stored);
  const key = stored.join("\n");
  useEffect(() => setDraft(key.split("\n").concat(Array(limits.slots).fill("")).slice(0, limits.slots)), [key, limits.slots]);
  const changed = draft.map((c) => c.trim().replace(/\s+/g, " ")).join("\n") !== key;
  return (
    <form
      className="flex flex-col gap-2"
      data-call-settings
      onSubmit={(e) => {
        e.preventDefault();
        void act.run(() => rpc("alliance.setCalls", { calls: draft })).then(onChange);
      }}
    >
      <ol className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {draft.map((text, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-4 text-right text-xs tabular-nums text-text-muted">{i + 1}</span>
            <input
              className="field min-w-0 flex-1"
              value={text}
              maxLength={limits.max}
              placeholder={t("Not used")}
              aria-label={t(`Quick call ${d(i + 1)}`)}
              onChange={(e) => setDraft(draft.map((c, n) => (n === i ? e.target.value : c)))}
            />
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn" disabled={act.busy || !changed}>{t("Save the calls")}</button>
        <span className="text-xs text-text-muted">{t("Up to {n} characters each. They go to the caller's party.").replace("{n}", String(limits.max))}</span>
      </div>
      {act.error && <p className="text-danger" role="alert">{act.error}</p>}
    </form>
  );
}
