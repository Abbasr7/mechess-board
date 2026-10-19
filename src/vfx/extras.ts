/**
 * Playful extras built on the effect manager. On chess.com these are
 * "special theme" easter eggs; here they are opt-in (`options.extras`).
 *
 *  - **Fidgets** (play mode only):
 *      · click your own piece three times within 500 ms each while it is the
 *        opponent's turn → the piece does a flip;
 *      · press and hold an opponent's piece for 500 ms on your turn → it
 *        "charges" (squashes and shakes) and jumps when you let go.
 *  - **Piece throw**: hover a piece and press `t` → a hand throws it away.
 *  - **Boxing glove**: hold `b` → a glove follows the pointer; moving fast over
 *    a piece punches it off the board.
 *  - **Board slam**: every piece jumps (and some fall over); any click resets.
 */
import type { Color, Piece, Square } from '../types';
import { toSquare } from '../squares';
import type { VfxManager } from './vfx';

export interface ExtrasOptions {
  /** Flip on triple-click of an own piece / charge-jump on press-and-hold of an opponent piece. */
  fidgets?: boolean;
  /** Key `t`: image shown for the throwing hand (required to enable the feature). */
  handImageUrl?: string;
  /** Hold `b` for a glove cursor that punches pieces. */
  boxingGlove?: boolean | BoxingGloveOptions;
}

export interface BoxingGloveOptions {
  keyToActivate?: string;
  /** Image of the glove; a 🥊 emoji is used when omitted. */
  gloveImageUrl?: string;
  /** Pointer speed (px/ms) needed to land a punch. */
  minPunchVelocity?: number;
  minPunchDistanceSquares?: number;
  maxPunchDistanceSquares?: number;
  gloveScale?: number;
  distanceMultiplier?: number;
  imageRotationDeg?: number;
  /** Punched pieces are removed instead of coming back. */
  disablePieceReset?: boolean;
  /** Only punch the opponent's pieces. */
  opponentOnly?: boolean;
  punchSoundUrls?: string[];
}

export interface ExtrasContext {
  el: HTMLElement;
  vfx: VfxManager;
  options(): ExtrasOptions | undefined;
  playingAs(): Color | null;
  turn(): Color;
  isPlayMode(): boolean;
  getPiece(sq: Square): Piece | undefined;
  /** Board geometry for pointer maths. */
  pointer(clientX: number, clientY: number): { square: Square | null };
  squareSizePx(): number;
  flipped(): boolean;
}

const FLIP_WINDOW_MS = 500;
const CHARGE_AFTER_MS = 500;
const short = (p: Piece): string => `${p.color}${p.type}`;

const GLOVE_DEFAULTS: Required<Omit<BoxingGloveOptions, 'gloveImageUrl'>> = {
  keyToActivate: 'b',
  minPunchVelocity: 0.12,
  minPunchDistanceSquares: 1,
  maxPunchDistanceSquares: 9,
  gloveScale: 1.3,
  distanceMultiplier: 100,
  imageRotationDeg: 90,
  disablePieceReset: false,
  opponentOnly: false,
  punchSoundUrls: [],
};

export class Extras {
  // fidgets
  private lastClickSquare: Square | undefined;
  private lastClickAt = 0;
  private clicks = 0;
  private flipping = false;
  private chargeTimer = 0;
  private chargeKey: string | null = null;
  private chargeSquare: Square | undefined;
  private chargeActive = false;
  // boxing glove
  private glove: HTMLElement | null = null;
  private gloveOn = false;
  private lastPtr: { x: number; y: number; t: number } | null = null;
  private vel: { vx: number; vy: number; speed: number } | null = null;
  private angle = 0;
  private sounds: HTMLAudioElement[] = [];
  private onPtr = (e: PointerEvent): void => this.gloveMove(e);

  constructor(private ctx: ExtrasContext) {}

  private get opts(): ExtrasOptions {
    return this.ctx.options() ?? {};
  }

  // ── pointer / key events fed by the board ──────────────────────────────

  /** The user pressed a piece (any state). */
  pieceClicked(square: Square, piece: Piece): void {
    if (!this.opts.fidgets || !this.ctx.isPlayMode()) return;
    const me = this.ctx.playingAs();
    if (!me) return;
    const myTurn = me === this.ctx.turn();
    const isMine = piece.color === me;

    if (!myTurn && isMine) {
      // own piece, opponent to move: triple click → flip
      if (this.flipping) return;
      const now = Date.now();
      const quick = now - this.lastClickAt < FLIP_WINDOW_MS && this.lastClickSquare === square;
      this.lastClickAt = now;
      this.clicks = quick ? this.clicks + 1 : 1;
      this.lastClickSquare = square;
      if (this.clicks === 3) {
        this.flipping = true;
        this.clicks = 0;
        this.ctx.vfx.add({ type: 'piece-flip', square, data: { piece: short(piece), onFlipComplete: () => (this.flipping = false) } });
      }
      return;
    }
    if (myTurn && !isMine) {
      // opponent's piece, my turn: press and hold → charge, release → jump
      if (this.chargeActive || this.chargeTimer) {
        this.cancelCharge();
        return;
      }
      this.chargeSquare = square;
      this.chargeTimer = window.setTimeout(() => {
        this.chargeTimer = 0;
        this.chargeActive = true;
        this.chargeKey = this.ctx.vfx.add({
          type: 'charge-jump',
          square,
          data: {
            piece: short(piece),
            onFidgetComplete: () => {
              this.chargeActive = false;
              this.chargeKey = null;
            },
          },
        });
      }, CHARGE_AFTER_MS);
    }
  }

