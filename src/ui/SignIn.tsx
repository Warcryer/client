import { t } from "../words";
import { useEffect, useState } from "react";
import { beginSignIn, onSignInLink, redeem } from "../auth";
import { isDesktop, PRIVACY_URL, SERVER, TERMS_URL } from "../config";
import { openInBrowser, Wordmark } from "./common";

export function SignIn({ onToken, notice }: { onToken: (token: string) => void; notice?: string }) {
  const [waiting, setWaiting] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const finish = async (c: string) => {
    setError("");
    try {
      onToken(await redeem(c));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    let off = () => {};
    let gone = false;
    void onSignInLink((c) => void finish(c)).then((un) => (gone ? un() : (off = un)));
    return () => {
      gone = true;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="panel rise w-full max-w-sm p-8 flex flex-col gap-5 text-center">
        <Wordmark className="text-2xl" />
        <div className="flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-gradient-to-l from-gold-dim to-transparent" />
          <span className="h-1.5 w-1.5 rotate-45 bg-gold" />
          <span className="h-px flex-1 bg-gradient-to-r from-gold-dim to-transparent" />
        </div>
        <p className="text-text-muted">{t("Voice that follows the chain of command.")}</p>
        {notice && <p className="text-gold" role="status">{notice}</p>}
        {!isDesktop ? (
          <>
            <a className="btn" href={`${SERVER}/`}>{t("Sign in on the site")}</a>
            <p className="text-xs text-text-muted">{t("Sign in with Discord there, then come back to this page.")}</p>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                setError("");
                try {
                  await beginSignIn();
                  setWaiting(true);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              {t("Sign in with Discord")}
            </button>
            {waiting && (
              <div className="flex flex-col gap-2 text-left">
                <p className="text-text-muted">{t("Finish signing in in your browser. This window continues by itself.")}</p>
                <details>
                  <summary className="cursor-pointer text-text-muted">{t("Enter code instead")}</summary>
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void finish(code);
                    }}
                  >
                    <input className="field font-mono text-xs" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("Code from the browser page")} aria-label={t("Sign-in code")} />
                    <button className="btn btn-quiet text-sm" disabled={!code.trim()}>{t("Use")}</button>
                  </form>
                </details>
              </div>
            )}
          </>
        )}
        {error && <p className="text-danger" role="alert">{error}</p>}
        <p className="text-xs text-text-muted">
          In beta, and free. By signing in you accept the{" "}
          <button type="button" className="underline underline-offset-2 hover:text-text cursor-pointer" onClick={() => void openInBrowser(TERMS_URL)}>{t("terms of use")}</button>; what is kept about you is in the{" "}
          <button type="button" className="underline underline-offset-2 hover:text-text cursor-pointer" onClick={() => void openInBrowser(PRIVACY_URL)}>{t("privacy policy")}</button>.
        </p>
      </div>
    </main>
  );
}
