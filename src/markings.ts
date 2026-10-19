/**
 * User markings (right-click highlights and arrows).
 *
 * Semantics observed in the original:
 *  - right-click on a square toggles a highlight, right-drag between two
 *    squares toggles an arrow;
 *  - the colour is chosen by the modifier key held on release
 *    (none / shift / ctrl / alt);
 *  - markings are keyed by `type|square` or `type|fromto`: toggling an existing
 *    marking with the *same* data removes it, with different data (another
 *    modifier) replaces it;
 *  - a left-click on the board removes every non-persistent user marking.
 */
import type { KeyModifier, Square } from './types';

export interface HighlightMarking {
  kind: 'highlight';
  key: string;
  square: Square;
  modifier: KeyModifier;
  /** Explicit colour; overrides the modifier colour. */
  color?: string;
  opacity?: number;
  /** Survives left-clicks on the board. */
  persistent: boolean;
}

export interface ArrowMarking {
  kind: 'arrow';
  key: string;
  from: Square;
  to: Square;
  modifier: KeyModifier;
  color?: string;
  opacity?: number;
  /** Relative thickness, 1 = default. */
  width?: number;
  persistent: boolean;
  /** Grow in and breathe instead of appearing at once. */
  animated?: boolean;
  /** Draw a gliding hand instead of an arrow. */
  pointerFinger?: boolean;
}

export type Marking = HighlightMarking | ArrowMarking;

/**
 * `key`: a key of the caller's own instead of `type|square` / `type|fromto`.
 * A page drawing its own markings (engine arrows, tints) gives them their own
 * keys, so they live beside the user's markings on the same squares: the
 * user's right-clicks neither replace nor remove them, and two arrows between
 * the same squares can both be shown.
 */
export type MarkingInput =
  | { kind: 'highlight'; key?: string; square: Square; modifier?: KeyModifier; color?: string; opacity?: number; persistent?: boolean }
  | { kind: 'arrow'; key?: string; from: Square; to: Square; modifier?: KeyModifier; color?: string; opacity?: number; width?: number; persistent?: boolean; animated?: boolean; pointerFinger?: boolean };

export interface MarkingsDelta {
  added: Marking[];
  removed: Marking[];
}

const sameData = (a: Marking, b: Marking): boolean =>
  a.modifier === b.modifier &&
  a.color === b.color &&
  a.opacity === b.opacity &&
  a.persistent === b.persistent &&
  (a.kind === 'arrow' && b.kind === 'arrow'
    ? a.animated === b.animated && a.pointerFinger === b.pointerFinger && a.width === b.width
    : true);

export function buildMarking(input: MarkingInput): Marking {
  const modifier = input.modifier ?? 'none';
  const persistent = input.persistent ?? false;
  if (input.kind === 'highlight') {
    return {
      kind: 'highlight',
      key: input.key ?? `highlight|${input.square}`,
      square: input.square,
      modifier,
      color: input.color,
      opacity: input.opacity,
      persistent,
    };
  }
  return {
    kind: 'arrow',
    key: input.key ?? `arrow|${input.from}${input.to}`,
    from: input.from,
    to: input.to,
    modifier,
    color: input.color,
    opacity: input.opacity,
    width: input.width,
    persistent,
    animated: input.animated,
    pointerFinger: input.pointerFinger,
  };
}

export class Markings {
  private items = new Map<string, Marking>();

  constructor(private onChange: (delta: MarkingsDelta) => void) {}

  all(): Marking[] {
    return [...this.items.values()];
  }

  get(key: string): Marking | undefined {
    return this.items.get(key);
  }

  /** Add or replace (never removes). */
  add(input: MarkingInput): Marking {
    const m = buildMarking(input);
    const prev = this.items.get(m.key);
    this.items.set(m.key, m);
    this.onChange({ added: [m], removed: prev ? [prev] : [] });
    return m;
  }

  /** Toggle: identical marking is removed, otherwise added / replaced. */
  toggle(input: MarkingInput): Marking | null {
    const m = buildMarking(input);
    const prev = this.items.get(m.key);
    if (prev && sameData(prev, m)) {
      this.items.delete(m.key);
      this.onChange({ added: [], removed: [prev] });
      return null;
    }
    this.items.set(m.key, m);
    this.onChange({ added: [m], removed: prev ? [prev] : [] });
    return m;
  }

  remove(key: string): void {
    const prev = this.items.get(key);
    if (!prev) return;
    this.items.delete(key);
    this.onChange({ added: [], removed: [prev] });
  }

  /** Remove everything (or only non-persistent markings). */
  clear(opts: { includePersistent?: boolean } = {}): void {
    const removed: Marking[] = [];
    for (const [key, m] of this.items) {
      if (m.persistent && !opts.includePersistent) continue;
      removed.push(m);
      this.items.delete(key);
    }
    if (removed.length) this.onChange({ added: [], removed });
  }
}
