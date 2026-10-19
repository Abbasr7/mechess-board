/**
 * A small, dependency-free chess rules engine (standard chess only).
 *
 * The board component itself is rules-agnostic in spirit, but it needs *some*
 * legal-move source to drive hints, move validation, SAN and sounds. This one
 * is deliberately compact and is validated against well-known perft counts
 * (see test/chess.test.ts).
 */
import type {
  Color,
  MoveDetails,
  MoveFlags,
  MoveInput,
  Piece,
  PieceType,
  PiecesMap,
  PromotionType,
  Square,
  GameResult,
} from '../types';
import { fileOf, rankOf, toSquare } from '../squares';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

interface Castling {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

interface State {
  /** index = (rank-1)*8 + (file-1) */
  board: (Piece | null)[];
  turn: Color;
  castling: Castling;
  ep: Square | null;
  half: number;
  full: number;
}

/** A legal move before SAN / check metadata is attached. */
export interface RawMove {
  from: Square;
  to: Square;
  piece: PieceType;
  color: Color;
  captured?: PieceType;
  capturedSquare?: Square;
  promotion?: PromotionType;
  flags: MoveFlags;
  rookMove?: { from: Square; to: Square };
}

export type DrawReason = 'stalemate' | 'insufficient' | 'fifty' | 'threefold';
export type GameOverReason = 'checkmate' | DrawReason;

const idx = (sq: Square): number => (rankOf(sq) - 1) * 8 + (fileOf(sq) - 1);
const sqAt = (i: number): Square => toSquare((i % 8) + 1, Math.floor(i / 8) + 1)!;
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

const KNIGHT_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const BISHOP_DIRS: ReadonlyArray<readonly [number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const PROMOTIONS: PromotionType[] = ['q', 'r', 'b', 'n'];

const noFlags = (): MoveFlags => ({
  capture: false,
  enPassant: false,
  doublePush: false,
  kingsideCastle: false,
  queensideCastle: false,
  promotion: false,
});

function cloneState(s: State): State {
  return { ...s, board: s.board.slice(), castling: { ...s.castling } };
}

function parseFen(fen: string): State {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) throw new Error(`Invalid FEN: ${fen}`);
  const rows = parts[0].split('/');
  if (rows.length !== 8) throw new Error(`Invalid FEN (ranks): ${fen}`);
  const board: (Piece | null)[] = new Array(64).fill(null);
  const kings = { w: 0, b: 0 };
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/[1-8]/.test(ch)) {
        f += Number(ch);
        continue;
      }
      const lower = ch.toLowerCase();
      if (!'pnbrqk'.includes(lower) || f > 7) throw new Error(`Invalid FEN (piece): ${fen}`);
      const color: Color = ch === lower ? 'b' : 'w';
      board[(7 - r) * 8 + f] = { color, type: lower as PieceType };
      if (lower === 'k') kings[color]++;
      f++;
    }
    if (f !== 8) throw new Error(`Invalid FEN (rank width): ${fen}`);
  }
  if (kings.w !== 1 || kings.b !== 1) throw new Error(`Invalid FEN (kings): ${fen}`);
  const turn = parts[1] === 'b' ? 'b' : parts[1] === 'w' ? 'w' : null;
  if (!turn) throw new Error(`Invalid FEN (turn): ${fen}`);
  const c = parts[2] ?? '-';
  const castling: Castling = {
    K: c.includes('K'),
    Q: c.includes('Q'),
    k: c.includes('k'),
    q: c.includes('q'),
  };
  const ep = parts[3] && parts[3] !== '-' ? parts[3] : null;
  return {
    board,
    turn,
    castling,
    ep,
    half: Number(parts[4] ?? 0) || 0,
    full: Number(parts[5] ?? 1) || 1,
  };
}

function stateToFen(s: State): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.board[r * 8 + f];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      row += p.color === 'w' ? p.type.toUpperCase() : p.type;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const c = `${s.castling.K ? 'K' : ''}${s.castling.Q ? 'Q' : ''}${s.castling.k ? 'k' : ''}${s.castling.q ? 'q' : ''}` || '-';
  return `${rows.join('/')} ${s.turn} ${c} ${s.ep ?? '-'} ${s.half} ${s.full}`;
}

