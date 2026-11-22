// Call to arms (decision 64, step 2; a button and a dialog since decision 65): for those who run the alliance, an
// operation started on the spot from whoever is about. The server makes an
// ordinary operation, led by the caller, turns the groups into its parties if
// asked, and starts it: every player of its clans is pulled onto its nets at
// once, and those in no group wait in Reserve.
import { useState } from "react";
import { t } from "../words";
import { rpc, type ClanSummary } from "../api";
import { ConfirmButton, useAct, useApp, useLoad } from "./app-context";
import { Help } from "./tips";

// t() where shown.
const CALL_HELP = [
  "For something that will not wait: a world boss that has just appeared, a castle under attack.",
  "Starts an operation now, led by you, with the clans you tick. Every player of those clans who has the app open is pulled onto its nets at once, as when any operation goes live.",
  "With the box ticked, each group becomes a party, its players in the order they joined and the first of them leading; everyone else waits in Reserve. Move them on the roster board as usual.",
  "It is an ordinary operation: attendance, points and loot work as for one planned ahead. End it on its board.",
].join("\n");

export function CallToArms() {
  const { info, go } = useApp();
  const act = useAct();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [fromGroups, setFromGroups] = useState(true);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const { data: clans } = useLoad(() => (open ? rpc<ClanSummary[]>("clans.list") : Promise.resolve(null)), [open], 60_000);
  if (!info.user.runsAlliance) return null;
  const chosen = (clans ?? []).filter((c) => !skip.has(c.id)).map((c) => c.id);

  // A rare thing to do, so it is a button, and its form a dialog over the screen: nothing on the screen
  // has to make room for it. (Not inside a panel: a panel's blur would hold the dialog inside itself.)
  return (
    <div className="shrink-0" data-call-to-arms>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-sm border border-net-broadcast/60 bg-bg-1/85 px-3 py-1.5 text-sm text-net-broadcast transition-colors duration-150 hover:border-net-broadcast hover:bg-net-broadcast/10"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-call-to-arms-open
      >
        <span className="title text-xs">{t("Call to arms")}</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={t("Call to arms")} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="flex max-h-full w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-sm border border-net-broadcast/70 bg-bg-1 p-4 text-sm shadow-[0_12px_32px_rgb(0_0_0/0.7)]">
            <div className="flex items-center gap-2">
              <h2 className="title text-sm text-net-broadcast">{t("Call to arms")}</h2>
              <Help text={t(CALL_HELP)} />
              <button type="button" className="ml-auto cursor-pointer text-xs text-text-muted hover:text-gold" onClick={() => setOpen(false)} data-call-to-arms-close>
                {t("Close")}
              </button>
            </div>
            <input className="field py-1" value={name} maxLength={80} placeholder={t("Call to arms")} aria-label={t("Name of the operation")} onChange={(e) => setName(e.target.value)} autoFocus data-call-name />
            <fieldset className="flex flex-col gap-1">
              <legend className="text-xs text-text-muted">{t("Clans")}</legend>
              {(clans ?? []).map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!skip.has(c.id)}
                    onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(c.id); else n.add(c.id); return n; })}
                  />
                  <span>{c.name}</span>
                  <span className="text-xs text-text-muted">[{c.tag}]</span>
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={fromGroups} onChange={(e) => setFromGroups(e.target.checked)} data-call-groups />
              <span>{t("Make the groups its parties")}</span>
            </label>
            {act.error && <p className="text-danger" role="alert">{act.error}</p>}
            <ConfirmButton
              className="btn text-sm"
              confirm={t("Pull everyone in now?")}
              disabled={act.busy || chosen.length === 0}
              onConfirm={() =>
                void act
                  .run(() => rpc<{ id: number }>("op.callToArms", { name: name.trim() || "Call to arms", clanIds: chosen, fromGroups }))
                  .then((r) => {
                    if (!r) return;
                    setOpen(false);
                    setName("");
                    go("voice");
                  })
              }
            >
              {t("Start it now")}
            </ConfirmButton>
          </div>
        </div>
      )}
    </div>
  );
}
