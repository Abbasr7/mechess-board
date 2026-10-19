// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setup, type Harness } from './helpers';

let h: Harness;
afterEach(() => {
  vi.useRealTimers();
  h?.destroy();
});

const items = (): HTMLElement[] => [...h.board.el.querySelectorAll('.custom-item')] as HTMLElement[];
const sqClass = (el: Element): string => [...el.classList].find((c) => /^square-\d\d$/.test(c))!;
const anim = (el: Element, animationName: string): void => {
  el.dispatchEvent(Object.assign(new Event('animationend', { bubbles: true }), { animationName }));
};
const order = (): string[] =>
  [...h.board.el.childNodes].map((n) => (n.nodeType === 8 ? `#${(n as Comment).data}` : (n as HTMLElement).classList.contains('custom-item') ? 'item' : ''));

describe('custom items', () => {
  it('pins a star to a square (default type)', () => {
    h = setup();
    h.board.customItems.add({ square: 'e4', color: '#ff0000', opacity: 0.5 });
    const [el] = items();
    expect(sqClass(el)).toBe('square-54');
    const star = el.querySelector('polygon')!;
    expect(star.getAttribute('fill')).toBe('#ff0000');
    expect(star.getAttribute('points')!.split(' ').length).toBe(10);
    expect((el.querySelector('svg') as unknown as HTMLElement).style.opacity).toBe('0.5');
    expect(h.board.customItems.get('e4')?.type).toBeUndefined();
  });

  it('shows an image sized as a percentage of the square', () => {
    h = setup();
    h.board.customItems.add({ square: 'a1', type: 'Image', image: { url: '/x.png', percentOfSquare: 60 } });
    const img = items()[0].querySelector('image')!;
    expect(img.getAttribute('href')).toBe('/x.png');
    expect(img.getAttribute('width')).toBe('60');
    expect(img.getAttribute('x')).toBe('20');
  });

  it('shows a text box without interpreting markup', () => {
    h = setup();
    h.board.customItems.add({ square: 'a1', type: 'TextBox', text: { value: '<b>+3</b>', color: '#123456' }, color: '#eeeeee' });
    const t = items()[0].querySelector('text')!;
    expect(t.textContent).toBe('<b>+3</b>');
    expect(t.getAttribute('fill')).toBe('#123456');
    expect(items()[0].querySelector('b')).toBeNull();
    expect(items()[0].querySelector('rect')!.getAttribute('fill')).toBe('#eeeeee');
  });

  it('keeps one item per square', () => {
    h = setup();
    h.board.customItems.add({ square: 'e4' });
    h.board.customItems.add({ square: 'e4', type: 'TextBox', text: { value: 'x' } });
    expect(items().length).toBe(1);
    expect(items()[0].querySelector('text')).toBeTruthy();
  });

  it('sits above the pieces by default and can be ordered around other layers', () => {
    h = setup();
    h.board.customItems.add({ square: 'a1' });
    let o = order();
    expect(o.indexOf('item')).toBeGreaterThan(o.indexOf('#/pieces') - 1);
    expect(o.indexOf('item')).toBeLessThan(o.indexOf('#/vfx-above'));
    h.board.customItems.add({ square: 'a2', visualOrder: { target: 'pieces', position: 'below' } });
    o = order();
    const firstItem = o.indexOf('item');
    expect(firstItem).toBeLessThan(o.indexOf('#/pieces')); // under the pieces …
    expect(firstItem).toBeGreaterThan(o.indexOf('#/effects')); // … but over the effect badges
    h.board.customItems.add({ square: 'a3', visualOrder: { target: 'arrows', position: 'above' } });
    o = order();
    expect(o.lastIndexOf('item')).toBeGreaterThan(o.indexOf('#/arrows'));
    h.board.customItems.add({ square: 'a4', visualOrder: { target: 'pieces', position: 'above' } });
    o = order();
    const idx = [...h.board.el.childNodes].findIndex((n) => (n as HTMLElement).classList?.contains('square-14'));
    expect(idx).toBeLessThan(o.indexOf('#/pieces')); // end of the pieces layer, before its marker
    expect(idx).toBeGreaterThan(o.indexOf('#/vfx-below'));
  });

  it('plays a creation animation and drops its class when the animation ends', () => {
    h = setup();
    h.board.customItems.add({ square: 'e4', creationAnimation: 'grow-in' });
    const el = items()[0];
    expect(el.classList.contains('basic-item-animation-grow-in')).toBe(true);
    anim(el, 'something-else');
    expect(el.classList.contains('basic-item-animation-grow-in')).toBe(true);
    anim(el, 'reboard-ci-grow-in');
    expect(el.classList.contains('basic-item-animation-grow-in')).toBe(false);
  });

  it('removal plays the leave animation first, then detaches after the timeout', () => {
    vi.useFakeTimers();
    h = setup();
    h.board.customItems.add({ square: 'e4' });
    h.board.customItems.remove('e4');
    const el = items()[0];
    expect(el.classList.contains('basic-item-animation-captured')).toBe(true);
    vi.advanceTimersByTime(399);
    expect(items().length).toBe(1);
    vi.advanceTimersByTime(5);
    expect(items().length).toBe(0);
    expect(h.board.customItems.get('e4')).toBeUndefined();
  });

  it('removalClass / removalTimeout are respected', () => {
    vi.useFakeTimers();
    h = setup();
    h.board.customItems.add({ square: 'e4', removalClass: 'my-exit', removalTimeout: 50 });
    h.board.customItems.remove('e4');
    expect(items()[0].classList.contains('my-exit')).toBe(true);
    vi.advanceTimersByTime(60);
    expect(items().length).toBe(0);
  });

  it('plays a removal sound through the board', () => {
    vi.useFakeTimers();
    h = setup();
    const sounds: string[] = [];
    h.board.on('sound', (s) => sounds.push(s));
    h.board.customItems.add({ square: 'e4', removalSound: 'capture' });
    h.board.customItems.remove('e4');
    expect(sounds).toEqual(['capture']);
  });

  it('adding over a square that is mid-removal replaces it at once', () => {
    vi.useFakeTimers();
    h = setup();
    h.board.customItems.add({ square: 'e4' });
    h.board.customItems.remove('e4');
    h.board.customItems.add({ square: 'e4', color: '#00ff00' });
    expect(items().length).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(items().length).toBe(1);
    expect(items()[0].querySelector('polygon')!.getAttribute('fill')).toBe('#00ff00');
  });

  it('clear / destroy remove everything', () => {
    vi.useFakeTimers();
    h = setup();
    h.board.customItems.addAll([{ square: 'a1' }, { square: 'a2' }, { square: 'a3' }]);
    h.board.customItems.remove('a1');
    h.board.customItems.clear();
    expect(items().length).toBe(0);
    vi.advanceTimersByTime(1000); // pending removal timer does not blow up
    expect(h.board.customItems.all()).toEqual([]);
  });

  it('follows the board when flipped (class based positioning)', () => {
    h = setup();
    h.board.customItems.add({ square: 'a1' });
    const el = items()[0];
    expect(sqClass(el)).toBe('square-11');
    h.board.setOptions({ flipped: true });
    expect(sqClass(items()[0])).toBe('square-11'); // same class; the flipped stylesheet re-maps it
  });
});

