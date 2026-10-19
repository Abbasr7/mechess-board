# Findings: how chess.com's board behaves

This is the evidence behind the implementation in `src/`. It records **observed behaviour,
algorithms and constants** of chess.com's board component, and separates what was
*read in the shipped code* from what is *inferred* and what is *not known*.

Nothing in `src/` is copied from chess.com. The code was written from the descriptions below
(clean-room), and no chess.com artwork or sounds are included.

## 1. Scope and method

| | |
|---|---|
| Target | the board shown on `chess.com/play/computer` (package `play-computer` 2026.10.3, board library reports version `1.189.0`) |
| Inputs | an HTTrack mirror of the page supplied by the user (HTML, `play-computer.css`, `play-computer.js`, layout CSS) **plus** two ES-module chunks that the mirror did not contain because HTTrack does not follow `import` statements: `shared.eager.ZDyFHQYc7g.chunk.js` (2 742 360 B) and `chessboard-636d356.62221e19.DUIqAABagG.chunk.js` (31 110 B, the default DOM renderer). Both were fetched from the same public path as `play-computer.js` with the user's permission. |
| Tool | REA (`rea-agents@6.7.0`). The REA MCP server timed out on connect, so the **CLI fallback** `analyze-javascript-application` was used on the chunk directory (Evidence `ev_523bc87093e06b3091a0fdff34fb3c5ce211275d126f6cfda7cbebdc3035223e`, root artifact sha256 `e232f1a7…f07c`). |
| Reading | the chunks are minified; they were pretty-printed and read function by function. The REA graph was used for inventory only. |
| Evidence type | **static analysis only**. chess.com's code was never executed and the live site was not driven, so animation *timing on screen* is derived from constants in the code, not measured. |

SHA-256 of the analysed files:

```
ddd14eee3ef578502d2238a15033e624aa9f576894c8ffbb3ec8d76f32c0f96c  shared.eager.ZDyFHQYc7g.chunk.js
3d73d22caf6a62bbd9ceaf92d45c9305db20975baf0bb986355666a15d387703  chessboard-636d356.62221e19.DUIqAABagG.chunk.js
14558b3b8dc434a58027ad2a38db8be29fc5ce0563cefe0e1a2c3bc21f9cb4d1  play-computer.js
6a6795e548bb6f18f61f691a7c857b6077477cddaf816f8da4c4ba25d86d4423  play-computer.css
```

## 2. Architecture (observed)

```
wc-chess-board  (custom element, one per board)
 └─ game core  ("bke")  = api + event emitter + plugin manager + mode + renderer
      ├─ interaction state machine  – 5 states (below)
      ├─ modes      – playing, analysis, setup, observing, exploring, … (decide `isAllowedToMove`)
      ├─ plugins    – highlights, hints, hover-square, markings, premoves, sounds, coordinates, …
      ├─ game model – rules + history + `premove` sub-model
      └─ renderer   – DOM (default), WebGL-2D ("arcade"/"natural" animations), WebGL-3D
```

The DOM renderer is a **flat list of absolutely positioned children** of the board element.
Stacking order is DOM order, maintained with comment-node placeholders (one per layer). Back to front:
`coordinates · squares(highlights) · blinking-highlights · effects · hover-square · vfx-below · pieces · vfx-above · move-hints · capture-hints · arrows · promotion-window · fade-setup`
(with the *dynamic* animation type the two hint layers sit **below** the pieces).

→ implemented in `src/view/layers.ts`.

### Positioning

* Every piece/highlight/hint is a one-square element (`12.5 %`) at `left:0; top:0`, positioned by a **class**
  `square-FR` (file, rank, 1-based): `transform: translate((F-1)·100 %, (8-R)·100 %)`.
* Flipping toggles class `flipped` on the board and a second rule set mirrors the same classes:
  `translate((8-F)·100 %, (R-1)·100 %)`. No DOM node moves when the board is flipped.
* Board image is a background on the board element; arrows/coordinates are SVG with `viewBox="0 0 100 100"`,
  one square = 12.5 units. `.board.flipped .arrows { transform: scale(-1) }`.
* Pointer → board: `col = ceil((x-left)/sq)`, `row = ceil((bottom-y)/sq)`, mirrored when flipped (`9-col`, `9-row`).
  Piece-drag coordinates are `((x-left-sq/2)/width)·800` (the piece is **centred on the pointer**, 100 = one square),
  clamped to `[-50, 750]`, so a piece may overhang the board by half a square.

