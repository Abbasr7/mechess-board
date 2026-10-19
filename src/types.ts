/** Shared types for the board. */

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionType = 'q' | 'r' | 'b' | 'n';
/** Algebraic square name, `a1` … `h8`. */
export type Square = string;

export interface Piece {
  color: Color;
  type: PieceType;
}

/** Square → piece. Insertion order is not significant. */
export type PiecesMap = Map<Square, Piece>;

export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: PromotionType;
}

export interface MoveFlags {
  capture: boolean;
  enPassant: boolean;
  doublePush: boolean;
  kingsideCastle: boolean;
  queensideCastle: boolean;
  promotion: boolean;
}

/** A fully-resolved move, as produced by the rules engine. */
export interface MoveDetails extends MoveInput {
  color: Color;
  piece: PieceType;
  captured?: PieceType;
  /** Square the captured pawn stood on (differs from `to` only for en passant). */
  capturedSquare?: Square;
  flags: MoveFlags;
  san: string;
  /** Rook displacement for castling moves. */
  rookMove?: { from: Square; to: Square };
  /** FEN after the move. */
  fen: string;
  check: boolean;
  checkmate: boolean;
}

/** Move as delivered to listeners / renderer. */
export interface BoardMove extends MoveDetails {
  /** True when the move came from the local user (drag / click / consumed premove). */
  userGenerated: boolean;
  /** True when the move is the execution of a queued premove. */
  isPremove: boolean;
  /** Animate the piece sliding? (false for user-dragged and premoved pieces) */
  animate: boolean;
}

export type AnimationType = 'default' | 'fast' | 'slow' | 'none' | 'dynamic' | 'natural' | 'arcade';
export type MoveMethod = 'drag' | 'click' | 'drag_only';
export type CoordinatesPosition = 'inside' | 'outside' | 'each_square' | 'off';
export type KeyModifier = 'none' | 'shift' | 'ctrl' | 'alt';

export type SoundName =
  | 'game-start'
  | 'game-end'
  | 'capture'
  | 'castle'
  | 'premove'
  | 'move-self'
  | 'move-check'
  | 'move-opponent'
  | 'promote'
  | 'notify'
  | 'tenseconds'
  | 'illegal';

export type MoveRejectedReason =
  | 'off-board'
  | 'own-piece'
  | 'not-allowed'
  | 'illegal-move'
  | 'not-player-turn';

export type GameResult = '1-0' | '0-1' | '1/2-1/2';
