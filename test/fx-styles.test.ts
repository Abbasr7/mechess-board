// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { piecesBySquare, setup, type Harness } from './helpers';

let h: Harness;
let now = 1000;

/** Advance the mocked clock and run animation frames until `ms` have passed. */
const advance = (ms: number, step = 16): void => {
  const end = now + ms;
  while (now < end) {
    now = Math.min(now + step, end);
    h.frames();
  }
};

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => h?.destroy());

const el = (sq: string): HTMLElement => h.board.el.querySelector(`.piece.square-${sq.charCodeAt(0) - 96}${sq[1]}`) as HTMLElement;
const num = (re: RegExp, s: string): number => Number(re.exec(s)?.[1]);

describe('natural style', () => {
  it('lifts a picked-up piece: 1.1× larger with a shadow, tilting with horizontal speed', () => {
    h = setup({ animationType: 'natural' });
    h.down('e2');
    advance(32);
    const piece = h.board.el.querySelector('.piece.dragging') as HTMLElement;
    expect(piece.style.transform).toMatch(/scale\(1\.1\)/);
    expect(piece.style.filter).toContain('drop-shadow');
    // drag to the right in steps
    let x = h.pt('e2').x;
    for (let i = 0; i < 10; i++) {
      x += 25;
      h.moveTo({ x, y: h.pt('e2').y });
      advance(16);
    }
    const angle = num(/rotate\((-?[\d.]+)deg\)/, piece.style.transform);
    expect(angle).toBeGreaterThan(1);
    expect(angle).toBeLessThanOrEqual(10);
    // stop: the tilt relaxes towards 0
    advance(600);
    expect(Math.abs(num(/rotate\((-?[\d.]+)deg\)/, piece.style.transform))).toBeLessThan(angle);
  });

  it('drag-drop: 20 ms drop, then a ripple on the landing square that fades over a second', () => {
    h = setup({ animationType: 'natural', playingAs: null });
    h.drag('e2', 'e4');
    advance(10);
    expect(h.board.getFen()).toContain('4P3');
    advance(40);
    const landed = el('e4');
    expect(landed.style.transform).toBe(''); // back on its CSS square
    const ripple = h.board.el.querySelector('.fx-ripple') as HTMLElement;
    expect(ripple).toBeTruthy();
    expect(ripple.className).toContain('square-54');
    const circle = ripple.firstElementChild as HTMLElement;
    expect(Number(circle.style.opacity)).toBeGreaterThan(0);
    advance(1100);
    expect(h.board.el.querySelector('.fx-ripple')).toBeNull();
  });

  it('API move: 300 ms timeline with a trail, scale pulse and shadow; piece ends clean', () => {
    h = setup({ animationType: 'natural', playingAs: null });
    h.board.move('g1f3', { animate: true });
    const piece = el('f3');
    advance(40);
    expect(h.board.el.querySelector('.fx-trail')).toBeTruthy();
    // 30 % of 300 ms ≈ 90 ms: scale peaks at 1.1 with the shadow at full strength
    advance(60);
    const mid = num(/scale\(([\d.]+)\)/, piece.style.transform);
    expect(mid).toBeGreaterThan(1.05);
    expect(piece.style.filter).toContain('drop-shadow');
    advance(300);
    expect(piece.style.transform).toBe('');
    expect(piece.style.filter).toBe('');
    expect(h.board.el.querySelector('.fx-trail')).toBeNull();
  });

  it('captures: the captured piece waits 0.3×duration, then shrinks away over 150 ms', () => {
    h = setup({ animationType: 'natural', playingAs: null });
    h.board.load('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
    h.board.move('e4d5', { animate: true });
    expect(h.board.el.querySelectorAll('.piece.bp').length).toBe(1); // still around
    advance(60);
    expect(h.board.el.querySelectorAll('.piece.bp').length).toBe(1); // within the 90 ms delay
    advance(300);
    expect(h.board.el.querySelectorAll('.piece.bp').length).toBe(0);
  });

  it('castling: the rook hops over an arc (extra y offset at 30 %)', () => {
    h = setup({ animationType: 'natural', playingAs: null });
    h.board.load('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    h.board.move('e1g1', { animate: true });
    const rook = el('f1');
    advance(95); // ≈ 30 %
    const y = num(/translate\([-\d.]+%, (-?[\d.]+)%\)/, rook.style.transform);
    expect(y).toBeLessThan(700 - 20); // lifted above the 1st rank (rank 1 is y = 700 %)
    advance(400);
    expect(rook.style.transform).toBe('');
  });

  it('a check pulses the king and flashes its square red; checkmate keeps the flash', () => {
    h = setup({ animationType: 'natural', playingAs: null });
    h.board.load('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2');
    h.board.move('d8h4', { animate: true });
    advance(450);
    const flash = h.board.el.querySelector('.fx-check-square') as HTMLElement;
    expect(flash).toBeTruthy();
    expect(flash.className).toContain('square-51'); // the white king on e1
    advance(1500);
    expect(h.board.el.querySelector('.fx-check-square')).toBeTruthy(); // mate: flash stays
  });

  it('an illegal drop while in check pulses the king instead of blinking', () => {
    h = setup({ animationType: 'natural' });
    h.board.load('4r1k1/8/8/8/8/8/P7/4K3 w - - 0 1');
    h.drag('a2', 'a5');
    advance(120);
    // natural: the king's square flashes red (no 3-blink highlight, no scale pulse on the king)
    const flash = h.board.el.querySelector('.fx-check-square') as HTMLElement;
    expect(flash.className).toContain('square-51');
    expect(h.board.el.querySelectorAll('.highlight[style*="255, 0, 0"]').length).toBe(0);
    expect(el('e1').style.transform).toBe('');
  });

  it('hover outlines a piece for 50 ms in/out', () => {
    h = setup({ animationType: 'natural' });
    const board = h.board.el;
    const move = (sq: string): void => {
      const p = h.pt(sq);
      board.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: p.x, clientY: p.y, buttons: 0 }));
    };
    move('e2');
    advance(60);
    const over = board.querySelector('.fx-piece-over') as HTMLElement;
    expect(over).toBeTruthy();
    expect(over.className).toContain('square-52');
    expect(Number(over.style.opacity)).toBeGreaterThan(0.95);
    move('e5'); // empty square → out
    advance(80);
    expect(board.querySelector('.fx-piece-over')).toBeNull();
  });

  it('hints pop in (0 → 1) in 80 ms', () => {
    h = setup({ animationType: 'natural' });
    h.click('g1');
    const hint = h.board.el.querySelector('.hint') as HTMLElement;
    expect(hint).toBeTruthy();
    advance(16);
    expect(Number(hint.style.getPropertyValue('--s'))).toBeLessThan(1);
    expect(hint.style.transform).toBe(''); // never overwrites the square's own translate
    advance(200);
    expect(hint.style.getPropertyValue('--s')).toBe('');
  });

  for (const type of ['natural', 'arcade'] as const) {
    it(`${type}: hovering a hint scales it in place - the square translate survives`, () => {
      h = setup({ animationType: type });
      h.click('g1');
      advance(400);
      const hint = h.board.el.querySelector('.hint') as HTMLElement;
      const cls = [...hint.classList].find((c) => /^square-\d\d$/.test(c))!;
      const sq = `${'abcdefgh'[Number(cls[7]) - 1]}${cls[8]}`;
      const board = h.board.el;
      const p = h.pt(sq);
      board.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: p.x, clientY: p.y, buttons: 0 }));
      advance(300);
      expect(Number(hint.style.getPropertyValue('--s'))).toBeGreaterThan(1.4);
      expect(hint.style.transform).toBe('');
      expect([...hint.classList]).toContain(cls);
      board.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
      advance(400);
      expect(Number(hint.style.getPropertyValue('--s') || 1)).toBeCloseTo(1, 2);
    });
  }

  it('the square classes carry the --s hook that makes this work', () => {
    h = setup({ animationType: 'natural' });
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(css).toContain('.square-11{transform:translate(0%,700%) scale(var(--s,1))}');
  });
});