/** Is `sq` attacked by any piece of colour `by`? */
function isAttacked(board: (Piece | null)[], sq: Square, by: Color): boolean {
  const f = fileOf(sq);
  const r = rankOf(sq);
  const at = (ff: number, rr: number): Piece | null => {
    if (ff < 1 || ff > 8 || rr < 1 || rr > 8) return null;
    return board[(rr - 1) * 8 + (ff - 1)];
  };
  // pawns: a `by` pawn attacks the squares one rank ahead of itself
  const pr = by === 'w' ? r - 1 : r + 1;
  for (const df of [-1, 1]) {
    const p = at(f + df, pr);
    if (p && p.color === by && p.type === 'p') return true;
  }
  for (const [df, dr] of KNIGHT_STEPS) {
    const p = at(f + df, r + dr);
    if (p && p.color === by && p.type === 'n') return true;
  }
  for (const [df, dr] of KING_STEPS) {
    const p = at(f + df, r + dr);
    if (p && p.color === by && p.type === 'k') return true;
  }
  const ray = (dirs: ReadonlyArray<readonly [number, number]>, types: PieceType[]): boolean => {
    for (const [df, dr] of dirs) {
      let ff = f + df;
      let rr = r + dr;
      while (ff >= 1 && ff <= 8 && rr >= 1 && rr <= 8) {
        const p = board[(rr - 1) * 8 + (ff - 1)];
        if (p) {
          if (p.color === by && types.includes(p.type)) return true;
          break;
        }
        ff += df;
        rr += dr;
      }
    }
    return false;
  };
  return ray(BISHOP_DIRS, ['b', 'q']) || ray(ROOK_DIRS, ['r', 'q']);
}

function findKing(board: (Piece | null)[], color: Color): Square | null {
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.type === 'k' && p.color === color) return sqAt(i);
  }
  return null;
}

interface PushExtra {
  flags?: Partial<MoveFlags>;
  captured?: PieceType;
  capturedSquare?: Square;
  promotion?: PromotionType;
  rookMove?: { from: Square; to: Square };
}

