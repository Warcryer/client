// Voice engine: one LiveKit room per net, one microphone capture shared by
// all of them. Each room the player may speak in gets its own clone of the
// mic track, published muted; a net's key (or voice activation, on Party and
// Reserve) unmutes only that room's clone.
//
// Which rooms exist is not decided here. The control channel delivers a net
// set and apply() makes the connections match it: new rooms are joined first,
// old ones left afterwards, so a move has no silent gap.

import { d, said, t } from "./words";
import {
  AudioPresets,
  ConnectionState,
  LocalAudioTrack,
  type Participant,
  type ReconnectPolicy,
  type RemoteAudioTrack,
  LoggerNames,
  LogLevel,
  Room,
  RoomEvent,
  setLogExtension,
  setLogLevel,
  Track,
} from "livekit-client";
import type { NetGrant, NetSet } from "./control";

// The voice library's own account of its signalling connection: when one drops, the library logs
// whether the socket was closed (and with which code) or its ping went unanswered. The last few
// such lines are kept, so that a drop can be reported with its reason. Nothing else is kept, and
// nothing of it says who was speaking or what was said.
const VOICE_LOG: { at: number; text: string }[] = [];
const brief = (context: unknown): string => {
  if (!context || typeof context !== "object") return "";
  const c = context as Record<string, unknown>;
  const kept = Object.fromEntries(["code", "reason", "state", "error"].filter((k) => c[k] !== undefined).map((k) => [k, typeof c[k] === "object" ? String(c[k]) : c[k]]));
  return Object.keys(kept).length ? ` ${JSON.stringify(kept).slice(0, 140)}` : "";
};
setLogLevel(LogLevel.debug, LoggerNames.Signal);
setLogExtension((level, msg, context) => {
  if (level < LogLevel.warn && !/websocket closed|ping timeout|closing|reconnect|disconnect/i.test(msg)) return;
  VOICE_LOG.push({ at: Date.now(), text: `${msg.slice(0, 120)}${brief(context)}` });
  if (VOICE_LOG.length > 30) VOICE_LOG.shift();
});
/**
 * What the library said from `since` on, oldest first, each with how long ago in seconds. The first
 * lines are the ones kept: the cause comes first, and what follows is the library trying again.
 */
const voiceSaid = (since: number): string[] => VOICE_LOG.filter((l) => l.at >= since).slice(0, 8).map((l) => `${((Date.now() - l.at) / 1000).toFixed(1)}s ago: ${l.text}`);
import { getSettings, onSettings, type NetKind, type Settings } from "./settings";

export type Member = {
  identity: string;
  name: string;
  classTag: string | null;
  clanTag: string | null;
  clanId: number | null;
  speaking: boolean;
  self: boolean;
  /** May speak on this net (holds a published track or is allowed to). */
  canSpeak: boolean;
  /** Your own volume for this player (0 to 1) and whether you muted them. */
  volume: number;
  muted: boolean;
  /** Their headset is off: they hear no one (set by the control service, decision 59). */
  headsetOff: boolean;
};

export type Speaker = { identity: string; name: string; clanId: number | null; clanTag: string | null };

export type NetView = {
  net: NetKind;
  label: string;
  room: string;
  /** "relinking": the room's signalling connection is being made again; what is being said is still heard. */
  state: "connecting" | "connected" | "relinking" | "reconnecting" | "disconnected";
  speak: boolean;
  /** Our mic is open on this net right now. */
  live: boolean;
  /** Others speaking right now. */
  speakers: Speaker[];
  /** Made quieter right now because a higher-priority net is live. */
  lowered: boolean;
  /** Broadcast, for the event leader: may be locked open for a briefing, and whether it is now. */
  canLock: boolean;
  locked: boolean;
  members: Member[];
};

