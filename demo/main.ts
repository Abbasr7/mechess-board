import { Chess, ChessBoard, BOARD_THEMES, START_FEN, type BoardMove } from '@/index';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const logEl = $('log');
const log = (msg: string): void => {
  logEl.textContent += msg + '\n';
  logEl.scrollTop = logEl.scrollHeight;
};

const pieceSources: Record<string, string | undefined> = {
  staunty: '/pieces/staunty/{piece}.svg',
  loco: '/pieces/loco/{piece}.svg',
  glyph: undefined,
};

const board = new ChessBoard($('board'), {
  playingAs: 'w',
  pieces: pieceSources.staunty,
});
(window as unknown as { __board: ChessBoard }).__board = board;

function status(): void {
  const el = $('status');
  if (board.isGameOver()) {
    el.textContent = `Game over: ${board.getResult()}`;
    return;
  }
  const q = board.getPremoves().length;
  el.textContent = `${board.getTurn() === 'w' ? 'White' : 'Black'} to move` + (q ? ` · ${q} premove${q > 1 ? 's' : ''} queued` : '');
}

// ── bot opponent ──────────────────────────────────────────────────────────
let botTimer = 0;
function maybeBotMove(): void {
  window.clearTimeout(botTimer);
  const side = ($('side') as HTMLSelectElement).value;
  if (!($('bot') as HTMLInputElement).checked || side === 'both' || board.isGameOver()) return;
  if (board.getTurn() === side) return;
  const delay = Number(($('delay') as HTMLInputElement).value) || 0;
  botTimer = window.setTimeout(() => {
    // pick a random legal move through a throw-away copy of the position
    const legal = new Chess(board.getFen()).legalMoves();
    if (!legal.length) return;
    const m = legal[Math.floor(Math.random() * legal.length)];
    board.move({ from: m.from, to: m.to, promotion: m.promotion }, { animate: true });
  }, delay);
}

board.on('move', (m: BoardMove) => {
  log(`${m.userGenerated ? (m.isPremove ? 'premove' : 'you') : 'opp'}: ${m.san}`);
  status();
  maybeBotMove();
});
board.on('premove', ({ move }) => {
  log(`premove queued: ${move.from}${move.to}`);
  status();
});
board.on('premove-cancel', ({ reason }) => {
  log(`premoves cancelled (${reason})`);
  status();
});
board.on('move-rejected', (e) => log(`rejected ${e.from} -> ${e.to ?? 'off-board'}: ${e.reason}`));
board.on('game-over', (e) => {
  log(`game over ${e.result} (${e.reason})`);
  status();
});
board.on('promotion-start', (e) => log(`promotion window ${e.from} -> ${e.to}`));
board.on('sound', (s) => log(`sound: ${s}`));

// ── controls ──────────────────────────────────────────────────────────────
const themeSel = $('theme') as HTMLSelectElement;
for (const name of Object.keys(BOARD_THEMES)) themeSel.add(new Option(name, name));

function bind(id: string, fn: (v: string, el: HTMLInputElement | HTMLSelectElement) => void): void {
  const el = $(id) as HTMLInputElement | HTMLSelectElement;
  el.addEventListener('change', () => fn(el.value, el));
}
bind('anim', (v) => board.setOptions({ animationType: v as never }));
bind('method', (v) => board.setOptions({ moveMethod: v as never }));
bind('coords', (v) => board.setOptions({ coordinates: v as never }));
bind('theme', (v) => board.setOptions({ boardStyle: v }));
bind('pieces', (v) => board.setOptions({ pieces: pieceSources[v] }));
bind('autopromote', (_v, el) => board.setOptions({ autoPromote: (el as HTMLInputElement).checked }));
bind('premoves', (_v, el) => board.setOptions({ premoves: (el as HTMLInputElement).checked }));
bind('sounds', (_v, el) => board.setOptions({ playSounds: (el as HTMLInputElement).checked }));
bind('side', (v) => {
  board.setOptions({ playingAs: v === 'both' ? null : (v as 'w' | 'b'), flipped: v === 'b' });
  maybeBotMove();
  status();
});
$('new').addEventListener('click', () => {
  board.load(START_FEN);
  log('-- new game --');
  status();
  maybeBotMove();
});
$('undo').addEventListener('click', () => {
  board.undo();
  status();
});
$('flip').addEventListener('click', () => board.flip());
$('loadfen').addEventListener('click', () => {
  try {
    board.load(($('fen') as HTMLInputElement).value);
    status();
    maybeBotMove();
  } catch (e) {
    log(String(e));
  }
});
($('fen') as HTMLInputElement).value = board.getFen();
status();
