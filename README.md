# mechess-board

A **clean-room TypeScript chessboard** (vanilla DOM, zero runtime dependencies) that reproduces the
observable behaviour of chess.com's board: drag-and-drop *and* click-to-move, **premoves** (queued,
chained, executed after the opponent moves), five animation styles (stepped, dynamic, **natural**, **arcade**), VFX,
last-move/selection highlights, legal-move hints, animated right-click arrows, the promotion window, coordinates, sounds,
history navigation, accessibility, classification badges, custom items and a position editor.

It was derived by reverse engineering the board code that chess.com ships (see
[`docs/FINDINGS.md`](docs/FINDINGS.md) for the evidence, constants and what is *not* known). **No chess.com
source, artwork or audio is included**: the code was written from behavioural descriptions, pieces are loaded from
whatever URL you give it, glyphs are drawn with SVG text and sounds are synthesised.

```
npm install
npm run dev          # demo on http://localhost:5199  (bot opponent, premove playground)
npm test             # 250+ unit tests (vitest + jsdom): rules (perft), premoves, DOM interaction, animation, effects, setup …
npm run test:e2e     # 48 Playwright tests in real Chrome (drag, hover, premove, promotion, setup, resize, touch, RTL …)
npm run build:lib    # dist/index.js + dist/types
```

## Quick start

```ts
import { ChessBoard } from 'mechess-board';        // or: import … from './mechess-board/src'

const board = new ChessBoard(document.getElementById('board')!, {
  playingAs: 'w',                                       // you play white; moving out of turn = premove
  pieces: '/pieces/staunty/{piece}.svg',                // wk, bp … → any URL template or (color,type) => url
  boardStyle: 'green',
  animationType: 'default',                             // default | fast | slow | none | dynamic | natural | arcade
});

// the local user's moves (including executed premoves) → send to your server
board.on('move', (m) => { if (m.userGenerated) socket.send(m.from + m.to + (m.promotion ?? '')); });

// the opponent's move arrives → animate it (queued premoves fire right after)
socket.onmessage = (msg) => board.move(msg.data);      // "e7e5", "e7e8q" or SAN
```

The board element is made square with `padding-bottom:100%`, so just give its container a width.

Declarative alternative:

```ts
import { defineChessBoardElement } from 'mechess-board';
defineChessBoardElement();                              // <re-chess-board fen="…" playing-as="w" pieces="/p/{piece}.svg">
```

## API

| | |
|---|---|
| `new ChessBoard(container, options?)` | options below, plus `fen` |
| `board.move(move \| san \| 'e2e4', { animate?, userGenerated? })` | apply a move from code. Returns the `BoardMove` or `null` (illegal, game over, or setup mode). Executes the oldest queued premove afterwards. |
| `load(fen?)` · `getFen()` · `getPieces()` · `getPiece(sq)` · `getTurn()` · `getLastMove()` · `isCheck()` | position |
| `getLegalMoves(from?)` · `isLegalMove(move)` | legal moves of the live position |
| `getHistory()` · `getHistorySANs()` · `getHistoryFENs()` · `getPGN(headers?)` · `getMaterial()` | history |
| `undo()` | take back the last move |
| `goTo(ply)` · `back()` · `forward()` · `toStart()` · `toEnd()` · `getPly()` · `getPlyCount()` · `isAtEnd()` | history navigation (also arrow keys / numpad) |
| `resign(color?)` · `outOfTime(color)` · `agreeDraw()` · `claimDraw()` · `setResult(result, reason?)` | end the game from outside; `isGameOver()` · `getResult()` · `getGameOverReason()` |
| `flip()` · `setOptions(patch)` · `getOptions()` | appearance and behaviour |
| `getPremoves()` · `cancelPremoves()` | premove queue |
| `board.markings` | `add / toggle / remove / clear` arrows and highlights (`persistent`, `animated`, `pointerFinger`) |
| `board.effects` | classification badges: `add({ square, type: 'Brilliant', animated?, flyOut? })`, `remove`, `clear`, `fadeOut(sq)` |
| `board.customItems` | stars, images, text boxes and sprite frames pinned to squares |
| `board.vfx` | low-level VFX manager (`piece-jump`, `piece-throw`, …) |
| `board.setup` | position editor, see below |
| `board.a11y` | screen-reader grid and move announcements |
| `blinkSquare(sq, color?)` · `triggerSlam()` · `resetSlam()` · `throwPiece(sq)` | effects |
| `on(type, handler)` → unsubscribe | events below |
| `playSound(name)` · `animationComplete()` · `destroy()` | utilities |

### Events

`move` · `premove` · `premove-cancel` (`user`, `illegal`, `game-over`, `api`) · `move-rejected` (`off-board`, `own-piece`, `not-allowed`, `illegal-move`, `not-player-turn`) ·
`piece-select` · `piece-click` · `promotion-start` · `promotion-cancel` · `game-over` (`checkmate`, a draw rule, `resignation`, `timeout`, `agreement`, `abandon`) ·
`navigate` · `keydown` · `keyup` · `sound` · `load` · `setup-change` · `setup-end` ·
`effect-animation-end` · `effect-flyout-begin` · `effect-flyout-end` · `effect-fade-out-end`

`BoardMove` = SAN, from/to, captured piece, flags (capture, en passant, castle, promotion, double push), rook move, resulting FEN,
check/checkmate, plus `userGenerated`, `isPremove`, `animate`.

