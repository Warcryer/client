import { d, t } from "./words";
// Key codes are Windows virtual-key codes everywhere, so a binding made in the
// desktop app and one made in the browser fallback mean the same thing.
// Mouse buttons use their VK values too: middle 0x04, side buttons 0x05 / 0x06.

export const VK_MBUTTON = 0x04;
export const VK_XBUTTON1 = 0x05;
export const VK_XBUTTON2 = 0x06;

const NAMED: Record<number, string> = {
  0x04: "Mouse 3 (middle)",
  0x05: "Mouse 4 (side)",
  0x06: "Mouse 5 (side)",
  0x08: "Backspace",
  0x09: "Tab",
  0x0d: "Enter",
  0x10: "Shift",
  0x11: "Ctrl",
  0x12: "Alt",
  0x14: "Caps Lock",
  0x1b: "Esc",
  0x20: "Space",
  0x21: "Page Up",
  0x22: "Page Down",
  0x23: "End",
  0x24: "Home",
  0x25: "Left",
  0x26: "Up",
  0x27: "Right",
  0x28: "Down",
  0x2d: "Insert",
  0x2e: "Delete",
  0xa0: "Left Shift",
  0xa1: "Right Shift",
  0xa2: "Left Ctrl",
  0xa3: "Right Ctrl",
  0xa4: "Left Alt",
  0xa5: "Right Alt",
  0xba: ";",
  0xbb: "=",
  0xbc: ",",
  0xbd: "-",
  0xbe: ".",
  0xbf: "/",
  0xc0: "`",
  0xdb: "[",
  0xdc: "\\",
  0xdd: "]",
  0xde: "'",
};

export function keyLabel(code: number): string {
  if (NAMED[code]) return NAMED[code];
  if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a)) {
    return String.fromCharCode(code);
  }
  if (code >= 0x60 && code <= 0x69) return t(`Numpad ${d(code - 0x60)}`);
  if (code >= 0x70 && code <= 0x87) return `F${code - 0x6f}`;
  return t(`Key 0x${d(code.toString(16).toUpperCase())}`);
}

/** Browser mouse button index -> VK code, or null for left/right click. */
export function mouseButtonToVk(button: number): number | null {
  if (button === 1) return VK_MBUTTON;
  if (button === 3) return VK_XBUTTON1;
  if (button === 4) return VK_XBUTTON2;
  return null;
}
