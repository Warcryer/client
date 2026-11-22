import { t } from "../words";
import { useState } from "react";
import { rpc } from "../api";
import { useGame } from "../game";
import { useAct } from "./app-context";
import { CharacterFields } from "./CharacterFields";
import { Wordmark } from "./common";
import { Help } from "./tips";

/** In-game name, class and level. Shown once after the first sign-in, and reused in Settings. */
export function ProfileForm({ name, className, levelBand, onSaved, submit }: { name: string; className: string; levelBand: string; onSaved: () => void; submit: string }) {
  const game = useGame();
  const [n, setN] = useState(name);
  const [cls, setCls] = useState(className);
  const [band, setBand] = useState(levelBand);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAct();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        if (await run(() => rpc("profile.save", { name: n, className: cls, levelBand: band }))) {
          setSaved(true);
          onSaved();
        }
      }}
    >
      <label className="flex flex-col gap-1 text-text-muted">
        In-game name
        <input className="field" value={n} onChange={(e) => setN(e.target.value)} maxLength={24} required autoComplete="off" />
        <span className="text-xs">{t("Exactly as it appears in game, so callers can find you.")}{game?.nameRule ? ` ${game.nameRule[0].toUpperCase()}${game.nameRule.slice(1)}.` : ""}</span>
      </label>
      {game && (game.classes.length > 0 || game.levelBands.length > 0) && (
        <div className="flex flex-col gap-1">
          <CharacterFields game={game} className={cls} levelBand={band} onClass={setCls} onLevel={setBand} />
          <span className="flex items-center gap-1 text-xs text-text-muted">
            {t("Your main character. Organisers see it when they build parties.")}
            <Help text={t("Class and level are shown beside your name on rosters, so the organiser can see at a glance which parties still need a buffer or a healer.\nUpdate the level when you move into the next band.\nWhen you sign up for an event you can say that you are bringing a different character, for that event only.")} />
          </span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button className="btn" disabled={busy || !n.trim()}>{busy ? t("Saving…") : submit}</button>
        {error && <span className="text-danger" role="alert">{error}</span>}
        {saved && !error && <span className="text-net-party" role="status">{t("Saved.")}</span>}
      </div>
    </form>
  );
}

export function NameStep({ onSaved }: { onSaved: () => void }) {
  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="panel rise w-full max-w-md p-8 flex flex-col gap-5">
        <Wordmark className="text-lg" />
        <h1 className="title text-gold">{t("Your name")}</h1>
        <p className="text-text-muted">{t("Welcome. First, confirm the name you play under. Your clan leader approves you by this name.")}</p>
        <ProfileForm name="" className="" levelBand="" onSaved={onSaved} submit={t("Confirm name")} />
      </div>
    </main>
  );
}
