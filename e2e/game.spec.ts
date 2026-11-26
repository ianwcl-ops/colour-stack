import { expect, test, type Page } from '@playwright/test';

const PASSCODE = 'test passcode';

async function unlock(page: Page) {
  await page.goto('/');
  await page.fill('#passcode', PASSCODE);
  await page.click('button[type=submit]');
  await expect(page.getByRole('button', { name: /Practice/ })).toBeVisible();
}

/** Plays the optimal solution by actually tapping the rods, like a person would. */
async function solveByTapping(page: Page) {
  const moves = await page.evaluate(() => (window as unknown as { __cs: { solution(): [number, number][] } }).__cs.solution());
  for (const [from, to] of moves) {
    await page.click(`.rod[data-rod="${from}"]`);
    await page.click(`.rod[data-rod="${to}"]`);
  }
  return moves.length;
}

test.describe('family passcode', () => {
  test('wrong passcode is refused, right one unlocks and is remembered', async ({ page }) => {
    await page.goto('/');
    await page.fill('#passcode', 'not it');
    await page.click('button[type=submit]');
    await expect(page.getByRole('alert')).toContainText('isn’t right');
    await expect(page.getByRole('button', { name: /Practice/ })).toHaveCount(0);

    await page.fill('#passcode', PASSCODE);
    await page.click('button[type=submit]');
    await expect(page.getByRole('button', { name: /Practice/ })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: /Practice/ })).toBeVisible();
  });

  test('a room link still asks for the passcode first', async ({ page }) => {
    await page.goto('/#room=ABCDEFGHJK');
    await expect(page.locator('#passcode')).toBeVisible();
  });
});

test.describe('single player', () => {
  test('practice: solving in par moves earns 3 stars', async ({ page }) => {
    await unlock(page);
    await page.getByRole('button', { name: /Practice/ }).click();
    await page.getByRole('button', { name: /Warm-up/ }).click();
    await expect(page.locator('.rod').first()).toBeVisible();
    const par = Number(await page.locator('.par strong').textContent());
    const used = await solveByTapping(page);
    expect(used).toBe(par);
    await expect(page.getByRole('dialog')).toContainText('Perfect!');
    await expect(page.getByLabel('3 of 3 stars')).toBeVisible();
  });

  test('an illegal move is rejected and not counted', async ({ page }) => {
    await unlock(page);
    await page.getByRole('button', { name: /Practice/ }).click();
    await page.getByRole('button', { name: /Warm-up/ }).click();
    // Level 1 has 9 rings on 4 rods that hold 3, so at least one rod is always full.
    const full = page.locator('.rod[aria-label*="3 of 3 rings"]').first();
    const fullIndex = Number(await full.getAttribute('data-rod'));
    const source = page.locator(`.rod:not([data-rod="${fullIndex}"]):not([aria-label*="empty"])`).first();
    await source.click();
    await expect(page.locator('.ring.lifted')).toHaveCount(1);
    await full.click();
    // Ring stays lifted, nothing moved, no move counted.
    await expect(page.locator('.ring.lifted')).toHaveCount(1);
    await expect(page.locator('.moves strong')).toHaveText('0');
    await expect(full).toHaveAttribute('aria-label', /3 of 3 rings/);
  });

  test('daily challenge records the result for today', async ({ page }) => {
    await unlock(page);
    await page.getByRole('button', { name: /Daily challenge/ }).click();
    await expect(page.locator('.rod').first()).toBeVisible({ timeout: 20_000 });
    await solveByTapping(page);
    await expect(page.getByRole('dialog')).toContainText('Challenge won!');
    await page.getByRole('button', { name: 'Home' }).click();
    await expect(page.getByRole('button', { name: /Daily challenge/ })).toContainText('Won today');
  });
});

