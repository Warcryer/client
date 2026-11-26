// Allies (decision 76): a pact between alliances, for the alliance's owner and
// admins. A pact puts the leaders of up to four alliances on one voice net,
// the Allies net, with its own key and chat. Here: the pact the alliance is
// in, making and withdrawing pact codes, accepting another alliance's code,
// leaving, and naming delegates.

import { d, t } from "../words";
import { useState } from "react";
import { rpc } from "../api";
import { clock, dayFull } from "./common";
import { ConfirmButton, useAct, useLoad } from "./app-context";
import { Help } from "./tips";

type PactCode = { code: string; expiresAt: string; hours: number | null; createdBy: string | null; forPact: boolean };
type PactData = {
  pact: { id: number; endsAt: string | null; alliances: { id: number; name: string; mine: boolean }[] } | null;
  manages: boolean;
  codes: PactCode[];
  delegates: { userId: number; name: string }[];
  limits: { alliances: number; delegates: number; codes: number; codeHours: number };
};
type Peek = { from: string; alliances: string[]; endsAt: string | null; hours: number | null };

// t() where shown.
export const ALLIES_HELP =
  "A pact puts your alliance's leaders on one voice net with the leaders of up to three other alliances: the Allies net. Its own key (Settings, Keys) talks on it, in an operation and between them, and it has a chat of its own.\nOn it from each alliance: the owner, the admins, and up to three delegates they name. Nobody else of any alliance hears it, and nothing else crosses: the other alliances see your leaders' names with your alliance's name, and never your roster, clans, operations or other nets.\nTo make a pact, make a pact code here and give it to the other alliance's leaders. An admin there enters it under Join a pact and accepts. A code works once, for 24 hours. When you make the first code, choose whether the pact stands until someone leaves or ends by itself 24 hours after it forms.\nAn alliance is in one pact at a time. Any admin can take their own alliance out at any moment; a pact left with one alliance ends, and its chat with it.";

const when = (iso: string) => `${dayFull(iso)} ${clock(iso)}`;