  pointerMoved(square: Square | null): void {
    if (this.chargeTimer && square !== this.chargeSquare) this.cancelCharge();
  }

  pointerReleased(): void {
    if (this.chargeTimer) {
      this.cancelCharge();
      return;
    }
    if (this.chargeActive && this.chargeKey) this.ctx.vfx.update(this.chargeKey, { phase: 'jump' });
  }

  /** Any position change or click elsewhere cancels pending fidgets and running throws. */
  interrupted(): void {
    if (this.flipping) {
      this.ctx.vfx.removeByPredicate((e) => e.type === 'piece-flip');
      this.flipping = false;
      this.clicks = 0;
    }
    if (this.chargeActive || this.chargeTimer) this.cancelCharge();
    this.ctx.vfx.removeByPredicate((e) => e.type === 'piece-throw' || e.type === 'hand-throw');
  }

  private cancelCharge(): void {
    if (this.chargeTimer) window.clearTimeout(this.chargeTimer);
    this.chargeTimer = 0;
    if (this.chargeKey) this.ctx.vfx.remove(this.chargeKey);
    this.chargeKey = null;
    this.chargeActive = false;
    this.chargeSquare = undefined;
  }

  keyDown(key: string): void {
    const o = this.opts;
    if (key === 't' && o.handImageUrl) {
      const hovered = this.ctx.el.querySelector('.piece:hover');
      const cls = hovered && [...hovered.classList].find((c) => /^square-[1-8][1-8]$/.test(c));
      if (!cls) return;
      const sq = toSquare(Number(cls[7]), Number(cls[8]));
      if (sq) this.throwPiece(sq);
      return;
    }
    const g = this.gloveOptions();
    if (g && key === g.keyToActivate.toLowerCase()) this.gloveStart(g);
  }

  keyUp(key: string): void {
    const g = this.gloveOptions();
    if (g && key === g.keyToActivate.toLowerCase()) this.gloveStop(g);
  }

  // ── piece throw ─────────────────────────────────────────────────────────

  /** A hand appears, throws the piece away and the piece comes back (needs `handImageUrl`). */
  throwPiece(square: Square): void {
    const piece = this.ctx.getPiece(square);
    const url = this.opts.handImageUrl;
    if (!piece || !url) return;
    this.ctx.vfx.add({
      type: 'hand-throw',
      square,
      data: { url, appearDurationMs: 500, throwDurationMs: 200, fadeDurationMs: 800, throwScaleX: 2, throwScaleY: 2, throwDyPercent: -100 },
    });
    this.ctx.vfx.add({ type: 'piece-throw', square, data: { piece: short(piece), delay: 500, throwDuration: 1500 } });
  }

  // ── boxing glove ────────────────────────────────────────────────────────

  private gloveOptions(): (Required<Omit<BoxingGloveOptions, 'gloveImageUrl'>> & { gloveImageUrl?: string }) | null {
    const g = this.opts.boxingGlove;
    if (!g) return null;
    return { ...GLOVE_DEFAULTS, ...(g === true ? {} : g) };
  }

  private gloveStart(g: NonNullable<ReturnType<Extras['gloveOptions']>>): void {
    if (this.gloveOn) return;
    this.gloveOn = true;
    this.lastPtr = null;
    this.vel = null;
    this.angle = 0;
    if (!this.sounds.length && g.punchSoundUrls.length) this.sounds = g.punchSoundUrls.map((u) => new Audio(u));
    const doc = this.ctx.el.ownerDocument;
    const el = doc.createElement('div');
    el.classList.add('boxing-glove-cursor');
    if (g.gloveImageUrl) {
      const img = doc.createElement('img');
      img.src = g.gloveImageUrl;
      img.alt = '';
      el.appendChild(img);
    } else {
      const e = doc.createElement('div');
      e.classList.add('glove');
      e.textContent = '🥊';
      el.appendChild(e);
    }
    this.ctx.el.appendChild(el);
    this.glove = el;
    doc.addEventListener('pointermove', this.onPtr);
  }

  private gloveStop(g: NonNullable<ReturnType<Extras['gloveOptions']>>): void {
    this.gloveOn = false;
    this.glove?.remove();
    this.glove = null;
    this.ctx.el.ownerDocument.removeEventListener('pointermove', this.onPtr);
    if (g.disablePieceReset) this.ctx.vfx.removeByPredicate((e) => e.type === 'piece-throw');
  }

