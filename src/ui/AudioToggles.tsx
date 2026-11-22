// The mic and headset buttons: always in sight at the top right of the app
// (and small on the compact strip), one click to turn either off or on.
// Off is drawn crossed out in red, so it can be seen at a glance.

import { t } from "../words";

/** A microphone: capsule, cradle and stand. Drawn here, nothing borrowed. */
export function MicIcon({ off, size = 18 }: { off: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21M8.5 21h7" />
      {off && <path d="M4 4l16 16" strokeWidth={2.2} />}
    </svg>
  );
}

/** A headset: the band over the head and the two ear cups. */
export function HeadsetIcon({ off, size = 18 }: { off: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="4.5" height="6.5" rx="1.5" />
      <rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5" />
      {off && <path d="M4 4l16 16" strokeWidth={2.2} />}
    </svg>
  );
}

type Props = {
  micOff: boolean;
  headsetOff: boolean;
  onMic: () => void;
  onHeadset: () => void;
  /** Smaller, for the compact strip. */
  small?: boolean;
  /** The mic is open on a net right now: it is drawn green. */
  live?: boolean;
};

/** Both buttons side by side. Red and crossed out when off. */
export function AudioToggles({ micOff, headsetOff, onMic, onHeadset, small, live }: Props) {
  const size = small ? 14 : 18;
  const cls = (off: boolean, on = false) =>
    t(`flex shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors duration-150 ${
      small ? "h-[18px] w-[20px]" : "h-8 w-9 border"
    } ${
      off
        ? `text-danger ${small ? "" : "border-danger/70 bg-danger/10"}`
        : on
          ? small ? "text-net-party" : "text-net-party border-net-party bg-net-party/10"
          : `text-text-muted hover:text-text ${small ? "" : "border-line hover:border-gold-dim"}`
    }`);
  return (
    <span className="flex shrink-0 items-center gap-1" data-audio-toggles>
      <button
        type="button"
        className={cls(micOff, live === true)}
        onClick={onMic}
        aria-pressed={micOff}
        aria-label={micOff ? t("Mic off: click to turn it on") : t("Mic on: click to turn it off")}
        data-mic-toggle={micOff ? "off" : "on"}
        data-mic-live={live && !micOff ? "" : undefined}
      >
        <MicIcon off={micOff} size={size} />
      </button>
      <button
        type="button"
        className={cls(headsetOff)}
        onClick={onHeadset}
        aria-pressed={headsetOff}
        aria-label={headsetOff ? t("Headset off, you hear no one: click to turn it on") : t("Headset on: click to hear no one")}
        data-headset-toggle={headsetOff ? "off" : "on"}
      >
        <HeadsetIcon off={headsetOff} size={size} />
      </button>
    </span>
  );
}
