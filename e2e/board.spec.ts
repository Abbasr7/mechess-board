import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __board: any;
    __errors: string[];
  }
}

const FILES = 'abcdefgh';

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/e2e.html?${query}`);
  await page.waitForSelector('.board .piece');
  await page.waitForFunction(() => !!window.__board);
}

/** Centre of a square in page pixels (follows flipping). */
async function centre(page: Page, square: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.board').boundingBox())!;
  const flipped = await page.locator('.board').evaluate((el) => el.classList.contains('flipped'));
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]) - 1;
  const col = flipped ? 7 - f : f;
  const row = flipped ? r : 7 - r;
  const s = box.width / 8;
  return { x: box.x + (col + 0.5) * s, y: box.y + (row + 0.5) * s };
}

async function squareBox(page: Page, square: string): Promise<{ x: number; y: number; s: number }> {
  const c = await centre(page, square);
  const box = (await page.locator('.board').boundingBox())!;
  return { ...c, s: box.width / 8 };
}

async function drag(page: Page, from: string, to: string, steps = 8): Promise<void> {
  const a = await centre(page, from);
  const b = await centre(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

async function click(page: Page, square: string): Promise<void> {
  const c = await centre(page, square);
  await page.mouse.click(c.x, c.y);
}

const fen = (page: Page): Promise<string> => page.evaluate(() => window.__board.getFen());
const placement = async (page: Page): Promise<string> => (await fen(page)).split(' ')[0];

/** What is actually drawn (differs from the live position while browsing the history). */
const shown = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const rows: string[] = [];
    const at = new Map<string, string>();
    for (const el of document.querySelectorAll('.board .piece')) {
      const cls = [...el.classList];
      const sq = cls.find((c) => /^square-\d\d$/.test(c));
      const pc = cls.find((c) => /^[wb][pnbrqk]$/.test(c));
      if (sq && pc) at.set(sq, pc);
    }
    for (let r = 8; r >= 1; r--) {
      let row = '';
      let empty = 0;
      for (let f = 1; f <= 8; f++) {
        const p = at.get('square-' + f + r);
        if (!p) { empty++; continue; }
        if (empty) row += empty;
        empty = 0;
        row += p[0] === 'w' ? p[1].toUpperCase() : p[1];
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/');
  });

test.afterEach(async ({ page }) => {
  const errors = await page.evaluate(() => window.__errors ?? []);
  expect(errors).toEqual([]);
});

for (const animationType of ['default', 'dynamic', 'natural', 'arcade', 'none'] as const) {
  test.describe(`animation: ${animationType}`, () => {
    test('drag and drop plays a legal move and rejects an illegal one', async ({ page }) => {
      await open(page, `animationType=${animationType}`);
      await drag(page, 'e2', 'e4');
      await page.evaluate(() => window.__board.animationComplete());
      expect(await placement(page)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
      // black to move: white's next gesture is a premove, not a move
      await drag(page, 'a2', 'a3');
      expect(await placement(page)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
      expect(await page.evaluate(() => window.__board.getPremoves().length)).toBe(1);
    });

    test('an illegal drop snaps the piece home and keeps it selected', async ({ page }) => {
      await open(page, `animationType=${animationType}`);
      await drag(page, 'e2', 'e5');
      await page.waitForTimeout(700); // let drop / snap-back animations finish
      expect(await placement(page)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
      const piece = page.locator('.piece.square-52');
      const pb = (await piece.boundingBox())!;
      const home = await squareBox(page, 'e2');
      expect(Math.abs(pb.x + pb.width / 2 - home.x)).toBeLessThan(2);
      expect(Math.abs(pb.y + pb.height / 2 - home.y)).toBeLessThan(2);
      await expect(page.locator('.hint')).toHaveCount(2); // still selected: e3, e4
    });

    test('hints stay on their squares, also while hovered (regression: hint jumped to a8)', async ({ page }) => {
      await open(page, `animationType=${animationType}`);
      await click(page, 'g1');
      await page.waitForTimeout(500);
      for (const target of ['f3', 'h3']) {
        const c = await squareBox(page, target);
        await page.mouse.move(c.x, c.y, { steps: 4 });
        await page.waitForTimeout(450);
        const hint = page.locator(`.hint.square-${FILES.indexOf(target[0]) + 1}${target[1]}`);
        await expect(hint).toHaveCount(1);
        const hb = (await hint.boundingBox())!;
        expect(Math.abs(hb.x + hb.width / 2 - c.x)).toBeLessThan(2);
        expect(Math.abs(hb.y + hb.height / 2 - c.y)).toBeLessThan(2);
        expect(await hint.evaluate((el) => (el as HTMLElement).style.transform)).toBe('');
      }
      // moving away restores the size
      const away = await squareBox(page, 'd5');
      await page.mouse.move(away.x, away.y, { steps: 4 });
      await page.waitForTimeout(450);
      const widths = await page.locator('.hint').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
    });

    test('click-to-move slides the piece', async ({ page }) => {
      await open(page, `animationType=${animationType}`);
      await click(page, 'g1');
      await click(page, 'f3');
      await page.evaluate(() => window.__board.animationComplete());
      expect(await placement(page)).toBe('rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R');
      await page.waitForTimeout(600);
      const nb = (await page.locator('.piece.square-63').boundingBox())!;
      const home = await squareBox(page, 'f3');
      expect(Math.abs(nb.x + nb.width / 2 - home.x)).toBeLessThan(2);
      expect(Math.abs(nb.y + nb.height / 2 - home.y)).toBeLessThan(2);
    });
  });
}

test('premove: queued while it is the opponent\'s turn, executed after the opponent moves', async ({ page }) => {
  await open(page);
  await drag(page, 'e2', 'e4'); // now black to move
  await drag(page, 'g1', 'f3'); // premove
  await expect(page.locator('.highlight')).not.toHaveCount(0);
  expect(await page.evaluate(() => window.__board.getPremoves().map((m: any) => m.from + m.to))).toEqual(['g1f3']);
  // the premoved piece is drawn on f3 already
  await expect(page.locator('.piece.square-63')).toHaveCount(1);
  await page.evaluate(() => window.__board.move('e7e5'));
  await page.waitForTimeout(400);
  expect(await placement(page)).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R');
  expect(await page.evaluate(() => window.__board.getPremoves().length)).toBe(0);
});

test('premove: a right click cancels the queue', async ({ page }) => {
  await open(page);
  await drag(page, 'e2', 'e4');
  await drag(page, 'g1', 'f3');
  const c = await centre(page, 'd5');
  await page.mouse.click(c.x, c.y, { button: 'right' });
  expect(await page.evaluate(() => window.__board.getPremoves().length)).toBe(0);
  expect(await placement(page)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
});

test('premove: an illegal premove empties the queue after the opponent moves', async ({ page }) => {
  await open(page);
  await drag(page, 'e2', 'e4');
  await drag(page, 'd1', 'h5'); // queen premove through f3... legal only if the diagonal is open
  await page.evaluate(() => window.__board.move('f7f6'));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__board.getPremoves().length)).toBe(0);
});

test('castling by dropping the king on the rook', async ({ page }) => {
  await open(page, 'fen=r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1&animationType=none');
  await click(page, 'e1');
  await expect(page.locator('.capture-hint')).toHaveCount(2);
  await drag(page, 'e1', 'h1');
  expect(await placement(page)).toBe('r3k2r/8/8/8/8/8/8/R4RK1');
});

test('promotion window opens at the board edge and promotes', async ({ page }) => {
  await open(page, 'fen=k7/4P3/8/8/8/8/8/K7 w - - 0 1&animationType=none');
  await drag(page, 'e7', 'e8');
  const win = page.locator('.promotion-window');
  await expect(win).toBeVisible();
  const wb = (await win.boundingBox())!;
  const board = (await page.locator('.board').boundingBox())!;
  expect(Math.abs(wb.y - board.y)).toBeLessThan(2); // hangs from the top edge
  expect(Math.abs(wb.height - board.width * 0.5625)).toBeLessThan(2);
  const e8 = await squareBox(page, 'e8');
  expect(Math.abs(wb.x + wb.width / 2 - e8.x)).toBeLessThan(2);
  await page.locator('.promotion-piece.wn').click();
  expect(await placement(page)).toBe('k3N3/8/8/8/8/8/8/K7');
});

test('dynamic promotion window opens and closes smoothly', async ({ page }) => {
  await open(page, 'fen=k7/4P3/8/8/8/8/8/K7 w - - 0 1&animationType=dynamic');
  await drag(page, 'e7', 'e8');
  const win = page.locator('.promotion-window');
  await expect(win).toHaveClass(/promotion-window--visible/);
  await page.waitForTimeout(900);
  await expect(win.locator('.promotion-piece.wq')).toHaveCSS('opacity', '1');
  await page.locator('.promotion-window .close-button').click();
  await expect(win).toHaveClass(/closing/);
  await expect(win).toHaveCSS('display', 'none', { timeout: 1500 });
  expect(await placement(page)).toBe('k7/4P3/8/8/8/8/8/K7');
});

test('right-drag draws an arrow, again removes it; right click toggles a highlight', async ({ page }) => {
  await open(page);
  const a = await centre(page, 'e2');
  const b = await centre(page, 'e5');
  const arrow = async (): Promise<void> => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up({ button: 'right' });
  };
  await arrow();
  await expect(page.locator('.arrows polygon')).toHaveCount(1);
  await arrow();
  await expect(page.locator('.arrows polygon')).toHaveCount(0);
  await page.mouse.click(b.x, b.y, { button: 'right' });
  await expect(page.locator('.highlight')).toHaveCount(1);
  await page.mouse.click(b.x, b.y);
  await expect(page.locator('.highlight')).toHaveCount(0);
});

test('keyboard: x flips, arrows walk through the moves', async ({ page }) => {
  await open(page, 'animationType=none');
  await drag(page, 'e2', 'e4');
  await page.evaluate(() => window.__board.move('e7e5'));
  await page.keyboard.press('x');
  await expect(page.locator('.board')).toHaveClass(/flipped/);
  await page.keyboard.press('x');
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => window.__board.getPly())).toBe(1);
  await page.keyboard.press('ArrowUp');
  expect(await shown(page)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
  await page.keyboard.press('ArrowDown');
  expect(await shown(page)).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR');
});

test('flipped board maps pointer input correctly', async ({ page }) => {
  await open(page, 'flipped=true&playingAs=b&fen=rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1&animationType=none');
  await drag(page, 'e7', 'e5');
  expect(await placement(page)).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR');
});

test('natural: dragged piece lifts and tilts, then lands cleanly', async ({ page }) => {
  await open(page, 'animationType=natural');
  const a = await centre(page, 'e2');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 150, a.y - 50, { steps: 6 });
  await page.waitForTimeout(100);
  const during = await page.locator('.piece.dragging').evaluate((el) => (el as HTMLElement).style.transform);
  expect(during).toMatch(/scale\(1\.\d+\)/);
  await page.mouse.move((await centre(page, 'e4')).x, (await centre(page, 'e4')).y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const after = await page.locator('.piece.square-54').evaluate((el) => (el as HTMLElement).style.transform);
  expect(after).toBe('');
});

test('dynamic: dragged piece pops and tilts (piece sway)', async ({ page }) => {
  await open(page, 'animationType=dynamic');
  const a = await centre(page, 'e2');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 200, a.y - 30, { steps: 5 });
  const transform = await page.locator('.piece.dragging').evaluate((el) => (el as HTMLElement).style.transform);
  expect(transform).toContain('rotate(');
  await page.mouse.up();
});

test('setup mode: free moves, deleting by dragging off the board, commit', async ({ page }) => {
  await open(page, 'mode=setup&animationType=none');
  await drag(page, 'a1', 'a5');
  expect((await page.evaluate(() => window.__board.setup.getFen())).split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/R7/8/8/PPPPPPPP/1NBQKBNR');
  const e2 = await centre(page, 'e2');
  await page.mouse.move(e2.x, e2.y);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 6 });
  await page.mouse.up();
  expect((await page.evaluate(() => window.__board.setup.getFen())).split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/R7/8/8/PPPP1PPP/1NBQKBNR');
  expect(await page.evaluate(() => window.__board.setup.commit())).toEqual([]);
  expect(await placement(page)).toBe('rnbqkbnr/pppppppp/8/R7/8/8/PPPP1PPP/1NBQKBNR');
});

test('effects: animated badge flashes, settles into the corner and reports', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    (window as any).__log = [];
    window.__board.on('effect-animation-end', () => (window as any).__log.push('end'));
    window.__board.effects.add({ square: 'e4', type: 'Brilliant', animated: true });
  });
  const el = page.locator('.animated-effect');
  await expect(el.locator('.text')).toHaveText('Brilliant!');
  await expect.poll(() => page.evaluate(() => (window as any).__log.length), { timeout: 3000 }).toBe(1);
  const badge = (await el.locator('.icon-background').boundingBox())!;
  const e4 = await squareBox(page, 'e4');
  // settled at the top-right corner of e4
  expect(badge.x + badge.width / 2).toBeGreaterThan(e4.x + e4.s * 0.3);
  expect(badge.y + badge.height / 2).toBeLessThan(e4.y - e4.s * 0.3);
  await page.screenshot({ path: 'e2e/.results/effects.png' });
});

test('static badges and custom items render on the right squares', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.__board.effects.addAll([
      { square: 'h8', type: 'Mate' },
      { square: 'e4', type: 'Blunder' },
    ]);
    window.__board.customItems.add({ square: 'c3', type: 'Star' });
  });
  const blunder = (await page.locator('.effect.blunder').boundingBox())!;
  const e4 = await squareBox(page, 'e4');
  // the badge box starts 0.44 squares right of the square's left edge
  expect(Math.abs(blunder.x - (e4.x - e4.s / 2 + e4.s * 0.44))).toBeLessThan(2);
  const star = (await page.locator('.custom-item').boundingBox())!;
  const c3 = await squareBox(page, 'c3');
  expect(Math.abs(star.x + star.width / 2 - c3.x)).toBeLessThan(2);
  expect(Math.abs(star.y + star.height / 2 - c3.y)).toBeLessThan(2);
  // the h8 badge is tucked: it stays inside the board
  const board = (await page.locator('.board').boundingBox())!;
  const mate = (await page.locator('.effect.mate svg').boundingBox())!; // the visible glyph, not the padded box
  expect(mate.x + mate.width).toBeLessThanOrEqual(board.x + board.width + 1);
  expect(mate.y).toBeGreaterThanOrEqual(board.y - 1);
  await page.screenshot({ path: 'e2e/.results/badges.png' });
});

test('game end from outside blocks input', async ({ page }) => {
  await open(page, 'animationType=none');
  await page.evaluate(() => window.__board.resign('b'));
  await drag(page, 'e2', 'e4');
  expect(await placement(page)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
  expect(await page.evaluate(() => window.__board.getResult())).toBe('1-0');
});

test('layout: the board is square and fills its container', async ({ page }) => {
  await open(page);
  const box = (await page.locator('.board').boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(1);
  expect(box.width).toBeCloseTo(640, 0);
  // every initial piece sits exactly on its square
  const squares = await page.locator('.piece').evaluateAll((els) =>
    els.map((el) => {
      const cls = [...el.classList].find((c) => /^square-\d\d$/.test(c))!;
      const r = el.getBoundingClientRect();
      return { cls, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );
  expect(squares.length).toBe(32);
  for (const s of squares) {
    const f = Number(s.cls[7]) - 1;
    const r = Number(s.cls[8]) - 1;
    const c = await centre(page, FILES[f] + (r + 1));
    expect(Math.abs(s.x - c.x)).toBeLessThan(1.5);
    expect(Math.abs(s.y - c.y)).toBeLessThan(1.5);
  }
});

test('resizing the window keeps pieces on their squares (percent based layout)', async ({ page }) => {
  await open(page, 'animationType=none');
  await page.setViewportSize({ width: 420, height: 800 });
  await page.waitForTimeout(100);
  const e1 = await squareBox(page, 'e1');
  const king = (await page.locator('.piece.square-51').boundingBox())!;
  expect(Math.abs(king.x + king.width / 2 - e1.x)).toBeLessThan(1.5);
  expect(Math.abs(king.y + king.height / 2 - e1.y)).toBeLessThan(1.5);
});

test('touch: tapping works like clicking', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 500, height: 800 }, channel: 'chrome' } as never);
  const page = await ctx.newPage();
  await open(page, 'animationType=none');
  const g1 = await centre(page, 'g1');
  const f3 = await centre(page, 'f3');
  await page.touchscreen.tap(g1.x, g1.y);
  await page.touchscreen.tap(f3.x, f3.y);
  expect(await placement(page)).toBe('rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R');
  await ctx.close();
});