describe('arcade style', () => {
  it('pulses a held piece (1 → 1.1 → 1 every 500 ms) with a grab ring and accent colours', () => {
    h = setup({ animationType: 'arcade' });
    h.down('e2');
    advance(16);
    expect(h.board.el.querySelector('.piece.dragging')!.getAttribute('style')).toContain('drop-shadow');
    advance(240);
    const mid = num(/scale\(([\d.]+)\)/, (h.board.el.querySelector('.piece.dragging') as HTMLElement).style.transform);
    expect(mid).toBeGreaterThan(1.05);
    advance(260);
    const end = num(/scale\(([\d.]+)\)/, (h.board.el.querySelector('.piece.dragging') as HTMLElement).style.transform);
    expect(end).toBeLessThan(1.05);
  });

  it('draws the last move as accent-coloured outlines (cyan for white, red for black)', () => {
    h = setup({ animationType: 'arcade', playingAs: null });
    h.drag('e2', 'e4');
    advance(600);
    const hl = [...h.board.el.querySelectorAll('.highlight')] as HTMLElement[];
    expect(hl.length).toBe(2);
    expect(hl.every((e) => e.style.border.includes('rgb(56, 220, 255)'))).toBe(true);
    h.drag('e7', 'e5');
    advance(600);
    const hl2 = [...h.board.el.querySelectorAll('.highlight')] as HTMLElement[];
    expect(hl2.some((e) => e.style.border.includes('rgb(255, 82, 82)'))).toBe(true);
  });

  it('moves take 400 ms with a thinner trail', () => {
    h = setup({ animationType: 'arcade', playingAs: null });
    h.board.move('g1f3', { animate: true });
    advance(100);
    const trail = h.board.el.querySelector('.fx-trail') as HTMLElement;
    expect(trail).toBeTruthy();
    // trail height = 0.55 of a square (board is 800 px → 100 px squares)
    expect(trail.style.height).toBe('55px');
    advance(300);
    expect(el('f3').style.transform).not.toBe('');
    advance(200);
    expect(el('f3').style.transform).toBe('');
  });

  it('a check shows a red ring around the king', () => {
    h = setup({ animationType: 'arcade', playingAs: null });
    h.board.load('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2');
    h.board.move('d8h4', { animate: true });
    advance(500);
    expect(h.board.el.querySelector('.fx-king-check')).toBeTruthy();
  });

  it('keeps the position consistent after fancy animations', () => {
    h = setup({ animationType: 'arcade', playingAs: null });
    h.drag('e2', 'e4');
    h.board.move('e5', { animate: true });
    advance(800);
    expect(piecesBySquare(h).e4).toBe('wp');
    expect(piecesBySquare(h).e5).toBe('bp');
    expect(Object.keys(piecesBySquare(h)).length).toBe(32);
    expect([...h.board.el.querySelectorAll('.piece')].every((e) => (e as HTMLElement).style.transform === '')).toBe(true);
  });
});
