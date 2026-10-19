// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { defineChessBoardElement, ReChessBoardElement } from '../src/element';

defineChessBoardElement();

let el: ReChessBoardElement;
afterEach(() => el?.remove());

const make = (attrs: Record<string, string> = {}): ReChessBoardElement => {
  el = document.createElement('re-chess-board') as ReChessBoardElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
};

describe('<re-chess-board>', () => {
  it('creates the board when connected and announces it', () => {
    el = document.createElement('re-chess-board') as ReChessBoardElement;
    let ready = false;
    el.addEventListener('board-ready', () => (ready = true));
    document.body.appendChild(el);
    expect(ready).toBe(true);
    expect(el.board).toBeTruthy();
    expect(el.style.display).toBe('block');
    expect(el.querySelectorAll('.piece').length).toBe(32);
  });

  it('reads its initial options from attributes', () => {
    make({ fen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1', 'playing-as': 'b', flipped: '', animation: 'none', coordinates: 'off' });
    const o = el.board!.getOptions();
    expect(o.playingAs).toBe('b');
    expect(o.flipped).toBe(true);
    expect(o.animationType).toBe('none');
    expect(o.coordinates).toBe('off');
    expect(el.board!.getFen()).toBe('4k3/8/8/8/8/8/8/4K3 b - - 0 1');
    expect(el.querySelectorAll('.piece').length).toBe(2);
  });

  it('"both" means hot-seat', () => {
    make({ 'playing-as': 'both' });
    expect(el.board!.getOptions().playingAs).toBeNull();
  });

  it('follows attribute changes; a removed attribute restores the default', () => {
    make({ flipped: '', 'playing-as': 'b', 'board-style': 'brown', animation: 'dynamic', premoves: 'false' });
    el.removeAttribute('flipped');
    expect(el.board!.getOptions().flipped).toBe(false);
    el.removeAttribute('playing-as');
    expect(el.board!.getOptions().playingAs).toBe('w');
    el.removeAttribute('board-style');
    expect(el.board!.getOptions().boardStyle).toBe('green');
    el.removeAttribute('animation');
    expect(el.board!.getOptions().animationType).toBe('default');
    el.removeAttribute('premoves');
    expect(el.board!.getOptions().premoves).toBe(true);
    el.setAttribute('animation', 'arcade');
    expect(el.board!.getOptions().animationType).toBe('arcade');
  });

  it('loads a new position when `fen` changes', () => {
    make();
    el.setAttribute('fen', '4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(el.querySelectorAll('.piece').length).toBe(2);
  });

  it('destroys the board when removed and recreates it when re-attached', () => {
    make();
    const first = el.board!;
    el.remove();
    expect(el.board).toBeNull();
    expect(el.querySelector('.board')).toBeNull();
    document.body.appendChild(el);
    expect(el.board).toBeTruthy();
    expect(el.board).not.toBe(first);
  });
});