→ `src/squares.ts`, `src/view/styles.ts`.

## 3. Interaction state machine (observed)

States: `Idle`, `PieceSelected`, `PieceDragging`, `PromotionAreaShowing`, `AddingMarkings`.

| State | Event | Behaviour |
|---|---|---|
| **Idle** | left down on a square | emit *piece-click* if a piece is there; if the click is on a board square and user markings are enabled → **clear all non-persistent markings**. If a piece is there and the board is enabled → emit *piece-select*, → **Dragging** (with `moveMethod = click` the piece is held at its own square instead of the pointer). *Any* piece can be picked up, including the opponent's. |
| Idle / Selected | right down | → **AddingMarkings** (selection is dropped) |
| **Dragging** | pointer move | piece follows pointer (clamped coords) |
| | right *mousedown* | cancel drag → Idle |
| | pointer up on **own square** | drop; if the piece was already selected, or method is drag-only → deselect → Idle; else → **Selected** |
| | pointer up elsewhere | resolve `getMove`. **Illegal / off-board** → emit *move-rejected* (reason: off-board / own-piece / not-allowed / illegal-move / not-player-turn); piece snaps back; if it is the mover's piece **and the king is in check** → *illegal* sound + king square blinks; drag-only → Idle, otherwise → **Selected** (hints shown). **Promotion** → open window (unless `autoPromote` and Alt not held) → PromotionAreaShowing. **Legal** → move with `animate:false` → Idle. |
| **Selected** | left down on the selected piece | start dragging it again |
| | left down on a legal target | make the move **on pointer-down**, `animate:true` (click-moves slide), or open the promotion window |
| | left down elsewhere | deselect; empty square / outside → emit *move-rejected* → Idle; another piece → select it and start dragging it |
| **Promotion** | piece clicked | drop + close window + move with that promotion → Idle |
| | close button / left / right down | cancel → Idle |
| **Markings** | pointer up | same square → toggle highlight; different squares → toggle arrow; colour from the modifier held (none/shift/ctrl/alt) |
| any | game changes (move, load …) | drop selection/drag **unless** the move is by the opponent, does not touch the held square, and the held piece still exists ("holdSelectedPiece" path used by premoves) |

Hint dots are shown for the dragged **or** selected piece whenever the mode allows moving: a dot on empty
destinations, a ring on occupied ones. The square under a dragged piece gets a hover outline
(`stroke rgba(255,255,255,.65)`, width 10/100), hidden in click-method.

→ `src/board.ts` (`handleDownLeft`, `handleDownRight`, `handleUp`, `afterChange`), tests in `test/board.test.ts`.

## 4. Premoves (observed)

* Premoving is active when **the local player is not the side to move** (or before the game starts) and the user setting is on.
  In that state moving a piece does not play it; it queues it. Hints show the premove destinations.
* **Move generation is "empty board"**: the piece is placed alone on an empty board and its moves generated.
  Consequences: sliders are never blocked, own pieces never obstruct, check is ignored, captures need no target
  (pawns get both diagonals via phantom enemy pieces), pawns get a double step from their start rank, no en passant.
  The king gets castling moves when the real FEN still has the right (king on e1/e8).
* Queued moves are **validated against the position with earlier premoves applied**, so chains (`e4-e5`, `e5-e6`) work.
  The board displays the premoved position (pieces drawn already moved, no animation) and the from/to squares of every
  queued move are highlighted **`#f42a32` at 0.5 opacity**.
* A **right-click cancels the whole queue** and is swallowed (no marking starts).
* When the opponent's move arrives: the board is reloaded to the real position, the opponent's move is animated, then the
  **first** queued move is tried on the real game. Legal → played immediately, `animate:false`, flagged *isPremove*
  (sound `premove`, highlighted as a normal last-move). Illegal → the **entire queue is dropped**. If more moves remain the
  premoved view is shown again. Game over also drops the queue.
* The option `premoveDelay: 200` exists in the defaults but no code path reading it was found; it is **not** implemented.

→ `src/rules/premove.ts`, `src/board.ts` (`queuePremove`, `consumePremove`), `test/premove*.test.ts`.

## 5. Animation (observed constants)

