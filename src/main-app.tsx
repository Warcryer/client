// The app itself: every screen, the voice engine and the key capture.
import { createRoot } from "react-dom/client";
import App from "./App";
import { rememberedLanguage, setLanguage } from "./i18n";
import { startInviteLinks } from "./invite";
import { startShell } from "./shell";
import { startStrip } from "./strip/publish";
import { Boot } from "./ui/Boot";
import { TipLayer } from "./ui/tips";

// The language chosen last time on this computer, for the screens that come before the server has said who this is.
void setLanguage(rememberedLanguage());
startShell();
startStrip();
void startInviteLinks().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <>
    <Boot>
      <App />
    </Boot>
    <TipLayer />
  </>,
);

// Space and the arrow keys scroll the page by default, which is distracting
// when they are bound to a net. Typing in a text field is left alone.
window.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement | null;
  const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  if (!typing && [" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) {
    e.preventDefault();
  }
});
