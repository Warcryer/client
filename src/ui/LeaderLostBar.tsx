import { d, t } from "../words";
import { useState } from "react";
import { rpc } from "../api";
import type { LeaderLost } from "../control";

/**
 * Shown to a party (and to the lost leader's clan officers) when the party's
 * leader has dropped out of a live operation. Anyone asked can name a new
 * leader; if nobody does, the server promotes the next member in party order
 * after a further half minute. The bar goes away when the server says the
 * party has a leader again, or the old one is back.
 */
export function LeaderLostBar({ opId, lost, myId }: { opId: number; lost: LeaderLost; myId: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pick = (userId: number) => {
    setBusy(true);
    setError("");
    rpc("party.setLeader", { opId, partyId: lost.partyId, userId })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t("That did not work.")))
      .finally(() => setBusy(false));
  };
  // Only players who are in voice can lead. Yourself first.
  const here = lost.members.filter((m) => m.here).sort((a, b) => Number(b.id === myId) - Number(a.id === myId));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-net-command bg-bg-2 px-4 py-2" role="alert">
      <span>
        <span className="font-semibold text-net-command">{t(`${d(lost.leader)} has dropped out.`)}</span> {t(`${d(lost.party)} has no one on Command. Who leads it now?`)}
      </span>
      {here.map((m) => (
        <button key={m.id} type="button" className="btn text-sm" disabled={busy} onClick={() => pick(m.id)}>
          {m.id === myId ? t("I will") : m.name}
        </button>
      ))}
      <span className="text-xs text-text-muted">
        {here.length === 0 ? t("Nobody else from the party is in voice yet.") : t("If nobody chooses, the next member in party order takes over in half a minute.")}
      </span>
      {error && <span className="text-xs text-danger" role="alert">{error}</span>}
    </div>
  );
}