/** Pseudo-legal moves for the side to move (castling is fully validated here). */
function pseudoMoves(s: State, onlyFrom?: Square): RawMove[] {
  const out: RawMove[] = [];
  const us = s.turn;
  const them = other(us);
  const start = onlyFrom ? idx(onlyFrom) : 0;
  const end = onlyFrom ? idx(onlyFrom) + 1 : 64;

  for (let i = start; i < end; i++) {
    const p = s.board[i];
    if (!p || p.color !== us) continue;
    const from = sqAt(i);
    const f = fileOf(from);
    const r = rankOf(from);
    const push = (to: Square, extra: PushExtra = {}): void => {
      const target = s.board[idx(to)];
      const flags: MoveFlags = { ...noFlags(), ...extra.flags };
      const m: RawMove = {
        from,
        to,
        piece: p.type,
        color: us,
        flags,
      };
      if (target) {
        m.captured = target.type;
        m.capturedSquare = to;
        flags.capture = true;
      }
      if (extra.captured) {
        m.captured = extra.captured;
        m.capturedSquare = extra.capturedSquare;
      }
      if (extra.promotion) m.promotion = extra.promotion;
      if (extra.rookMove) m.rookMove = extra.rookMove;
      out.push(m);
    };

    if (p.type === 'p') {
      const dir = us === 'w' ? 1 : -1;
      const startRank = us === 'w' ? 2 : 7;
      const lastRank = us === 'w' ? 8 : 1;
      const pushPawn = (to: Square, flags: Partial<MoveFlags> = {}, extra: PushExtra = {}): void => {
        if (rankOf(to) === lastRank) {
          for (const promotion of PROMOTIONS) push(to, { ...extra, promotion, flags: { ...flags, promotion: true } });
        } else push(to, { ...extra, flags });
      };
      const one = toSquare(f, r + dir);
      if (one && !s.board[idx(one)]) {
        pushPawn(one);
        const two = toSquare(f, r + 2 * dir);
        if (r === startRank && two && !s.board[idx(two)]) push(two, { flags: { doublePush: true } });
      }
      for (const df of [-1, 1]) {
        const to = toSquare(f + df, r + dir);
        if (!to) continue;
        const t = s.board[idx(to)];
        if (t && t.color === them) pushPawn(to);
        else if (!t && s.ep === to) {
          const capSq = toSquare(f + df, r)!;
          const cap = s.board[idx(capSq)];
          if (cap && cap.color === them && cap.type === 'p') {
            push(to, { flags: { enPassant: true, capture: true }, captured: 'p', capturedSquare: capSq });
          }
        }
      }
    } else if (p.type === 'n' || p.type === 'k') {
      const steps = p.type === 'n' ? KNIGHT_STEPS : KING_STEPS;
      for (const [df, dr] of steps) {
        const to = toSquare(f + df, r + dr);
        if (!to) continue;
        const t = s.board[idx(to)];
        if (!t || t.color === them) push(to);
      }
      if (p.type === 'k') {
        const homeRank = us === 'w' ? 1 : 8;
        if (r === homeRank && f === 5 && !isAttacked(s.board, from, them)) {
          const canK = us === 'w' ? s.castling.K : s.castling.k;
          const canQ = us === 'w' ? s.castling.Q : s.castling.q;
          const rookAt = (file: number): boolean => {
            const rk = s.board[idx(toSquare(file, homeRank)!)];
            return !!rk && rk.type === 'r' && rk.color === us;
          };
          const empty = (file: number): boolean => !s.board[idx(toSquare(file, homeRank)!)];
          const safe = (file: number): boolean => !isAttacked(s.board, toSquare(file, homeRank)!, them);
          if (canK && rookAt(8) && empty(6) && empty(7) && safe(6) && safe(7)) {
            push(toSquare(7, homeRank)!, {
              flags: { kingsideCastle: true },
              rookMove: { from: toSquare(8, homeRank)!, to: toSquare(6, homeRank)! },
            });
          }
          if (canQ && rookAt(1) && empty(2) && empty(3) && empty(4) && safe(4) && safe(3)) {
            push(toSquare(3, homeRank)!, {
              flags: { queensideCastle: true },
              rookMove: { from: toSquare(1, homeRank)!, to: toSquare(4, homeRank)! },
            });
          }
        }
      }
    } else {
      const dirs = p.type === 'b' ? BISHOP_DIRS : p.type === 'r' ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
      for (const [df, dr] of dirs) {
        let ff = f + df;
        let rr = r + dr;
        while (ff >= 1 && ff <= 8 && rr >= 1 && rr <= 8) {
          const to = toSquare(ff, rr)!;
          const t = s.board[idx(to)];
          if (!t) push(to);
          else {
            if (t.color === them) push(to);
            break;
          }
          ff += df;
          rr += dr;
        }
      }
    }
  }
  return out;
}

/** Apply a raw move to a *copy* of the state. */
function play(s: State, m: RawMove): State {
  const n = cloneState(s);
  const piece = n.board[idx(m.from)]!;
  n.board[idx(m.from)] = null;
  if (m.flags.enPassant && m.capturedSquare) n.board[idx(m.capturedSquare)] = null;
  n.board[idx(m.to)] = m.promotion ? { color: m.color, type: m.promotion } : piece;
  if (m.rookMove) {
    n.board[idx(m.rookMove.to)] = n.board[idx(m.rookMove.from)];
    n.board[idx(m.rookMove.from)] = null;
  }
  // castling rights
  if (piece.type === 'k') {
    if (m.color === 'w') n.castling.K = n.castling.Q = false;
    else n.castling.k = n.castling.q = false;
  }
  const touch = (sq: Square): void => {
    if (sq === 'a1') n.castling.Q = false;
    else if (sq === 'h1') n.castling.K = false;
    else if (sq === 'a8') n.castling.q = false;
    else if (sq === 'h8') n.castling.k = false;
  };
  touch(m.from);
  touch(m.to);
  n.ep = m.flags.doublePush ? toSquare(fileOf(m.from), (rankOf(m.from) + rankOf(m.to)) / 2) : null;
  n.half = piece.type === 'p' || m.captured ? 0 : s.half + 1;
  if (s.turn === 'b') n.full = s.full + 1;
  n.turn = other(s.turn);
  return n;
}

function legalMoves(s: State, onlyFrom?: Square): RawMove[] {
  const us = s.turn;
  const them = other(us);
  return pseudoMoves(s, onlyFrom).filter((m) => {
    const next = play(s, m);
    const king = findKing(next.board, us);
    return !!king && !isAttacked(next.board, king, them);
  });
}

