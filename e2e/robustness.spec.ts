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
}
async function centre(page: Page, square: string, board = 0): Promise<{ x: number; y: number }> {
  const loc = page.locator('.board').nth(board);
  const box = (await loc.boundingBox())!;
  const flipped = await loc.evaluate((el) => el.classList.contains('flipped'));
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]) - 1;
  const s = box.width / 8;
  return { x: box.x + ((flipped ? 7 - f : f) + 0.5) * s, y: box.y + ((flipped ? r : 7 - r) + 0.5) * s };
}
const errors = (page: Page): Promise<string[]> => page.evaluate(() => window.__errors);

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw new Error(`page error: ${e.message}`);
  });
});

test('dropping a piece outside the board (play mode) sends it home without errors', async ({ page }) => {
  await open(page, 'animationType=natural');
  const a = await centre(page, 'e2');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__board.getFen())).toContain('PPPPPPPP');
  expect(await page.locator('.piece.square-52').count()).toBe(1);
  expect(await errors(page)).toEqual([]);
});

test('a right click during a drag cancels it', async ({ page }) => {
  await open(page, 'animationType=default');
  const a = await centre(page, 'e2');
  const b = await centre(page, 'e4');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__board.getFen().split(' ')[0])).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
  expect(await errors(page)).toEqual([]);
});

test('destroy() in the middle of a drag and of an animation leaves no errors behind', async ({ page }) => {
  for (const type of ['default', 'dynamic', 'natural', 'arcade']) {
    await open(page, `animationType=${type}`);
    const a = await centre(page, 'g1');
    const b = await centre(page, 'f3');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.evaluate(() => window.__board.destroy());
    await page.mouse.move(b.x + 20, b.y, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await errors(page), type).toEqual([]);

    await open(page, `animationType=${type}`);
    await page.evaluate(() => {
      window.__board.move('e2e4');
      window.__board.destroy();
    });
    await page.waitForTimeout(500);
    expect(await errors(page), type).toEqual([]);
  }
});

test('two boards on one page do not interfere', async ({ page }) => {
  await open(page, 'animationType=none');
  await page.evaluate(async () => {
        const host = document.createElement('div');
    host.id = 'board2';
    host.style.cssText = 'width:320px;margin:20px';
    document.body.appendChild(host);
    (window as any).__board2 = new (window as any).__ChessBoard(host, { sounds: false, animationType: 'none', boardStyle: 'brown', pieces: '/pieces/staunty/{piece}.svg' });
  });
  const a = await centre(page, 'e2', 0);
  const b = await centre(page, 'e4', 0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  const f1 = await page.evaluate(() => window.__board.getFen().split(' ')[0]);
  const f2 = await page.evaluate(() => (window as any).__board2.getFen().split(' ')[0]);
  expect(f1).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
  expect(f2).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
  // selecting on board 2 does not leave a selection on board 1
  await page.locator('.board').nth(1).scrollIntoViewIfNeeded();
  const g = await centre(page, 'g1', 1);
  await page.mouse.click(g.x, g.y);
  expect(await page.locator('.board').nth(1).locator('.hint').count()).toBe(2);
  expect(await page.locator('.board').nth(0).locator('.hint').count()).toBe(0);
  // two separate style sheets with their own piece/board rules
  expect(await page.locator('style[id^="reboard"], style').count()).toBeGreaterThanOrEqual(2);
  expect(await errors(page)).toEqual([]);
});

test('options can change at run time without breaking the position', async ({ page }) => {
  await open(page, 'animationType=default');
  await page.evaluate(() => {
    const b = window.__board;
    b.move('e2e4', { animate: false });
    for (const t of ['dynamic', 'natural', 'arcade', 'fast', 'slow', 'none', 'default']) b.setOptions({ animationType: t });
    b.setOptions({ boardStyle: 'brown', coordinates: 'outside', flipped: true, highlightMoves: false, rounded: false });
    b.setOptions({ coordinates: 'each_square', flipped: false, accessibility: true, pieceSway: true, vfx: true });
    b.setOptions({ accessibility: false, analysisOverlay: true, fadeSetup: 300 });
    b.load();
  });
  await page.waitForTimeout(400);
  expect(await page.locator('.piece').count()).toBe(32);
  expect(await errors(page)).toEqual([]);
  // still playable
  const a = await centre(page, 'd2');
  const b = await centre(page, 'd4');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__board.getFen().split(' ')[0])).toBe('rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR');
});

test('API moves during a running animation do not corrupt the board', async ({ page }) => {
  for (const type of ['default', 'dynamic', 'natural', 'arcade']) {
    await open(page, `animationType=${type}&playingAs=null`);
    await page.evaluate(() => {
      const b = window.__board;
      for (const m of ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1', 'f6e4']) b.move(m); // no waiting
    });
    await page.waitForTimeout(1200);
    const drawn = await page.evaluate(() => [...document.querySelectorAll('.board .piece')].length);
    expect(drawn, type).toBe(31); // black knight took a pawn
    // every drawn piece sits on the square its class says
    const stray = await page.evaluate(() =>
      [...document.querySelectorAll('.board .piece')].filter((el) => (el as HTMLElement).style.transform !== '').length,
    );
    expect(stray, type).toBe(0);
    expect(await errors(page), type).toEqual([]);
  }
});

test('undo, load and navigation while animating', async ({ page }) => {
  await open(page, 'animationType=dynamic&playingAs=null');
  await page.evaluate(() => {
    const b = window.__board;
    b.move('e2e4');
    b.move('e7e5');
    b.undo();
    b.move('d7d5');
    b.back();
    b.forward();
    b.toStart();
    b.toEnd();
    b.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  });
  await page.waitForTimeout(600);
  expect(await page.locator('.piece').count()).toBe(2);
  expect(await errors(page)).toEqual([]);
});

test('a11y grid is present and labelled', async ({ page }) => {
  await open(page, 'accessibility=true');
  const cells = await page.locator('.a11y-overlay [role="gridcell"] div').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(cells.length).toBe(64);
  expect(cells[0]).toBe('black rook on a8');
});

test('big and tiny boards both lay out squares exactly', async ({ page }) => {
  for (const width of [160, 333, 1000]) {
    await page.setViewportSize({ width: width + 60, height: width + 60 });
    await page.goto(`/e2e.html?animationType=none`);
    await page.addStyleTag({ content: `#board{width:${width}px !important}` });
    await page.waitForSelector('.board .piece');
    const k = (await page.locator('.piece.square-51').boundingBox())!;
    const c = await centre(page, 'e1');
    expect(Math.abs(k.x + k.width / 2 - c.x)).toBeLessThan(1);
    expect(Math.abs(k.width - width / 8)).toBeLessThan(1);
  }
});

test('dark colour scheme and RTL pages keep the board usable', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page, 'animationType=none');
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  const a = await centre(page, 'e2');
  const b = await centre(page, 'e4');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__board.getFen().split(' ')[0])).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
  // pieces still on their squares in RTL
  const k = (await page.locator('.piece.square-51').boundingBox())!;
  const c = await centre(page, 'e1');
  expect(Math.abs(k.x + k.width / 2 - c.x)).toBeLessThan(1.5);
});