describe('custom item frames', () => {
  it('shows one cell of a sprite sheet', () => {
    h = setup();
    h.board.customItems.add({
      square: 'c3',
      frame: { imageURL: '/sheet.png', positionRatioX: 0.5, positionRatioY: 0, widthRatio: 0.5, heightRatio: 1 },
    });
    const el = items()[0];
    expect(el.classList.contains('custom-item__frame')).toBe(true);
    const cell = el.querySelector('div') as HTMLElement;
    expect(cell.style.backgroundImage).toContain('/sheet.png');
    expect(cell.style.backgroundSize).toBe('200% 100%');
    expect(cell.style.backgroundPositionX).toBe('100%');
    expect(cell.style.backgroundPositionY).toBe('0%');
  });

  it('a single-image frame needs no position maths', () => {
    h = setup();
    h.board.customItems.add({ square: 'c3', frame: { imageURL: '/one.png', positionRatioX: 0, positionRatioY: 0, widthRatio: 1, heightRatio: 1 } });
    const cell = items()[0].querySelector('div') as HTMLElement;
    expect(cell.style.backgroundPositionX).toBe('0%');
    expect(cell.style.backgroundSize).toBe('100% 100%');
  });

  it('an animated strip is marked as such', () => {
    h = setup();
    h.board.customItems.add({
      square: 'c3',
      frame: { imageURL: '/strip.png', imageAnimated: true, positionRatioX: 0, positionRatioY: 0, widthRatio: 0.25, heightRatio: 1 },
    });
    expect(items()[0].classList.contains('custom-item__frame--animated')).toBe(true);
    expect((items()[0].querySelector('div') as HTMLElement).style.backgroundSize).toBe('auto 100%');
  });

  it('removing an animated strip whose image cannot load detaches it right away', () => {
    h = setup();
    const imgs: Array<{ onerror?: () => void; onload?: () => void; src?: string }> = [];
    vi.stubGlobal(
      'Image',
      class {
        onerror?: () => void;
        onload?: () => void;
        src = '';
        constructor() {
          imgs.push(this);
        }
      },
    );
    h.board.customItems.add({
      square: 'c3',
      frame: { imageURL: '/missing.png', imageAnimated: true, positionRatioX: 0, positionRatioY: 0, widthRatio: 0.25, heightRatio: 1 },
    });
    h.board.customItems.remove('c3');
    expect(items().length).toBe(1);
    imgs[0].onerror?.();
    expect(items().length).toBe(0);
    vi.unstubAllGlobals();
  });
});