  private gloveMove(e: PointerEvent): void {
    const g = this.gloveOptions();
    if (!g || !this.gloveOn || !this.glove) return;
    const rect = this.ctx.el.getBoundingClientRect();
    const sq = rect.width / 8;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const inside = x >= -sq / 2 && x <= rect.width + sq / 2 && y >= -sq / 2 && y <= rect.height + sq / 2;
    const t = e.timeStamp;
    if (!this.lastPtr) this.lastPtr = { x, y, t };
    else {
      const dt = Math.max(1, t - this.lastPtr.t);
      const vx = (x - this.lastPtr.x) / dt;
      const vy = (y - this.lastPtr.y) / dt;
      const speed = Math.hypot(vx, vy);
      this.vel = { vx, vy, speed };
      this.lastPtr = { x, y, t };
      if (speed > 0) {
        const target = (Math.atan2(vy, vx) * 180) / Math.PI + g.imageRotationDeg;
        this.angle += (((target - this.angle) % 360 + 540) % 360 - 180) * 0.2;
      }
    }
    const size = sq * g.gloveScale;
    this.glove.style.setProperty('--boxing-glove-size', `${size}px`);
    this.glove.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${this.angle}deg)`;
    if (!inside) {
      this.glove.classList.remove('boxing-glove-cursor--active');
      return;
    }
    this.glove.classList.add('boxing-glove-cursor--active');
    if (!this.vel || this.vel.speed < g.minPunchVelocity) return;
    const hit = this.ctx.pointer(e.clientX, e.clientY).square;
    if (!hit) return;
    const piece = this.ctx.getPiece(hit);
    if (!piece) return;
    if (g.opponentOnly && this.ctx.playingAs() && piece.color === this.ctx.playingAs()) return;
    this.punch(hit, piece, g, { x, y }, sq);
  }

  private punch(sq: Square, piece: Piece, g: NonNullable<ReturnType<Extras['gloveOptions']>>, at: { x: number; y: number }, squareSize: number): void {
    const v = this.vel!;
    if (this.sounds.length) (this.sounds[Math.floor(Math.random() * this.sounds.length)].cloneNode() as HTMLAudioElement).play().catch(() => undefined);
    // punch animation + a burst of stars along the direction of travel
    const glove = this.glove!;
    glove.classList.remove('boxing-glove-cursor--punch');
    void glove.offsetHeight;
    glove.classList.add('boxing-glove-cursor--punch');
    window.setTimeout(() => glove.classList.remove('boxing-glove-cursor--punch'), 180);
    this.stars(at, v);
    const dx = v.vx / v.speed;
    const dy = v.vy / v.speed;
    const squares = Math.min(Math.max(Math.round((v.speed / squareSize) * g.distanceMultiplier), g.minPunchDistanceSquares), g.maxPunchDistanceSquares);
    this.ctx.vfx.add({
      type: 'piece-throw',
      square: sq,
      data: { piece: short(piece), throwX: dx * squares * 100, throwY: dy * squares * 100, throwDuration: 600, scale: 1, disablePieceReset: g.disablePieceReset },
    });
  }

  private stars(at: { x: number; y: number }, v: { vx: number; vy: number; speed: number }): void {
    const doc = this.ctx.el.ownerDocument;
    const box = doc.createElement('div');
    box.classList.add('boxing-glove-stars');
    box.style.left = `${at.x}px`;
    box.style.top = `${at.y}px`;
    const base = v.speed ? Math.atan2(v.vy, v.vx) : -Math.PI / 2;
    const spread = Math.PI / 3;
    for (let i = 0; i < 3; i++) {
      const star = doc.createElement('span');
      star.classList.add('boxing-glove-star');
      const a = base + ([-0.5, 0, 0.5][i] ?? 0) * spread + (Math.random() * 2 - 1) * spread * 0.08;
      const dist = 36 + (i / 2) * 54;
      star.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
      star.style.setProperty('--dy', `${Math.sin(a) * dist}px`);
      box.appendChild(star);
    }
    this.ctx.el.appendChild(box);
    window.setTimeout(() => box.remove(), 320);
  }

  // ── board slam ──────────────────────────────────────────────────────────

  private slam: string[] = [];

  /** Every piece jumps; call again to re-roll the jump, `resetSlam()` to put everything back. */
  triggerSlam(pieces: Map<Square, Piece>): void {
    if (this.slam.length) {
      this.slam.forEach((k) => this.ctx.vfx.update(k));
      return;
    }
    this.ctx.el.classList.add('hide-pieces');
    for (const [sq, p] of pieces) this.slam.push(this.ctx.vfx.add({ type: 'piece-jump', square: sq, data: { piece: short(p) } }));
  }

  resetSlam(): boolean {
    if (!this.slam.length) return false;
    this.ctx.el.classList.remove('hide-pieces');
    this.slam.forEach((k) => this.ctx.vfx.remove(k));
    this.slam = [];
    return true;
  }

  destroy(): void {
    this.cancelCharge();
    this.glove?.remove();
    this.ctx.el.ownerDocument.removeEventListener('pointermove', this.onPtr);
    this.resetSlam();
  }
}

