// An invite link that reached the app from outside (Windows hands the app any
// warcryer:// link a web page or program opens). Nothing is joined until the
// player has seen which clan it is for and said yes: a link alone must never
// put someone in a clan, or their voice in its lounge.

import { tx } from "../i18n";
import { d, t } from "../words";
import { useEffect, useState } from "react";
import { dropPending, peekPending, redeemPending, type InvitePeek } from "../invite";
import { ClanCrest } from "./common";

export function InviteAsk({ onDone }: { onDone: () => void }) {
  // undefined: looking it up. null: the server is too old to say which clan; ask anyway.
  const [inv, setInv] = useState<InvitePeek | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    peekPending()
      .then((p) => live && setInv(p))
      .catch((e) => {
        if (!live) return;
        const why = e instanceof Error ? e.message : "";
        if (/unknown method/i.test(why)) return setInv(null);
        // A dead link: say why on the Clan screen, as before.
        dropPending(why || t("That invite could not be used."));
        onDone();
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (inv === undefined) return null;
  const clan = inv?.clanName ?? t("a clan");
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6" role="dialog" aria-modal="true" aria-label={t("Clan invite")}>
      <div className="panel flex w-full max-w-md flex-col gap-4 p-5">
        <h2 className="title flex items-center gap-2 text-gold-bright">
          {inv && <ClanCrest clanId={inv.clanId} size={28} />}
          {t(`You are invited to join ${d(clan)}`)}
          {inv && <span className="font-sans text-sm font-normal text-text-muted">[{inv.clanTag}]</span>}
        </h2>
        {inv?.allianceName && <p className="-mt-2 text-text-muted">{tx("A clan of the alliance {name}.", { name: <span className="text-text">{inv.allianceName}</span> })}</p>}
        <p className="text-text-muted">
          {inv === null
            ? t("A link you opened asks to add you to a clan. Only accept if you were expecting it.")
            : inv.autoApprove
              ? t(`If you join, you are a member of ${d(clan)} at once and your voice goes to its lounge.`)
              : t(`If you join, your request goes to ${d(clan)}'s leader and officers, who let you in.`)}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => {
              dropPending();
              onDone();
            }}
          >
            {t("Not now")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void redeemPending().then(onDone);
            }}
          >
            {t(`Join ${d(clan)}`)}
          </button>
        </div>
      </div>
    </div>
  );
}