| | |
|---|---|
| Durations | default **180 ms**, fast **100**, slow **500**, none **0**; *dynamic* uses 180 |
| Default engine ("js") | stepped: `steps = max(floor(duration/16), 1)`; one `requestAnimationFrame` per step; each step sets inline `transform: translate(x%, y%)` (linear between absolute square offsets) and `z-index:10`; the **last step clears both** so the CSS class takes over. Several animations are right-aligned so they end on the same frame. A pending animation set is flushed (jumped to its end) when the next move/position load starts. |
| Captured piece | stays at opacity 1 for ≈65 % of the steps then `opacity = min(1, 2.86 − 2.86·progress)` → 0; element recycled on the last step (only when `animate`). |
| Which moves slide | opponent/API moves: yes. Click-to-move: yes. **Drag-and-drop: no** (the piece is already there). Executed premoves: no. **The rook of a castling move always slides**, even when the king was dragged. |
| Position loads | no animation; elements are created/removed to match |
| *dynamic* | time-based tween, **ease-in-out quad**, in pixels; for horizontal travel an extra wobble of `rotate()` over 1.5× duration with keyframes 0 %→0°, 60 %→±θ, 80 %→∓θ/2, 100 %→0° where θ = sign·lerp(5°, 20°, (|Δfile|−1)/6) and easing **ease-in quad**; hint dots grow/shrink as circles (0.15 s), highlights grow as a circle (0.2 s) |
| **Drag sway** (`piece-sway` plugin; *dynamic* type + DOM renderer only) | on pick-up the piece starts at **scale 1.25** and settles to 1 in **0.2 s** with ease-out-back (it overshoots slightly below 1). While dragging it **tilts** by the pointer's horizontal speed (board-space units per frame): if the speed is above 1 the target tilt is `current + sign·speed·0.3`, clamped to **±10°**; below that the tilt is pulled back at `400 · (tilt/10) · dt` degrees, a small counter-swing (`lastSpeed·0.03`) is applied the first time it nearly reaches upright, and anything under **0.3°** snaps to 0. The shown tilt follows its target with a **0.15** low-pass per frame. Rendered as `translate(x%, y%) rotate(deg) scale(s)`. It runs in its own rAF loop, so it keeps relaxing while the pointer is still. The renderer's `dragPiece` already accepts `rotation` / `scale`; the plugin just injects them. |
| Other engines | CSS-keyframe engine and a "js-animator" engine exist behind feature flags; the WebGL-2D renderer implements "natural" and "arcade" — ported to DOM tweens in `src/fx` (see §10); WebGL-3D is **not implemented** |

→ `src/animation.ts`, `test/animation.test.ts`.

## 6. Overlays (observed)

* **Highlights**: one element per square, first spec wins (the last module to write a square wins, so the visible priority is: premoves, user markings, last move, selection).
  Last move and selection use the board theme's highlight colour (green board: `#ffff00`) at **0.5**.
* **Markings**: user highlight colours (opacity 0.8) none `#eb6150`, shift `#acce59`, ctrl `#ffaa00`, alt `#52b0dc`;
  arrow fills (alpha built in, *plus* 0.8 opacity) none `rgba(255,170,0,.8)`, shift `rgba(159,207,63,.8)`,
  ctrl `rgba(248,85,63,.8)`, alt `rgba(72,193,249,.8)`. Keyed by `type|square` / `type|fromto`; same data toggles off,
  different data replaces.
* **Arrow geometry** (percent of board width): width 2.75, head height 4.5, head width 6.5, tail padding 4.5, all in a 100-unit
  viewBox; drawn pointing down from the origin square centre and rotated. **Knight arrows** are L-shaped
  (2 squares along the long leg, then 1 across), chosen when the centre distance equals √(25²+12.5²) and the slope is ±2/±0.5; the
  polygon is rotated by 0/90/180/270° and mirrored for slopes 0.5 and −2.
* **Blink** after an illegal move in check: red `#ff0000` at 0.5 opacity, 3 on/off cycles of 500 ms.
* **Coordinates** (`inside`): rank digits at x = 0.75 (y = 3.5, 15.75, 28.25 … 90.75, size 2.8), file letters at y = 99
  (x = 10, 22.5 … 97.5); a label's class is the colour of the square under it and is filled with the *opposite* theme colour.
  `outside` = grey size 3.1 labels, `each_square` = a faint `e4`-style label bottom-right of every square.
* **Promotion window**: one square wide, 56.25 % tall, hangs from the board edge of the promotion square; order from the edge
  inwards: queen, knight, rook, bishop, close button; white promoting on an un-flipped board uses the top edge.