function inCheck(s: State): boolean {
  const k = findKing(s.board, s.turn);
  return !!k && isAttacked(s.board, k, other(s.turn));
}

function hasLegalMove(s: State): boolean {
  return legalMoves(s).length > 0;
}

/** Position key used for threefold repetition (EP only when capturable). */
function positionKey(s: State): string {
  const fen = stateToFen(s).split(' ');
  let ep = '-';
  if (s.ep && pseudoMoves(s).some((m) => m.flags.enPassant)) ep = s.ep;
  return `${fen[0]} ${fen[1]} ${fen[2]} ${ep}`;
}

function insufficientMaterial(board: (Piece | null)[]): boolean {
  const minors: { type: PieceType; sqColor: number }[] = [];
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p || p.type === 'k') continue;
    if (p.type === 'p' || p.type === 'r' || p.type === 'q') return false;
    minors.push({ type: p.type, sqColor: ((i % 8) + Math.floor(i / 8)) % 2 });
  }
  if (minors.length <= 1) return true;
  if (minors.every((m) => m.type === 'b') && minors.every((m) => m.sqColor === minors[0].sqColor)) return true;
  return false;
}

export class Chess {
  private s: State;
  private stack: { before: State; move: MoveDetails; keys: string[] }[] = [];
  private keys: string[] = [];
  private start: string;

  constructor(fen: string = START_FEN) {
    this.s = parseFen(fen);
    this.start = stateToFen(this.s);
    this.keys = [positionKey(this.s)];
  }

  static fromFen(fen: string): Chess {
    return new Chess(fen);
  }

  /** Replace the position. History is discarded. */
  load(fen: string): void {
    this.s = parseFen(fen);
    this.start = stateToFen(this.s);
    this.stack = [];
    this.keys = [positionKey(this.s)];
  }

  /** FEN the game started from (after `load`). */
  startFen(): string {
    return this.start;
  }

  /** FEN after `ply` half-moves (0 = start position). */
  fenAt(ply: number): string {
    if (ply <= 0) return this.start;
    const e = this.stack[Math.min(ply, this.stack.length) - 1];
    return e ? e.move.fen : this.fen();
  }

  fen(): string {
    return stateToFen(this.s);
  }

  turn(): Color {
    return this.s.turn;
  }

  get(sq: Square): Piece | null {
    return this.s.board[idx(sq)];
  }

  /** `castling` field of the FEN (`KQkq`, `-`, …). */
  castlingRights(): string {
    return stateToFen(this.s).split(' ')[2];
  }

  pieces(): PiecesMap {
    const m: PiecesMap = new Map();
    for (let i = 0; i < 64; i++) {
      const p = this.s.board[i];
      if (p) m.set(sqAt(i), { ...p });
    }
    return m;
  }

  /** Legal moves, optionally restricted to a source square. Cheap: no SAN. */
  legalMoves(from?: Square): RawMove[] {
    return legalMoves(this.s, from);
  }

  isCheck(): boolean {
    return inCheck(this.s);
  }

  /** Square of the side-to-move's king when it is in check. */
  checkedKing(): Square | null {
    return inCheck(this.s) ? findKing(this.s.board, this.s.turn) : null;
  }

  isCheckmate(): boolean {
    return inCheck(this.s) && !hasLegalMove(this.s);
  }

  isStalemate(): boolean {
    return !inCheck(this.s) && !hasLegalMove(this.s);
  }

  isInsufficientMaterial(): boolean {
    return insufficientMaterial(this.s.board);
  }

  isFiftyMoveRule(): boolean {
    return this.s.half >= 100;
  }

  isThreefoldRepetition(): boolean {
    const k = this.keys[this.keys.length - 1];
    return this.keys.filter((x) => x === k).length >= 3;
  }

  /** Why the game is over (or `null` if it is not). */
  gameOverReason(autoClaim = true): GameOverReason | null {
    if (this.isCheckmate()) return 'checkmate';
    if (this.isStalemate()) return 'stalemate';
    if (this.isInsufficientMaterial()) return 'insufficient';
    if (autoClaim && this.isFiftyMoveRule()) return 'fifty';
    if (autoClaim && this.isThreefoldRepetition()) return 'threefold';
    return null;
  }

  isGameOver(autoClaim = true): boolean {
    return this.gameOverReason(autoClaim) !== null;
  }

