// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { piecesBySquare, setup, type Harness } from './helpers';

let h: Harness;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  h?.destroy();
  vi.useRealTimers();
});

const vfx = (type: string): HTMLElement[] => [...h.board.el.querySelectorAll(`.vfx-${type}`)] as HTMLElement[];
const sqOf = (el: HTMLElement): string => {
  const m = /square-([1-8])([1-8])/.exec(el.className)!;
  return 'abcdefgh'[Number(m[1]) - 1] + m[2];
};

describe('dynamic animation type adds effects', () => {
  it('a landed piece gets a growing circle (white on dark squares, black on light ones)', () => {
    h = setup({ animationType: 'dynamic', playingAs: null });
    h.board.move('e4', { animate: true }); // e4 is a light square
    const c = vfx('growing-circle')[0];
    expect(sqOf(c)).toBe('e4');
    expect((c.firstElementChild as HTMLElement).style.getPropertyValue('--growing-circle-color')).toBe('#000000');
    h.board.move('e5', { animate: true }); // e5 is a dark square
    const c2 = vfx('growing-circle')[0];
    expect((c2.firstElementChild as HTMLElement).style.getPropertyValue('--growing-circle-color')).toBe('#fff');
    expect((c2.firstElementChild as HTMLElement).style.getPropertyValue('--growing-circle-initial-opacity')).toBe('0.25');
  });

  it('a trail follows animated moves, but not a dragged-and-dropped piece', () => {
    h = setup({ animationType: 'dynamic', playingAs: null });
    h.drag('e2', 'e4');
    expect(vfx('piece-trail').length).toBe(0);
    h.board.move('e5', { animate: true });
    const t = vfx('piece-trail')[0];
    expect(sqOf(t)).toBe('e7'); // starts on the origin square
    const seg = t.querySelector('.trail-segment') as HTMLElement;
    expect(seg.style.getPropertyValue('--trail-width')).toBe('200%'); // two squares long
    expect(seg.style.background).toContain('linear-gradient');
  });

  it('castling draws two trails', () => {
    h = setup({ animationType: 'dynamic', playingAs: null });
    h.board.load('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    h.board.move('e1g1', { animate: true });
    expect(vfx('piece-trail').map(sqOf).sort()).toEqual(['e1', 'h1']);
    expect(vfx('growing-circle').map(sqOf).sort()).toEqual(['f1', 'g1']);
  });

  it('a capture leaves a ghost of the captured piece that grows and fades', () => {
    h = setup({ animationType: 'dynamic', playingAs: null });
    h.board.load('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
    h.board.move('e4d5', { animate: true });
    const g = vfx('piece-capture')[0];
    expect(sqOf(g)).toBe('d5');
    expect(g.querySelector('.element')!.className).toContain('bp');
    vi.advanceTimersByTime(600);
    expect(vfx('piece-capture').length).toBe(0); // removed after the fade
  });

  it('a king in check: the square pops red and the king wiggles after the move landed; not on mate', () => {
    h = setup({ animationType: 'dynamic', playingAs: null });
    h.board.load('4k3/8/8/8/8/8/3r4/4K3 b - - 0 1');
    h.board.move('d2e2', { animate: true });
    expect(vfx('king-check-square').length).toBe(0); // waits for the 180 ms move
    vi.advanceTimersByTime(200);
    expect(sqOf(vfx('king-check-square')[0])).toBe('e1');
    const kc = vfx('king-check')[0];
    expect(sqOf(kc)).toBe('e1');
    // the real king is hidden while its effect copy performs
    expect(h.board.el.querySelector('.piece.wk.piece-hidden')).toBeTruthy();
    // after the effect ends the king is shown again
    vi.advanceTimersByTime(2000);
    expect(h.board.el.querySelector('.piece.wk.piece-hidden')).toBeNull();
  });

  it('checkmate: no check effect', () => {
    h = setup({ animationType: 'dynamic', playingAs: null });
    h.board.load('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2');
    h.board.move('d8h4', { animate: true });
    vi.advanceTimersByTime(500);
    expect(vfx('king-check-square').length).toBe(0);
    expect(vfx('king-check').length).toBe(0);
  });

  it('promotion: piece pop and ripple on the promotion square', () => {
    h = setup({ animationType: 'dynamic', playingAs: null });
    h.board.load('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
    h.board.move('e7e8q', { animate: true });
    expect(sqOf(vfx('piece-promote')[0])).toBe('e8');
    expect(vfx('piece-promote')[0].querySelector('.element')!.className).toContain('wq');
    expect(vfx('promote-ripple')[0].querySelectorAll('.circle').length).toBe(2);
  });

  it('a user-chosen promotion waits 230 ms (the promotion window is closing)', () => {
    h = setup({ animationType: 'dynamic', playingAs: null });
    h.board.load('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
    h.drag('e7', 'e8');
    (h.board.el.querySelector('.promotion-piece.wq') as HTMLElement).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(vfx('piece-promote').length).toBe(0);
    vi.advanceTimersByTime(250);
    expect(vfx('piece-promote').length).toBe(1);
  });

  it('a rejected move taps the target square', () => {
    h = setup({ animationType: 'dynamic' });
    h.drag('e2', 'e5');
    expect(sqOf(vfx('illegal-move-tap')[0])).toBe('e5');
  });

  it('every position change clears running effects first', () => {
    h = setup({ animationType: 'dynamic', playingAs: null });
    h.board.move('e4', { animate: true });
    expect(h.board.vfx.count()).toBeGreaterThan(0);
    h.board.load();
    expect(h.board.vfx.count()).toBe(0);
  });

  it('no effects with the default animation type, unless `vfx` is switched on', () => {
    h = setup({ playingAs: null });
    h.board.move('e4', { animate: true });
    expect(h.board.vfx.count()).toBe(0);
    h.board.setOptions({ vfx: true });
    h.board.move('e5', { animate: true });
    expect(vfx('growing-circle').length).toBe(1);
  });
});

describe('effect manager API', () => {
  it('adds, updates and removes effects; hides the real piece while one stands in for it', () => {
    h = setup();
    const k = h.board.vfx.add({ type: 'piece-throw', square: 'e2', data: { piece: 'wp', throwDuration: 300 } });
    expect(vfx('piece-throw').length).toBe(1);
    expect(h.board.el.querySelector('.piece.wp.piece-hidden')).toBeTruthy();
    const el = vfx('piece-throw')[0].querySelector('.element') as HTMLElement;
    expect(el.classList.contains('piece-throw-and-spin')).toBe(true);
    expect(el.style.getPropertyValue('--throw-duration')).toBe('300ms');
    vi.advanceTimersByTime(400);
    expect(h.board.vfx.has(k)).toBe(false);
    expect(h.board.el.querySelector('.piece.piece-hidden')).toBeNull(); // piece reset
  });

  it('piece-jump randomises wiggle/fall and honours fallen pieces; update re-rolls', () => {
    h = setup();
    const k = h.board.vfx.add({ type: 'piece-jump', square: 'a1', data: { piece: 'wr' } });
    const el = vfx('piece-jump')[0].querySelector('.element') as HTMLElement;
    expect(el.className).toMatch(/piece-jump-and-(wiggle|fall-over)/);
    expect(el.style.getPropertyValue('--jump-y')).toMatch(/^-\d/);
    // corner pieces start later than centre pieces
    const corner = Number.parseFloat(el.style.getPropertyValue('--initial-delay'));
    h.board.vfx.add({ type: 'piece-jump', square: 'e4', data: { piece: 'wp' } });
    const centre = Number.parseFloat((vfx('piece-jump')[1].querySelector('.element') as HTMLElement).style.getPropertyValue('--initial-delay'));
    expect(corner).toBeGreaterThan(centre);
    h.board.vfx.update(k);
    expect(el.className).toMatch(/piece-jump-and-(wiggle|fall-over)|fallen-piece-jump/);
  });

  it('piece-flip hides the piece, flips cw or ccw and reports completion', () => {
    h = setup();
    const done = vi.fn();
    h.board.vfx.add({ type: 'piece-flip', square: 'e2', data: { piece: 'wp', onFlipComplete: done } });
    const wrap = vfx('piece-flip')[0];
    expect(wrap.classList.contains('flip-cw') || wrap.classList.contains('flip-ccw')).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(done).toHaveBeenCalledOnce();
    expect(vfx('piece-flip').length).toBe(0);
  });

  it('charge-jump compresses, then jumps when updated with phase "jump"', () => {
    h = setup();
    const k = h.board.vfx.add({ type: 'charge-jump', square: 'e7', data: { piece: 'bp' } });
    h.board.vfx.update(k, { phase: 'jump' });
    const el = vfx('charge-jump')[0].querySelector('.element') as HTMLElement;
    expect(el.classList.contains('jumping')).toBe(true);
    expect(vfx('charge-jump')[0].style.getPropertyValue('--jump-height')).toMatch(/^-\d/);
  });

  it('hand-throw shows an image with the three timing variables', () => {
    h = setup();
    h.board.vfx.add({ type: 'hand-throw', square: 'e4', data: { url: '/hand.png', throwScaleX: 2 } });
    const img = vfx('hand-throw')[0].querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/hand.png');
    expect(img.style.getPropertyValue('--hand-throw-throw-scale-x')).toBe('2');
    expect(img.style.getPropertyValue('--hand-throw-appear-duration')).toBe('150ms');
  });

  it('removeByPredicate / removeAll / duration', () => {
    h = setup();
    h.board.vfx.add({ type: 'illegal-move-tap', square: 'a3' });
    h.board.vfx.add({ type: 'growing-circle', square: 'a4', duration: 100, data: { color: '#000', initialOpacity: 0.1 } });
    h.board.vfx.add({ type: 'growing-circle', square: 'a5', data: { color: '#000', initialOpacity: 0.1 } });
    expect(h.board.vfx.count()).toBe(3);
    vi.advanceTimersByTime(150);
    expect(h.board.vfx.count()).toBe(2);
    h.board.vfx.removeByPredicate((e) => e.type === 'illegal-move-tap');
    expect(h.board.vfx.count()).toBe(1);
    h.board.vfx.removeAll();
    expect(h.board.vfx.count()).toBe(0);
    expect(Object.keys(piecesBySquare(h)).length).toBe(32);
  });
});
