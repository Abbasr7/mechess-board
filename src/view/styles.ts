/**
 * Stylesheets.
 *
 * Two layers, like the original:
 *  1. a static base sheet shared by every board on the page (layout, pieces,
 *     squares, hints, promotion window …);
 *  2. a per-board sheet generated from the options (board image, piece
 *     artwork, coordinate colours).
 *
 * Squares are positioned with classes: `.square-FR` (file, rank, 1-based) sets
 * a `transform: translate(…%, …%)` on a one-square-sized absolute element.
 * `.flipped` re-maps the same classes so flipping never moves DOM nodes.
 * Every square class also applies `scale(var(--s, 1))`, so an overlay that
 * pulses (hints, the king-check ring) animates `--s` instead of overwriting
 * the inline `transform` - which would throw it off its square.
 */
import type { Color, PieceType } from '../types';
import type { BoardOptions, PieceSource } from '../options';
import { boardImageUri, resolveTheme } from '../themes';
import { VFX_CSS } from '../vfx/css';
import { EFFECTS_CSS } from './effects';
import { CUSTOM_ITEMS_CSS } from './custom-items';

const BASE_ID = 'reboard-base-styles';

function squareRules(): string {
  const out: string[] = [];
  for (let f = 1; f <= 8; f++) {
    for (let r = 1; r <= 8; r++) {
      const x = (f - 1) * 100;
      const y = (8 - r) * 100;
      out.push(`.square-${f}${r}{transform:translate(${x}%,${y}%) scale(var(--s,1))}`);
      out.push(`.board.flipped .square-${f}${r}{transform:translate(${700 - x}%,${700 - y}%) scale(var(--s,1))}`);
    }
  }
  return out.join('\n');
}