/** How long the mic stays open after a push-to-talk key is released, so word endings are not clipped. */
const RELEASE_TAIL_MS = 200;
/** Lower number = higher priority. A live net lowers every net below it for the listener. */
const PRIORITY: Record<NetKind, number> = { broadcast: 0, command: 1, clan: 2, party: 3, reserve: 3, group: 3, lounge: 4 };
/** A net counts as live for this long after its last speaker closes their mic, so gaps between words do not pump the volume. */
const LIVE_HOLD_MS = 400;
/**
 * Voice activation opens the mic only for a sound that lasts and holds up: above the marker for this many
 * meter reports in a row (about 10 ms each), and still within VOICE_HOLD_DB of its loudest. A key click or a
 * knock on the desk is a few milliseconds, but the browser's echo cancellation and noise suppression draw it
 * out into a tail that fades over a quarter of a second; a voice holds its level.
 */
const VOICE_OPEN_REPORTS = 6;
const VOICE_HOLD_DB = 10;
/** How fast the remembered loudest level sinks, per report, so that a voice right after a click is not measured against the click. */
const VOICE_PEAK_FALL_DB = 1;
/** How often volumes are re-evaluated. */
const VOLUME_TICK_MS = 50;
/** Holding one of these sends your voice to that net only; voice activation pauses meanwhile. */
const KEYED_ONLY: NetKind[] = ["broadcast", "command", "clan"];
/** A Broadcast left locked open is released by itself after this long, in case it was forgotten. */
export const BROADCAST_LOCK_MAX_MS = 10 * 60 * 1000;

type Net = {
  grant: NetGrant;
  room: Room;
  track?: LocalAudioTrack;
  live: boolean;
  /** Opened by a key (gets the release tail) rather than by voice. */
  byKey: boolean;
  /** When to close after the reason to be open has gone; 0 = not closing. */
  closeAt: number;
  speakers: Speaker[];
  /** We are leaving on purpose; ignore the disconnect that follows. */
  closing: boolean;
  failed: boolean;
  /** Someone else has their mic open here until at least this time. */
  liveUntil: number;
  /** The same, for a senior leader (Command only). */
  seniorLiveUntil: number;
  /** This net is being played quieter right now. */
  lowered: boolean;
};

function meta(p: Participant): { classTag: string | null; clanTag: string | null; clanId: number | null; senior: boolean } {
  try {
    const m = JSON.parse(p.metadata || "{}") as { classTag?: string | null; clanTag?: string | null; clanId?: number | null; senior?: boolean };
    return { classTag: m.classTag ?? null, clanTag: m.clanTag ?? null, clanId: typeof m.clanId === "number" ? m.clanId : null, senior: m.senior === true };
  } catch {
    return { classTag: null, clanTag: null, clanId: null, senior: false };
  }
}


/**
 * How a lost signalling connection is made again. Sound that is already
 * flowing keeps flowing meanwhile (it does not travel over that connection),
 * but a key pressed or a player joining is not heard of until it is back, so
 * it should be back soon. The voice library's own way waits up to ten seconds
 * between tries; a home network that hiccups is usually fine again within a
 * second or two. So: at once, then quickly, then every second and a half, and
 * after half a minute every three seconds, so that a server that is really
 * down is not hammered by everyone at once. After three quarters of a minute
 * it gives up, as the library itself would, and the app asks the control
 * service where it should be.
 */
const RELINK: ReconnectPolicy = {
  nextRetryDelayInMs({ retryCount, elapsedMs }) {
    if (elapsedMs > 45_000) return null;
    const base = retryCount < 4 ? 300 * retryCount : elapsedMs < 30_000 ? 1500 : 3000;
    // Spread out, so that players who lost it at the same moment do not all come back at the same one.
    return Math.round(base * (0.75 + Math.random() * 0.5) + Math.random() * 150);
  },
};

export class VoiceEngine {
  private nets = new Map<string, Net>();
  private url = "";
  private mic?: MediaStream;
  private micTrack?: MediaStreamTrack;
  private micPromise?: Promise<void>;
  private ctx?: AudioContext;
  private meterSource?: MediaStreamAudioSourceNode;
  private meterNode?: AudioWorkletNode;
  private sink: HTMLElement;
  private queue: Promise<void> = Promise.resolve();
  private held = new Set<NetKind>();
  private voiceUntil = 0;
  /** Meter reports in a row above the voice activation marker, and the loudest of them (sinking slowly). */
  private loudReports = 0;
  private loudPeak = -100;
  private refreshTimer: number | undefined;
  private settings: Settings = getSettings();
  /** With more than one lounge (or a group and a lounge), the one the player talks in. They hear all of them. */
  private talkLounge: string | null = null;
  /** The group the player was last seen in: joining another puts their key back on the group. */
  private lastGroup: string | null = null;
  private lastVolumeTick = 0;
  /** Volume last set per track, to avoid setting it again and again. */
  private volumeSet = new WeakMap<object, number>();

