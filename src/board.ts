/**
 * ChessBoard – public component.
 *
 * Wires together the rules engine, the premove queue, the interaction state
 * machine and the DOM renderer. The interaction model is a port of the
 * behaviour observed in the original board (see docs/FINDINGS.md):
 *
 *   idle ──pointerdown(piece)──▶ dragging ──pointerup(same square)──▶ selected
 *     ▲                             │ pointerup(other square)
 *     │                             ├── legal ──▶ move / premove ──▶ idle
 *     │                             ├── promotion ──▶ promotion ──pick──▶ idle
 *     │                             └── illegal ──▶ selected (or idle when drag-only)
 *     └── right-button ──▶ markings ──pointerup──▶ toggle highlight / arrow ──▶ idle
 */
import type {
  BoardMove,
  Color,
  GameResult,
  KeyModifier,
  MoveInput,
  MoveRejectedReason,
  Piece,
  PiecesMap,
  PromotionType,
  SoundName,
  Square,
} from './types';
import { defaultOptions, type BoardOptions } from './options';
import { Emitter } from './events';
import { Chess, START_FEN, type GameOverReason, type RawMove } from './rules/chess';
import { PremoveQueue, type PremoveMove } from './rules/premove';
import { Markings, type Marking } from './markings';
import { createSoundPlayer, soundForMove, type SoundPlayer } from './sounds';
import { BoardRenderer } from './view/renderer';
import type { HighlightSpec } from './view/overlays';
import type { ArrowSpec } from './view/arrows';
import { resolveTheme } from './themes';
import { squareOffset } from './squares';
import { VfxManager } from './vfx/vfx';
import { DynamicVfx } from './vfx/dynamic';
import { durationFor } from './animation';
import { KeyboardController } from './keyboard';
import { Extras } from './vfx/extras';
import { A11yOverlay } from './a11y';
import { Effects, type EffectEvents } from './view/effects';
import { CustomItems } from './view/custom-items';
import { SetupSession, type SetupProblem } from './setup';
import type { MoveDetails } from './types';
import type { PointerPosition } from './squares';

export interface BoardEvents extends EffectEvents, Record<string, unknown> {
  /** Every move applied to the board: API moves, user moves and executed premoves. */
  move: BoardMove;
  /** A premove was queued. */
  premove: { move: PremoveMove; queue: readonly PremoveMove[] };
  'premove-cancel': { reason: 'user' | 'illegal' | 'game-over' | 'api' };
  'move-rejected': { from: Square; to: Square | null; reason: MoveRejectedReason };
  'piece-select': { square: Square; piece: Piece };
  'piece-click': { square: Square; piece: Piece };
  'promotion-start': { from: Square; to: Square; color: Color };
  'promotion-cancel': Record<string, never>;
  'game-over': { result: GameResult | null; reason: BoardGameOverReason };
  /** The displayed position changed because the user (or code) stepped through the history. */
  navigate: { ply: number; atEnd: boolean; move: BoardMove | null };
  /** Raw keyboard events (key names like `x`, `arrowleft`, `b`). */
  keydown: { key: string; event: KeyboardEvent };
  keyup: { key: string; event: KeyboardEvent };
  sound: SoundName;
  load: { fen: string };
  /** The position being edited in setup mode changed. */
  'setup-change': { fen: string; problems: SetupProblem[] };
  /** Setup mode was left; `committed` tells whether the edited position became the game. */
  'setup-end': { committed: boolean; fen: string | null; problems: SetupProblem[] };
}

/** Why a game ended: the rules (`checkmate`, a draw rule) or an outside decision. */
export type BoardGameOverReason = GameOverReason | 'resignation' | 'timeout' | 'agreement' | 'abandon';

export type BoardInit = Partial<BoardOptions> & { fen?: string };

type MachineState = 'idle' | 'selected' | 'dragging' | 'promotion' | 'markings';

interface Machine {
  state: MachineState;
  dragging?: Square;
  selected?: Square;
  promo?: { from: Square; to: Square; color: Color; premove: boolean };
  markStart?: Square;
  hideHover: boolean;
}

interface Resolved {
  premove: boolean;
  from: Square;
  to: Square;
  /** Destination needs a promotion piece. */
  needsPromotion: boolean;
}

const modifierOf = (e: { altKey: boolean; ctrlKey: boolean; shiftKey: boolean }): KeyModifier =>
  e.altKey ? 'alt' : e.ctrlKey ? 'ctrl' : e.shiftKey ? 'shift' : 'none';

export class ChessBoard {
  readonly events = new Emitter<BoardEvents>();
  readonly markings: Markings;
  /** Effect manager: `board.vfx.add({ type: 'piece-jump', square: 'e4', data: { piece: 'wp' } })`, … */
  readonly vfx: VfxManager;
  /** Screen-reader grid and move announcements (`options.accessibility` attaches it). */
  readonly a11y: A11yOverlay;
  /** Classification badges on squares (Brilliant, Blunder, Checkmate …): `board.effects.add({ square: 'e4', type: 'Brilliant', animated: true })`. */
  readonly effects: Effects;
  /** Stars, images, text boxes and sprite frames pinned to squares: `board.customItems.add({ square: 'e4', type: 'Star' })`. */
  readonly customItems: CustomItems;
  private dynamicVfx: DynamicVfx;
  private extras: Extras;

  private opts: BoardOptions;
  private game: Chess;
  private queue = new PremoveQueue();
  private renderer: BoardRenderer;
  private sound: SoundPlayer | null;
  private doc: Document;
  private lastMove: BoardMove | null = null;
  /** Ply being shown while looking at an earlier position; `null` = the live end of the game. */
  private viewPly: number | null = null;
  private keyboard: KeyboardController | null = null;
  private m: Machine = { state: 'idle', hideHover: false };
  private destroyed = false;
  private setupSession: SetupSession | null = null;
  private setupReturnMode: 'play' | 'analysis' | 'view' = 'play';
  private setupLeave: 'commit' | 'cancel' = 'commit';
  /** The game was ended from outside (resignation, flag fall, agreed draw …). */
  private ended: { result: GameResult | null; reason: BoardGameOverReason } | null = null;

