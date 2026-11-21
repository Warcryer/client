// Window behaviour that lives on the native side of the desktop app.

import { isDesktop } from "./config";
import { getSettings, onSettings } from "./settings";

let last: boolean | null = null;

async function push() {
  const want = getSettings().closeToTray;
  if (want === last) return;
  last = want;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_close_to_tray", { enabled: want });
}

/**
 * The window opens at 1280 x 800. A screen with less to give (a laptop at 150% scaling has 1280 x 680
 * once the taskbar is taken off) would leave its lower edge out of reach, so there the window is made
 * to fit the screen it opened on. Once, at start; after that its size is the player's.
 */
async function fitToScreen() {
  const { currentMonitor, getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const monitor = await currentMonitor();
  if (!monitor || (await w.isMaximized())) return;
  const scale = monitor.scaleFactor || 1;
  const area = monitor.workArea?.size ?? monitor.size;
  const room = { w: Math.floor(area.width / scale), h: Math.floor(area.height / scale) };
  const [outer, inner] = await Promise.all([w.outerSize(), w.innerSize()]);
  const have = { w: Math.ceil(outer.width / scale), h: Math.ceil(outer.height / scale) };
  if (have.w <= room.w && have.h <= room.h) return;
  // setSize takes the size of the inside; the title bar and borders come on top of it.
  const frame = { w: have.w - Math.floor(inner.width / scale), h: have.h - Math.floor(inner.height / scale) };
  await w.setSize(new LogicalSize(Math.min(have.w, room.w) - frame.w, Math.min(have.h, room.h) - frame.h));
  await w.center();
}

/** Keeps the native side in step with the "keep running in the tray" setting, and the window on the screen. */
export function startShell() {
  if (!isDesktop) return;
  void fitToScreen().catch(() => {});
  void push().catch(() => {});
  onSettings(() => void push().catch(() => {}));
}