export const BASE_CSS = `
.board{background-repeat:no-repeat;background-size:100%;border-radius:var(--board-border-radius,var(--chessboard-border-radius,3px));contain:layout;height:100%;position:relative;-webkit-user-select:none;user-select:none;width:100%;touch-action:none;-webkit-tap-highlight-color:transparent}
.board.square-host{display:block;height:0;padding-bottom:100%}
.board.not-rounded{border-radius:0}
.board.disabled .piece{cursor:default}
.board canvas{position:absolute}
.piece{background-size:100%;cursor:pointer;cursor:grab;height:12.5%;left:0;overflow:hidden;position:absolute;top:0;touch-action:none;width:12.5%;will-change:transform}
.piece.dragging{cursor:grabbing;z-index:2}
.piece.piece-hidden{display:none}
.element-pool{position:absolute;transform:translate(-10000px)}
.highlight,.hover-square{height:12.5%;left:0;pointer-events:none;position:absolute;top:0;width:12.5%}
.hover-square{background:none}
.hover-square svg{display:block;width:100%;height:100%}
.hint,.capture-hint{height:12.5%;left:0;position:absolute;top:0;width:12.5%;background-clip:content-box;border-radius:50%;box-sizing:border-box;pointer-events:none}
.hint{background-color:rgba(0,0,0,.14);padding:4.2%}
.capture-hint{border:5px solid rgba(0,0,0,.14)}
.arrows{height:100%;left:0;pointer-events:none;position:absolute;top:0;width:100%}
.board.flipped .arrows{transform:scale(-1)}
.arrows .arrow{pointer-events:none}
.coordinates{left:0;position:absolute;top:0;width:100%;height:100%;pointer-events:none;-webkit-user-select:none;user-select:none;font-family:inherit}
.coordinates.outside{overflow:visible}
.coordinates.each-square{opacity:.4;z-index:1}
.coordinate-light,.coordinate-dark{font-weight:600}
.coordinate-grey{fill:rgba(128,128,128,.9);font-weight:600}
.promotion-window{background-color:#fff;border-radius:3px;bottom:0;display:flex;flex-direction:column-reverse;height:56.25%;left:0;position:absolute;top:auto;width:12.5%;z-index:3;box-shadow:3px 3px 10px rgba(0,0,0,.65)}
.promotion-window.top{bottom:auto;top:0}
.promotion-window.top .close-button{border-radius:0 0 3px 3px;order:0}
.promotion-window.top .promotion-piece.wq,.promotion-window.top .promotion-piece.bq{order:4}
.promotion-window.top .promotion-piece.wn,.promotion-window.top .promotion-piece.bn{order:3}
.promotion-window.top .promotion-piece.wr,.promotion-window.top .promotion-piece.br{order:2}
.promotion-window.top .promotion-piece.wb,.promotion-window.top .promotion-piece.bb{order:1}
.promotion-window .promotion-piece{background-position-y:bottom;background-repeat:no-repeat;background-size:100%;cursor:pointer;padding-top:100%;position:relative}
.promotion-window .promotion-piece:hover{background-color:rgba(0,0,0,.08)}
.promotion-window .promotion-piece.wq,.promotion-window .promotion-piece.bq{order:0}
.promotion-window .promotion-piece.wn,.promotion-window .promotion-piece.bn{order:1}
.promotion-window .promotion-piece.wr,.promotion-window .promotion-piece.br{order:2}
.promotion-window .promotion-piece.wb,.promotion-window .promotion-piece.bb{order:3}
.promotion-window .close-button{align-items:center;background:#eee;border-radius:4px 4px 0 0;color:#777;cursor:pointer;display:flex;flex-grow:1;font-size:150%;font-style:normal;justify-content:center;max-height:12.5%;order:4;text-align:center;line-height:1}
.promotion-window .close-button:hover{background:#ddd}
.promotion-window.dynamic{--promotion-window-clip-top:100%;--promotion-window-clip-bottom:0%;background-color:transparent;box-shadow:3px 3px 10px transparent;isolation:isolate;justify-content:flex-start;overflow:visible;transition:box-shadow 333ms ease-out}
.promotion-window.dynamic.top{--promotion-window-clip-top:0%;--promotion-window-clip-bottom:100%;justify-content:flex-end}
.promotion-window.dynamic.promotion-window--visible{--promotion-window-clip-top:0%;--promotion-window-clip-bottom:0%;box-shadow:3px 3px 10px rgba(0,0,0,.65);transition-delay:.16s}
.promotion-window.dynamic:before{background-color:#fff;border-radius:inherit;box-shadow:3px 3px 10px rgba(0,0,0,.65);clip-path:inset(var(--promotion-window-clip-top,100%) 0 var(--promotion-window-clip-bottom,0%) 0);content:"";inset:0;pointer-events:none;position:absolute;transition:clip-path 333ms cubic-bezier(.34,1.56,.64,1);will-change:clip-path;z-index:-1}
.promotion-window.dynamic .close-button{height:11.1111111111%;left:0;max-height:11.1111111111%;position:absolute;top:0;transform:translateY(calc(var(--promotion-window-clip-top) * 8));transition:transform 333ms cubic-bezier(.34,1.56,.64,1);width:100%;z-index:20}
.promotion-window.dynamic.top .close-button{bottom:0;top:auto;transform:translateY(calc(var(--promotion-window-clip-bottom) * -8))}
.promotion-window.dynamic .promotion-piece{opacity:0;transition:opacity 333ms,transform .15s cubic-bezier(.16,1,.3,1)}
.promotion-window.dynamic.promotion-window--visible .promotion-piece{opacity:1}
.promotion-window.dynamic .promotion-piece:hover{transform:scale(1.15)}
.promotion-window.dynamic.closing .close-button{opacity:0;transition:opacity 80ms,transform var(--promotion-close-duration,.2s) cubic-bezier(.32,0,.67,0)}
.promotion-window.dynamic.closing .promotion-piece{transition-duration:80ms}
.promotion-window.dynamic.closing .promotion-piece.wb,.promotion-window.dynamic.closing .promotion-piece.bb{transition-delay:0ms}
.promotion-window.dynamic.closing .promotion-piece.wr,.promotion-window.dynamic.closing .promotion-piece.br{transition-delay:50ms}
.promotion-window.dynamic.closing .promotion-piece.wn,.promotion-window.dynamic.closing .promotion-piece.bn{transition-delay:.1s}
.promotion-window.dynamic.closing .promotion-piece.wq,.promotion-window.dynamic.closing .promotion-piece.bq{transition-delay:.15s}
.promotion-window.dynamic.closing:before{transition:clip-path var(--promotion-close-duration,.2s) cubic-bezier(.32,0,.67,0)}
.board.analysis-overlay:before{background:rgba(255,255,255,.25);content:" ";height:100%;position:absolute;width:100%}
.pointer-finger-container{--flipped-modifier:1;--adjusted-from-x:calc(var(--from-x) - var(--offset-x) * var(--flipped-modifier));--adjusted-from-y:calc(var(--from-y) - var(--offset-y) * var(--flipped-modifier));--adjusted-to-x:calc(var(--to-x) - var(--offset-x) * var(--flipped-modifier));--adjusted-to-y:calc(var(--to-y) - var(--offset-y) * var(--flipped-modifier));opacity:0;pointer-events:none;position:absolute;transform:translate(var(--adjusted-from-x),var(--adjusted-from-y))}
.board.flipped .pointer-finger-container{--flipped-modifier:-1}
.board.flipped .pointer-finger{transform:scale(-1)}
@keyframes finger-move{0%{transform:translate(var(--adjusted-from-x),var(--adjusted-from-y))}to{transform:translate(var(--adjusted-to-x),var(--adjusted-to-y))}}
@keyframes finger-fade-in{0%{opacity:0}to{opacity:1}}
@keyframes finger-fade-out{0%{opacity:1}to{opacity:0}}
.board .fade-in-overlay.animate{animation-name:reboard-fade-out;animation-fill-mode:forwards;display:block}
@keyframes reboard-fade-out{0%{opacity:1}to{opacity:0}}
.board .fade-in-overlay{background-size:100%;display:none;height:100%;pointer-events:none;position:absolute;top:0;left:0;touch-action:none;width:100%;z-index:3}
.a11y-overlay{border-collapse:collapse;box-sizing:border-box;position:absolute;top:0;left:0;z-index:1;pointer-events:none}
.a11y-overlay td{padding:0;width:12.5%;height:12.5%}
.a11y-announcement{height:0;overflow:hidden;width:0}
.glyph-piece{display:flex;align-items:center;justify-content:center;font-size:min(8vw,64px);line-height:1}
/* "dynamic" animation type: growing highlight circle and popping hint dots */
.highlight.growing-circle{background-color:transparent;overflow:hidden}
.highlight.growing-circle:after{animation:reboard-grow .2s ease-out forwards;background-color:var(--background-color,#ffff33);border-radius:50%;content:"";height:100%;left:50%;opacity:var(--opacity,.5);position:absolute;top:50%;transform:translate(-50%,-50%) scale(.4);width:100%}
@keyframes reboard-grow{to{transform:translate(-50%,-50%) scale(1.4142)}}
.hint.dynamic{background-color:transparent}
.capture-hint.dynamic{background:none;background-clip:unset;border:0}
.dynamic.hint .circle{animation:reboard-grow-hint .15s cubic-bezier(.34,1.56,.64,1) forwards;background-color:rgba(0,0,0,.14);border-radius:50%;height:100%;opacity:0;transform:scale(0);width:100%}
.dynamic.hint .circle.removing{animation:reboard-shrink-hint .15s cubic-bezier(.33,1,.68,1) forwards}
.dynamic.capture-hint .circle{--hole-percent:90%;animation:reboard-grow-capture .15s cubic-bezier(.34,1.56,.64,1) forwards;background:radial-gradient(circle closest-side at center,transparent 0 var(--hole-percent),rgba(0,0,0,.14) var(--hole-percent) 100%);height:100%;opacity:0;transform:scale(.4);width:100%}
.dynamic.capture-hint .circle.removing{animation:reboard-shrink-capture .15s cubic-bezier(.33,1,.68,1) forwards}
@keyframes reboard-grow-hint{to{opacity:1;transform:scale(1)}}
@keyframes reboard-shrink-hint{0%{opacity:1;transform:scale(.8)}to{opacity:1;transform:scale(0)}}
@keyframes reboard-grow-capture{to{opacity:1;transform:scale(1)}}
@keyframes reboard-shrink-capture{0%{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(1)}}
${squareRules()}
.hide-pieces .piece{display:none}
[dir=rtl] .arrows,[dir=rtl] .fade-in-overlay{left:auto;right:0}
[dir=rtl] .element-pool{transform:translate(10000px)}
html[dir=rtl] .coordinates:not(.outside){left:8px;overflow:visible}
[dir=rtl] .promotion-window,[dir=rtl] .promotion-window.dynamic:before,[dir=rtl] .promotion-window.dynamic.promotion-window--visible{box-shadow:-3px 3px 10px rgba(0,0,0,.65)}
[dir=rtl] .promotion-window.dynamic{box-shadow:-3px 3px 10px transparent}
[dir=rtl] .promotion-window.dynamic .close-button{left:auto;right:0}
${VFX_CSS}
${EFFECTS_CSS}
${CUSTOM_ITEMS_CSS}
`;