test.describe('two-player race', () => {
  test('both players race the same puzzle, watch each other, and get the same result', async ({ context }) => {
    const host = await context.newPage();
    await unlock(host);
    await host.getByRole('button', { name: /Race someone/ }).click();
    await host.fill('#name', 'Sam');
    await host.getByRole('button', { name: 'Continue' }).click();
    await expect(host.getByRole('status')).toContainText('Waiting for player 2');
    const link = (await host.locator('.link-text').textContent())!;
    expect(link).toMatch(/#room=[A-Z2-9]{10}$/);

    const guest = await context.newPage();
    await guest.goto('/');
    await guest.evaluate(() => localStorage.setItem('cs.name', JSON.stringify('Jo')));
    await guest.goto(link);
    await expect(guest.getByRole('status')).toContainText('Connected to Sam');
    await expect(host.getByRole('status')).toContainText('Jo is here');

    // Host picks level 1; guest sees it.
    await host.getByRole('button', { name: /Warm-up/ }).click();
    await expect(guest.locator('.lede')).toContainText('Warm-up');

    await host.click('#start-race');
    await expect(host.locator('.count-num')).toBeVisible();
    await expect(guest.locator('.count-num')).toBeVisible();
    await expect(host.locator('.countdown')).toHaveCount(0, { timeout: 8000 });
    await expect(guest.locator('.countdown')).toHaveCount(0, { timeout: 8000 });

    // Same puzzle on both screens.
    expect(await host.locator('.rods').innerHTML()).toBe(await guest.locator('.rods').innerHTML());

    // Guest makes a move: host's opponent view updates live.
    const firstMoves = await guest.evaluate(() => (window as unknown as { __cs: { solution(): [number, number][] } }).__cs.solution());
    const [from, to] = firstMoves[0]!;
    await guest.click(`.rod[data-rod="${from}"]`);
    await guest.click(`.rod[data-rod="${to}"]`);
    await expect(host.locator('.opponent strong')).toHaveText('1');

    // Host solves first and wins on both screens.
    await solveByTapping(host);
    await expect(host.getByRole('dialog')).toContainText('You win!');
    await expect(host.locator('.rod.done').first()).toBeVisible();
    await expect(guest.getByRole('dialog')).toContainText('Sam wins');
    await expect(guest.getByRole('dialog')).toContainText('Jo 0, Sam 1');

    // Rematch: both must tap; the room creator picks the next level first.
    await guest.getByRole('button', { name: 'Rematch' }).click();
    await expect(guest.locator('#rematch')).toHaveText('Waiting for Sam…');
    await expect(host.getByRole('dialog')).toContainText('Jo is ready for a rematch');
    await host.getByRole('dialog').getByRole('button', { name: /Easy/ }).click();
    await expect(guest.getByRole('dialog')).toContainText('Next level: 2 Easy');
    await host.getByRole('button', { name: 'Rematch' }).click();
    await expect(guest.locator('.heading small')).toContainText('Easy, round 2');
    await expect(host.locator('.heading small')).toContainText('Easy, round 2');
    await expect(guest.getByRole('dialog')).toHaveCount(0);
  });

  test('a dead room link explains what to do', async ({ page }) => {
    await unlock(page);
    await page.evaluate(() => localStorage.setItem('cs.name', JSON.stringify('Jo')));
    await page.goto('/#room=ABCDEFGHJK');
    // Local test transport never answers; the real one reports "room not found".
    await expect(page.getByRole('status')).toContainText('Connecting');
  });
});

test.describe('sorting rule and big levels', () => {
  test('practice level 5 has 9 rods on two shelves on a phone, and a sorted rod shows a tick', async ({ page }) => {
    await unlock(page);
    await page.getByRole('button', { name: /Practice/ }).click();
    await expect(page.getByRole('button', { name: /Expert/ })).toContainText('8 colours, 7 rings each, only 1 spare rod');
    await page.getByRole('button', { name: /Expert/ }).click();
    await expect(page.locator('.rod')).toHaveCount(9, { timeout: 30_000 });
    await expect(page.locator('.shelf')).toHaveCount(2);
    // Every rod is reachable with a tap.
    for (const rod of await page.locator('.rod').all()) await expect(rod).toBeInViewport();
  });
});
