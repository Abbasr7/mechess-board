// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setup, type Harness } from './helpers';

let h: Harness;
afterEach(() => {
  vi.useRealTimers();
  h?.destroy();
});

const anim = (el: Element, animationName: string): void => {
  el.dispatchEvent(Object.assign(new Event('animationend', { bubbles: true }), { animationName }));
};
const effectEls = (): Element[] => [...h.board.el.querySelectorAll('.effect, .animated-effect')];
const sqClass = (el: Element): string => [...el.classList].find((c) => /^square-\d\d$/.test(c))!;

describe('static effect badges', () => {
  beforeEach(() => {
    h = setup();
  });

  it('draws a coloured disc with a glyph on its square', () => {
    h.board.effects.add({ square: 'e4', type: 'Brilliant' });
    const el = h.board.el.querySelector('.effect') as HTMLElement;
    expect(sqClass(el)).toBe('square-54');
    expect(el.classList.contains('brilliant')).toBe(true);
    expect(el.style.backgroundColor).toBe('rgb(38, 194, 163)');
    expect(el.querySelector('text')!.textContent).toBe('!!');
    expect(h.board.effects.get('e4')?.type).toBe('Brilliant');
  });

  it('keeps one effect per square – a new one replaces the old', () => {
    h.board.effects.add({ square: 'e4', type: 'Mistake' });
    h.board.effects.add({ square: 'e4', type: 'Blunder' });
    expect(effectEls().length).toBe(1);
    expect(effectEls()[0].classList.contains('blunder')).toBe(true);
  });

  it('colours follow the classification', () => {
    const want: Record<string, string> = {
      BestMove: 'rgb(129, 182, 76)',
      Inaccuracy: 'rgb(247, 198, 49)',
      Blunder: 'rgb(250, 65, 45)',
      CheckmateWhite: 'rgb(224, 40, 40)',
      Winner: 'rgb(131, 184, 79)',
    };
    for (const [type, color] of Object.entries(want)) {
      h.board.effects.add({ square: 'a1', type: type as never });
      expect((h.board.el.querySelector('.effect') as HTMLElement).style.backgroundColor).toBe(color);
    }
  });

  it('tucks badges on the top and right edge inwards, and follows a flip', () => {
    h.board.effects.add({ square: 'h8', type: 'Mate' });
    h.board.effects.add({ square: 'a1', type: 'Winner' });
    h.board.effects.add({ square: 'e5', type: 'Good' });
    const byType = (t: string): Element => h.board.el.querySelector(`.effect.${t}`)!;
    expect(byType('mate').classList.contains('tuck-top')).toBe(true);
    expect(byType('mate').classList.contains('tuck-right')).toBe(true);
    expect(byType('winner').classList.contains('tuck-top')).toBe(false);
    expect(byType('good').classList.contains('tuck-top')).toBe(false);
    h.board.setOptions({ flipped: true });
    expect(byType('mate').classList.contains('tuck-top')).toBe(false);
    expect(byType('winner').classList.contains('tuck-top')).toBe(true);
    expect(byType('winner').classList.contains('tuck-right')).toBe(true);
  });

  it('orders badges so a badge overlaps the squares above and to its right', () => {
    h.board.effects.add({ square: 'a1', type: 'Good' });
    h.board.effects.add({ square: 'h8', type: 'Mate' });
    h.board.effects.add({ square: 'e4', type: 'Brilliant' });
    h.board.effects.add({ square: 'a4', type: 'Blunder' });
    const order = effectEls().map((e) => sqClass(e));
    // rank 8 first, then 4 (right to left), then 1
    expect(order).toEqual(['square-88', 'square-54', 'square-14', 'square-11']);
  });

  it('can carry custom text, a custom path and a custom colour', () => {
    h.board.effects.add({ square: 'b2', type: 'Skills', iconText: '+3', backgroundColor: '#112233' });
    h.board.effects.add({ square: 'c3', type: 'Custom', path: 'M2 2 L18 2 L10 18 Z' });
    const els = effectEls() as HTMLElement[];
    const b2 = els.find((e) => sqClass(e) === 'square-22')!;
    expect(b2.querySelector('text')!.textContent).toBe('+3');
    expect(b2.style.backgroundColor).toBe('rgb(17, 34, 51)');
    expect(els.find((e) => sqClass(e) === 'square-33')!.querySelector('path')!.getAttribute('d')).toBe('M2 2 L18 2 L10 18 Z');
  });

  it('never injects markup from text', () => {
    h.board.effects.add({ square: 'b2', type: 'Custom', iconText: '<img src=x onerror=alert(1)>' });
    expect(h.board.el.querySelector('.effect img')).toBeNull();
  });

  it('fadeInEffects adds the fade-in class', () => {
    h.board.setOptions({ fadeInEffects: true });
    h.board.effects.add({ square: 'e4', type: 'Good' });
    expect(effectEls()[0].classList.contains('fade-in')).toBe(true);
  });

  it('remove / clear / destroy take the badges away', () => {
    h.board.effects.addAll([
      { square: 'a1', type: 'Good' },
      { square: 'a2', type: 'Good' },
      { square: 'a3', type: 'Good' },
    ]);
    h.board.effects.remove('a2');
    expect(effectEls().length).toBe(2);
    h.board.effects.clear();
    expect(effectEls().length).toBe(0);
    expect(h.board.effects.all()).toEqual([]);
  });

  it('draws below the pieces layer marker but above the highlights', () => {
    h.board.effects.add({ square: 'e4', type: 'Good' });
    const kids = [...h.board.el.childNodes];
    const at = kids.indexOf(h.board.el.querySelector('.effect')!);
    const comments = kids.map((n) => (n.nodeType === 8 ? (n as Comment).data : ''));
    expect(comments.indexOf('/effects')).toBeGreaterThan(at);
    expect(comments.indexOf('/squares')).toBeLessThan(at);
  });
});