export function ensureBaseStyles(doc: Document): void {
  if (doc.getElementById(BASE_ID)) return;
  const el = doc.createElement('style');
  el.id = BASE_ID;
  el.textContent = BASE_CSS;
  doc.head.appendChild(el);
}

export const PIECE_KEYS = ['wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk'] as const;

/** URL of a piece image for a piece source option. */
export function pieceUrl(source: PieceSource | undefined, color: Color, type: PieceType): string | null {
  if (!source) return null;
  if (typeof source === 'function') return source(color, type);
  return source.replace('{piece}', `${color}${type}`);
}

/** Unicode fallback used when no piece artwork is configured. */
const GLYPHS: Record<string, string> = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

function glyphDataUri(key: string): string {
  const white = key[0] === 'w';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<text x="50" y="78" font-size="84" text-anchor="middle" font-family="'Segoe UI Symbol','Noto Sans Symbols2','DejaVu Sans',serif" ` +
    `fill="${white ? '#fafafa' : '#222'}" stroke="${white ? '#222' : '#fafafa'}" stroke-width="2" paint-order="stroke">${GLYPHS[key]}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const cssEscape = (id: string): string =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);

/** CSS `background-image` value of the board (used by effects that show a slice of it). */
export function boardImageValue(opts: BoardOptions): string {
  return opts.boardImage ?? boardImageUri(resolveTheme(opts.boardStyle));
}

/** Per-board dynamic CSS: board image, piece artwork, coordinate colours. */
export function boardCss(opts: BoardOptions): string {
  const theme = resolveTheme(opts.boardStyle);
  const host = `#${cssEscape(opts.id)}`;
  const boardImage = opts.boardImage ?? boardImageUri(theme);
  const pieceRules = PIECE_KEYS.map((key) => {
    const url = pieceUrl(opts.pieces, key[0] as Color, key[1] as PieceType);
    const image = url ? `url("${url}")` : glyphDataUri(key);
    return `${host} .piece.${key},${host} .promotion-piece.${key},${host} .vfx .element.${key}{background-image:${image}}`;
  }).join('\n');
  return `
${host}{background-image:${boardImage}}
${host} .coordinate-light{fill:${theme.dark}}
${host} .coordinate-dark{fill:${theme.light}}
${host} .highlight{background-color:${opts.highlightColor ?? theme.highlight}}
${pieceRules}
`;
}