  /**
   * Position editor (`mode: 'setup'`). Enter it with `setOptions({ mode: 'setup' })`; `commit()` loads the
   * edited position when it is legal, `cancel()` restores the game. Leaving the mode with `setOptions`
   * commits a legal position and discards an illegal one.
   */
  readonly setup = {
    isActive: (): boolean => !!this.setupSession,
    getPieces: (): PiecesMap => new Map([...this.session().pieces].map(([sq, p]) => [sq, { ...p }])),
    getFen: (): string => this.session().fen(),
    validate: (): SetupProblem[] => this.session().problems(),
    /** Put a piece on a square (replacing whatever is there). */
    dropPiece: (square: Square, piece: Piece): void => {
      this.session().drop(square, piece);
      this.setupRefresh();
    },
    removePiece: (square: Square): boolean => {
      const had = !!this.session().remove(square);
      if (had) this.setupRefresh();
      return had;
    },
    movePiece: (from: Square, to: Square): boolean => {
      const r = this.session().move(from, to);
      if (!r) return false;
      this.setupRefresh();
      return true;
    },
    /** Empty board. */
    clear: (): void => {
      this.session().clear();
      this.setupRefresh();
    },
    /** Standard starting position. */
    reset: (): void => {
      this.session().reset();
      this.setupRefresh();
    },
    setTurn: (color: Color): void => {
      this.session().turn = color;
      this.setupChanged();
    },
    /** FEN castling field (`KQkq`, `-`) or `null` to infer the rights from the pieces. Impossible rights are dropped. */
    setCastling: (rights: string | null): void => {
      this.session().castling = rights;
      this.setupChanged();
    },
    /** Leave setup mode with the edited position. Returns the problems (and stays in setup mode) when it is illegal. */
    commit: (mode?: 'play' | 'analysis' | 'view'): SetupProblem[] => {
      const problems = this.session().problems();
      if (problems.length) return problems;
      this.setupLeave = 'commit';
      this.setOptions({ mode: mode ?? this.setupReturnMode });
      return [];
    },
    /** Leave setup mode and restore the game position. */
    cancel: (mode?: 'play' | 'analysis' | 'view'): void => {
      this.session();
      this.setupLeave = 'cancel';
      this.setOptions({ mode: mode ?? this.setupReturnMode });
    },
  };

