import { d, t } from "../words";
import { useState, useSyncExternalStore } from "react";
import { rpc } from "../api";
import { APP_NAME, isDesktop, STATUS_URL, VERSION_TEXT } from "../config";
import { foreground } from "../runtime";
import { checkForUpdate, installUpdate, useUpdate } from "../update";
import { CALL_TARGETS, setSettings, useSettings, type BindTarget, type CallTarget, type InputSource, type NetKind } from "../settings";
import { chat } from "../chat";
import { useApp } from "./app-context";
import { LanguageSettings } from "./Language";
import { DevicePickers, KeyBind, MicTest, netName, NET_TEXT, openInBrowser, PartyMode } from "./common";
import { MyCharacters } from "./MyCharacters";
import { ProfileForm } from "./NameStep";
import { Help } from "./tips";

// Labels and notes: t() where shown.
const KEYS: { target: Exclude<BindTarget, CallTarget>; label: string; note: string }[] = [
  { target: "broadcast", label: "Broadcast", note: "Event leader and deputies" },
  { target: "command", label: "Command", note: "Leaders" },
  { target: "clan", label: "Clan", note: "Clan leader and officers" },
  { target: "party", label: "Party", note: "Your party, and the lounge" },
  { target: "reserve", label: "Reserve", note: "While you have no party" },
  { target: "muteAll", label: "Mute all", note: "Press once to silence your mic everywhere, again to restore. The mic button at the top right does the same" },
  { target: "deafen", label: "Headset", note: "Press once to hear no one (your mic goes off too), again to hear everyone. The headset button at the top right does the same" },
  { target: "broadcastLock", label: "Broadcast lock", note: "Event leader only: press once to hold Broadcast open for a briefing, again to release" },
  { target: "chat", label: "Chat", note: "Puts the keyboard in the chat window's line while the game is in front. Enter sends and returns to the game; Esc, or the key again, gives up. Pick a key the game does not use" },
  { target: "ready", label: "Ready", note: "Answers a ready check with Ready, without leaving the game. It does nothing when nobody is asking" },
];

const SOURCES: { id: InputSource; label: string; note: string }[] = [
  { id: "auto", label: "Automatic", note: "Polling and Raw Input together: a key counts when either sees it. Recommended." },
  { id: "poll", label: "Polling", note: "Works with the game running as administrator, but some games' protection hides keys from it." },
  { id: "hook", label: "Low-level hook", note: "Needs this app to run as administrator if the game does." },
  { id: "raw", label: "Raw Input", note: "Same limit as the hook." },
];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4 first:border-0 first:pt-0">
      <h2 className="title title-rule text-sm text-gold">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
      {hint && <Help text={hint} />}
    </span>
  );
}

