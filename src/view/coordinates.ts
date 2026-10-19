/**
 * Coordinate labels, drawn as one SVG in a 100×100 viewBox.
 *
 *  - `inside`      rank numbers in the left column and file letters on the bottom row,
 *                  coloured with the opposite square colour;
 *  - `outside`     grey labels hanging half outside the board edge (leave a margin
 *                  around the board for them);
 *  - `each_square` a faint "e4"-style label on every square.
 */
import type { CoordinatesPosition } from '../types';
import type { Layers } from './layers';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

interface Label {
  text: string;
  x: number;
  y: number;
  size: number;
  cls: string;
  anchor?: 'start' | 'middle' | 'end';
}

/** y positions of the rank labels, copied from the original layout (a hair under 12.5 apart). */
const RANK_Y = [3.5, 15.75, 28.25, 40.75, 53.25, 65.75, 78.25, 90.75];

function insideLabels(flipped: boolean): Label[] {
  const ranks = flipped ? RANKS : [...RANKS].reverse();
  const files = flipped ? [...FILES].reverse() : FILES;
  const out: Label[] = [];
  // 180° rotation preserves the colour pattern, so the classes do not depend on orientation:
  // the top-left square is always light, the bottom-left one always dark.
  ranks.forEach((r, i) => out.push({ text: r, x: 0.75, y: RANK_Y[i], size: 2.8, cls: i % 2 === 0 ? 'light' : 'dark' }));
  files.forEach((f, i) => out.push({ text: f, x: 10 + i * 12.5, y: 99, size: 2.8, cls: i % 2 === 0 ? 'dark' : 'light' }));
  return out;
}

function outsideLabels(flipped: boolean): Label[] {
  const ranks = flipped ? RANKS : [...RANKS].reverse();
  const files = flipped ? [...FILES].reverse() : FILES;
  const out: Label[] = [];
  ranks.forEach((r, i) => out.push({ text: r, x: -1.8, y: 6.25 + i * 12.5 + 1, size: 3.1, cls: 'grey', anchor: 'middle' }));
  files.forEach((f, i) => out.push({ text: f, x: 6.25 + i * 12.5, y: 103.6, size: 3.1, cls: 'grey', anchor: 'middle' }));
  return out;
}

function eachSquareLabels(flipped: boolean): Label[] {
  const files = flipped ? [...FILES].reverse() : FILES;
  const ranks = flipped ? RANKS : [...RANKS].reverse();
  const out: Label[] = [];
  ranks.forEach((r, row) =>
    files.forEach((f, col) =>
      out.push({
        text: `${f}${r}`,
        x: 12.5 * 0.94 + 12.5 * col,
        y: 12.5 * 0.92 + 12.5 * row,
        size: 2.8,
        cls: (row + col) % 2 === 0 ? 'light' : 'dark',
        anchor: 'end',
      }),
    ),
  );
  return out;
}

export class Coordinates {
  private svg: SVGSVGElement | null = null;

  constructor(private layers: Layers, private doc: Document) {}

  set(position: CoordinatesPosition, flipped: boolean): void {
    this.svg?.remove();
    this.svg = null;
    if (position === 'off') return;
    const svg = this.doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('coordinates');
    if (position === 'outside') svg.classList.add('outside');
    if (position === 'each_square') svg.classList.add('each-square');
    const labels = position === 'outside' ? outsideLabels(flipped) : position === 'each_square' ? eachSquareLabels(flipped) : insideLabels(flipped);
    for (const l of labels) {
      const t = this.doc.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', String(l.x));
      t.setAttribute('y', String(l.y));
      t.setAttribute('font-size', String(l.size));
      if (l.anchor) t.setAttribute('text-anchor', l.anchor);
      t.setAttribute('class', `coordinate-${l.cls}`);
      t.textContent = l.text;
      svg.appendChild(t);
    }
    this.layers.add(svg, 'coordinates');
    this.svg = svg;
  }
}
