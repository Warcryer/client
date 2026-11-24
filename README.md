<img src="app-icon.png" width="96" align="right" alt="">

# Warcryer

Warcryer is clan and alliance management for MMORPG players, with voice built in: planning operations, the roster, voice where the event roster decides who hears whom, attendance, points and loot. The hosted service is in beta and free while it is. Website: <https://warcryer.org>. What it is, in plain facts: <https://warcryer.org/about/>.

This is the Windows client, built on [Tauri](https://tauri.app) and [LiveKit](https://livekit.io). MIT licensed.

Voice follows the roster: the server tells the client which voice rooms ("nets") it belongs in, and the client connects to exactly those. Nobody picks a channel by hand. When an organiser moves you to another party, your audio follows within a couple of seconds.

Between events you sit in your clan's lounge. When an operation you belong to goes live you are pulled into it, and returned to the lounge when it ends.

The app is also where the alliance is run: starting one (with a beta code from the [Warcryer Discord](https://discord.gg/qf4meEMfhp)), fitting it to your game, bringing clans and their members in by invite link, approving members, keeping constant parties, creating operations, signing up for them, building the roster on a drag-and-drop board and checking attendance afterwards. Each screen offers only what your role allows, and the server checks every action again.

## What it does

- Holds several nets at once (Broadcast, Command, Clan, Party, Reserve) from a single microphone capture.
- Each net you may speak on has its own push-to-talk key. Holding a key opens the mic on that net only.
- Party and Reserve can use voice activation instead, with an adjustable sensitivity.
- Keys work while a game has focus, including mouse side buttons. They are never swallowed: the game still receives them.
- Signs in with Discord through your normal browser. The app never sees your Discord password.
- Lowers the nets below while a higher one is live, so a leader's call cuts through without muting anyone.
- Keeps a party on Command: if its leader drops out, the party is asked to choose another, and the next member is promoted if nobody does.
- Rosters are reusable: clans keep constant parties that drop onto a board in one click, and a new operation can start from an earlier one.
- Can announce operations in a Discord channel (a webhook the clan's leader pastes; no bot), for players who do not have the app open: when one is planned, changed or started, and as a reminder before it starts. A leader can choose a role for those messages to ping.
- Gives every operation a text chat with a channel per net, which can sit on the game as a small see-through window; a Chat key lets you type a line without leaving the game. Whoever runs the operation can pin an order at the top of it and ask everyone for a ready check, and players send their alliance's quick calls ("Need res") to their party with one key.
- Keeps a list of priority targets for an operation: enemies' names given to everyone, to a clan, to a party or to one player by the organisers and the clans' leaders. Each player sees the names meant for them at the top of the chat and on the strip, and copies one with a click.
- Translates the chat for players who read another language: each chooses their language and sees a line as written at once, then in their own a second later, marked as translated, with the original a click away. Twelve languages; an alliance's admins can switch it off, and teach it their own slang.
- Keeps each player's other characters as a standing list, boxes included, which the clan sees on its roster, organisers see on the board, and the player picks from when signing up.
- Plans the event as well as carrying it: players set their class and level and answer "are you coming?", the board shows what each party still needs, and afterwards it lists who was in voice and for how long.
- Each alliance is its own. What is inside one (clans, players, operations, voice, the log) is seen and heard by nobody outside it, and the only way in is an invite link from one of its clans.
- Fits the game an alliance plays: its classes and roles, party size, what a party should have, level or gear bands and kinds of event are the alliance's own lists, with starting points for a few games. If its players say guild and raid, the app says so too.
- Updates itself, with every update signed. Sits in the Windows tray; can keep running there when the window is closed.
- An optional compact strip: a small always-on-top window showing who is speaking on which net. It is an ordinary window, never drawn into the game.

## Key capture and privacy

To notice your push-to-talk keys while the game is in front, the app reads keyboard and mouse button state system-wide. Three methods are available in Settings; the default, Polling, asks Windows whether keys are down a few hundred times a second and needs no administrator rights.

Only keys you have bound to a net are ever acted on, plus the single key you press while binding. Key presses are not logged, stored or sent anywhere. The code is in [`src-tauri/src/input`](src-tauri/src/input).

Key bindings and audio settings stay on your computer. The server receives your Discord account ID and name at sign-in, your in-game name, class and level when you set them, the other characters you list, your answer when you sign up for an event, and what you write in an operation's chat. It records when you join and leave each net, from which an operation's organisers and your clan's leadership see how long you were in voice. Voice itself is never recorded. The [privacy policy](PRIVACY.md) has the full list.

## Guides

Step-by-step guides for [members](docs/members.md), [clan leaders and officers](docs/clan-leaders.md) and [alliance admins and event leaders](docs/alliance-admins.md), and for whoever starts an alliance, [its first hour](docs/first-hour.md). The same guides are inside the app, on the Guides tab.

The hosted service has [terms of use](TERMS.md), a [privacy policy](PRIVACY.md) and a [status page](https://warcryer.org/status/). Questions go to the [Warcryer Discord](https://discord.gg/qf4meEMfhp).

## Install

Download the latest installer from [Releases](../../releases) and run it. It installs for the current Windows user only and needs no administrator rights.

The installer is not code-signed yet, so Windows SmartScreen warns: choose **More info**, then **Run anyway**. Why, and what stands in for a signature, is under [Code signing policy](#code-signing-policy).

## Updates

From version 0.8.0 the app updates itself. An update found when the app starts installs before you join voice; one found while it is running waits for you to click **Restart to update**. Every update is signed with the project's update key, and the app refuses one whose signature does not match the key built into it. Automatic checks can be switched off in **Settings → Window and updates**.

Only full releases are offered as updates. A tag with a suffix, such as `v1.2.3-rc.1`, is published as a pre-release for testing and is never offered.

The update key is kept in a GitHub environment that only a version tag can use, and only after the project's owner approves that run. Builds of ordinary commits are signed with a throwaway key made for the run, which no installed app accepts. A release is built only from a commit on `main`, and the build's third-party actions are pinned to exact commits.

## Uninstall

Open **Windows Settings → Apps → Installed apps**, find **Warcryer** and choose **Uninstall**. This removes the program, its Start menu entry and the sign-in link it registered. Tick "Delete the application data" in the uninstaller to also remove your saved key bindings and settings.

## Code signing policy

Releases are not code-signed yet, so Windows SmartScreen warns on a first install. The project applied for the free signing that the SignPath Foundation gives to open-source projects and was not accepted; signing with a certificate of its own is being arranged.

Until then, what stands in for a signature:

- Every release is built from this repository by [GitHub Actions](.github/workflows/build.yml) on GitHub-hosted runners, only from a commit on `main`, and only after the project's owner has approved that build.
- It is published only after the installed app passes an [automated test](.github/workflows/test-windows.yml) on a clean Windows machine.
- Every update is signed with the project's update key, and an installed app refuses one whose signature does not match the key built into it (see [Updates](#updates)).

## Privacy policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it, with one exception: it checks for updates, sending only its version number, which you can switch off in Settings. Nothing else is sent until you sign in. What is sent after that, and what the server keeps, is described in the [privacy policy](PRIVACY.md).

## Build

```
npm ci
npx tauri build     # Windows installer
npm run build:web   # the same UI for the browser fallback, served under /voice/
```

Requires Node 22 and stable Rust on Windows. GitHub Actions builds the installer on every push and attaches it to a release for every `v*` tag.

Building the installer needs an update-signing key in `TAURI_SIGNING_PRIVATE_KEY`. For a build of your own, make a key pair with `npx tauri signer generate`, put its public half in `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, and change the update address there, or set `bundle.createUpdaterArtifacts` to `false` to build without updates.

The server address is set at build time with `VITE_SERVER`.

## Layout

| Path | What |
| --- | --- |
| `src/engine.ts` | Rooms, microphone, push-to-talk and voice activation |
| `src/control.ts` | The control channel that delivers your nets |
| `src/auth.ts` | Sign-in through the system browser |
| `src/update.ts` | Checking for, verifying and installing updates |
| `src/invite.ts` | Clan invite links opened in the app |
| `src/strip/` | The compact strip: its own small page, fed by the main window, with no voice of its own |
| `src/words.ts`, `src/reword.ts` | Saying every sentence in the alliance's own words (`npm run check:words` checks that none is missed) |
| `src/game.ts` | The alliance's game setup, fetched from the server |
| `src/api.ts` | Calls to the backend for clans, operations and the roster |
| `src/ui/` | Screens: voice, operations and roster board, clan, settings |
| `src-tauri/src/input/` | System-wide key capture (Windows) |
| `src-tauri/src/lib.rs` | The desktop shell: tray icon, close-to-tray, updater plugin |
| `docs/` | The guides, also shown inside the app |

## Name and artwork

Warcryer is a community project. It is not affiliated with or endorsed by NCSOFT or any game publisher, and it contains no game artwork: the emblem in [`art/`](art) and every drawing in the app, including the sword on the opening screen ([`src/ui/SwordLoader.tsx`](src/ui/SwordLoader.tsx)), were made for this project. TeamSpeak is a trademark of its owner, named above only for comparison; Warcryer is not affiliated with it.