* **Hints**: dot = padding 4.2 % of the board width on each side (so the dot is ≈ ⅓ of a square wide), `rgba(0,0,0,.14)`; capture ring = 10 % of a square thick.

→ `src/view/*.ts`, `src/markings.ts`.

## 7. Sounds (observed)

Names: `game-start, game-end, capture, castle, premove, move-self, move-check, move-opponent, promote, notify, tenseconds, illegal`.
Priority for a move: **check > premove > promotion > capture > castle > opponent's move > own move**.
`premove` also plays when a premove is queued, `illegal` when a drop is rejected while the mover's king is in check.
The audio files are chess.com's and are not included; `src/sounds.ts` ships a Web Audio synth and accepts your own URLs.

## 8. Defaults (observed, `Tb()`)

`animationType default · boardStyle green · coordinates inside · highlightMoves true · highlightLegalMoves true · highlightOpacity 0.5 ·
hoverSquareOutline true · moveMethod drag · autoPromote false · playSounds true · premoveHighlightColor #f42a32 · premoveHighlightOpacity 0.5 ·
analysisHighlightOpacity 0.8 · checkBlinkingSquareColor #ff0000 · rounded true · disableRookCastling false (the site's play board sets it from the user's castling preference)`.

→ `src/options.ts`.

## 9. Known gaps / unknowns

* Not implemented: WebGL-3D renderer (needs proprietary models/textures), theme "takeover", move list / clocks / captured pieces /
  hand pieces (variants), game tree and variations, Chess960, observing/exploring/guess-the-move modes, textured board images,
  the original's `premoveDelay` (declared but never read), `syncEffects` (move-list coupling) and `soundTheme` (audio files).
* Never measured on the live site: real frame timing, CSS cascade interactions with chess.com's page styles,
  behaviour on touch hardware, `pseudo3d` piece layering.
* The REA graph (59 MB JSON) was produced and used for inventory; most conclusions come from reading the prettified chunks
  (the REA MCP server timed out, so the CLI `rea-agents analyze-javascript-application` was used).
* One quirk of the original that is deliberately **not** reproduced: its highlight renderer keys elements by square only, so
  removing one highlight can remove another on the same square; here highlights are diffed properly.

## 10. Added after the first pass

* **natural / arcade** (`src/fx`): keyframe animator with per-segment easing; drag lift + tilt + shadow, drop ripple, move trail, capture shrink,
  king-check pulse, hover outlines, hint pop-in/out and hover grow (natural 1.5x, arcade 1.6x). Elements positioned by a `square-FR` class are
  scaled through `--s` (the class transform is `translate(..) scale(var(--s,1))`); writing an inline `transform` would drop them onto a8.
* **VFX** (dynamic): captured ghost, trail, growing circle, king check, promote pop/ripple, illegal-move tap; opt-in extras (fidgets, throw, boxing glove, slam).
* **Keyboard**: `x` flips; arrows / numpad 4 6 8 5 step through history (`navigate` event). **Accessibility** grid with announcements.
* **Arrows**: animated (400 ms grow-in, 1.4 s breathing) and pointer-finger variants; analysis overlay; fade-in of a loaded position.
* **Rook castling**: with `disableRookCastling` false (the default) the king may be dropped on its own rook; the rook square gets a capture ring.
* **Effects** (`src/view/effects.ts`): one badge per square; static disc in the top-right corner (edge squares tuck inwards), or animated:
  flash 0.3 s, glyph grows in, pill text slides in, after a 0.7 s hold (second step 0.3 s) everything settles into the corner badge; optional fly-out
  (50 ms later, 0.5 s, 90 deg rotation, opacity 0.2) to a target point. DOM order follows the board (upper rows, then right to left).
* **Custom items** (`src/view/custom-items.ts`): star / image / text box / sprite frame (animated strips play at 24 fps on removal), creation
  animations `grow-in` / `captured`, removal class + 400 ms timeout, `visualOrder` placement relative to arrows / effects / pieces.
* **Setup mode** (`src/setup.ts`): free piece map, drag off the board deletes, any move allowed, no hints; commit validates kings, pawns on
  back ranks, adjacent kings and the side not to move being in check.
* **Game-end API**: resign / flag fall (draw when the winner cannot mate) / agreed draw / claim; `autoClaimDraw`.