export function AlliesSection({ users }: { users: { id: number; name: string; banned: boolean; isAllianceAdmin: boolean; isOwner?: boolean }[] }) {
  const { data, error, reload } = useLoad(() => rpc<PactData>("pact.get"), []);
  const act = useAct();
  const [hours, setHours] = useState<24 | null>(null);
  const [code, setCode] = useState("");
  const [peek, setPeek] = useState<Peek | null>(null);
  const [copied, setCopied] = useState("");
  const [pick, setPick] = useState("");

  const call = (method: string, params: Record<string, unknown> = {}) => act.run(() => rpc(method, params)).then((ok) => (reload(), ok));
  const copy = async (c: string) => {
    try {
      await navigator.clipboard.writeText(c);
      setCopied(c);
      window.setTimeout(() => setCopied(""), 2500);
    } catch {
      setCopied("");
    }
  };

  const pact = data?.pact ?? null;
  const full = !!pact && pact.alliances.length >= (data?.limits.alliances ?? 4);
  const delegateIds = new Set(data?.delegates.map((x) => x.userId) ?? []);
  // Delegates are for players the Allies net would not have anyway: not the owner nor an admin.
  const candidates = users.filter((u) => !u.banned && !u.isAllianceAdmin && !u.isOwner && !delegateIds.has(u.id));

  return (
    <section className="panel p-5 flex flex-col gap-3" data-allies>
      <h2 className="title title-rule text-sm text-gold">
        {t("Allies")}
        <Help text={t(ALLIES_HELP)} />
      </h2>
      {error && <p className="text-danger">{error}</p>}
      {!data && !error && <p className="text-text-muted">{t("Loading…")}</p>}
      {data && (
        <>
          {pact ? (
            <div className="flex flex-col gap-2" data-pact={pact.id}>
              <p className="text-text-muted">{t("In a pact with:")}</p>
              <ul className="flex flex-wrap gap-2">
                {pact.alliances
                  .filter((a) => !a.mine)
                  .map((a) => (
                    <li key={a.id} className="rounded-sm border border-net-allies/50 px-2 py-0.5 text-net-allies" data-pact-alliance={a.name}>
                      {a.name}
                    </li>
                  ))}
              </ul>
              <p className="text-sm text-text-muted" data-pact-ends>
                {pact.endsAt ? t(`Ends by itself on ${d(when(pact.endsAt))}.`) : t("Stands until an alliance leaves it.")}
              </p>
              <div>
                <ConfirmButton confirm={t("Take your alliance out of the pact?")} disabled={act.busy} onConfirm={() => void call("pact.leave")}>
                  {t("Leave the pact")}
                </ConfirmButton>
              </div>
            </div>
          ) : (
            <p className="text-text-muted">{t("Your alliance is in no pact.")}</p>
          )}

          {/* Pact codes this alliance has made and that are still waiting. */}
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <span className="text-xs uppercase tracking-wider text-text-muted">{pact ? t("Bring another alliance in") : t("Make a pact")}</span>
            {data.codes.length > 0 && (
              <ul className="flex flex-col divide-y divide-line">
                {data.codes.map((c) => (
                  <li key={c.code} className="flex flex-col gap-1 py-2" data-pact-code={c.code}>
                    <div className="flex flex-wrap items-center gap-2">
                      <input className="field w-44 select-all font-mono tracking-wider" readOnly value={c.code} aria-label={t("Pact code")} onFocus={(e) => e.target.select()} />
                      <button type="button" className="btn text-sm" onClick={() => void copy(c.code)}>{copied === c.code ? t("Copied") : t("Copy code")}</button>
                      <ConfirmButton confirm={t("Withdraw this code?")} disabled={act.busy} onConfirm={() => void call("pact.revokeCode", { code: c.code })}>
                        {t("Withdraw")}
                      </ConfirmButton>
                    </div>
                    <p className="text-xs text-text-muted">
                      {c.forPact ? t("Brings an alliance into your pact") : c.hours ? t("For a pact that ends 24 hours after it forms") : t("For a standing pact")}
                      {" · "}{t(`until ${d(when(c.expiresAt))}`)}
                      {c.createdBy ? <>{" · "}{t(`made by ${d(c.createdBy)}`)}</> : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {full ? (
              <p className="text-sm text-text-muted">{t(`Your pact has ${d(data.limits.alliances)} alliances, as many as a pact can have.`)}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {!pact && (
                  <span className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label={t("How long the pact lasts")}>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="pact-hours" checked={hours === null} onChange={() => setHours(null)} /> {t("Standing")}
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="pact-hours" checked={hours === 24} onChange={() => setHours(24)} /> {t("Ends after 24 hours")}
                    </label>
                  </span>
                )}
                <button type="button" className="btn text-sm" disabled={act.busy || data.codes.length >= data.limits.codes} onClick={() => void call("pact.createCode", { hours: pact ? null : hours })} data-pact-make>
                  {t("Make a pact code")}
                </button>
              </div>
            )}
          </div>

          {/* Another alliance's code: looked at first, then accepted. One pact at a time. */}
          {!pact && (
            <form
              className="flex flex-col gap-2 border-t border-line pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                void act.run(async () => setPeek(await rpc<Peek>("pact.peekCode", { code })));
              }}
            >
              <span className="text-xs uppercase tracking-wider text-text-muted">{t("Join a pact")}</span>
              <div className="flex flex-wrap items-center gap-2">
                <input className="field w-44 font-mono tracking-wider" value={code} onChange={(e) => { setCode(e.target.value); setPeek(null); }} placeholder={t("Pact code")} aria-label={t("Pact code to accept")} maxLength={24} data-pact-enter />
                <button className="btn text-sm" disabled={act.busy || code.trim().length < 6}>{t("Look it up")}</button>
              </div>
              {peek && (
                <div className="flex flex-col gap-2 border-l-2 border-net-allies pl-3" role="status" data-pact-peek>
                  <p>
                    {peek.alliances.length > 1 ? t(`A pact of ${d(peek.alliances.join(", "))}.`) : t(`A pact with ${d(peek.from)}.`)}{" "}
                    <span className="text-text-muted">{peek.endsAt ? t(`It ends by itself on ${d(when(peek.endsAt))}.`) : peek.hours ? t("It ends by itself 24 hours after it forms.") : t("It stands until an alliance leaves it.")}</span>
                  </p>
                  <p className="text-xs text-text-muted">{t("Your owner, your admins and your delegates will hear and speak with their leaders on the Allies net. Nothing else of your alliance is shared.")}</p>
                  <div className="flex gap-2">
                    <button type="button" className="btn text-sm" disabled={act.busy} onClick={() => void call("pact.accept", { code }).then((ok) => ok && (setPeek(null), setCode("")))} data-pact-accept>
                      {t("Accept")}
                    </button>
                    <button type="button" className="btn btn-quiet text-sm" onClick={() => setPeek(null)}>{t("Cancel")}</button>
                  </div>
                </div>
              )}
            </form>
          )}

          {/* Delegates: on the Allies net beside the owner and the admins. */}
          <div className="flex flex-col gap-2 border-t border-line pt-3" data-delegates>
            <span className="flex items-center gap-1 text-xs uppercase tracking-wider text-text-muted">
              {t(`Delegates (${d(data.delegates.length)} of ${d(data.limits.delegates)})`)}
              <Help text={t("Players who are on the Allies net beside your owner and admins, such as a siege commander who is not an admin. They stay named from one pact to the next.")} />
            </span>
            {data.delegates.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {data.delegates.map((x) => (
                  <li key={x.userId} className="flex items-center gap-2 rounded-sm border border-line px-2 py-0.5" data-delegate={x.name}>
                    {x.name}
                    <button type="button" className="text-text-muted hover:text-danger cursor-pointer" aria-label={t(`Take ${d(x.name)} off`)} disabled={act.busy} onClick={() => void call("pact.setDelegate", { userId: x.userId, on: false })}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {data.delegates.length < data.limits.delegates && candidates.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <select className="field w-auto py-0.5 text-sm" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t("Name a delegate")} data-delegate-pick>
                  <option value="">{t("Name a delegate…")}</option>
                  {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <button type="button" className="btn text-sm" disabled={act.busy || !pick} onClick={() => void call("pact.setDelegate", { userId: Number(pick), on: true }).then(() => setPick(""))} data-delegate-add>
                  {t("Add")}
                </button>
              </div>
            )}
          </div>
          {act.error && <p className="text-danger" role="alert">{act.error}</p>}
        </>
      )}
    </section>
  );
}