  constructor(container: HTMLElement, init: BoardInit = {}) {
    const { fen, ...rest } = init;
    const base = defaultOptions();
    this.opts = {
      ...base,
      ...rest,
      analysisHighlightColors: { ...base.analysisHighlightColors, ...rest.analysisHighlightColors },
      arrowColors: { ...base.arrowColors, ...rest.arrowColors },
    };
    this.doc = container.ownerDocument;
    this.game = new Chess(fen ?? START_FEN);
    this.sound = createSoundPlayer(this.opts.sounds);
    this.renderer = new BoardRenderer(container, () => this.opts);
    this.markings = new Markings(() => this.refreshOverlays());
    this.a11y = new A11yOverlay(this.renderer.el, () => this.opts.flipped);
    if (this.opts.accessibility) this.a11y.attach(this.game.pieces());
    this.vfx = new VfxManager(this.renderer.vfxHost());
    this.customItems = new CustomItems(this.renderer.customItemsHost((name) => this.playSound(name)));
    this.effects = new Effects(this.renderer.effectsHost((type, payload) => this.events.emit(type, payload as never)));
    this.extras = new Extras({
      el: this.renderer.el,
      vfx: this.vfx,
      options: () => this.opts.extras,
      playingAs: () => this.opts.playingAs,
      turn: () => this.game.turn(),
      isPlayMode: () => this.opts.mode === 'play',
      getPiece: (sq) => this.pieceAt(sq),
      pointer: (x, y) => this.renderer.pointer(x, y),
      squareSizePx: () => this.renderer.el.getBoundingClientRect().width / 8,
      flipped: () => this.opts.flipped,
    });
    this.dynamicVfx = new DynamicVfx(this.vfx, {
      enabled: () => this.opts.vfx ?? this.opts.animationType === 'dynamic',
      checkedKing: () => this.game.checkedKing(),
      turn: () => this.game.turn(),
      isGameOver: () => this.gameOver() !== null,
      isDragging: (sq) => this.m.dragging === sq,
      moveDuration: () => durationFor(this.opts.animationType),
      autoPromote: () => this.opts.autoPromote,
      revealPieces: () => this.renderer.revealPieces(),
    });

    this.syncPremoveBase();
    this.renderer.loadPieces(this.game.pieces());
    this.renderer.setAnalysisOverlay(this.opts.analysisOverlay);
    this.renderer.fadeSetup(this.opts.fadeSetup);
    this.renderer.el.classList.toggle('disabled', !this.opts.enabled);
    this.renderer.el.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.el.addEventListener('contextmenu', this.onContextMenu);
    this.doc.addEventListener('pointerdown', this.onDocumentPointerDown);
    this.keyboard = new KeyboardController(this.doc, {
      onKeydown: (key, e) => this.onKey('down', key, e),
      onKeyup: (key, e) => this.onKey('up', key, e),
    });
    this.syncKeyboard();
    if (this.opts.mode === 'setup') this.enterSetup('play');
    this.refreshOverlays();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════

  /** The board's root element. */
  get el(): HTMLElement {
    return this.renderer.el;
  }

  getOptions(): Readonly<BoardOptions> {
    return this.opts;
  }

  setOptions(patch: Partial<BoardOptions>): void {
    const prev = this.opts;
    this.opts = {
      ...prev,
      ...patch,
      analysisHighlightColors: { ...prev.analysisHighlightColors, ...patch.analysisHighlightColors },
      arrowColors: { ...prev.arrowColors, ...patch.arrowColors },
    };
    if ('sounds' in patch && patch.sounds !== prev.sounds) {
      this.sound?.destroy?.();
      this.sound = createSoundPlayer(this.opts.sounds);
    }
    const gameplayChanged =
      patch.mode !== undefined && patch.mode !== prev.mode ||
      patch.playingAs !== undefined && patch.playingAs !== prev.playingAs ||
      patch.premoves === false && prev.premoves ||
      patch.enabled === false && prev.enabled;
    if (gameplayChanged) {
      this.cancelPremoves('api');
      this.resetMachine();
    }
    this.renderer.el.classList.toggle('disabled', !this.opts.enabled);
    this.renderer.optionsChanged(prev);
    if (patch.mode !== undefined && patch.mode !== prev.mode) {
      if (patch.mode === 'setup') this.enterSetup(prev.mode === 'setup' ? 'play' : prev.mode);
      else if (prev.mode === 'setup') this.leaveSetup();
    }
    if (patch.animationType !== undefined || patch.vfx !== undefined) this.dynamicVfx.positionChanged();
    this.syncKeyboard();
    if (patch.analysisOverlay !== undefined) this.renderer.setAnalysisOverlay(this.opts.analysisOverlay);
    if (patch.accessibility !== undefined) {
      if (patch.accessibility) this.a11y.attach(this.displayPieces());
      else this.a11y.detach();
    } else if (patch.flipped !== undefined && patch.flipped !== prev.flipped) this.a11y.reattach(this.displayPieces());
    if (patch.flipped !== undefined && patch.flipped !== prev.flipped) this.effects.flipChanged();
    this.refreshOverlays();
  }

  getFen(): string {
    return this.game.fen();
  }

  getTurn(): Color {
    return this.game.turn();
  }

  /** Pieces currently *on the board* (ignoring queued premoves). */
  getPieces(): PiecesMap {
    return this.game.pieces();
  }

  getHistory(): BoardMove[] {
    return this.game.history().map((d) => ({ ...d, userGenerated: false, isPremove: false, animate: false }));
  }

  isGameOver(): boolean {
    return this.gameOver() !== null;
  }

  getResult(): GameResult | null {
    return this.gameOver()?.result ?? null;
  }

  /** Why the game is over, or `null` while it is going on. */
  getGameOverReason(): BoardGameOverReason | null {
    return this.gameOver()?.reason ?? null;
  }

  private gameOver(): { result: GameResult | null; reason: BoardGameOverReason } | null {
    if (this.ended) return this.ended;
    const reason = this.game.gameOverReason(this.opts.autoClaimDraw);
    return reason ? { result: this.game.result(this.opts.autoClaimDraw), reason } : null;
  }

  /** End the game from outside. Returns false when it is already over. */
  setResult(result: GameResult | null, reason: BoardGameOverReason = 'agreement'): boolean {
    if (this.gameOver() || this.setupSession) return false;
    this.ended = { result, reason };
    this.announceGameOver();
    return true;
  }

  /** `color` resigns: the other side wins. */
  resign(color: Color = this.opts.playingAs ?? this.game.turn()): boolean {
    return this.setResult(color === 'w' ? '0-1' : '1-0', 'resignation');
  }

  /** `color` ran out of time: the other side wins unless it has no way to mate, then the game is drawn. */
  outOfTime(color: Color): boolean {
    const winner: Color = color === 'w' ? 'b' : 'w';
    if (!this.game.hasMatingMaterial(winner)) return this.setResult('1/2-1/2', 'timeout');
    return this.setResult(winner === 'w' ? '1-0' : '0-1', 'timeout');
  }

  agreeDraw(): boolean {
    return this.setResult('1/2-1/2', 'agreement');
  }

  /** Claim a draw by threefold repetition or the fifty-move rule (only needed when `autoClaimDraw` is off). */
  claimDraw(): boolean {
    if (this.gameOver() || this.setupSession) return false;
    const reason = this.game.isThreefoldRepetition() ? 'threefold' : this.game.isFiftyMoveRule() ? 'fifty' : null;
    return reason ? this.setResult('1/2-1/2', reason) : false;
  }

  /** Legal moves of the position on the board, optionally only those of the piece on `from`. */
  getLegalMoves(from?: Square): RawMove[] {
    return this.gameOver() ? [] : this.game.legalMoves(from);
  }

  isLegalMove(input: MoveInput | string): boolean {
    return !this.gameOver() && this.game.resolve(input) !== null;
  }

  getPiece(square: Square): Piece | undefined {
    return this.game.get(square) ?? undefined;
  }

  getLastMove(): BoardMove | null {
    const h = this.game.history();
    return h.length ? { ...h[h.length - 1], userGenerated: false, isPremove: false, animate: false } : null;
  }

  isCheck(): boolean {
    return this.game.isCheck();
  }

  getHistorySANs(): string[] {
    return this.game.history().map((d) => d.san);
  }

  /** FENs after every move; index 0 is the start position. */
  getHistoryFENs(): string[] {
    return Array.from({ length: this.game.history().length + 1 }, (_, i) => this.game.fenAt(i));
  }

  /** Material on the board in pawn units (P 1, N/B 3, R 5, Q 9) and the balance from White's point of view. */
  getMaterial(): { white: number; black: number; diff: number } {
    const value: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let white = 0;
    let black = 0;
    for (const p of this.game.pieces().values()) {
      if (p.color === 'w') white += value[p.type];
      else black += value[p.type];
    }
    return { white, black, diff: white - black };
  }

  /** Movetext with optional headers; a non-standard start position adds the `SetUp` / `FEN` tags. */
  getPGN(headers: Record<string, string> = {}): string {
    const tags: Record<string, string> = { ...headers };
    const result = this.getResult() ?? '*';
    tags.Result ??= result;
    const start = this.game.startFen();
    if (start.split(' ').slice(0, 4).join(' ') !== START_FEN.split(' ').slice(0, 4).join(' ')) {
      tags.SetUp = '1';
      tags.FEN = start;
    }
    const head = Object.entries(tags)
      .map(([k, v]) => `[${k} "${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)
      .join('\n');
    const startParts = start.split(' ');
    let move = Number(startParts[5] ?? 1) || 1;
    let blackToMove = startParts[1] === 'b';
    const out: string[] = [];
    for (const san of this.getHistorySANs()) {
      if (!blackToMove) out.push(`${move}.`);
      else if (!out.length) out.push(`${move}...`);
      out.push(san);
      if (blackToMove) move++;
      blackToMove = !blackToMove;
    }
    out.push(result);
    return `${head ? head + '\n\n' : ''}${out.join(' ')}`;
  }

  /** Blink a square (the signal for "you are in check" after an illegal move). */
  blinkSquare(square: Square, color: string = this.opts.checkBlinkingSquareColor): void {
    this.renderer.blink(square, color);
  }

  /** The queued premoves (oldest first). */
  getPremoves(): readonly PremoveMove[] {
    return this.queue.list();
  }

  cancelPremoves(reason: 'user' | 'illegal' | 'game-over' | 'api' = 'api'): void {
    if (this.queue.length === 0) return;
    this.queue.clear();
    this.renderer.loadPieces(this.game.pieces());
    this.refreshOverlays();
    this.events.emit('premove-cancel', { reason });
  }

  /** Replace the position. Clears history, premoves and markings that are not persistent. */
  load(fen: string = START_FEN): void {
    if (this.setupSession) {
      const next = SetupSession.fromFen(fen);
      if (next) {
        this.setupSession = next;
        this.setupRefresh(true);
      }
      return;
    }
    this.game.load(fen);
    this.ended = null;
    this.viewPly = null;
    this.lastMove = null;
    this.queue.clear();
    this.resetMachine();
    this.syncPremoveBase();
    this.renderer.flushAnimations();
    this.renderer.loadPieces(this.game.pieces(), true);
    this.renderer.fadeSetup(this.opts.fadeSetup);
    this.dynamicVfx.positionChanged();
    this.refreshOverlays();
    this.events.emit('load', { fen: this.game.fen() });
  }

  /**
   * Make a move from code – e.g. the opponent's move arriving from the server.
   * Pass `userGenerated: true` for moves that should count as the local user's.
   * If premoves are queued, the first one is played immediately afterwards.
   */
  move(input: MoveInput | string, opts: { animate?: boolean; userGenerated?: boolean } = {}): BoardMove | null {
    if (this.setupSession || this.ended) return null; // the position is being edited / the game was ended from outside
    const hadQueue = this.queue.length > 0;
    if (hadQueue) this.renderer.loadPieces(this.game.pieces()); // drop the premoved look
    const bm = this.applyMove(input, {
      userGenerated: opts.userGenerated ?? false,
      animate: opts.animate ?? true,
      isPremove: false,
    });
    if (!bm) {
      if (hadQueue) this.renderer.loadPieces(this.displayPieces());
      return null;
    }
    if (hadQueue) this.consumePremove();
    return bm;
  }

  /** Take back the last move. Queued premoves are discarded. */
  undo(): BoardMove | null {
    if (this.setupSession) return null;
    const was = this.viewPly;
    this.viewPly = null;
    if (was !== null) this.renderer.loadPieces(this.game.pieces());
    const had = this.queue.length > 0;
    if (had) this.queue.clear();
    const d = this.game.undo();
    if (d) this.ended = null;
    if (!d) {
      if (had) this.renderer.loadPieces(this.game.pieces());
      return null;
    }
    this.resetMachine();
    const bm: BoardMove = { ...d, userGenerated: false, isPremove: false, animate: true };
    const history = this.game.history();
    this.lastMove = history.length ? { ...history[history.length - 1], userGenerated: false, isPremove: false, animate: false } : null;
    this.syncPremoveBase();
    if (had) this.renderer.loadPieces(this.game.pieces());
    this.renderer.pieces.undo({ ...d, animate: true });
    this.dynamicVfx.positionChanged();
    this.refreshOverlays();
    return bm;
  }

  flip(): void {
    this.setOptions({ flipped: !this.opts.flipped });
  }

  /** Board slam: every piece jumps. Any click (or `resetSlam()`) puts them back. */
  triggerSlam(): void {
    this.extras.triggerSlam(this.displayPieces());
  }

  resetSlam(): boolean {
    return this.extras.resetSlam();
  }

  /** A hand throws the piece on `square` away (needs `extras.handImageUrl`). */
  throwPiece(square: Square): void {
    this.extras.throwPiece(square);
  }

  playSound(name: SoundName): void {
    if (!this.opts.playSounds) return;
    this.sound?.play(name);
    this.events.emit('sound', name);
  }

  /** Resolves when running piece animations have finished. */
  animationComplete(): Promise<void> {
    return this.renderer.animationComplete();
  }

  on<K extends keyof BoardEvents>(type: K, handler: (payload: BoardEvents[K]) => void): () => void {
    return this.events.on(type, handler);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.detachPointerListeners();
    this.renderer.el.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.el.removeEventListener('contextmenu', this.onContextMenu);
    this.doc.removeEventListener('pointerdown', this.onDocumentPointerDown);
    this.doc.onselectstart = null;
    this.sound?.destroy?.();
    this.events.clear();
    this.keyboard?.destroy();
    this.extras.destroy();
    this.a11y.detach();
    this.effects.destroy();
    this.customItems.destroy();
    this.dynamicVfx.destroy();
    this.renderer.destroy();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // History navigation & keyboard
  // ═══════════════════════════════════════════════════════════════════════

  /** Ply currently shown: 0 = the start position, `getPlyCount()` = the live position. */
  getPly(): number {
    return this.viewPly ?? this.game.history().length;
  }

  getPlyCount(): number {
    return this.game.history().length;
  }

  /** Is the board showing the end of the game (where moves can be made)? */
  isAtEnd(): boolean {
    return this.viewPly === null;
  }

  /**
   * Show the position after `ply` half-moves. Stepping by one ply animates the
   * piece; larger jumps just redraw. Moves can only be made at the end of the game.
   */
  goTo(ply: number, opts: { animate?: boolean } = {}): boolean {
    if (this.setupSession) return false;
    const hist = this.game.history();
    const n = hist.length;
    const target = Math.max(0, Math.min(n, Math.round(ply)));
    const cur = this.viewPly ?? n;
    if (target === cur) return false;
    this.cancelPremoves('api');
    this.resetMachine();
    this.renderer.flushAnimations();
    const animate = opts.animate ?? true;
    const asBoardMove = (d: MoveDetails, anim: boolean): BoardMove => ({ ...d, userGenerated: false, isPremove: false, animate: anim });
    let sound: SoundName | null = null;
    if (Math.abs(target - cur) === 1 && animate) {
      if (target > cur) {
        const d = hist[target - 1];
        const bm = asBoardMove(d, true);
        this.renderer.makeMove({ ...d, animate: true });
        sound = soundForMove(bm, this.opts.playingAs);
        this.dynamicVfx.moved(bm);
      } else {
        const d = hist[cur - 1];
        this.renderer.pieces.undo({ ...d, animate: true });
        sound = soundForMove(asBoardMove(d, true), this.opts.playingAs);
        this.dynamicVfx.stepped(d, 'back', new Chess(this.game.fenAt(target)));
      }
    } else {
      this.renderer.loadPieces(new Chess(this.game.fenAt(target)).pieces());
      this.dynamicVfx.positionChanged();
    }
    this.viewPly = target === n ? null : target;
    this.lastMove = target > 0 ? asBoardMove(hist[target - 1], false) : null;
    if (sound && this.opts.playSounds) this.playSound(sound);
    this.syncPremoveBase();
    this.refreshOverlays();
    this.events.emit('navigate', { ply: target, atEnd: this.viewPly === null, move: this.lastMove });
    return true;
  }

  back(): boolean {
    return this.goTo(this.getPly() - 1);
  }

  forward(): boolean {
    return this.goTo(this.getPly() + 1);
  }

  toStart(): boolean {
    return this.goTo(0, { animate: false });
  }

  toEnd(): boolean {
    return this.goTo(this.getPlyCount(), { animate: false });
  }

  private syncKeyboard(): void {
    if (this.opts.captureKeyStrokes && this.opts.enabled) this.keyboard?.enable();
    else this.keyboard?.disable();
  }

  isKeyPressed(key: string): boolean {
    return this.keyboard?.isPressed(key) ?? false;
  }

  private onKey(kind: 'down' | 'up', key: string, e: KeyboardEvent): void {
    this.events.emit(kind === 'down' ? 'keydown' : 'keyup', { key, event: e });
    if (kind === 'down') this.extras.keyDown(key);
    else this.extras.keyUp(key);
    if (kind !== 'down' || e.ctrlKey || e.metaKey) return;
    const o = this.opts;
    if (key === 'x') {
      this.flip();
      return;
    }
    if (o.disableUserNavigation) return;
    let handled = true;
    switch (key) {
      case 'arrowleft':
      case 'numpad4':
        this.back();
        break;
      case 'arrowright':
      case 'numpad6':
        this.forward();
        break;
      case 'arrowup':
      case 'numpad8':
        this.toStart();
        break;
      case 'arrowdown':
      case 'numpad5':
        this.toEnd();
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Game state helpers
  // ═══════════════════════════════════════════════════════════════════════

  private syncPremoveBase(): void {
    this.queue.setBase({ pieces: this.game.pieces(), castling: this.game.castlingRights() });
  }

  /** What the board shows: the real position, or the premoved one when moves are queued. */
  private displayPieces(): PiecesMap {
    if (this.setupSession) return this.setupSession.pieces;
    if (this.viewPly !== null) return new Chess(this.game.fenAt(this.viewPly)).pieces();
    return this.queue.length ? this.queue.position()!.pieces : this.game.pieces();
  }

  private pieceAt(sq: Square | null): Piece | undefined {
    return sq ? this.displayPieces().get(sq) : undefined;
  }

  /** Is it the opponent's turn for the local player, so that a move would be a premove? */
  private isPremoveMode(): boolean {
    if (this.viewPly !== null) return false;
    const o = this.opts;
    return o.mode === 'play' && o.premoves && !!o.playingAs && !this.gameOver() && this.game.turn() !== o.playingAs;
  }

  /** May the user make (or premove) a move right now? */
  private canMoveNow(): boolean {
    if (this.setupSession) return this.opts.enabled; // setup: anything goes
    if (this.viewPly !== null) return false; // moves can only be made at the end of the line
    const o = this.opts;
    if (!o.enabled || o.mode === 'view' || this.gameOver()) return false;
    if (o.mode === 'analysis') return true;
    if (!o.playingAs) return true; // hot-seat
    return this.game.turn() === o.playingAs || this.isPremoveMode();
  }

  private interactive(): boolean {
    return this.opts.enabled && this.opts.mode !== 'view';
  }

  /** Resolve a user move attempt against the legal moves, or the premove model. */
  private resolveUserMove(from: Square, to: Square | null): Resolved | null {
    if (!to || !this.canMoveNow()) return null;
    if (this.setupSession) return from === to ? null : { premove: false, from, to, needsPromotion: false };
    // "rook castling": the king dropped on its own rook castles (the king's real destination is two files away)
    to = this.rookCastles(from).find((c) => c.rook === to)?.king ?? to;
    if (this.isPremoveMode()) {
      const color = this.opts.playingAs!;
      const cands = this.queue.movesFrom(from, color).filter((m) => m.to === to);
      if (!cands.length) return null;
      return { premove: true, from, to, needsPromotion: cands.some((m) => m.promotion) };
    }
    const raw = this.game.resolve({ from, to });
    if (!raw) return null;
    return { premove: false, from, to, needsPromotion: !!raw.flags.promotion };
  }

  /**
   * Castling moves of the king on `from` that can also be made by moving the king onto its own rook
   * (the original's default; `disableRookCastling` turns it off). `king` is where the king really lands.
   */
  private rookCastles(from: Square): Array<{ rook: Square; king: Square }> {
    if (this.opts.disableRookCastling) return [];
    const piece = this.pieceAt(from);
    if (!piece || piece.type !== 'k') return [];
    const rank = piece.color === 'w' ? '1' : '8';
    if (from !== `e${rank}`) return [];
    const premove = this.isPremoveMode();
    const out: Array<{ rook: Square; king: Square }> = [];
    for (const [rook, king, kind] of [
      [`h${rank}`, `g${rank}`, 'kingsideCastle'],
      [`a${rank}`, `c${rank}`, 'queensideCastle'],
    ] as const) {
      const r = this.pieceAt(rook);
      if (!r || r.type !== 'r' || r.color !== piece.color) continue;
      const ok = premove
        ? this.queue.movesFrom(from, piece.color).some((m) => m.to === king && !!m.castle)
        : !!this.game.resolve({ from, to: king })?.flags[kind];
      if (ok) out.push({ rook, king });
    }
    return out;
  }

  /** Destination squares for the hint dots of the piece on `from`. */
  private hintTargets(from: Square): Square[] {
    if (!this.canMoveNow() || this.setupSession) return [];
    const rooks = this.rookCastles(from).map((c) => c.rook);
    if (this.isPremoveMode()) return [...new Set([...this.queue.movesFrom(from, this.opts.playingAs!).map((m) => m.to), ...rooks])];
    const moves: RawMove[] = this.game.legalMoves(from);
    return [...new Set([...moves.map((m) => m.to), ...rooks])];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Applying moves
  // ═══════════════════════════════════════════════════════════════════════

  private applyMove(
    input: MoveInput | string,
    flags: { userGenerated: boolean; animate: boolean; isPremove: boolean; hold?: boolean; fromDrop?: boolean },
  ): BoardMove | null {
    const d = this.game.move(input);
    if (!d) return null;
    const bm: BoardMove = { ...d, userGenerated: flags.userGenerated, isPremove: flags.isPremove, animate: flags.animate };
    if (this.viewPly !== null) {
      // the user is looking at an earlier position: the game moves on, the board stays where it is
      this.events.emit('move', bm);
      this.checkGameOver();
      return bm;
    }
    this.lastMove = bm;
    this.syncPremoveBase();
    this.renderer.makeMove({
      from: d.from,
      to: d.to,
      color: d.color,
      piece: d.piece,
      promotion: d.promotion,
      capturedSquare: d.capturedSquare,
      flags: d.flags,
      rookMove: d.rookMove,
      animate: flags.animate,
      fromDrop: flags.fromDrop,
      check: d.check,
      checkmate: d.checkmate,
    });
    if (this.opts.playSounds) this.playSound(soundForMove(bm, this.opts.playingAs));
    this.dynamicVfx.moved(bm);
    if (this.a11y.isAttached()) this.a11y.announce(bm);
    this.afterChange({ move: bm, plyDiff: 1, hold: flags.hold });
    this.events.emit('move', bm);
    this.checkGameOver();
    return bm;
  }

  private checkGameOver(): void {
    if (this.gameOver()) this.announceGameOver();
  }

  private announceGameOver(): void {
    const over = this.gameOver();
    if (!over) return;
    this.cancelPremoves('game-over');
    this.resetMachine();
    if (this.opts.playSounds) this.playSound('game-end');
    this.events.emit('game-over', over);
    this.refreshOverlays();
  }

  private queuePremove(from: Square, to: Square, promotion?: PromotionType): void {
    const color = this.opts.playingAs!;
    const pm = this.queue.tryAdd({ from, to, promotion }, color);
    if (!pm) {
      this.refreshOverlays();
      return;
    }
    this.renderer.loadPieces(this.displayPieces());
    this.playSound('premove');
    this.refreshOverlays();
    this.events.emit('premove', { move: pm, queue: this.queue.list() });
  }

  /** Called after the opponent moved: try the oldest queued premove on the real board. */
  private consumePremove(): void {
    if (this.gameOver()) {
      this.cancelPremoves('game-over');
      return;
    }
    const pm = this.queue.shift();
    if (!pm) return;
    const legal = this.game.resolve({ from: pm.from, to: pm.to, promotion: pm.promotion });
    if (!legal) {
      // the premove is not legal in the real position: drop the whole queue
      this.queue.clear();
      this.renderer.loadPieces(this.game.pieces());
      this.refreshOverlays();
      this.events.emit('premove-cancel', { reason: 'illegal' });
      return;
    }
    this.applyMove({ from: pm.from, to: pm.to, promotion: pm.promotion }, { userGenerated: true, animate: false, isPremove: true, hold: true });
    if (this.queue.length && !this.gameOver()) {
      this.renderer.loadPieces(this.displayPieces());
      this.refreshOverlays();
    }
  }

  /** The original's "any API event" transition: decide whether a pending selection/drag survives a change. */
  private afterChange(change: { move?: BoardMove; plyDiff: number; hold?: boolean }): void {
    this.extras.resetSlam();
    this.extras.interrupted();
    const { state, dragging, selected } = this.m;
    if (state === 'selected' || state === 'dragging') {
      const sq = state === 'dragging' ? dragging : selected;
      if (!change.hold && this.shouldRelease(sq, change)) {
        if (state === 'dragging') this.renderer.dropPiece();
        this.m.dragging = undefined;
        this.m.selected = undefined;
        this.setState('idle');
      }
    } else if (state === 'promotion') {
      if (!change.move) this.cancelPromotion();
    } else if (state === 'markings') {
      this.m.markStart = undefined;
      this.setState('idle');
    }
    this.refreshOverlays();
  }

  private shouldRelease(sq: Square | undefined, change: { move?: BoardMove; plyDiff: number }): boolean {
    const color = sq ? this.displayPieces().get(sq)?.color : undefined;
    const mv = change.move;
    return (
      !mv ||
      change.plyDiff !== 1 ||
      !color ||
      (color === mv.color && !mv.userGenerated) ||
      mv.from === sq ||
      mv.to === sq
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Pointer input
  // ═══════════════════════════════════════════════════════════════════════

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  private pressed = false;

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 2) return;
    e.stopPropagation();
    this.extras.resetSlam();
    if (e.button === 2) this.extras.interrupted();
    if (!this.pressed) {
      this.pressed = true;
      // keep receiving pointer events if the pointer leaves the window mid-drag
      try {
        if (typeof e.pointerId === 'number') this.renderer.el.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      this.doc.addEventListener('pointermove', this.onPointerMove);
      this.doc.addEventListener('pointermove', this.onPointerTrack);
      this.doc.addEventListener('pointerup', this.onPointerUp);
      this.doc.addEventListener('pointercancel', this.onPointerCancel);
      // a right-button press while a drag is in progress cancels the drag
      window.setTimeout(() => this.doc.addEventListener('pointerdown', this.onSecondaryDown, { once: true, capture: true }), 0);
    }
    const pos = this.renderer.pointer(e.clientX, e.clientY);
    this.beforeState(e.button === 2 ? 'right' : 'left', () => {
      if (e.button === 2) this.handleDownRight(pos);
      else this.handleDownLeft(pos, modifierOf(e));
    });
  };

  /** Pointer pressed anywhere outside the board. */
  private onDocumentPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 2) return;
    this.extras.resetSlam();
    this.extras.interrupted();
    const outside: PointerPosition = { coords: { x: 0, y: 0 }, coordsInsideBoard: { x: 0, y: 0 }, square: null, squareInsideBoard: 'a1' };
    this.beforeState(e.button === 2 ? 'right' : 'left', () => {
      if (e.button === 2) this.handleDownRight(outside);
      else this.handleDownLeft(outside, modifierOf(e));
    });
  };

  private onSecondaryDown = (e: PointerEvent): void => {
    if (e.button !== 2 || this.m.state !== 'dragging') return;
    this.cancelDrag();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.m.state !== 'dragging' || !this.m.dragging) return;
    // Browsers do not send a pointerdown for a second button pressed during a drag; they report it as a
    // pointermove whose `buttons` gained the right button.
    if (e.buttons & 2) {
      this.cancelDrag();
      return;
    }
    const pos = this.renderer.pointer(e.clientX, e.clientY);
    this.renderer.dragPiece(this.m.dragging, pos.coordsInsideBoard);
    this.updateHover(pos);
  };

  private onPointerTrack = (e: PointerEvent): void => {
    const pos = this.renderer.pointer(e.clientX, e.clientY);
    this.extras.pointerMoved(pos.square ?? pos.squareInsideBoard);
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.detachPointerListeners();
    this.extras.pointerReleased();
    const pos = this.renderer.pointer(e.clientX, e.clientY);
    this.handleUp(pos, modifierOf(e));
  };

  private onPointerCancel = (): void => {
    this.detachPointerListeners();
    if (this.m.state === 'dragging') this.cancelDrag();
  };

  private detachPointerListeners(): void {
    this.pressed = false;
    this.doc.removeEventListener('pointermove', this.onPointerMove);
    this.doc.removeEventListener('pointermove', this.onPointerTrack);
    this.doc.removeEventListener('pointerup', this.onPointerUp);
    this.doc.removeEventListener('pointercancel', this.onPointerCancel);
    this.doc.removeEventListener('pointerdown', this.onSecondaryDown, { capture: true });
  }

  /** Right-click first cancels queued premoves (and is swallowed). */
  private beforeState(button: 'left' | 'right', run: () => void): void {
    if (button === 'right' && this.queue.length > 0) {
      this.cancelDragIfAny();
      this.cancelPremoves('user');
      return;
    }
    run();
  }

  private cancelDragIfAny(): void {
    if (this.m.state === 'dragging') this.cancelDrag();
  }

  private cancelDrag(): void {
    this.renderer.dropPiece();
    this.m.dragging = undefined;
    this.m.selected = undefined;
    this.setState('idle');
    this.refreshOverlays();
  }

  // ── state transitions ───────────────────────────────────────────────────

  private setState(next: MachineState): void {
    const prev = this.m.state;
    this.m.state = next;
    if (next === 'dragging' && prev !== 'dragging') this.doc.onselectstart = () => false;
    else if (prev === 'dragging' && next !== 'dragging') this.doc.onselectstart = null;
  }

  private resetMachine(): void {
    if (this.m.state === 'dragging' || this.m.state === 'promotion') this.renderer.dropPiece();
    if (this.m.state === 'promotion') this.renderer.closePromotionWindow();
    this.m = { state: 'idle', hideHover: false };
    this.doc.onselectstart = null;
    this.renderer.hideHoverSquare();
    this.refreshOverlays();
  }

  /** Where a piece sits on screen when "held" by a click rather than a drag. */
  private coordsOfSquare(sq: Square): { x: number; y: number } {
    return squareOffset(sq, this.opts.flipped);
  }

  private startDrag(sq: Square, pos: PointerPosition): void {
    const byClick = this.opts.moveMethod === 'click';
    const coords = byClick ? this.coordsOfSquare(sq) : pos.coords;
    this.m.dragging = sq;
    this.m.hideHover = byClick;
    this.renderer.dragPiece(sq, coords);
    this.setState('dragging');
    this.updateHover(pos);
  }

  private updateHover(pos: PointerPosition): void {
    const o = this.opts;
    if (this.m.state === 'dragging' && o.hoverSquareOutline && o.highlightMoves && !this.m.hideHover) {
      this.renderer.showHoverSquare(pos.square ?? pos.squareInsideBoard, this.m.dragging ? this.pieceAt(this.m.dragging)?.color : undefined);
    } else {
      this.renderer.hideHoverSquare();
    }
  }

  private emitPieceClick(sq: Square | null): void {
    const piece = this.pieceAt(sq);
    if (sq && piece) {
      this.events.emit('piece-click', { square: sq, piece });
      this.extras.pieceClicked(sq, piece);
    }
  }

  private rejectMove(from: Square, to: Square | null): MoveRejectedReason {
    let reason: MoveRejectedReason;
    const piece = this.pieceAt(from);
    if (!to) reason = 'off-board';
    else if (!this.canMoveNow()) reason = piece && piece.color === this.game.turn() ? 'not-allowed' : 'not-player-turn';
    else if (piece && piece.color !== (this.isPremoveMode() ? this.opts.playingAs : this.game.turn())) reason = 'not-player-turn';
    else if (this.pieceAt(to)?.color === piece?.color) reason = 'own-piece';
    else reason = 'illegal-move';
    this.events.emit('move-rejected', { from, to, reason });
    this.dynamicVfx.rejected(to);
    return reason;
  }

  // ── pointer down ────────────────────────────────────────────────────────

  private handleDownLeft(pos: PointerPosition, key: KeyModifier): void {
    const sq = pos.square;
    switch (this.m.state) {
      case 'idle': {
        this.emitPieceClick(sq);
        if (sq && !this.opts.disableUserMarkings) this.markings.clear();
        if (!this.interactive() || !sq || !this.pieceAt(sq)) return;
        this.events.emit('piece-select', { square: sq, piece: this.pieceAt(sq)! });
        this.renderer.pieceSelected(sq);
        this.startDrag(sq, pos);
        break;
      }
      case 'selected': {
        this.emitPieceClick(sq);
        const sel = this.m.selected;
        if (!sel) return;
        if (sq === sel) {
          // pressing the selected piece again starts a drag (or a click-hold)
          this.startDrag(sel, pos);
          break;
        }
        const res = sq ? this.resolveUserMove(sel, sq) : null;
        if (!res) {
          this.m.selected = undefined;
          if (!sq || !this.pieceAt(sq)) {
            this.rejectMove(sel, sq);
            this.setState('idle');
            break;
          }
          this.events.emit('piece-select', { square: sq, piece: this.pieceAt(sq)! });
        this.renderer.pieceSelected(sq);
          this.startDrag(sq, pos);
          break;
        }
        this.m.selected = undefined;
        if (res.needsPromotion && (!this.opts.autoPromote || key === 'alt')) {
          this.m.dragging = sel;
          this.openPromotion(sel, res);
          break;
        }
        this.setState('idle');
        // click-to-move slides the piece, unlike a drop
        this.commit(res, res.needsPromotion ? 'q' : undefined, { animate: true });
        break;
      }
      case 'promotion':
        this.cancelPromotion();
        break;
      case 'markings':
        this.m.markStart = undefined;
        this.setState('idle');
        break;
      case 'dragging':
        break;
    }
    this.refreshOverlays();
  }

  private handleDownRight(pos: PointerPosition): void {
    const o = this.opts;
    switch (this.m.state) {
      case 'idle':
        if (!o.enabled || o.disableUserMarkings || !o.allowMarkings) return;
        this.m.markStart = pos.square ?? undefined;
        this.setState('markings');
        break;
      case 'selected':
        if (!o.enabled || o.disableUserMarkings || !o.allowMarkings) return;
        this.m.selected = undefined;
        this.m.markStart = pos.square ?? undefined;
        this.setState('markings');
        break;
      case 'promotion':
        this.cancelPromotion();
        break;
      default:
        break;
    }
    this.refreshOverlays();
  }

  // ── pointer up ──────────────────────────────────────────────────────────

  private handleUp(pos: PointerPosition, key: KeyModifier): void {
    const sq = pos.square;
    if (this.m.state === 'markings') {
      const start = this.m.markStart;
      if (sq && start && this.opts.allowMarkings) {
        const um = this.opts.userMarkings ?? {};
        if (start === sq) this.markings.toggle({ kind: 'highlight', square: sq, modifier: key, persistent: um.persistent });
        else this.markings.toggle({ kind: 'arrow', from: start, to: sq, modifier: key, persistent: um.persistent, animated: um.animated, pointerFinger: um.pointerFinger });
      }
      this.m.markStart = undefined;
      this.setState('idle');
      this.refreshOverlays();
      return;
    }
    if (this.m.state !== 'dragging') return;
    const from = this.m.dragging;
    if (!from) return;
    this.renderer.hideHoverSquare();

    // dropped on its own square → toggle selection
    if (sq === from) {
      this.renderer.dropPiece(from);
      this.m.dragging = undefined;
      const wasSelected = this.m.selected === from;
      if (wasSelected || this.opts.moveMethod === 'drag_only') {
        this.m.selected = undefined;
        this.setState('idle');
      } else {
        this.m.selected = from;
        this.setState('selected');
      }
      this.refreshOverlays();
      return;
    }

    if (this.m.selected) this.m.selected = undefined;
    if (this.setupSession && !sq) {
      // setup mode: a piece dropped off the board is deleted
      this.renderer.dropPiece();
      this.m.dragging = undefined;
      this.setState('idle');
      this.setupSession.remove(from);
      this.setupRefresh();
      return;
    }
    const res = this.resolveUserMove(from, sq);

    if (!res) {
      // rejected: the piece goes home, and (unless drag-only) stays selected
      this.renderer.dropPiece(from);
      this.m.dragging = undefined;
      this.rejectMove(from, sq);
      const king = this.game.checkedKing();
      let blinkSquare: Square | null = null;
      if (this.pieceAt(from)?.color === this.game.turn() && king) {
        this.playSound('illegal');
        blinkSquare = king;
      }
      if (blinkSquare && this.opts.animationType !== 'dynamic') this.renderer.blink(blinkSquare, this.opts.checkBlinkingSquareColor);
      if (this.opts.moveMethod === 'drag_only') {
        this.setState('idle');
      } else {
        this.m.selected = from;
        this.setState('selected');
      }
      this.refreshOverlays();
      return;
    }

    if (res.needsPromotion && (!this.opts.autoPromote || key === 'alt')) {
      this.openPromotion(from, res);
      this.refreshOverlays();
      return;
    }

    this.renderer.dropPiece(res.to);
    this.m.dragging = undefined;
    this.setState('idle');
    this.commit(res, res.needsPromotion ? 'q' : undefined, { animate: false, fromDrop: true });
    this.refreshOverlays();
  }

  /** Execute a user decision: queue a premove or play the move. */
  private commit(res: Resolved, promotion: PromotionType | undefined, how: { animate: boolean; fromDrop?: boolean }): void {
    if (this.setupSession) {
      this.setupMove(res.from, res.to, how);
      return;
    }
    if (res.premove) {
      this.queuePremove(res.from, res.to, promotion);
      return;
    }
    this.applyMove({ from: res.from, to: res.to, promotion }, { userGenerated: true, animate: how.animate, isPremove: false, fromDrop: how.fromDrop });
  }

  // ── promotion ───────────────────────────────────────────────────────────

  private openPromotion(from: Square, res: Resolved): void {
    const color = this.pieceAt(from)!.color;
    this.m.dragging = from;
    this.m.promo = { from, to: res.to, color, premove: res.premove };
    this.renderer.dragPiece(from, undefined, res.to);
    this.setState('promotion');
    this.renderer.openPromotionWindow(
      { to: res.to, color },
      {
        onPick: (piece) => this.finishPromotion(piece),
        onClose: () => this.cancelPromotion(),
        onRightClick: () => this.cancelPromotion(),
      },
    );
    this.events.emit('promotion-start', { from, to: res.to, color });
  }

  private finishPromotion(piece: PromotionType): void {
    const promo = this.m.promo;
    if (!promo) return;
    this.renderer.dropPiece(promo.to);
    this.renderer.closePromotionWindow();
    this.m.dragging = undefined;
    this.m.promo = undefined;
    this.setState('idle');
    this.commit({ premove: promo.premove, from: promo.from, to: promo.to, needsPromotion: true }, piece, { animate: false, fromDrop: true });
    this.refreshOverlays();
  }

  private cancelPromotion(): void {
    if (this.m.state !== 'promotion') return;
    this.renderer.dropPiece();
    this.renderer.closePromotionWindow();
    this.m.dragging = undefined;
    this.m.promo = undefined;
    this.setState('idle');
    this.events.emit('promotion-cancel', {});
    this.refreshOverlays();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Setup mode
  // ═══════════════════════════════════════════════════════════════════════

  private session(): SetupSession {
    if (!this.setupSession) throw new Error("The board is not in setup mode (use setOptions({ mode: 'setup' }))");
    return this.setupSession;
  }

  private enterSetup(from: 'play' | 'analysis' | 'view'): void {
    const shown = this.viewPly !== null ? new Chess(this.game.fenAt(this.viewPly)) : this.game;
    this.setupReturnMode = from;
    this.setupLeave = 'commit';
    this.setupSession = new SetupSession(shown.pieces(), shown.turn(), shown.castlingRights());
    this.queue.clear();
    this.resetMachine();
    this.renderer.loadPieces(this.setupSession.pieces);
    this.setupChanged();
    this.refreshOverlays();
  }

  /** Mode left: load the edited position when it is legal (and not cancelled), otherwise restore the game. */
  private leaveSetup(): void {
    const session = this.setupSession;
    if (!session) return;
    const problems = session.problems();
    const fen = session.fen();
    const commit = this.setupLeave === 'commit' && problems.length === 0;
    this.setupSession = null;
    this.setupLeave = 'commit';
    this.resetMachine();
    if (commit) this.load(fen);
    else {
      this.renderer.loadPieces(this.displayPieces(), true);
      this.refreshOverlays();
    }
    this.events.emit('setup-end', { committed: commit, fen: commit ? fen : null, problems });
  }

  private setupChanged(): void {
    const s = this.setupSession;
    if (s) this.events.emit('setup-change', { fen: s.fen(), problems: s.problems() });
  }

  /** The edited position changed without a visible piece move: redraw it. */
  private setupRefresh(all = false): void {
    if (!this.setupSession) return;
    this.resetMachine();
    this.renderer.loadPieces(this.setupSession.pieces, all);
    this.setupChanged();
    this.refreshOverlays();
  }

  private setupMove(from: Square, to: Square, how: { animate: boolean; fromDrop?: boolean }): void {
    const s = this.setupSession;
    const moved = s?.move(from, to);
    if (!s || !moved) return;
    this.renderer.makeMove({
      from,
      to,
      color: moved.piece.color,
      piece: moved.piece.type,
      flags: { capture: !!moved.captured, enPassant: false, doublePush: false, kingsideCastle: false, queensideCastle: false, promotion: false },
      animate: how.animate,
      fromDrop: how.fromDrop,
    });
    this.playSound(moved.captured ? 'capture' : 'move-self');
    this.setupChanged();
    this.refreshOverlays();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Overlays (highlights, hints, arrows)
  // ═══════════════════════════════════════════════════════════════════════

  private refreshOverlays(): void {
    if (this.destroyed) return;
    const o = this.opts;
    const specs: HighlightSpec[] = [];
    const growing = o.animationType === 'dynamic';
    const themeColor = o.highlightColor ?? resolveTheme(o.boardStyle).highlight;

    // One highlight per square. In the original every module writes into a map keyed by square and
    // the *last* writer wins; modules run in the order selection, last move, user markings, premoves.
    // Specs are listed here highest priority first (the renderer keeps the first spec of a square).
    const premoveSpecs: HighlightSpec[] = [];
    if (o.allowMarkings) {
      for (const pm of this.queue.list()) {
        for (const sq of [pm.from, pm.to]) {
          premoveSpecs.push({ key: `premove|${sq}`, square: sq, color: o.premoveHighlightColor, opacity: o.premoveHighlightOpacity, growing, kind: 'premove' });
        }
      }
    }
    specs.push(...premoveSpecs);
    if (o.allowMarkings) {
      for (const mk of this.markings.all()) {
        if (mk.kind !== 'highlight') continue;
        specs.push({
          key: mk.key,
          square: mk.square,
          color: mk.color ?? o.analysisHighlightColors[mk.modifier],
          opacity: mk.opacity ?? o.analysisHighlightOpacity,
          growing,
          kind: 'analysis',
        });
      }
    }
    if (o.highlightMoves && this.lastMove && !this.setupSession) {
      for (const sq of [this.lastMove.from, this.lastMove.to]) {
        specs.push({ key: `move|${sq}`, square: sq, color: growing ? themeColor : o.highlightColor, opacity: o.highlightOpacity, growing, kind: 'move', turn: this.lastMove.color });
      }
    }
    const held = this.m.state === 'dragging' || this.m.state === 'promotion' ? this.m.dragging : this.m.selected;
    if (o.highlightMoves && held) {
      specs.push({ key: `selected|${held}`, square: held, color: growing ? themeColor : o.highlightColor, opacity: o.highlightOpacity, growing, kind: 'selection' });
    }
    this.renderer.setHeld(held);
    if (this.a11y.isAttached()) this.a11y.updateAll(this.displayPieces());
    this.renderer.setHighlights(specs);

    // hints
    const target = this.m.state === 'promotion' ? undefined : this.m.dragging ?? this.m.selected;
    if (o.highlightLegalMoves && target && this.canMoveNow()) {
      const targets = this.hintTargets(target);
      const occupied = this.displayPieces();
      this.renderer.setHints(
        targets.filter((s) => !occupied.has(s)),
        targets.filter((s) => occupied.has(s)),
      );
    } else {
      this.renderer.setHints([], []);
    }

    // arrows
    const arrows: ArrowSpec[] = [];
    if (o.allowMarkings) {
      for (const mk of this.markings.all() as Marking[]) {
        if (mk.kind !== 'arrow') continue;
        arrows.push({
          key: mk.key,
          from: mk.from,
          to: mk.to,
          color: mk.color ?? o.arrowColors[mk.modifier],
          opacity: mk.opacity ?? o.analysisHighlightOpacity,
          width: mk.width,
          animated: mk.animated,
          pointerFinger: mk.pointerFinger,
        });
      }
    }
    this.renderer.setArrows(arrows);
  }

  /** Theme currently in use (colours of the board). */
  getTheme() {
    return resolveTheme(this.opts.boardStyle);
  }
}