  /**
   * Can `color` still deliver mate? Used when the other side runs out of time: a lone king or a king with a
   * single minor piece cannot win on time. (Approximation: any pawn, rook, queen or two minors count as mating material.)
   */
  hasMatingMaterial(color: Color): boolean {
    let minors = 0;
    for (const p of this.s.board) {
      if (!p || p.color !== color || p.type === 'k') continue;
      if (p.type === 'p' || p.type === 'r' || p.type === 'q') return true;
      minors++;
    }
    return minors >= 2;
  }

  result(autoClaim = true): GameResult | null {
    const why = this.gameOverReason(autoClaim);
    if (!why) return null;
    if (why === 'checkmate') return this.s.turn === 'w' ? '0-1' : '1-0';
    return '1/2-1/2';
  }

  /** Resolve `{from,to,promotion}`, a SAN string or a coordinate string against the legal moves; `null` if illegal. */
  resolve(input: MoveInput | string): RawMove | null {
    if (typeof input === 'string') {
      // coordinate notation ("e2e4", "e7e8q") is accepted besides SAN
      const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(input);
      if (uci) return this.resolve({ from: uci[1], to: uci[2], promotion: uci[3] as PromotionType | undefined });
      return this.resolveSan(input);
    }
    const cands = legalMoves(this.s, input.from).filter((m) => m.to === input.to);
    if (cands.length === 0) return null;
    if (cands.length === 1 && !cands[0].promotion) return cands[0];
    const promo = input.promotion ?? 'q';
    return cands.find((m) => m.promotion === promo) ?? null;
  }

  private resolveSan(san: string): RawMove | null {
    const clean = san.replace(/[+#!?]/g, '');
    return legalMoves(this.s).find((m) => this.sanBody(m, legalMoves(this.s)) === clean) ?? null;
  }

  /** Play a move. Returns the full move description, or `null` if illegal. */
  move(input: MoveInput | string): MoveDetails | null {
    const raw = this.resolve(input);
    if (!raw) return null;
    const legal = legalMoves(this.s);
    const body = this.sanBody(raw, legal);
    const before = this.s;
    const after = play(before, raw);
    const check = inCheck(after);
    const mate = check && !hasLegalMove(after);
    const details: MoveDetails = {
      from: raw.from,
      to: raw.to,
      color: raw.color,
      piece: raw.piece,
      captured: raw.captured,
      capturedSquare: raw.capturedSquare,
      promotion: raw.promotion,
      flags: raw.flags,
      rookMove: raw.rookMove,
      san: body + (mate ? '#' : check ? '+' : ''),
      fen: stateToFen(after),
      check,
      checkmate: mate,
    };
    this.stack.push({ before, move: details, keys: this.keys.slice() });
    this.s = after;
    this.keys.push(positionKey(after));
    return details;
  }

  undo(): MoveDetails | null {
    const top = this.stack.pop();
    if (!top) return null;
    this.s = top.before;
    this.keys = top.keys;
    return top.move;
  }

  history(): MoveDetails[] {
    return this.stack.map((e) => e.move);
  }

  /** Standard algebraic notation without the check suffix. */
  private sanBody(m: RawMove, legal: RawMove[]): string {
    if (m.flags.kingsideCastle) return 'O-O';
    if (m.flags.queensideCastle) return 'O-O-O';
    let s = '';
    if (m.piece === 'p') {
      if (m.flags.capture) s += m.from[0] + 'x';
      s += m.to;
      if (m.promotion) s += '=' + m.promotion.toUpperCase();
      return s;
    }
    s += m.piece.toUpperCase();
    const rivals = legal.filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
    if (rivals.length) {
      const sameFile = rivals.some((o) => o.from[0] === m.from[0]);
      const sameRank = rivals.some((o) => o.from[1] === m.from[1]);
      if (!sameFile) s += m.from[0];
      else if (!sameRank) s += m.from[1];
      else s += m.from;
    }
    if (m.flags.capture) s += 'x';
    return s + m.to;
  }
}

/** Number of leaf nodes at `depth` (used by tests). */
export function perft(fen: string, depth: number): number {
  const walk = (s: State, d: number): number => {
    const moves = legalMoves(s);
    if (d === 1) return moves.length;
    let n = 0;
    for (const m of moves) n += walk(play(s, m), d - 1);
    return n;
  };
  return depth === 0 ? 1 : walk(parseFen(fen), depth);
}
