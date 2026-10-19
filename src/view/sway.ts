/**
 * "Piece sway": the small physical feel of the *dynamic* animation type.
 *
 *  - when a piece is picked up it starts 25 % larger and settles to normal size
 *    over 0.2 s with an ease-out-back curve (a little "pop");
 *  - while it is dragged it tilts towards the horizontal direction of travel,
 *    by up to ±10°, and wobbles back to upright when the pointer slows down.
 *
 * Observed in the original as the `piece-sway` plugin, active only for the
 * "dynamic" animation type on the DOM renderer. The numbers below are the
 * constants found in that code; the physics is a per-frame low-pass filter on
 * the pointer's horizontal speed (board-space units per frame).
 */

export const SWAY = {
  /** Largest tilt in degrees. */
  maxAngle: 10,
  /** How strongly pointer speed turns into tilt. */
  gain: 0.3,
  /** How fast the tilt is pulled back to upright (deg/s at full tilt). */
  restore: 400,
  /** Below this speed the piece counts as "not moving". */
  speedThreshold: 1,
  /** Tilts under this many degrees snap to 0. */
  deadZone: 0.3,
  /** Smoothing factor applied to the target tilt each frame. */
  smoothing: 0.15,
  /** Pick-up pop. */
  startScale: 1.25,
  endScale: 1,
  scaleDuration: 0.2,
} as const;

export interface RotationState {
  rotation: number;
  target: number;
  lastSpeed: number;
  /** The small counter-swing after stopping has been applied. */
  overshoot: boolean;
}

export const initialRotation = (): RotationState => ({ rotation: 0, target: 0, lastSpeed: 0, overshoot: false });

/** One frame of the tilt physics. `speed` is `null` when no pointer data exists yet. */
export function stepRotation(s: RotationState, speed: number | null, dt: number): RotationState {
  let target = s.target;
  let overshoot = s.overshoot;
  let lastSpeed = s.lastSpeed;
  if (speed !== null && Math.abs(speed) > SWAY.speedThreshold) {
    lastSpeed = Math.abs(speed);
    overshoot = false;
    target = s.rotation + Math.sign(speed) * Math.abs(speed) * SWAY.gain;
    target = Math.max(-SWAY.maxAngle, Math.min(SWAY.maxAngle, target));
  } else {
    if (!overshoot && Math.abs(s.rotation) < SWAY.deadZone) {
      // a tiny counter-swing the first time the tilt has nearly died out
      target = -Math.sign(s.rotation) * lastSpeed * SWAY.gain * 0.1;
      overshoot = true;
    } else {
      target -= Math.sign(s.rotation) * (Math.abs(s.rotation) / SWAY.maxAngle) * SWAY.restore * dt;
    }
    if (Math.abs(target) < SWAY.deadZone) {
      target = 0;
      overshoot = false;
    }
  }
  return { rotation: s.rotation + SWAY.smoothing * (target - s.rotation), target, lastSpeed, overshoot };
}

/** ease-out-back (overshoots 1 slightly before settling). */
export const easeOutBack = (t: number): number => {
  const u = t - 1;
  return u * u * (2.70158 * u + 1.70158) + 1;
};

/** Pick-up scale at `t` seconds after the piece was selected. */
export function scaleAt(t: number): number {
  const p = t / SWAY.scaleDuration;
  if (p >= 1) return SWAY.endScale;
  return SWAY.startScale + (SWAY.endScale - SWAY.startScale) * easeOutBack(Math.min(p, 1));
}

export interface SwayHost {
  /** Place a piece with an explicit transform (board-space coordinates, degrees, scale). */
  setPiecePosition(square: string, coords: { x: number; y: number }, rotation: number, scale: number): void;
  clearPieceTransform(square: string): void;
  coordsOfSquare(square: string): { x: number; y: number };
}

export class PieceSway {
  private rot = initialRotation();
  private scale = 1;
  private selected: string | null = null;
  private scaleStart: number | null = null;
  private drag: { square: string; coords: { x: number; y: number } | null } | null = null;
  private coords: { x: number; y: number } | null = null;
  private prevCoords: { x: number; y: number } | null = null;
  private raf = 0;
  private frameTime = 0;

  constructor(private host: SwayHost) {}

  /** The state machine selected / picked up a piece: start the pop. */
  pieceSelected(square: string): void {
    if (this.selected && this.selected !== square && !(this.drag?.coords && this.drag.square === this.selected)) {
      this.host.clearPieceTransform(this.selected);
    }
    this.selected = square;
    this.scale = 1;
    this.scaleStart = performance.now();
    this.ensureLoop();
  }

  /** The renderer is about to draw the dragged piece; returns the extra tilt/scale to apply. */
  dragged(square: string, coords: { x: number; y: number } | null): { rotation: number; scale: number } {
    this.drag = { square, coords };
    if (coords) {
      this.prevCoords = this.coords;
      this.coords = coords;
    }
    return { rotation: this.rot.rotation, scale: this.scale };
  }

  dragStarted(): void {
    this.ensureLoop();
  }

  dragEnded(square: string | null): void {
    this.rot = initialRotation();
    this.coords = null;
    this.prevCoords = null;
    this.drag = null;
    if (!(this.scaleRunning() && this.selected === square) && square) this.host.clearPieceTransform(square);
    if (this.raf && !this.scaleRunning()) this.cancel();
  }

  /** Called when the position changes and nothing is being dragged. */
  stop(): void {
    if (this.selected) this.host.clearPieceTransform(this.selected);
    if (this.drag) this.host.clearPieceTransform(this.drag.square);
    this.cancel();
    this.selected = null;
    this.scaleStart = null;
  }

  destroy(): void {
    this.stop();
    this.drag = null;
    this.coords = null;
    this.prevCoords = null;
  }

  private scaleRunning(now = performance.now()): boolean {
    return this.selected !== null && this.scaleStart !== null && (now - this.scaleStart) / 1000 / SWAY.scaleDuration < 1;
  }

  private ensureLoop(): void {
    if (this.raf) return;
    this.frameTime = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private cancel(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame(now: number): void {
    const dt = (now - this.frameTime) * 0.001;
    this.frameTime = now;

    // pick-up scale
    let scaleRunning = false;
    if (this.selected && this.scaleStart !== null) {
      const t = (now - this.scaleStart) / 1000;
      this.scale = scaleAt(t);
      if (t / SWAY.scaleDuration >= 1) {
        if (!this.drag?.coords) this.host.clearPieceTransform(this.selected);
        this.scaleStart = null;
      } else scaleRunning = true;
    }

    // tilt
    const speed = this.coords && this.prevCoords ? this.coords.x - this.prevCoords.x : null;
    this.prevCoords = this.coords;
    this.rot = stepRotation(this.rot, speed, dt);

    // apply
    if (this.drag?.coords) {
      this.host.setPiecePosition(this.drag.square, this.drag.coords, this.rot.rotation, this.scale);
    } else if (this.selected && this.scaleStart !== null) {
      this.host.setPiecePosition(this.selected, this.host.coordsOfSquare(this.selected), 0, this.scale);
    }

    this.raf = scaleRunning || this.drag?.coords ? requestAnimationFrame((t) => this.frame(t)) : 0;
  }
}