  /** Latest mic level in dBFS, about every 10 ms. */
  level = -100;
  muteAll = false;
  /** The headset is off: nobody is heard (the mic is off too, see toggleDeafen). */
  deafened = false;
  /** Whether the mic was off when the headset went off, to put it back the same way. */
  private micBeforeDeafen = false;
  /** When Broadcast was locked open for a briefing; 0 when it is not. */
  private lockedSince = 0;
  micError = "";

  onChange: () => void = () => {};
  /** A room could not get back in with the token it has; fresh ones are needed. */
  onNeedRefresh: () => void = () => {};
  /** A voice room lost its signalling connection: which kind of net, and the voice library's own words about it. */
  onVoiceDropped: (what: { net: string; said: string[] }) => void = () => {};
  private levelListeners = new Set<(db: number) => void>();

  constructor() {
    this.sink = document.createElement("div");
    this.sink.hidden = true;
    document.body.appendChild(this.sink);
    onSettings(() => this.settingsChanged());
    // Backup clock. The meter worklet is the main one, because timers are
    // slowed while the window sits behind a game.
    window.setInterval(() => this.update(), 100);
  }

  // ---- Microphone ---------------------------------------------------------

  /** Captures the mic once and keeps it. Safe to call repeatedly. */
  startMic(): Promise<void> {
    this.micPromise ??= this.capture().catch((e) => {
      this.micPromise = undefined;
      this.micError = e instanceof Error ? e.message : String(e);
      this.onChange();
      throw e;
    });
    return this.micPromise;
  }

