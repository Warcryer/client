// Setting up Discord announcements: a clan's leader for the clan's channel,
// an alliance admin for the alliance's. The server posts there when an
// operation is created, changed, cancelled or started, and a reminder some
// time before it starts. A channel can have a role that those messages ping.
//
// What is pasted is a channel webhook's address, which is a secret: the
// server keeps it and only ever tells the app whether one is set.

import { d, t } from "../words";
import { useState } from "react";
import { rpc } from "../api";
import { ConfirmButton, useAct } from "./app-context";

/** The help behind the section's icon: for a clan's own channel, or for the alliance's. */
export const discordHelp = (forClan: boolean) =>
  [
    forClan
      ? t("Posts a message in a Discord channel when an operation your clan takes part in is created, changed, cancelled or started, so players who do not have the app open still hear about it.")
      : t("Posts a message in a Discord channel when any operation of the alliance is created, changed, cancelled or started, so players who do not have the app open still hear about it."),
    t("To set it up: in Discord, open the channel's settings (the cog beside its name), then Integrations, Webhooks, New Webhook, and Copy Webhook URL. Paste that address here. You need the Manage Webhooks permission on the Discord server."),
    t("A first message is posted at once, so you can see it arrive."),
    t("The address is a secret: anyone who has it can post in that channel. The app stores it and never shows it again. To stop, disconnect here or delete the webhook in Discord."),
    t("A message names the operation, its start (shown to each reader in their own time zone), the clans and the event leader."),
    t("A reminder is posted some time before an operation starts. An alliance admin chooses how long before, for the whole alliance, or switches it off."),
    t("Nobody is pinged unless you choose a role here. That role is then pinged when an operation is announced, by the reminder, when it starts and if it is cancelled; not by a change of detail. Type @everyone or @here, or paste a role's ID: in Discord, switch on Developer Mode under Settings, Advanced, then right-click the role in the server's settings and choose Copy Role ID. If the ping does not light up, allow the role to be mentioned in its settings."),
    forClan ? "" : t("Each clan's leader can also set up a channel of their own on the Clan screen, for the operations that clan takes part in."),
  ].filter(Boolean).join("\n");

/** A stored role the way a leader typed it. */
const shown = (role: string | null | undefined) => (!role ? "" : role === "everyone" || role === "here" ? `@${role}` : role);
// t() where shown.
const LEAD: Record<number, string> = { 0: "Off", 15: "15 minutes before", 30: "30 minutes before", 60: "1 hour before", 120: "2 hours before" };

/** `clanId` null: the alliance's own channel. */
export function DiscordSetup({
  clanId,
  connected,
  role,
  remind,
  onChange,
}: {
  clanId: number | null;
  connected: boolean;
  /** The role this channel's announcements ping, if one is chosen. */
  role?: string | null;
  /** The alliance's reminder: minutes before the start (0: off) and what can be chosen. Only on the alliance's own channel. */
  remind?: { minutes: number; choices: number[] };
  onChange: () => void;
}) {
  const act = useAct();
  const [url, setUrl] = useState("");
  const [ping, setPing] = useState<string | null>(null);
  const typed = ping ?? shown(role);
  const saveRole = (text: string, done: string) => {
    setSaid("");
    void act.run(() => rpc("discord.setRole", { clanId, role: text })).then((ok) => {
      if (!ok) return;
      setPing(null);
      setSaid(done);
      onChange();
    });
  };
  const [said, setSaid] = useState("");
  const set = (text: string, done: string) => {
    setSaid("");
    void act
      .run(() => rpc(clanId === null ? "alliance.setDiscord" : "clan.setDiscord", { clanId, url: text }))
      .then((ok) => {
        if (!ok) return;
        setUrl("");
        setSaid(done);
        onChange();
      });
  };
  return (
    <div className="flex flex-col gap-2" data-discord-setup>
      <p className={connected ? "text-net-party" : "text-text-muted"}>{connected ? t("Connected: operations are announced in a Discord channel.") : t("Not set up.")}</p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          set(url, t("Connected. A first message has been posted in the channel."));
        }}
      >
        {/* Typed like a password: it is one, and this screen may be on a stream. */}
        <input
          type="password"
          autoComplete="off"
          className="field max-w-md flex-1"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={connected ? t("Paste another webhook address to replace it") : t("Paste the channel's webhook address")}
          aria-label={t("Discord webhook address")}
        />
        <button className="btn text-sm" disabled={act.busy || url.trim().length < 20}>{connected ? t("Replace") : t("Connect")}</button>
        {connected && (
          <>
            <button
              type="button"
              className="btn btn-quiet text-sm"
              disabled={act.busy}
              onClick={() => {
                setSaid("");
                void act.run(() => rpc("discord.test", { clanId })).then((ok) => ok && setSaid(t("Test message sent. Check the channel.")));
              }}
            >
              {t("Send a test message")}
            </button>
            <ConfirmButton confirm={t("Stop announcing?")} disabled={act.busy} onConfirm={() => set("", t("Disconnected. Nothing more is posted."))}>{t("Disconnect")}</ConfirmButton>
          </>
        )}
      </form>
      {connected && (
        <form
          className="flex flex-wrap items-center gap-2"
          data-discord-role
          onSubmit={(e) => {
            e.preventDefault();
            saveRole(typed, typed.trim() ? t("Saved. The channel has been told who will be pinged.") : t("Saved. Nobody is pinged."));
          }}
        >
          <label className="flex flex-wrap items-center gap-2 text-text-muted">
            {t("Ping")}
            <input className="field w-56" value={typed} onChange={(e) => setPing(e.target.value)} placeholder="nobody" autoComplete="off" maxLength={40} aria-label={t("Role to ping")} />
          </label>
          <button className="btn btn-quiet text-sm" disabled={act.busy || typed.trim() === shown(role)}>{t("Save")}</button>
          <span className="text-xs text-text-muted">{t("A role's ID, @everyone or @here. Empty: nobody.")}</span>
        </form>
      )}
      {remind && (
        <label className="flex flex-wrap items-center gap-2 text-text-muted" data-discord-remind>
          {t("Reminder")}
          <select
            className="field"
            value={remind.minutes}
            disabled={act.busy}
            aria-label={t("Reminder before the start")}
            onChange={(e) => {
              const minutes = Number(e.target.value);
              setSaid("");
              void act.run(() => rpc("alliance.setReminder", { minutes })).then((ok) => {
                if (!ok) return;
                setSaid(minutes ? t("Saved. Every channel of the alliance is reminded before an operation starts.") : t("Saved. No reminders are posted."));
                onChange();
              });
            }}
          >
            {remind.choices.map((m) => <option key={m} value={m}>{LEAD[m] ? t(LEAD[m]) : t(`${d(m)} minutes before`)}</option>)}
          </select>
          <span className="text-xs">{t("Posted in the alliance's channel and in each clan's own, for the operations it takes part in.")}</span>
        </label>
      )}
      {act.error && <p className="text-danger" role="alert">{act.error}</p>}
      {said && <p className="text-net-party" role="status">{said}</p>}
    </div>
  );
}