describe('animated effect badges', () => {
  beforeEach(() => {
    h = setup();
  });

  it('builds the flash, glyph, settled badge and label pill', () => {
    h.board.effects.add({ square: 'e4', type: 'Brilliant', animated: true });
    const el = h.board.el.querySelector('.animated-effect') as HTMLElement;
    expect(sqClass(el)).toBe('square-54');
    expect(el.querySelector('.square')).toBeTruthy();
    expect(el.querySelector('svg.icon')).toBeTruthy();
    expect(el.querySelector('.icon-background')).toBeTruthy();
    expect((el.querySelector('.text') as HTMLElement).textContent).toBe('Brilliant!');
    expect(el.style.getPropertyValue('--effect-square')).toBe('100px');
    expect(el.style.getPropertyValue('--effect-badge')).toBe('18.75%');
    expect((el.querySelector('.square') as HTMLElement).style.backgroundColor).toBe('rgba(27, 172, 166, 0.8)');
  });

  it('labels can be overridden per effect and per board', () => {
    h.board.effects.add({ square: 'a1', type: 'Blunder', animated: true, pillText: 'Oops' });
    expect(h.board.el.querySelector('.animated-effect .text')!.textContent).toBe('Oops');
    h.board.setOptions({ effectLabels: { Mistake: 'Fehler' } });
    h.board.effects.add({ square: 'a2', type: 'Mistake', animated: true });
    expect(h.board.el.querySelector('.animated-effect.mistake .text')!.textContent).toBe('Fehler');
    h.board.effects.add({ square: 'a3', type: 'Good', animated: true });
    expect(h.board.el.querySelector('.animated-effect.good .text')!.textContent).toBe('Good'); // type name as the last resort
  });

  it('large badges and tucking set the geometry variables', () => {
    h.board.effects.add({ square: 'h8', type: 'Mate', animated: true, badgeSize: 'large' });
    const el = h.board.el.querySelector('.animated-effect') as HTMLElement;
    expect(el.style.getPropertyValue('--effect-badge')).toBe('24.5%');
    expect(el.classList.contains('tuck-top') && el.classList.contains('tuck-right')).toBe(true);
  });

  it('announces when the animation has settled', () => {
    h.board.effects.add({ square: 'e4', type: 'Brilliant', animated: true });
    const seen: string[] = [];
    h.board.on('effect-animation-end', (e) => seen.push(e.effect.type));
    const el = h.board.el.querySelector('.animated-effect')!;
    anim(el, 'reboard-fx-sq-in'); // other animations of the badge do not count
    expect(seen).toEqual([]);
    anim(el, 'reboard-fx-badge');
    expect(seen).toEqual(['Brilliant']);
    expect(h.board.effects.get('e4')).toBeTruthy(); // it stays as the corner badge
  });

  it('flyOut: after settling, a copy flies to the target and the badge is gone', () => {
    vi.useFakeTimers();
    const events: string[] = [];
    h.board.on('effect-flyout-begin', () => events.push('begin'));
    h.board.on('effect-flyout-end', () => events.push('end'));
    h.board.effects.add({ square: 'e4', type: 'Brilliant', animated: true, flyOut: { target: { x: 900, y: 20 } } });
    const el = h.board.el.querySelector('.animated-effect')!;
    anim(el, 'reboard-fx-badge');
    expect(h.board.el.querySelector('.flying-points')).toBeNull();
    vi.advanceTimersByTime(60);
    const fly = h.board.el.querySelector('.flying-points') as HTMLElement;
    expect(fly).toBeTruthy();
    expect(fly.style.getPropertyValue('--target-x')).toBe('900px');
    expect(fly.style.getPropertyValue('--target-y')).toBe('20px');
    // e4: file 5 → right edge 500px; rank 4 → top 400px; the badge sits 5 % inwards
    expect(fly.style.getPropertyValue('--fly-x')).toBe('495px');
    expect(fly.style.getPropertyValue('--fly-y')).toBe('405px');
    expect(h.board.el.querySelector('.animated-effect')).toBeNull();
    expect(h.board.effects.get('e4')).toBeUndefined();
    expect(events).toEqual(['begin']);
    anim(fly, 'reboard-fx-fly');
    expect(events).toEqual(['begin', 'end']);
    expect(h.board.el.querySelector('.flying-points')).toBeNull();
  });

  it('flyOut from a tucked square starts on the edge', () => {
    vi.useFakeTimers();
    h.board.effects.add({ square: 'h8', type: 'Winner', animated: true, flyOut: { target: { x: 1, y: 2 } } });
    anim(h.board.el.querySelector('.animated-effect')!, 'reboard-fx-badge');
    vi.advanceTimersByTime(60);
    const fly = h.board.el.querySelector('.flying-points') as HTMLElement;
    expect(fly.style.getPropertyValue('--fly-x')).toBe('800px');
    expect(fly.style.getPropertyValue('--fly-y')).toBe('0px');
    expect(fly.classList.contains('tuck-top') && fly.classList.contains('tuck-right')).toBe(true);
  });

  it('replacing the effect before the fly-out cancels it', () => {
    vi.useFakeTimers();
    h.board.effects.add({ square: 'e4', type: 'Brilliant', animated: true, flyOut: { target: { x: 1, y: 2 } } });
    anim(h.board.el.querySelector('.animated-effect')!, 'reboard-fx-badge');
    h.board.effects.add({ square: 'e4', type: 'Blunder' });
    vi.advanceTimersByTime(100);
    expect(h.board.el.querySelector('.flying-points')).toBeNull();
    expect(h.board.effects.get('e4')?.type).toBe('Blunder');
  });
});

