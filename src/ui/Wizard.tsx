import { t } from "../words";
import { useEffect, useState } from "react";
import { engine } from "../runtime";
import { setSettings, useSettings } from "../settings";
import { DevicePickers, MicTest, PartyMode, useEngine, Wordmark } from "./common";

const STEPS = ["Devices", "Microphone test", "How you talk"] as const;

/** First run: pick devices, hear yourself, then choose how you talk to your party. */
export function Wizard() {
  const [step, setStep] = useState(0);
  const s = useSettings();
  const eng = useEngine();

  useEffect(() => {
    void engine.startMic().catch(() => {});
  }, []);

  const ready = step < 2 || s.partyMode === "voice" || s.bindings.party !== null;

  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="panel rise w-full max-w-lg p-8 flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <Wordmark className="text-lg" />
          <span className="text-text-muted tabular-nums">Step {step + 1} of {STEPS.length}</span>
        </div>
        <div className="flex gap-1" aria-hidden>
          {STEPS.map((name, i) => (
            <span key={name} className={`h-0.5 flex-1 transition-colors duration-150 ${i <= step ? "bg-gold" : "bg-line"}`} />
          ))}
        </div>
        <h1 className="title text-gold">{STEPS[step]}</h1>

        {eng.micError && (
          <p className="text-danger" role="alert">
            The microphone could not be opened ({eng.micError}). Allow microphone access, then{" "}
            <button type="button" className="underline cursor-pointer" onClick={() => void engine.startMic().catch(() => {})}>{t("try again")}</button>.
          </p>
        )}

        {step === 0 && (
          <>
            <p className="text-text-muted">{t("Choose what you speak into and what you listen on. You can change both later in Settings.")}</p>
            <DevicePickers />
          </>
        )}
        {step === 1 && (
          <>
            <p className="text-text-muted">{t("Speak and watch the bar move. The test records three seconds and plays them back, so you hear what others will.")}</p>
            <MicTest />
          </>
        )}
        {step === 2 && (
          <>
            <p className="text-text-muted">
              {t("Your party, and your clan's lounge between events, hear you either while you hold a key or whenever you speak. Mouse side buttons work as keys. Command, Clan and Broadcast always need a key; you bind those if you get such a role.")}
            </p>
            <PartyMode />
          </>
        )}

        <div className="flex justify-between">
          <button type="button" className="btn btn-quiet" disabled={step === 0} onClick={() => setStep(step - 1)}>{t("Back")}</button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn" onClick={() => setStep(step + 1)}>{t("Continue")}</button>
          ) : (
            <button type="button" className="btn" disabled={!ready} onClick={() => setSettings({ wizardDone: true })}>{t("Finish")}</button>
          )}
        </div>
      </div>
    </main>
  );
}
