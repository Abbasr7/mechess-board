/**
 * Document-level keyboard capture, like the original's `keys` plugin.
 *
 * Keys are identified by `KeyboardEvent.code` with the `Key` / `Digit` prefix
 * removed and lower-cased (`KeyX` → `x`, `ArrowLeft` → `arrowleft`,
 * `ControlLeft` → `control`). Events are ignored while an editable element has
 * focus. The set of currently pressed keys is tracked and cleared on window
 * blur / context menu.
 */

const SPECIAL = new Set([
  'Escape', 'Tab', 'Backspace', 'Enter', 'Backslash', 'Period', 'Slash', 'Comma', 'Space', 'Delete', 'Home', 'End',
  'PageUp', 'PageDown', 'ArrowUp', 'Numpad8', 'ArrowDown', 'Numpad5', 'ArrowLeft', 'Numpad4', 'ArrowRight', 'Numpad6',
  'BracketLeft', 'BracketRight',
]);

/** Normalise `KeyboardEvent.code` to the short key name, or `undefined` for keys that are not tracked. */
export function keyName(code: string): string | undefined {
  if (!code) return undefined;
  let name: string | undefined;
  if (code.includes('Digit')) name = code.replace('Digit', '');
  else if (code.includes('Key')) name = code.replace('Key', '');
  else if (code.includes('Control')) name = 'Control';
  else if (code.includes('Shift')) name = 'Shift';
  else if (code.includes('Alt')) name = 'Alt';
  else if (code.includes('Meta')) name = 'Meta';
  else if (SPECIAL.has(code)) name = code;
  return name?.toLowerCase();
}

const MODIFIERS = ['meta', 'alt', 'control'];

const isEditable = (el: Element | null): boolean => {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable === true;
};

export interface KeyboardHandlers {
  onKeydown?: (key: string, e: KeyboardEvent) => void;
  onKeyup?: (key: string, e: KeyboardEvent) => void;
}

export class KeyboardController {
  private pressed = new Set<string>();
  private active = true;

  constructor(private doc: Document, private handlers: KeyboardHandlers = {}) {
    doc.addEventListener('keydown', this.down);
    doc.addEventListener('keyup', this.up);
    doc.defaultView?.addEventListener('blur', this.clear);
    doc.defaultView?.addEventListener('contextmenu', this.clear);
  }

  isPressed(key: string): boolean {
    return this.pressed.has(key.toLowerCase());
  }

  pressedKeys(): string[] {
    return [...this.pressed].sort();
  }

  enable(): void {
    this.active = true;
  }

  disable(): void {
    this.active = false;
    this.pressed.clear();
  }

  destroy(): void {
    this.doc.removeEventListener('keydown', this.down);
    this.doc.removeEventListener('keyup', this.up);
    this.doc.defaultView?.removeEventListener('blur', this.clear);
    this.doc.defaultView?.removeEventListener('contextmenu', this.clear);
    this.pressed.clear();
  }

  private down = (e: KeyboardEvent): void => {
    if (!this.active || isEditable(this.doc.activeElement)) return;
    const key = keyName(e.code);
    if (!key) return;
    this.pressed.add(key);
    this.handlers.onKeydown?.(key, e);
  };

  private up = (e: KeyboardEvent): void => {
    const key = keyName(e.code);
    if (!key) return;
    if (MODIFIERS.includes(key)) this.pressed.clear();
    this.pressed.delete(key);
    this.handlers.onKeyup?.(key, e);
  };

  private clear = (): void => {
    this.pressed.clear();
  };
}
