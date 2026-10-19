import type {
  AnimationType,
  Color,
  CoordinatesPosition,
  KeyModifier,
  MoveMethod,
  PieceType,
} from './types';
import type { BoardTheme } from './themes';
import type { SoundSource } from './sounds';
import type { ExtrasOptions } from './vfx/extras';
import type { EffectType } from './view/effects';

/** Animation duration in ms for each animation type (the original's `Animation.Speeds`). */
export const ANIMATION_DURATION: Record<AnimationType, number> = {
  default: 180,
  fast: 100,
  slow: 500,
  none: 0,
  // "dynamic" shares the default duration; it adds easing and a tilt (see animation.ts)
  dynamic: 180,
  // "natural" / "arcade" use their own keyframe timelines (src/fx/styles.ts); these are the move durations
  natural: 300,
  arcade: 400,
};

export type ModifierColors = Record<KeyModifier, string>;

export type PieceSource = string | ((color: Color, type: PieceType) => string);

export interface BoardOptions {
  /** DOM id of the board element. Auto-generated when omitted. */
  id: string;

  // ── interaction ─────────────────────────────────────────────────────────
  /** When false the board ignores all pointer input. */
  enabled: boolean;
  /**
   * `play`     – the local user plays `playingAs`; clicking out of turn queues premoves.
   * `analysis` – whoever is to move may move; no premoves.
   * `view`     – read-only.
   * `setup`    – position editor: any piece goes anywhere, dropping it off the board deletes it
   *              (see `board.setup`). Leaving the mode commits the position when it is legal.
   */
  mode: 'play' | 'analysis' | 'view' | 'setup';
  /** Side played by the local user in `play` mode. `null` lets both sides move (hot-seat). */
  playingAs: Color | null;
  moveMethod: MoveMethod;
  /** Queue the pawn automatically instead of opening the promotion window (hold Alt to override). */
  autoPromote: boolean;
  /** Allow queueing premoves while it is the opponent's turn (`play` mode only). */
  premoves: boolean;
  /**
   * Castle only by moving the king two files. By default the king may also be dropped on its own
   * rook (the rook square then shows a hint ring too).
   */
  disableRookCastling: boolean;
  /**
   * End the game by itself on threefold repetition and the fifty-move rule (default). When off, those
   * draws must be claimed with `board.claimDraw()`.
   */
  autoClaimDraw: boolean;
  /** Listen to the keyboard: `x` flips, arrow keys / numpad 4 6 8 5 step through the moves. */
  captureKeyStrokes: boolean;
  /** Keep arrow-key / navigation controls disabled. */
  disableUserNavigation: boolean;
  /** Draw right-click arrows / highlights. */
  allowMarkings: boolean;
  disableUserMarkings: boolean;

  // ── appearance ──────────────────────────────────────────────────────────
  flipped: boolean;
  coordinates: CoordinatesPosition;
  /** Name of a theme in `BOARD_THEMES`, or an explicit theme object. */
  boardStyle: string | BoardTheme;
  /** CSS `background-image` for the board; overrides the generated checkerboard. */
  boardImage?: string;
  /**
   * Piece artwork. Either a URL template containing `{piece}` (`wk`, `bp`, …)
   * — e.g. `/pieces/staunty/{piece}.svg` — or a function.
   * When omitted the board falls back to Unicode glyphs.
   */
  pieces?: PieceSource;
  animationType: AnimationType;
  /**
   * Pick-up "pop" and tilt while dragging. Defaults to on for the `dynamic`
   * animation type and off otherwise; set it explicitly to use it with any type.
   */
  pieceSway?: boolean;
  /**
   * Visual effects around moves (captured-piece ghost, trails, growing circle,
   * king-in-check pulse, promotion pop, illegal-move tap). Defaults to on for
   * the `dynamic` animation type and off otherwise.
   */
  vfx?: boolean;
  /** Opt-in easter eggs: fidgets, piece throw (`t`), boxing glove (`b`). See `src/vfx/extras.ts`. */
  extras?: ExtrasOptions;
  /** Overlay an invisible, labelled square grid and announce moves for screen readers. */
  accessibility?: boolean;
  /** Behaviour of right-click arrows: grow-in/breathing, pointer-finger, and whether they survive left-clicks. */
  userMarkings?: { animated?: boolean; pointerFinger?: boolean; persistent?: boolean };
  /** Veil the board with a translucent white layer (used while an analysis is shown). */
  analysisOverlay: boolean;
  /** Fade the empty board into the position over this many ms after `load()` (0 = off). */
  fadeSetup: number;
  /** Fade static effect badges in when they are added. */
  fadeInEffects: boolean;
  /** Text of the animated badge pills per effect type (localisation). */
  effectLabels?: Partial<Record<EffectType, string>>;
  /** Highlight the last move and the selected piece. */
  highlightMoves: boolean;
  /** Show hint dots on legal destination squares. */
  highlightLegalMoves: boolean;
  highlightOpacity: number;
  /** Overrides the theme's highlight colour. */
  highlightColor?: string;
  /** Outline the square under a dragged piece. */
  hoverSquareOutline: boolean;
  premoveHighlightColor: string;
  premoveHighlightOpacity: number;
  analysisHighlightColors: ModifierColors;
  analysisHighlightOpacity: number;
  arrowColors: ModifierColors;
  /** Colour of the king-square blink after an illegal move while in check. */
  checkBlinkingSquareColor: string;
  rounded: boolean;

  // ── sound ───────────────────────────────────────────────────────────────
  playSounds: boolean;
  /** `'synth'` (built-in beeps), a name→URL map, a player object, or `false`. */
  sounds: SoundSource;
}

let counter = 0;
const nextId = (): string => `board-${Date.now().toString(36)}${(counter++).toString(36)}`;

export function defaultOptions(): BoardOptions {
  return {
    id: nextId(),
    enabled: true,
    mode: 'play',
    playingAs: 'w',
    moveMethod: 'drag',
    autoPromote: false,
    premoves: true,
    disableRookCastling: false,
    autoClaimDraw: true,
    captureKeyStrokes: true,
    disableUserNavigation: false,
    allowMarkings: true,
    disableUserMarkings: false,
    analysisOverlay: false,
    fadeSetup: 0,
    fadeInEffects: false,
    flipped: false,
    coordinates: 'inside',
    boardStyle: 'green',
    animationType: 'default',
    highlightMoves: true,
    highlightLegalMoves: true,
    highlightOpacity: 0.5,
    hoverSquareOutline: true,
    premoveHighlightColor: '#f42a32',
    premoveHighlightOpacity: 0.5,
    analysisHighlightColors: {
      none: '#eb6150',
      shift: '#acce59',
      ctrl: '#ffaa00',
      alt: '#52b0dc',
    },
    analysisHighlightOpacity: 0.8,
    arrowColors: {
      none: 'rgba(255, 170, 0, 0.8)',
      shift: 'rgba(159, 207, 63, 0.8)',
      ctrl: 'rgba(248, 85, 63, 0.8)',
      alt: 'rgba(72, 193, 249, 0.8)',
    },
    checkBlinkingSquareColor: '#ff0000',
    rounded: true,
    playSounds: true,
    sounds: 'synth',
  };
}