describe('fading effects out', () => {
  beforeEach(() => {
    h = setup();
  });

  it('adds fade-out, then removes the badge and reports it', async () => {
    h.board.effects.add({ square: 'e4', type: 'Good' });
    const ended: string[] = [];
    h.board.on('effect-fade-out-end', (e) => ended.push(e.square));
    const p = h.board.effects.fadeOut('e4');
    const el = h.board.el.querySelector('.effect')!;
    expect(el.classList.contains('fade-out')).toBe(true);
    anim(el, 'something-else');
    expect(ended).toEqual([]);
    anim(el, 'reboard-fx-fade-out');
    await p;
    expect(ended).toEqual(['e4']);
    expect(effectEls().length).toBe(0);
  });

  it('still finishes when the browser never fires animationend', async () => {
    vi.useFakeTimers();
    h.board.effects.add({ square: 'e4', type: 'Good' });
    const p = h.board.effects.fadeOut('e4', { scale: true });
    vi.advanceTimersByTime(450);
    await p;
    expect(h.board.effects.get('e4')).toBeUndefined();
  });

  it('scale fade-out grows the settled badge', () => {
    h.board.effects.add({ square: 'e4', type: 'Brilliant', animated: true });
    void h.board.effects.fadeOut('e4', { scale: true });
    expect(h.board.el.querySelector('.icon-background')!.classList.contains('scale-animation')).toBe(true);
  });

  it('rejects when there is nothing to fade out', async () => {
    await expect(h.board.effects.fadeOut('a1')).rejects.toThrow(/doesn't exist/);
  });
});