/** Deleting your own account: one click to open the warning, a second to do it. */
function DeleteAccount({ leadsClan, onDeleted }: { leadsClan: boolean; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open) {
    return (
      <div>
        <button type="button" className="text-xs text-text-muted underline hover:text-danger cursor-pointer" onClick={() => setOpen(true)}>
          {t("Delete my account")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 border border-danger/60 p-3" role="alertdialog" aria-label={t("Delete my account")}>
      <p>
        {t("This removes your account from the server for good: your name, your clan membership, your places on rosters and the record of when you were in voice. It cannot be undone. Signing in again later starts from nothing.")}
      </p>
      {leadsClan && <p className="text-text-muted">{t("Your clan will be left without a leader until an alliance admin appoints one.")}</p>}
      {error && <p className="text-danger" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn text-sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            rpc("account.delete")
              .then(onDeleted)
              .catch((e: unknown) => {
                setError(e instanceof Error ? e.message : t("That did not work. Try again."));
                setBusy(false);
              });
          }}
        >
          {t("Delete my account for good")}
        </button>
        <button type="button" className="btn btn-quiet text-sm" disabled={busy} onClick={() => setOpen(false)}>{t("Keep my account")}</button>
      </div>
    </div>
  );
}

/** One line on where updates stand, for the Updates group. */
function UpdateStatus() {
  const u = useUpdate();
  const text =
    u.phase === "checking" ? t("Checking…")
    : u.phase === "current" ? t("You have the latest version.")
    : u.phase === "downloading" ? t(`Downloading version ${d(u.version)}${d(u.percent === null ? "…" : `: ${u.percent}%`)}`)
    : u.phase === "ready" ? t(`Version ${d(u.version)} is ready to install.`)
    : u.phase === "installing" ? t(`Installing version ${d(u.version)}; the app will restart by itself.`)
    : u.phase === "failed" ? t(`Could not check for updates: ${d(u.message)}`)
    : "";
  return (
    <div className="flex flex-wrap items-center gap-3">
      {u.phase === "ready" ? (
        <button type="button" className="btn text-sm" onClick={() => void installUpdate()}>{t("Restart to update")}</button>
      ) : (
        <button type="button" className="btn btn-quiet text-sm" disabled={u.phase === "checking" || u.phase === "downloading" || u.phase === "installing"} onClick={() => void checkForUpdate()}>
          {t("Check for updates")}
        </button>
      )}
      <span className="text-xs text-text-muted" role="status">{text}</span>
    </div>
  );
}

export function SettingsPanel({ onClose, onSignOut }: { onClose: () => void; onSignOut: () => void }) {
  const s = useSettings();
  const { info, refreshInfo, go } = useApp();
  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-black/60" onClick={onClose}>
      <aside className="panel h-full w-full max-w-md overflow-y-auto p-6 flex flex-col gap-5" onClick={(e) => e.stopPropagation()} aria-label={t("Settings")}>
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="title text-gold-bright">{t("Settings")}</h1>
            <span className="text-xs text-text-muted" data-app-version>Version {VERSION_TEXT}</span>
          </div>
          <button type="button" className="btn btn-quiet text-sm" onClick={onClose}>{t("Close")}</button>
        </div>

        {info.translation && (
          <Group title={t("Language")}>
            <LanguageSettings />
          </Group>
        )}
        <Group title={t("Devices")}>
          <DevicePickers />
          <MicTest />
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <Toggle label={t("Echo cancellation")} hint={t("Stops others hearing themselves through your speakers. Leave on unless you use a headset and hear artefacts.")} checked={s.echoCancellation} onChange={(v) => setSettings({ echoCancellation: v })} />
            <Toggle label={t("Noise suppression")} hint={t("Removes fans, keyboard and background noise. It also runs before voice activation, so key clicks open the mic less often.")} checked={s.noiseSuppression} onChange={(v) => setSettings({ noiseSuppression: v })} />
            <Toggle label={t("Auto gain")} hint={t("Evens out your volume so you are not too quiet or too loud.")} checked={s.autoGainControl} onChange={(v) => setSettings({ autoGainControl: v })} />
          </div>
        </Group>

        <Group title={t("Party, Reserve and lounge")}>
          <PartyMode />
          {s.partyMode === "voice" && (
            <label className="flex items-center gap-3 text-text-muted">
              <span className="flex items-center gap-1">
                {t("Keep open after you stop")}
                <Help text={t("How long the mic stays open after you stop speaking, so word endings and short pauses are not cut off.")} />
              </span>
              <input
                type="range"
                min={100}
                max={1500}
                step={50}
                value={s.vadHoldMs}
                onChange={(e) => setSettings({ vadHoldMs: Number(e.target.value) })}
              />
              <span className="tabular-nums text-text">{s.vadHoldMs} ms</span>
            </label>
          )}
        </Group>

        <Group title={t("Keys")}>
          <ul className="flex flex-col gap-2">
            {KEYS.map((k) => (
              <li key={k.target} className="flex items-center gap-3">
                <span className={`w-24 font-medium ${k.target === "muteAll" || k.target === "deafen" || k.target === "chat" || k.target === "ready" ? "" : NET_TEXT[k.target === "broadcastLock" ? "broadcast" : k.target]}`}>{t(k.label)}</span>
                <KeyBind target={k.target} label={t(k.label)} />
                <span className="text-xs text-text-muted">{t(k.note)}</span>
              </li>
            ))}
          </ul>
          <QuickCallKeys />
          <p className="text-xs text-text-muted">
            {t("Keys are never taken from the game: it still receives them. Only keys bound here are looked at.")}
            {!isDesktop && t(" In the browser, keys only work while this tab has focus.")}
          </p>
        </Group>

        <Group title={t("Volume")}>
          {(Object.keys(NET_TEXT) as NetKind[]).map((net) => (
            <label key={net} className="flex items-center gap-3">
              <span className={`w-24 ${NET_TEXT[net]}`}>{netName(net)}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={s.netVolume[net]}
                onChange={(e) => setSettings({ netVolume: { ...s.netVolume, [net]: Number(e.target.value) } })}
              />
              <span className="tabular-nums text-text-muted w-10">{Math.round(s.netVolume[net] * 100)}%</span>
            </label>
          ))}
        </Group>

        <Group title={t("Priority")}>
          <Toggle label={t("Lower other nets while a higher one is live")} hint={t("So a Broadcast or Command call cuts through party chatter. Nothing is muted, only made quieter.")} checked={s.ducking} onChange={(v) => setSettings({ ducking: v })} />
          <label className="flex items-center gap-3 text-text-muted">
            Lowered nets stay at
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.duckLevel}
              disabled={!s.ducking}
              aria-label={t("Volume of lowered nets")}
              onChange={(e) => setSettings({ duckLevel: Number(e.target.value) })}
            />
            <span className="tabular-nums text-text w-10">{Math.round(s.duckLevel * 100)}%</span>
          </label>
          <p className="text-xs text-text-muted">
            {t("Order: Broadcast, Command, Clan, Party. On Command, the event leader, deputies and clan leaders also lower the party leaders. Nothing is ever muted by this, only made quieter.")}
          </p>
          <label className="flex items-center gap-3 text-text-muted">
            Your lounge while you are in a group
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.loungeUnderGroup}
              aria-label={t("Volume of your lounge while you are in a group")}
              onChange={(e) => setSettings({ loungeUnderGroup: Number(e.target.value) })}
              data-lounge-under-group
            />
            <span className="tabular-nums text-text w-10">{s.loungeUnderGroup === 0 ? t("Off") : `${Math.round(s.loungeUnderGroup * 100)}%`}</span>
          </label>
        </Group>

        <Group title={t("Sounds")}>
          <Toggle label={t("Play a cue when you are moved to another party")} checked={s.cues} onChange={(v) => setSettings({ cues: v })} />
          <label className="flex items-center gap-3 text-text-muted">
            {t("Cue volume")}
            <input type="range" min={0} max={1} step={0.05} value={s.cueVolume} onChange={(e) => setSettings({ cueVolume: Number(e.target.value) })} />
          </label>
        </Group>

        {isDesktop && (
          <Group title={t("Key capture")}>
            {SOURCES.map((src) => (
              <label key={src.id} className="flex items-start gap-2">
                <input type="radio" className="mt-1" checked={s.source === src.id} onChange={() => setSettings({ source: src.id })} />
                <span>
                  {src.label}
                  <span className="block text-xs text-text-muted">{src.note}</span>
                </span>
              </label>
            ))}
            <Toggle
              label={t("Always start as administrator (from the next start)")}
              checked={s.alwaysAdmin}
              onChange={(v) => setSettings({ alwaysAdmin: v })}
            />
            <p className="text-xs text-text-muted">
              This app is running as {foreground?.selfElevated ? "administrator" : t("a normal user")}. With Polling you should not need administrator rights.
            </p>
          </Group>
        )}

        {isDesktop && (
          <Group title={t("Window and updates")}>
            <Toggle
              label={t("Keep running in the tray when I close the window")}
              hint={t("Closing the window then hides it and you stay in voice. Click the tray icon to bring it back; right-click it and choose Quit to leave. Off: closing the window quits.")}
              checked={s.closeToTray}
              onChange={(v) => setSettings({ closeToTray: v })}
            />
            <Toggle
              label={t("Show the compact strip")}
              hint={t("A small window that stays on top of other windows and shows who is speaking, one line per net, so you can see it without switching to the app. Drag it where you like; double-click it to bring the app forward. It sits over a game running in a window or in borderless mode, not over one in exclusive full screen.")}
              checked={s.strip}
              onChange={(v) => setSettings({ strip: v })}
            />
            <Toggle
              label={t("Update automatically")}
              hint={t("The app asks the server for a newer version when it starts and every few hours. An update found at start installs before you join voice; one found later waits for you to click Restart to update.")}
              checked={s.autoUpdate}
              onChange={(v) => setSettings({ autoUpdate: v })}
            />
            <UpdateStatus />
          </Group>
        )}

        <Group title={t("Help")}>
          <div>
            <button
              type="button"
              className="btn btn-quiet text-sm"
              onClick={() => {
                onClose();
                go("guides");
              }}
            >
              {t("Open the guides")}
            </button>
            <button type="button" className="btn btn-quiet ml-2 text-sm" onClick={() => void openInBrowser(STATUS_URL)} data-status-link>{t("Is the service working?")}</button>
          </div>
          <p className="flex items-center gap-1 text-xs text-text-muted">
            {t("Point at a scroll like this one for a short explanation.")}
            <Help text={t("Like this. Explanations only appear when you point at a scroll, tab to it, or click it.")} />
          </p>
        </Group>

        <Group title={t("Account")}>
          <ProfileForm name={info.user.name} className={info.user.className ?? ""} levelBand={info.user.levelBand ?? ""} onSaved={refreshInfo} submit={t("Save")} />
          <MyCharacters />
          <div><button type="button" className="btn btn-quiet text-sm" onClick={onSignOut}>{t("Sign out")}</button></div>
          <DeleteAccount leadsClan={info.membership?.role === "leader" && info.membership.status === "active"} onDeleted={onSignOut} />
        </Group>

        <p className="text-center text-xs text-text-muted">{APP_NAME} {VERSION_TEXT}</p>
      </aside>
    </div>
  );
}

/** A key for each of the alliance's quick calls. The list is the alliance's; the keys are the player's. */
function QuickCallKeys() {
  const calls = useSyncExternalStore(chat.subscribe, () => chat.view().calls);
  const used = calls.map((text, i) => ({ text, target: CALL_TARGETS[i] })).filter((c) => c.text && c.target);
  if (used.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2" data-call-keys>
      <p className="flex items-center gap-2 font-medium">
        {t("Quick calls")}
        <Help text={t("A quick call is a short line sent into your party's chat with one key, without typing: the others see it in the chat and on their strip, and hear a short sound.\nYour alliance's admins choose the list. Bind a key to the ones you want; the rest stay unused.\nWithout a party your calls go to Reserve. Outside an operation the keys do nothing.")} />
      </p>
      <ul className="flex flex-col gap-2">
        {used.map((c) => (
          <li key={c.target} className="flex items-center gap-3">
            <span className="w-40 truncate text-gold" title={c.text}>{c.text}</span>
            <KeyBind target={c.target} label={t(`Quick call: ${d(c.text)}`)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
