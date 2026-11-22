// Signing up for an operation: "coming" or "can't come", and, when a player
// brings a character other than the one on their profile, which one.

import { t } from "../words";
import { useEffect, useState } from "react";
import { rpc, type Character, type Signup } from "../api";
import { useGame } from "../game";
import { useAct, useApp } from "./app-context";
import { CharacterFields } from "./CharacterFields";
import { CharacterLine } from "./MyCharacters";
import { Help } from "./tips";

// t() where shown.
const SIGNUP_HELP = [
  "Tell the organiser whether you are coming, so they can build the parties before the event.",
  "Coming: you appear at the top of the organiser's list of players to place.",
  "Can't come: the organiser knows not to count on you. You can change your answer at any time.",
  "Your answer does not change your voice: when the operation starts, everyone on the roster is pulled in as before.",
].join("\n");

const OTHER_HELP = [
  "Use this when you bring a different character than the one on your profile, for this event only.",
  "Leave a field empty to use what your profile says.",
  "If you keep a list of other characters (Settings, Account), pick one from it instead of typing.",
  "The note is for the organiser, for example that you will be half an hour late.",
].join("\n");

/**
 * The two answer buttons. `full` adds the form for another character and a
 * note, and the way to take an answer back; without it this is the short form
 * used in lists.
 */
export function SignupControl({
  opId,
  status,
  signup,
  full = false,
  onDone,
}: {
  opId: number;
  status: "coming" | "out" | null;
  /** My current answer with its details, where the caller has them. */
  signup?: Signup | null;
  full?: boolean;
  onDone?: () => void;
}) {
  const { info, refreshInfo } = useApp();
  const game = useGame();
  const act = useAct();
  const [open, setOpen] = useState(false);
  const [charName, setCharName] = useState(signup?.charName ?? "");
  const [cls, setCls] = useState(signup?.className ?? "");
  const [band, setBand] = useState(signup?.levelBand ?? "");
  const [note, setNote] = useState(signup?.note ?? "");
  // The player's own standing list, fetched when the form is first opened.
  const [mine, setMine] = useState<Character[]>([]);
  useEffect(() => {
    if (!open) return;
    void rpc<{ characters: Character[] }>("character.list").then((r) => setMine(r.characters), () => {});
  }, [open]);

  const send = (next: "coming" | "out" | "none", details: boolean) =>
    void act
      .run(() => rpc("op.signup", { opId, status: next, ...(details ? { charName, className: cls, levelBand: band, note } : keep(signup)) }))
      .then((ok) => {
        if (!ok) return;
        if (details) setOpen(false);
        refreshInfo();
        onDone?.();
      });

  const button = (value: "coming" | "out", label: string, on: string) => (
    <button
      type="button"
      aria-pressed={status === value}
      disabled={act.busy}
      onClick={() => status !== value && send(value, false)}
      className={`rounded-sm border px-2.5 py-0.5 text-sm transition-colors duration-150 ${
        status === value ? `${on} cursor-default font-semibold` : "border-line text-text-muted hover:border-gold-dim hover:text-text cursor-pointer"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {button("coming", status === "coming" ? t("✓ Coming") : t("Coming"), "border-net-party text-net-party")}
        {button("out", t("Can't come"), "border-danger text-danger")}
        {full && <Help text={t(SIGNUP_HELP)} />}
        {full && status === "coming" && (
          <span className="text-text-muted">
            as <span className="text-text">{signup?.charName ?? info.user.name}</span>
            {(signup?.className ?? info.user.className) && <span> · {signup?.className ?? info.user.className}</span>}
            {(signup?.levelBand ?? info.user.levelBand) && <span> · {signup?.levelBand ?? info.user.levelBand}</span>}
            {signup?.byLeader && <span> {t("· signed up by your party's leader")}</span>}
          </span>
        )}
        {full && game && !open && (
          <button type="button" className="btn btn-quiet text-xs px-2 py-0.5" onClick={() => setOpen(true)}>
            {t("Another character or a note")}
          </button>
        )}
        {full && status !== null && !open && (
          <button type="button" className="text-xs text-text-muted hover:text-text cursor-pointer" disabled={act.busy} onClick={() => send("none", false)}>
            {t("Clear my answer")}
          </button>
        )}
        {act.error && <span className="text-danger" role="alert">{act.error}</span>}
      </div>
      {full && open && game && (
        <form
          className="flex flex-col gap-3 rounded-sm border border-line bg-bg-2/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send("coming", true);
          }}
        >
          <span className="flex items-center gap-1 text-text-muted">
            {t("Coming with another character")}
            <Help text={OTHER_HELP} />
          </span>
          {mine.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" data-pick-character>
              <span className="text-text-muted">{t("From your list:")}</span>
              {mine.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`btn btn-quiet text-sm ${charName.trim().toLowerCase() === c.name.toLowerCase() ? "border-gold text-gold-bright" : ""}`}
                  onClick={() => {
                    setCharName(c.name);
                    setCls(c.className ?? "");
                    setBand(c.levelBand ?? "");
                  }}
                >
                  <CharacterLine c={c} />
                </button>
              ))}
            </div>
          )}
          <label className="flex flex-col gap-1 text-text-muted">
            {t("Character name")}
            <input className="field max-w-xs" value={charName} onChange={(e) => setCharName(e.target.value)} maxLength={24} autoComplete="off" placeholder={info.user.name} />
          </label>
          <CharacterFields game={game} className={cls} levelBand={band} onClass={setCls} onLevel={setBand} none={t("As on my profile")} />
          <label className="flex flex-col gap-1 text-text-muted">
            {t("Note for the organiser (optional)")}
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} autoComplete="off" />
          </label>
          <div className="flex items-center gap-2">
            <button className="btn text-sm" disabled={act.busy}>{t("Sign up")}</button>
            <button type="button" className="btn btn-quiet text-sm" onClick={() => setOpen(false)}>{t("Cancel")}</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Changing the answer with the short buttons keeps the character and note already given. */
const keep = (s: Signup | null | undefined) => (s ? { charName: s.charName ?? "", className: s.className ?? "", levelBand: s.levelBand ?? "", note: s.note ?? "" } : {});