  private async capture() {
    const s = this.settings;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        deviceId: s.inputDeviceId ? { exact: s.inputDeviceId } : undefined,
        echoCancellation: s.echoCancellation,
        noiseSuppression: s.noiseSuppression,
        autoGainControl: s.autoGainControl,
      },
      video: false,
    });
    this.mic = stream;
    this.micTrack = stream.getAudioTracks()[0];
    this.micError = "";
    await this.startMeter(stream);
    this.onChange();
  }

  /** Level metering runs on the processed signal, so noise suppression acts before the voice gate. */
  private async startMeter(stream: MediaStream) {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        await this.ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}meter-worklet.js`);
        this.meterNode = new AudioWorkletNode(this.ctx, "meter");
        this.meterNode.port.onmessage = (e) => {
          this.level = e.data as number;
          if (this.level >= this.settings.vadThresholdDb) {
            this.loudPeak = this.loudReports === 0 ? this.level : Math.max(this.level, this.loudPeak - VOICE_PEAK_FALL_DB);
            this.loudReports++;
          } else this.loudReports = 0;
          this.levelListeners.forEach((l) => l(this.level));
          this.update();
        };
        // The graph only runs if it reaches the output; a silent gain keeps it inaudible.
        const silent = this.ctx.createGain();
        silent.gain.value = 0;
        this.meterNode.connect(silent).connect(this.ctx.destination);
      }
      this.meterSource?.disconnect();
      this.meterSource = this.ctx.createMediaStreamSource(stream);
      this.meterSource.connect(this.meterNode!);
      void this.ctx.resume();
    } catch (e) {
      console.warn("level meter unavailable", e);
    }
  }

  /** Re-captures after a device or processing change and swaps the new mic into every room. */
  private async recapture() {
    if (!this.mic) return;
    const old = this.mic;
    this.micPromise = this.capture();
    try {
      await this.micPromise;
    } catch (e) {
      this.mic = old; // keep the working mic
      this.micTrack = old.getAudioTracks()[0];
      this.micError = e instanceof Error ? e.message : String(e);
      this.micPromise = Promise.resolve();
      this.onChange();
      return;
    }
    for (const net of this.nets.values()) {
      if (!net.track || !this.micTrack) continue;
      const clone = this.micTrack.clone();
      clone.enabled = net.live;
      await net.track.replaceTrack(clone, true).catch((e) => console.warn("replaceTrack", e));
    }
    old.getTracks().forEach((t) => t.stop());
  }

  onLevel(listener: (db: number) => void): () => void {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  }

  /** Listens to the room for a few seconds and returns a threshold just above its noise. */
  async measureNoise(ms = 5000): Promise<number> {
    const samples: number[] = [];
    const stop = this.onLevel((db) => samples.push(db));
    await new Promise((r) => setTimeout(r, ms));
    stop();
    if (!samples.length) return this.settings.vadThresholdDb;
    samples.sort((a, b) => a - b);
    const loud = samples[Math.floor(samples.length * 0.95)];
    return Math.round(Math.min(-15, Math.max(-70, loud + 6)));
  }

  /** Records a few seconds of the mic and plays it back, so the player hears what others will. */
  async micTest(ms = 3000): Promise<void> {
    await this.startMic();
    if (!this.mic) return;
    const rec = new MediaRecorder(this.mic);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start();
    await new Promise((r) => setTimeout(r, ms));
    rec.stop();
    await stopped;
    const audio = new Audio(URL.createObjectURL(new Blob(chunks, { type: rec.mimeType })));
    const out = this.settings.outputDeviceId;
    if (out && "setSinkId" in audio) await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(out).catch(() => {});
    await audio.play();
    await new Promise((r) => (audio.onended = r));
    URL.revokeObjectURL(audio.src);
  }

  // ---- Rooms --------------------------------------------------------------

  /** Makes the connections match the net set. Calls are applied one at a time, in order. */
  apply(set: NetSet): Promise<void> {
    this.queue = this.queue.then(() => this.reconcile(set)).catch((e) => console.error("apply failed", e));
    return this.queue;
  }

  private async reconcile(set: NetSet) {
    this.url = set.url;
    const wanted = new Map(set.nets.map((g) => [g.room, g]));

    // Join new rooms (and re-join dead ones) before leaving anything.
    await Promise.all(
      [...wanted.values()].map(async (grant) => {
        const cur = this.nets.get(grant.room);
        if (cur && cur.room.state !== ConnectionState.Disconnected && !cur.failed) {
          cur.grant = grant;
          if (grant.speak && !cur.track) await this.publish(cur);
          else if (!grant.speak && cur.track) await this.unpublish(cur);
          return;
        }
        if (cur) await this.leave(cur);
        await this.join(grant);
      }),
    );

    for (const net of [...this.nets.values()]) {
      if (!wanted.has(net.grant.room)) await this.leave(net);
    }
    this.onChange();
  }

  private async join(grant: NetGrant) {
    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      reconnectPolicy: RELINK,
      publishDefaults: { dtx: true, red: true, audioPreset: AudioPresets.speech },
      audioOutput: this.settings.outputDeviceId ? { deviceId: this.settings.outputDeviceId } : undefined,
    });
    const net: Net = { grant, room, live: false, byKey: false, closeAt: 0, speakers: [], closing: false, failed: false, liveUntil: 0, seniorLiveUntil: 0, lowered: false };
    this.nets.set(grant.room, net);
    const changed = () => this.onChange();

    room
      // A room's signalling connection was lost and is being made again. What the voice library said
      // about why is passed on, once it has had a moment to say it (see VOICE_LOG).
      .on(RoomEvent.SignalReconnecting, () => {
        const at = Date.now();
        window.setTimeout(() => this.onVoiceDropped({ net: grant.net, said: voiceSaid(at - 5000) }), 1500);
      })
      .on(RoomEvent.ConnectionStateChanged, changed)
      .on(RoomEvent.ParticipantConnected, changed)
      .on(RoomEvent.ParticipantDisconnected, changed)
      .on(RoomEvent.ParticipantMetadataChanged, changed)
      .on(RoomEvent.ParticipantNameChanged, changed)
      .on(RoomEvent.ParticipantAttributesChanged, changed)
      .on(RoomEvent.TrackPublished, changed)
      .on(RoomEvent.TrackUnpublished, changed)
      .on(RoomEvent.AudioPlaybackStatusChanged, changed)
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        net.speakers = speakers.filter((p) => !p.isLocal).map((p) => {
          const m = meta(p);
          return { identity: p.identity, name: p.name || p.identity, clanId: m.clanId, clanTag: m.clanTag };
        });
        this.onChange();
      })
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.dataset.room = net.grant.room;
        this.sink.appendChild(el);
        this.applyVolumes(true);
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
      })
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
        // The server may grant speaking a moment after the net set says so.
        if (participant.isLocal && net.grant.speak && !net.track) void this.publish(net).then(changed);
      })
      .on(RoomEvent.Disconnected, () => {
        if (net.closing) return;
        // LiveKit gave up reconnecting, or the server removed us. Ask the
        // control channel what our rooms should be now; apply() re-joins.
        net.track = undefined;
        net.live = false;
        this.clearAudio(net.grant.room);
        this.needRefresh();
        this.onChange();
      });

    try {
      await room.connect(this.url, grant.token);
      if (grant.speak) await this.publish(net);
    } catch (e) {
      console.warn(`join ${grant.room} failed`, e);
      net.failed = true;
      this.needRefresh();
    }
    this.onChange();
  }

  private async publish(net: Net) {
    if (net.track || net.room.state !== ConnectionState.Connected) return;
    try {
      await this.startMic();
    } catch {
      return; // no microphone: listen-only until it is fixed in Settings
    }
    if (!this.micTrack || net.track) return;
    const clone = this.micTrack.clone();
    clone.enabled = false;
    const track = new LocalAudioTrack(clone, undefined, true);
    try {
      await net.room.localParticipant.publishTrack(track, { source: Track.Source.Microphone, name: net.grant.net });
      await track.mute();
      net.track = track;
    } catch (e) {
      // Usually the speak permission has not arrived yet; ParticipantPermissionsChanged retries.
      clone.stop();
      console.warn(`publish on ${net.grant.room} failed`, e);
    }
  }

  private async unpublish(net: Net) {
    const track = net.track;
    if (!track) return;
    net.track = undefined;
    net.live = false;
    await net.room.localParticipant.unpublishTrack(track, true).catch(() => {});
  }

  private async leave(net: Net) {
    net.closing = true;
    this.nets.delete(net.grant.room);
    net.track?.stop();
    await net.room.disconnect().catch(() => {});
    this.clearAudio(net.grant.room);
  }

  /** Removes a room's audio elements. A disconnect does not always report each track as unsubscribed. */
  private clearAudio(room: string) {
    this.sink.querySelectorAll<HTMLAudioElement>("audio").forEach((el) => {
      if (el.dataset.room === room) el.remove();
    });
  }

  /** Throttled: several rooms failing together produce one request. */
  private needRefresh() {
    if (this.refreshTimer !== undefined) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      this.onNeedRefresh();
    }, 3000);
  }

  async stop() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    await this.queue;
    await Promise.all([...this.nets.values()].map((n) => this.leave(n)));
    this.held.clear();
    this.lockedSince = 0;
    this.onChange();
  }

  // ---- Opening and closing the mic ---------------------------------------

  /** Key down / up for one kind of net. */
  ptt(kind: NetKind, down: boolean) {
    if (down) this.held.add(kind);
    else this.held.delete(kind);
    // Taking the Broadcast key in hand again ends a briefing lock: from here it is push-to-talk as usual.
    if (down && kind === "broadcast" && this.lockedSince) this.setBroadcastLock(false);
    this.update();
  }

  /**
   * The mic on or off everywhere: the Mute all key and the header's mic
   * button. Turning the mic on while the headset is off turns the headset on
   * too, as players expect from other voice apps: you cannot talk unheard-of.
   */
  toggleMuteAll() {
    if (this.muteAll && this.deafened) {
      this.deafened = false;
      this.muteAll = false;
      this.applyVolumes(true);
    } else {
      this.muteAll = !this.muteAll;
    }
    if (this.muteAll) this.lockedSince = 0;
    this.cue(this.muteAll ? "off" : "on");
    this.update();
    this.onChange();
  }

  /**
   * The headset off or on: off, nobody is heard and the mic is off as well;
   * on again, the mic is back the way it was before. Only this player's own
   * playback changes; the control service shows the others a mark beside the
   * player's name (App tells it, decision 59). Not kept over a restart.
   */
  toggleDeafen() {
    this.deafened = !this.deafened;
    if (this.deafened) {
      this.micBeforeDeafen = this.muteAll;
      this.muteAll = true;
      this.lockedSince = 0;
    } else {
      this.muteAll = this.micBeforeDeafen;
    }
    this.cue(this.deafened ? "off" : "on");
    this.applyVolumes(true);
    this.update();
    this.onChange();
  }

  // ---- Broadcast lock, for briefings ---------------------------------------

  /** The Broadcast net, if this player may lock it open (the event leader, with a working mic on it). */
  private lockable(): Net | undefined {
    return [...this.nets.values()].find((n) => n.grant.net === "broadcast" && n.grant.lock === true && n.grant.speak && !!n.track);
  }

  get broadcastLocked(): boolean {
    return this.lockedSince > 0;
  }

  /**
   * Holds Broadcast open without a key, for a briefing, or releases it. It is
   * also released by pressing the Broadcast key, by Mute all, when the
   * operation's Broadcast net goes away, and by itself after
   * BROADCAST_LOCK_MAX_MS. Returns whether it is locked afterwards.
   */
  setBroadcastLock(on: boolean): boolean {
    const want = on && !this.muteAll && !!this.lockable();
    if (want === this.broadcastLocked) return want;
    this.lockedSince = want ? Date.now() : 0;
    this.cue(want ? "locked" : "released");
    this.update();
    this.onChange();
    return want;
  }

  /**
   * The room the player talks in between operations: their group if they sit in one, unless they chose a
   * lounge with Talk here; otherwise their first lounge. Joining a group puts the key back on the group.
   */
  get loungeRoom(): string | null {
    const nets = [...this.nets.values()];
    const group = nets.find((n) => n.grant.net === "group")?.grant.room ?? null;
    if (group !== this.lastGroup) {
      this.lastGroup = group;
      if (group) this.talkLounge = null;
    }
    const rooms = [...(group ? [group] : []), ...nets.filter((n) => n.grant.net === "lounge").map((n) => n.grant.room)];
    return this.talkLounge && rooms.includes(this.talkLounge) ? this.talkLounge : (rooms[0] ?? null);
  }

  setLoungeRoom(room: string) {
    this.talkLounge = room;
    this.update();
    this.onChange();
  }

  /** The net voice activation applies to: the party, Reserve for a player without one, or the lounge. */
  private voiceRoom(): string | null {
    let reserve: string | null = null;
    for (const net of this.nets.values()) {
      if (net.grant.net === "party") return net.grant.room;
      if (net.grant.net === "reserve") reserve = net.grant.room;
    }
    return reserve ?? this.loungeRoom;
  }

  /** Decides, for every net, whether the mic should be open now. Runs on every key event and meter tick. */
  private update() {
    const now = Date.now();
    const s = this.settings;
    const voiceMode = s.partyMode === "voice";
    const speech = this.loudReports >= VOICE_OPEN_REPORTS && this.level >= this.loudPeak - VOICE_HOLD_DB;
    // Only a voice opens the mic or keeps it open: typing after a sentence must not hold it open. The gaps
    // between words are bridged by the hold time ("Keep open after you stop").
    if (voiceMode && speech) this.voiceUntil = now + s.vadHoldMs;
    if (this.lockedSince && (!this.lockable() || now - this.lockedSince > BROADCAST_LOCK_MAX_MS)) {
      this.lockedSince = 0;
      this.cue("released");
      this.onChange();
    }
    const locked = this.lockedSince > 0;
    const keyedHeld = locked || KEYED_ONLY.some((k) => this.held.has(k));
    const voiceRoom = voiceMode ? this.voiceRoom() : null;
    const loungeRoom = this.loungeRoom;
    let changed = false;

    for (const net of this.nets.values()) {
      if (!net.track) continue;
      // A lounge or a group is talked in with the Party key, and only the chosen one.
      const byKey =
        net.grant.net === "lounge" || net.grant.net === "group"
          ? net.grant.room === loungeRoom && this.held.has("party")
          : this.held.has(net.grant.net) || (locked && net.grant.net === "broadcast" && net.grant.lock === true);
      const byVoice = net.grant.room === voiceRoom && !keyedHeld && now < this.voiceUntil;
      const want = !this.muteAll && (byKey || byVoice);

      if (want) {
        net.closeAt = 0;
        net.byKey = byKey;
        if (!net.live) {
          net.live = true;
          // Enabling the media track is what opens the mic; LiveKit's unmute also tells the server.
          net.track.mediaStreamTrack.enabled = true;
          void net.track.unmute();
          changed = true;
        }
      } else if (net.live) {
        // Voice activation already waited out its hold time; a released key gets a short tail.
        if (!net.closeAt) net.closeAt = now + (net.byKey && !this.muteAll ? RELEASE_TAIL_MS : 0);
        if (now >= net.closeAt) {
          net.live = false;
          net.closeAt = 0;
          void net.track.mute();
          changed = true;
        }
      }
    }
    if (changed) this.onChange();
    if (now - this.lastVolumeTick >= VOLUME_TICK_MS) {
      this.lastVolumeTick = now;
      this.applyVolumes();
    }
  }

  // ---- Volume: per net, per player, and ducking ---------------------------

  /**
   * Sets every incoming track to: the net's volume, times the player's own
   * setting for that speaker, times the ducking factor. Ducking: while a
   * higher-priority net is live, lower nets drop to the duck level; and on
   * Command, while a senior leader speaks, the party leaders drop the same way.
   *
   * "Live" is read from who has their mic open, which arrives sooner than
   * the server's who-is-speaking detection, so the start of a call is not masked.
   */
  private applyVolumes(force = false) {
    const now = Date.now();
    const s = this.settings;
    const nets = [...this.nets.values()];

    for (const net of nets) {
      for (const p of net.room.remoteParticipants.values()) {
        let open = false;
        p.audioTrackPublications.forEach((pub) => {
          if (!pub.isMuted && pub.track) open = true;
        });
        if (!open || s.playerMuted[p.identity]) continue;
        net.liveUntil = now + LIVE_HOLD_MS;
        if (net.grant.net === "command" && meta(p).senior) net.seniorLiveUntil = now + LIVE_HOLD_MS;
      }
    }

    let shownChanged = false;
    for (const net of nets) {
      const rank = PRIORITY[net.grant.net];
      const ducked = s.ducking && nets.some((other) => PRIORITY[other.grant.net] < rank && other.liveUntil > now);
      const seniorLive = s.ducking && net.grant.net === "command" && net.seniorLiveUntil > now;
      // Shown on the net's card, so a player can see why it went quiet.
      if (net.lowered !== ducked) {
        net.lowered = ducked;
        shownChanged = true;
      }
      // While the player sits in a group, their lounges carry on underneath it, quieter (decision 64).
      const under = net.grant.net === "lounge" && nets.some((n) => n.grant.net === "group") ? s.loungeUnderGroup : 1;
      const base = s.netVolume[net.grant.net] * under;
      for (const p of net.room.remoteParticipants.values()) {
        const own = s.playerMuted[p.identity] ? 0 : (s.playerVolume[p.identity] ?? 1);
        const duck = ducked || (seniorLive && !meta(p).senior) ? s.duckLevel : 1;
        const volume = this.deafened ? 0 : Math.max(0, Math.min(1, base * own * duck));
        p.audioTrackPublications.forEach((pub) => {
          const track = pub.track as RemoteAudioTrack | undefined;
          if (!track) return;
          if (!force && this.volumeSet.get(track) === volume) return;
          this.volumeSet.set(track, volume);
          track.setVolume(volume);
        });
      }
    }
    if (shownChanged) this.onChange();
  }

  // ---- Settings -----------------------------------------------------------

  private settingsChanged() {
    const prev = this.settings;
    const next = (this.settings = getSettings());
    if (
      prev.inputDeviceId !== next.inputDeviceId ||
      prev.echoCancellation !== next.echoCancellation ||
      prev.noiseSuppression !== next.noiseSuppression ||
      prev.autoGainControl !== next.autoGainControl
    ) {
      this.queue = this.queue.then(() => this.recapture()).catch(() => {});
    }
    if (prev.outputDeviceId !== next.outputDeviceId) {
      for (const net of this.nets.values()) void net.room.switchActiveDevice("audiooutput", next.outputDeviceId || "default").catch(() => {});
    }
    this.applyVolumes();
    this.update();
  }

  // ---- Playback permission and cues ---------------------------------------

  /** True when the browser is holding audio back until the player clicks something. */
  get audioBlocked(): boolean {
    if (this.ctx && this.ctx.state === "suspended") return true;
    for (const net of this.nets.values()) if (net.room.state === ConnectionState.Connected && !net.room.canPlaybackAudio) return true;
    return false;
  }

  async unlockAudio() {
    await this.ctx?.resume().catch(() => {});
    await Promise.all([...this.nets.values()].map((n) => n.room.startAudio().catch(() => {})));
    this.onChange();
  }

  /** A short two-note cue, generated here (no sound files, nothing borrowed). */
  cue(kind: "moved" | "locked" | "released" | "order" | "ready" | "call" | "off" | "on") {
    const s = this.settings;
    if (!s.cues || s.cueVolume <= 0) return;
    const ctx = (this.ctx ??= new AudioContext());
    // A new order: one low note twice, hard to mistake for anything else. A ready check: a rising question.
    // Mic or headset off: a short low step down; on again: the same step up.
    const notes =
      kind === "moved" ? [660, 880] : kind === "locked" ? [523, 659, 784] : kind === "order" ? [392, 392] : kind === "ready" ? [587, 740, 880] : kind === "call" ? [1047, 1319]
      : kind === "off" ? [440, 330] : kind === "on" ? [330, 440] : [784, 523];
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25 * s.cueVolume, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  // ---- For the UI ---------------------------------------------------------

  get hasMic(): boolean {
    return !!this.micTrack;
  }

  view(): NetView[] {
    const order: NetKind[] = ["broadcast", "command", "clan", "party", "reserve", "group", "lounge"];
    return [...this.nets.values()]
      .sort((a, b) => order.indexOf(a.grant.net) - order.indexOf(b.grant.net))
      .map((net) => {
        const speaking = new Set(net.room.activeSpeakers.map((p) => p.identity));
        const person = (p: Participant, self: boolean): Member => ({
          identity: p.identity,
          name: p.name || p.identity,
          ...meta(p),
          speaking: self ? net.live : speaking.has(p.identity),
          self,
          canSpeak: self ? net.grant.speak : (p.permissions?.canPublish ?? false),
          volume: this.settings.playerVolume[p.identity] ?? 1,
          muted: this.settings.playerMuted[p.identity] === true,
          headsetOff: self ? this.deafened : p.attributes?.headset === "off",
        });
        const members = [...net.room.remoteParticipants.values()].map((p) => person(p, false));
        const relinking = net.room.state === ConnectionState.SignalReconnecting;
        if (net.room.state === ConnectionState.Connected || relinking) members.push(person(net.room.localParticipant, true));
        members.sort((a, b) => a.name.localeCompare(b.name));
        const state: NetView["state"] = net.failed
          ? "disconnected"
          : net.room.state === ConnectionState.Connected
            ? "connected"
            : relinking
              ? "relinking"
              : net.room.state === ConnectionState.Connecting
              ? "connecting"
              : net.room.state === ConnectionState.Disconnected
                ? "disconnected"
                : "reconnecting";
        return {
          net: net.grant.net,
          label: said(net.grant.say, net.grant.label),
          room: net.grant.room,
          state,
          speak: net.grant.speak && !!net.track,
          live: net.live,
          speakers: net.speakers,
          lowered: net.lowered,
          canLock: net.grant.net === "broadcast" && net.grant.lock === true && net.grant.speak,
          locked: net.grant.net === "broadcast" && this.lockedSince > 0,
          members,
        };
      });
  }
}
