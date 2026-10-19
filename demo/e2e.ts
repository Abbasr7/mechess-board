/**
 * Minimal host page for the Playwright tests: one board, no bot, options from the query string
 * (`?animationType=natural&playingAs=b&fen=…`). The board is exposed as `window.__board`.
 */
import { ChessBoard } from '../src';
import type { BoardInit } from '../src';

const q = new URLSearchParams(location.search);
const init: Record<string, unknown> = { sounds: false, pieces: '/pieces/staunty/{piece}.svg' };
for (const [k, v] of q) {
  if (k === 'fen') init.fen = v;
  else if (v === 'true' || v === 'false') init[k] = v === 'true';
  else if (v === 'null') init[k] = null;
  else init[k] = v;
}
const board = new ChessBoard(document.getElementById('board')!, init as BoardInit);
(window as unknown as { __board: ChessBoard }).__board = board;
(window as unknown as { __ChessBoard: typeof ChessBoard }).__ChessBoard = ChessBoard;
(window as unknown as { __errors: string[] }).__errors = [];
window.addEventListener('error', (e) => (window as unknown as { __errors: string[] }).__errors.push(String(e.message)));
