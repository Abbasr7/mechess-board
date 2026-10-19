import type { Color, MoveFlags, SoundName } from './types';

export interface SoundPlayer {
  play(name: SoundName): void;
  destroy?(): void;
}

/**
 * - `'synth'`: built-in Web Audio beeps (no assets needed)
 * - a map of sound name → URL (or several URLs, first playable wins)
 * - your own player object
 * - `false`: silence
 */
export type SoundSource = 'synth' | Partial<Record<SoundName, string | string[]>> | SoundPlayer | false;

export const SOUND_NAMES: readonly SoundName[] = [
  'game-start',
  'game-end',
  'capture',
  'castle',
  'premove',
  'move-self',
  'move-check',
  'move-opponent',
  'promote',
  'notify',
  'tenseconds',
  'illegal',
];

interface Tone {
  at: number;
  freq: number;
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

/** Tone recipes for the synthesised fallback sounds. */
const RECIPES: Record<SoundName, { tones: Tone[]; noise?: { at: number; dur: number; gain: number } }> = {
  'move-self': { tones: [{ at: 0, freq: 240, to: 120, dur: 0.07, type: 'triangle', gain: 0.5 }], noise: { at: 0, dur: 0.03, gain: 0.25 } },
  'move-opponent': { tones: [{ at: 0, freq: 200, to: 100, dur: 0.07, type: 'triangle', gain: 0.45 }], noise: { at: 0, dur: 0.03, gain: 0.22 } },
  capture: { tones: [{ at: 0, freq: 180, to: 70, dur: 0.12, type: 'triangle', gain: 0.6 }], noise: { at: 0, dur: 0.08, gain: 0.5 } },
  castle: {
    tones: [
      { at: 0, freq: 240, to: 120, dur: 0.07, type: 'triangle', gain: 0.5 },
      { at: 0.09, freq: 280, to: 140, dur: 0.07, type: 'triangle', gain: 0.5 },
    ],
  },
  'move-check': {
    tones: [
      { at: 0, freq: 240, to: 120, dur: 0.07, type: 'triangle', gain: 0.5 },
      { at: 0.06, freq: 880, dur: 0.12, type: 'sine', gain: 0.25 },
    ],
  },
  promote: {
    tones: [
      { at: 0, freq: 523, dur: 0.07, type: 'triangle', gain: 0.35 },
      { at: 0.07, freq: 659, dur: 0.07, type: 'triangle', gain: 0.35 },
      { at: 0.14, freq: 784, dur: 0.12, type: 'triangle', gain: 0.35 },
    ],
  },
  premove: { tones: [{ at: 0, freq: 330, to: 200, dur: 0.05, type: 'triangle', gain: 0.3 }], noise: { at: 0, dur: 0.02, gain: 0.12 } },
  illegal: { tones: [{ at: 0, freq: 120, to: 90, dur: 0.14, type: 'sawtooth', gain: 0.18 }] },
  'game-start': {
    tones: [
      { at: 0, freq: 523, dur: 0.1, type: 'sine', gain: 0.3 },
      { at: 0.1, freq: 659, dur: 0.1, type: 'sine', gain: 0.3 },
      { at: 0.2, freq: 784, dur: 0.18, type: 'sine', gain: 0.3 },
    ],
  },
  'game-end': {
    tones: [
      { at: 0, freq: 784, dur: 0.1, type: 'sine', gain: 0.3 },
      { at: 0.1, freq: 659, dur: 0.1, type: 'sine', gain: 0.3 },
      { at: 0.2, freq: 523, dur: 0.22, type: 'sine', gain: 0.3 },
    ],
  },
  notify: {
    tones: [
      { at: 0, freq: 740, dur: 0.08, type: 'sine', gain: 0.3 },
      { at: 0.1, freq: 988, dur: 0.12, type: 'sine', gain: 0.3 },
    ],
  },
  tenseconds: { tones: [{ at: 0, freq: 1000, dur: 0.05, type: 'square', gain: 0.1 }] },
};

class SynthPlayer implements SoundPlayer {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  play(name: SoundName): void {
    const ctx = this.context();
    const recipe = RECIPES[name];
    if (!ctx || !recipe) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const t0 = ctx.currentTime + 0.005;
    for (const t of recipe.tones) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = t.type ?? 'sine';
      osc.frequency.setValueAtTime(t.freq, t0 + t.at);
      if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, t0 + t.at + t.dur);
      const peak = t.gain ?? 0.3;
      g.gain.setValueAtTime(0.0001, t0 + t.at);
      g.gain.exponentialRampToValueAtTime(peak, t0 + t.at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + t.at + t.dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + t.at);
      osc.stop(t0 + t.at + t.dur + 0.02);
    }
    if (recipe.noise) {
      if (!this.noiseBuf) {
        const len = Math.floor(ctx.sampleRate * 0.15);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(recipe.noise.gain, t0 + recipe.noise.at);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + recipe.noise.at + recipe.noise.dur);
      src.connect(filter).connect(g).connect(ctx.destination);
      src.start(t0 + recipe.noise.at);
      src.stop(t0 + recipe.noise.at + recipe.noise.dur + 0.02);
    }
  }

  destroy(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

class UrlPlayer implements SoundPlayer {
  private audio = new Map<SoundName, HTMLAudioElement>();

  constructor(private urls: Partial<Record<SoundName, string | string[]>>) {}

  private get(name: SoundName): HTMLAudioElement | null {
    const cached = this.audio.get(name);
    if (cached) return cached;
    const src = this.urls[name];
    if (!src || typeof Audio === 'undefined') return null;
    const list = Array.isArray(src) ? src : [src];
    const el = new Audio();
    el.preload = 'auto';
    // pick the first source the browser claims to be able to play
    const pick = list.find((u) => {
      const ext = /\.([a-z0-9]+)(?:$|\?)/i.exec(u)?.[1]?.toLowerCase();
      const mime = ext === 'mp3' ? 'audio/mpeg' : ext ? `audio/${ext}` : '';
      return !mime || el.canPlayType(mime) !== '';
    });
    el.src = pick ?? list[0];
    this.audio.set(name, el);
    return el;
  }

  play(name: SoundName): void {
    const el = this.get(name);
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => undefined); // autoplay policy: ignore until the user has interacted
  }

  destroy(): void {
    this.audio.forEach((a) => a.pause());
    this.audio.clear();
  }
}

/**
 * Which sound accompanies a move. Priority observed in the original:
 * check > premove > promotion > capture > castle > opponent's move > own move.
 */
export function soundForMove(
  move: { check: boolean; isPremove: boolean; flags: MoveFlags; color: Color },
  playingAs: Color | null,
): SoundName {
  if (move.check) return 'move-check';
  if (move.isPremove) return 'premove';
  if (move.flags.promotion) return 'promote';
  if (move.flags.capture) return 'capture';
  if (move.flags.kingsideCastle || move.flags.queensideCastle) return 'castle';
  return playingAs && playingAs !== move.color ? 'move-opponent' : 'move-self';
}

export function createSoundPlayer(source: SoundSource): SoundPlayer | null {
  if (source === false) return null;
  if (source === 'synth') return new SynthPlayer();
  if (typeof (source as SoundPlayer).play === 'function') return source as SoundPlayer;
  return new UrlPlayer(source as Partial<Record<SoundName, string | string[]>>);
}
