/**
 * Position set-up (the board's "setup" mode).
 *
 * In setup mode the board is a free canvas: any piece may be dragged anywhere
 * (replacing what is there), dragged off the board to delete it, or dropped
 * from outside via the API. The position is therefore kept as a plain piece
 * map that is *not* required to be a legal chess position until it is
 * committed.
 */
import type { Color, Piece, PieceType, PiecesMap, Square } from './types';
import { fileOf, rankOf, toSquare } from './squares';
import { Chess } from './rules/chess';

export interface SetupInfo {
  turn: Color;
  /** FEN castling field, or `null` to infer from the pieces standing on their home squares. */
  castling: string | null;
}

/** Placement field of a FEN → pieces. Returns `null` when the placement is malformed. */
export function placementToPieces(fen: string): PiecesMap | null {
  const rows = fen.trim().split(/\s+/)[0].split('/');
  if (rows.length !== 8) return null;
  const out: PiecesMap = new Map();
  for (let r = 0; r < 8; r++) {
    let f = 1;
    for (const ch of rows[r]) {
      if (/[1-8]/.test(ch)) {
        f += Number(ch);
        continue;
      }
      const lower = ch.toLowerCase();
      if (!'pnbrqk'.includes(lower) || f > 8) return null;
      out.set(toSquare(f, 8 - r)!, { color: ch === lower ? 'b' : 'w', type: lower as PieceType });
      f++;
    }
    if (f !== 9) return null;
  }
  return out;
}

export function piecesToPlacement(pieces: PiecesMap): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 1; file <= 8; file++) {
      const p = pieces.get(toSquare(file, rank)!);
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
  return rows.join('/');
}

/** Castling rights implied by kings and rooks standing on their original squares. */
export function inferCastling(pieces: PiecesMap): string {
  const at = (sq: Square, color: Color, type: PieceType): boolean => {
    const p = pieces.get(sq);
    return !!p && p.color === color && p.type === type;
  };
  let s = '';
  if (at('e1', 'w', 'k') && at('h1', 'w', 'r')) s += 'K';
  if (at('e1', 'w', 'k') && at('a1', 'w', 'r')) s += 'Q';
  if (at('e8', 'b', 'k') && at('h8', 'b', 'r')) s += 'k';
  if (at('e8', 'b', 'k') && at('a8', 'b', 'r')) s += 'q';
  return s || '-';
}

/** Keep only the rights of `wanted` that the pieces on the board still allow. */
export function sanitizeCastling(wanted: string, pieces: PiecesMap): string {
  const possible = inferCastling(pieces);
  const kept = [...'KQkq'].filter((c) => wanted.includes(c) && possible.includes(c)).join('');
  return kept || '-';
}

export function piecesToFen(pieces: PiecesMap, info: SetupInfo): string {
  const castling = info.castling === null ? inferCastling(pieces) : sanitizeCastling(info.castling, pieces);
  return `${piecesToPlacement(pieces)} ${info.turn} ${castling} - 0 1`;
}

export type SetupProblem =
  | 'no-white-king'
  | 'no-black-king'
  | 'multiple-white-kings'
  | 'multiple-black-kings'
  | 'pawn-on-back-rank'
  | 'too-many-pawns'
  | 'too-many-pieces'
  | 'kings-adjacent'
  | 'side-not-to-move-in-check';

/** Everything that makes a set-up position illegal (empty when it can be played). */
export function validateSetup(pieces: PiecesMap, turn: Color): SetupProblem[] {
  const problems: SetupProblem[] = [];
  const kings: Record<Color, Square[]> = { w: [], b: [] };
  const counts: Record<Color, number> = { w: 0, b: 0 };
  const pawns: Record<Color, number> = { w: 0, b: 0 };
  for (const [sq, p] of pieces) {
    counts[p.color]++;
    if (p.type === 'k') kings[p.color].push(sq);
    if (p.type === 'p') {
      pawns[p.color]++;
      if (rankOf(sq) === 1 || rankOf(sq) === 8) problems.push('pawn-on-back-rank');
    }
  }
  if (kings.w.length === 0) problems.push('no-white-king');
  if (kings.b.length === 0) problems.push('no-black-king');
  if (kings.w.length > 1) problems.push('multiple-white-kings');
  if (kings.b.length > 1) problems.push('multiple-black-kings');
  if (pawns.w > 8 || pawns.b > 8) problems.push('too-many-pawns');
  if (counts.w > 16 || counts.b > 16) problems.push('too-many-pieces');
  if (kings.w.length === 1 && kings.b.length === 1) {
    const [a, b] = [kings.w[0], kings.b[0]];
    if (Math.abs(fileOf(a) - fileOf(b)) <= 1 && Math.abs(rankOf(a) - rankOf(b)) <= 1) problems.push('kings-adjacent');
    else {
      // the side that just moved cannot be left in check
      try {
        const waiting: Color = turn === 'w' ? 'b' : 'w';
        if (new Chess(`${piecesToPlacement(pieces)} ${waiting} - - 0 1`).isCheck()) problems.push('side-not-to-move-in-check');
      } catch {
        /* an unparseable placement already has other problems */
      }
    }
  }
  return [...new Set(problems)];
}

export const EMPTY_PLACEMENT = '8/8/8/8/8/8/8/8';
const START_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

/** A fresh copy of a piece map. */
export const clonePieces = (p: PiecesMap): PiecesMap => new Map([...p].map(([sq, pc]: [Square, Piece]) => [sq, { ...pc }]));

/** The editable position behind setup mode. */
export class SetupSession {
  pieces: PiecesMap;
  turn: Color;
  /** FEN castling field, or `null` to infer it from the pieces. */
  castling: string | null;

  constructor(pieces: PiecesMap, turn: Color, castling: string | null) {
    this.pieces = clonePieces(pieces);
    this.turn = turn;
    this.castling = castling;
  }

  static fromFen(fen: string): SetupSession | null {
    const parts = fen.trim().split(/\s+/);
    const pieces = placementToPieces(parts[0] ?? '');
    if (!pieces) return null;
    const turn: Color = parts[1] === 'b' ? 'b' : 'w';
    return new SetupSession(pieces, turn, parts[2] ?? null);
  }

  /** Put `piece` on `sq`, replacing whatever stands there. */
  drop(sq: Square, piece: Piece): void {
    if (!/^[a-h][1-8]$/.test(sq)) throw new Error(`Invalid square: ${String(sq)}`);
    if ((piece.color !== 'w' && piece.color !== 'b') || !'pnbrqk'.includes(piece.type) || piece.type.length !== 1) {
      throw new Error(`Invalid piece: ${JSON.stringify(piece)}`);
    }
    this.pieces.set(sq, { color: piece.color, type: piece.type });
  }

  remove(sq: Square): Piece | undefined {
    const p = this.pieces.get(sq);
    this.pieces.delete(sq);
    return p;
  }

  /** Move a piece, replacing the piece on the target square. */
  move(from: Square, to: Square): { piece: Piece; captured?: Piece } | null {
    const piece = this.pieces.get(from);
    if (!piece || from === to) return null;
    const captured = this.pieces.get(to);
    this.pieces.delete(from);
    this.pieces.set(to, piece);
    return { piece, captured };
  }

  clear(): void {
    this.pieces = new Map();
    this.castling = null;
  }

  reset(): void {
    this.pieces = placementToPieces(START_PLACEMENT)!;
    this.turn = 'w';
    this.castling = null;
  }

  fen(): string {
    return piecesToFen(this.pieces, { turn: this.turn, castling: this.castling });
  }

  problems(): SetupProblem[] {
    return validateSetup(this.pieces, this.turn);
  }
}
