// The player's other characters: a standing list beside the one on their
// profile. Their clan sees it on the roster, an operation's organisers on the
// board, and the player picks from it when answering "are you coming?".

import { useCallback, useEffect, useState } from "react";
import { rpc, type Character } from "../api";
import { d, t } from "../words";
import { useGame } from "../game";
import { ConfirmButton, useAct } from "./app-context";
import { CharacterFields } from "./CharacterFields";
import { Help } from "./tips";

/** One character on one line: name, class and level, and whether it is a box. */
export function CharacterLine({ c }: { c: Character }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-text">{c.name}</span>
      {c.classTag && <span className="text-xs text-gold">{c.classTag}</span>}
      {c.levelBand && <span className="text-xs text-text-muted">{c.levelBand}</span>}
      {c.box && <span className="rounded-sm border border-line px-1 text-[10px] uppercase tracking-wide text-text-muted">{t("box")}</span>}
    </span>
  );
}

const EMPTY = { id: null as number | null, name: "", className: "", levelBand: "", box: false };

export function MyCharacters() {
  const game = useGame();
  const act = useAct();
  const [list, setList] = useState<Character[] | null>(null);
  const [max, setMax] = useState(8);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const load = useCallback(() => {
    void rpc<{ characters: Character[]; max: number }>("character.list").then(
      (r) => {
        setList(r.characters);
        setMax(r.max);
      },
      () => setList([]),
    );
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!form) return;
    if (await act.run(() => rpc("character.save", form))) {
      setForm(null);
      load();
    }
  };

  return (
    <div className="flex flex-col gap-2" data-my-characters>
      <span className="flex items-center gap-1 text-text-muted">
        {t("Other characters")}
        <Help
          text={t(
            "Characters you play beside the one on your profile.\nYour clan sees this list on its roster, and an operation's organisers on its board. When you say whether you are coming to an operation, you can pick one of them instead of typing it.\nTick Box for a character you play at the same time as your main, on a second game client.",
          )}
        />
      </span>
      {list === null ? (
        <p className="text-xs text-text-muted">{t("Loading…")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.length === 0 && !form && <li className="text-xs text-text-muted">{t("None listed.")}</li>}
          {list.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2" data-character={c.name}>
              <CharacterLine c={c} />
              <span className="ml-auto flex gap-1">
                <button type="button" className="btn btn-quiet text-xs" disabled={act.busy} onClick={() => setForm({ id: c.id, name: c.name, className: c.className ?? "", levelBand: c.levelBand ?? "", box: c.box })}>
                  {t("Change")}
                </button>
                <ConfirmButton
                  confirm={t("Remove it?")}
                  disabled={act.busy}
                  onConfirm={() => void act.run(() => rpc("character.remove", { id: c.id })).then((ok) => ok && load())}
                >
                  {t("Remove")}
                </ConfirmButton>
              </span>
            </li>
          ))}
        </ul>
      )}
      {form ? (
        <form
          className="flex flex-col gap-3 rounded-sm border border-line bg-bg-2/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="flex flex-col gap-1 text-text-muted">
            {t("Character name")}
            <input className="field max-w-xs" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={24} required autoComplete="off" autoFocus />
          </label>
          {game && <CharacterFields game={game} className={form.className} levelBand={form.levelBand} onClass={(v) => setForm({ ...form, className: v })} onLevel={(v) => setForm({ ...form, levelBand: v })} />}
          <label className="flex items-center gap-2 text-text-muted">
            <input type="checkbox" checked={form.box} onChange={(e) => setForm({ ...form, box: e.target.checked })} />
            {t("Box: I play it at the same time as my main")}
          </label>
          <div className="flex items-center gap-2">
            <button className="btn text-sm" disabled={act.busy || !form.name.trim()}>{form.id ? t("Save character") : t("Add character")}</button>
            <button
              type="button"
              className="btn btn-quiet text-sm"
              onClick={() => {
                setForm(null);
                act.clear();
              }}
            >
              {t("Cancel")}
            </button>
          </div>
        </form>
      ) : (
        list !== null && list.length < max && (
          <div>
            <button type="button" className="btn btn-quiet text-sm" onClick={() => setForm({ ...EMPTY })}>{t("Add a character")}</button>
          </div>
        )
      )}
      {act.error && <p className="text-danger" role="alert">{act.error}</p>}
    </div>
  );
}