### Options (defaults mirror the original)

| option | default | notes |
|---|---|---|
| `mode` | `'play'` | `play` (you play `playingAs`, premoves), `analysis` (whoever is to move), `view` (read-only), `setup` (position editor) |
| `playingAs` | `'w'` | `null` = hot-seat |
| `moveMethod` | `'drag'` | `drag` (drag or click-click), `click` (piece stays until you click the target; no hover outline), `drag_only` |
| `autoPromote` | `false` | queen automatically; hold **Alt** to still get the window |
| `premoves` | `true` | |
| `disableRookCastling` | `false` | by default the king can also be dropped on its own rook to castle |
| `autoClaimDraw` | `true` | `false`: threefold / fifty-move draws need `claimDraw()` |
| `captureKeyStrokes`, `disableUserNavigation` | `true`, `false` | `x` flips; arrows / numpad 4 6 8 5 step through the moves. The keys are captured on the whole document, so with several boards on a page set `captureKeyStrokes: false` on all but one |
| `flipped` | `false` | |
| `coordinates` | `'inside'` | `inside · outside · each_square · off` |
| `boardStyle` | `'green'` | any key of `BOARD_THEMES` or `{dark, light, highlight}`; `boardImage` overrides with a CSS image |
| `pieces` | glyphs | URL template with `{piece}` or function |
| `animationType` | `'default'` | `default 180 ms · fast 100 · slow 500 · none · dynamic · natural · arcade` |
| `pieceSway` | follows `dynamic` | pick-up pop and drag tilt; usable with any animation type |
| `vfx` | follows `dynamic` | capture ghost, trails, growing circle, king-check pulse, promotion pop, illegal-tap |
| `extras` | off | opt-in fidgets, piece throw (`t`), boxing glove (`b`), board slam |
| `accessibility` | `false` | labelled grid + announcements |
| `userMarkings` | `{}` | `{ animated, pointerFinger, persistent }` for right-click arrows |
| `analysisOverlay`, `fadeSetup` | `false`, `0` | white veil; fade the empty board into the position over N ms |
| `fadeInEffects`, `effectLabels` | `false`, – | badge fade-in; pill texts per effect type |
| `highlightMoves` / `highlightLegalMoves` | `true` | last-move & selection tint / hint dots |
| `hoverSquareOutline` | `true` | outline under a dragged piece |
| `allowMarkings`, `disableUserMarkings` | `true`, `false` | right-click arrows & highlights |
| `playSounds`, `sounds` | `true`, `'synth'` | `'synth'`, a `{ 'move-self': url, … }` map, your own `{ play(name) }`, or `false` |
| `premoveHighlightColor/Opacity`, `analysisHighlightColors`, `arrowColors`, … | see `src/options.ts` | |

### Setup mode

```ts
board.setOptions({ mode: 'setup' });         // enter: the current position becomes editable
// drag any piece anywhere; drop it off the board to delete it
board.setup.dropPiece('e4', { color: 'w', type: 'q' });
board.setup.setTurn('b');
board.setup.validate();                       // [] or ['no-white-king', 'kings-adjacent', …]
board.setup.commit();                         // loads the position and leaves setup mode, or returns the problems
board.setup.cancel();                         // restore the game instead
```

Leaving the mode with `setOptions({ mode })` commits a legal position and discards an illegal one (`setup-end` tells which).

## Behaviour cheat-sheet

* Drag a piece anywhere (the piece is centred on the pointer and may overhang the board by half a square); drop on its own square to *select* it
  (hint dots), click a target to move (it slides), drop on a target to move (no slide).
* Illegal drop → the piece snaps back and stays selected; if you are in check the king blinks red and the *illegal* sound plays.
* While it is the opponent's turn the same gestures **queue premoves** (empty-board rules: nothing blocks, check is ignored, castling needs the right).
  Queued squares are red, the piece is shown already moved. Right-click cancels the queue. After the opponent moves, the first premove is
  tried; if it is illegal the whole queue is dropped.
* Right-drag draws an arrow, right-click a highlight; Shift / Ctrl / Alt pick the colour; the same marking again removes it;
  a left click on the board clears them.

## Layout

```
src/
  board.ts            ChessBoard: state machine, premove flow, overlays, setup mode, public API
  rules/chess.ts      rules engine (FEN, legal moves, SAN, draws) – perft-tested
  rules/premove.ts    empty-board premove model + queue
  animation.ts        stepped engine (default) and tween engine (dynamic)
  fx/                 keyframe animator + natural / arcade piece styles
  vfx/                CSS VFX (dynamic) and opt-in extras
  view/               DOM renderer: layers, pieces, highlights/hints, arrows, effects, custom items, coordinates, promotion window, styles
  setup.ts  markings.ts  keyboard.ts  a11y.ts  sounds.ts  themes.ts  options.ts  squares.ts  events.ts  element.ts
test/                 vitest (+ jsdom) – see FINDINGS.md for which behaviour each test pins down
demo/                 playground (vite); borrows piece SVGs from ../mechess-front/public/pieces
docs/FINDINGS.md      reverse-engineering report
```

## Not implemented (see FINDINGS §9)

WebGL-3D renderer (needs proprietary models), theme "takeover", move list / clocks / captured-pieces panels, game tree and variations,
Chess960 and other variants, textured board images.
