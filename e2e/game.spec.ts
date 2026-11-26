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
  // Background tabs pause animation frames; act like the player picked up this device.
  await page.bringToFront();
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

type Sol = { __cs: { solution(): [number, number][] } };

async function openRoom(context: import('@playwright/test').BrowserContext, hostName: string) {
  const host = await context.newPage();
  await unlock(host);
  await host.evaluate((n) => localStorage.setItem('cs.name', JSON.stringify(n)), hostName);
  await host.reload();
  await host.getByRole('button', { name: /Race someone/ }).click();
  await expect(host.getByRole('status')).toContainText('Waiting for players');
  const link = (await host.locator('.link-text').textContent())!;
  return { host, link };
}

async function joinRoom(context: import('@playwright/test').BrowserContext, link: string, name: string) {
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate((n) => localStorage.setItem('cs.name', JSON.stringify(n)), name);
  await page.goto(link);
  return page;
}

test.describe('multiplayer races', () => {
  test('2 players: same puzzle, live view, placings, and a both-tap rematch', async ({ context }) => {
    const { host, link } = await openRoom(context, 'Sam');
    expect(link).toMatch(/#room=[A-Z2-9]{10}$/);
    await expect(host.locator('#start-race')).toBeDisabled();

    const guest = await joinRoom(context, link, 'Jo');
    await expect(guest.getByRole('status')).toContainText('Waiting for Sam to start');
    await expect(host.getByRole('status')).toContainText('2 players in');
    await expect(host.locator('#start-race')).toBeEnabled();

    await host.getByRole('button', { name: /Warm-up/ }).click();
    await expect(guest.locator('.lede')).toContainText('Warm-up');
    await host.click('#start-race');
    await expect(host.locator('.countdown')).toHaveCount(0, { timeout: 8000 });
    await expect(guest.locator('.countdown')).toHaveCount(0, { timeout: 8000 });
    expect(await host.locator('.shelves').innerHTML()).toBe(await guest.locator('.shelves').innerHTML());

    const [first] = await guest.evaluate(() => (window as unknown as Sol).__cs.solution());
    await guest.click(`.rod[data-rod="${first![0]}"]`);
    await guest.click(`.rod[data-rod="${first![1]}"]`);
    await expect(host.locator('[data-player="Jo"] .status')).toHaveText('1 moves');

    await solveByTapping(host);
    await expect(host.locator('.note')).toContainText('You came 1st! Waiting for Jo');
    await expect(guest.locator('[data-player="Sam"] .status')).toHaveText('1st');
    await solveByTapping(guest);

    await expect(host.getByRole('dialog')).toContainText('You win!');
    await expect(guest.getByRole('dialog')).toContainText('You came 2nd');
    await expect(guest.locator('.standings')).toContainText('Sam');

    await guest.locator('#rematch').click();
    await expect(guest.locator('#rematch')).toHaveText('Waiting for the others…');
    await expect(host.getByRole('dialog')).toContainText('Ready: Jo. Waiting for Sam.');
    await host.getByRole('dialog').getByRole('button', { name: /Easy/ }).click();
    await expect(guest.getByRole('dialog')).toContainText('Next level: 2 Easy');
    await host.locator('#rematch').click();
    await expect(guest.locator('.heading small')).toContainText('Easy, round 2');
    await expect(host.locator('.heading small')).toContainText('Easy, round 2');
  });

  test('3 players: everyone gets a place and points; giving up scores nothing', async ({ context }) => {
    const { host, link } = await openRoom(context, 'Ian');
    const keira = await joinRoom(context, link, 'Keira');
    const jake = await joinRoom(context, link, 'Jake');
    await expect(host.getByRole('status')).toContainText('3 players in');
    await expect(jake.locator('.players')).toContainText('Keira');
    await host.bringToFront();
    await host.getByRole('button', { name: /Warm-up/ }).click();
    await host.click('#start-race');
    for (const p of [host, keira, jake]) await expect(p.locator('.countdown')).toHaveCount(0, { timeout: 8000 });
    await expect(keira.locator('.opponents [data-player]')).toHaveCount(2);

    await solveByTapping(keira);
    await expect(keira.locator('.note')).toContainText('You came 1st! Waiting for Ian and Jake');
    await solveByTapping(host);
    await jake.bringToFront();
    await jake.getByRole('button', { name: 'Give up' }).click();
    await jake.getByRole('button', { name: 'Tap again to give up' }).click();

    for (const p of [host, keira, jake]) await expect(p.getByRole('dialog')).toBeVisible();
    await expect(keira.getByRole('dialog')).toContainText('You win!');
    await expect(host.getByRole('dialog')).toContainText('You came 2nd');
    await expect(jake.getByRole('dialog')).toContainText('Race over');
    const rows = jake.locator('.standings tbody tr');
    await expect(rows.nth(0)).toContainText('1stKeira');
    await expect(rows.nth(0).locator('.pts')).toHaveText('3');
    await expect(rows.nth(1).locator('.pts')).toHaveText('2');
    await expect(rows.nth(2)).toContainText('gave up');
    await expect(rows.nth(2).locator('.pts')).toHaveText('0');

    // Rematch only starts once all three have tapped.
    await keira.bringToFront();
    await keira.locator('#rematch').click();
    await host.bringToFront();
    await host.locator('#rematch').click();
    await expect(jake.getByRole('dialog')).toContainText('Ready: Ian and Keira. Waiting for Jake.');
    await jake.bringToFront();
    await jake.locator('#rematch').click();
    for (const p of [host, keira, jake]) await expect(p.locator('.heading small')).toContainText('round 2');
  });

  test('a 5th player is turned away, and someone joining mid-race plays the next round', async ({ context }) => {
    const { host, link } = await openRoom(context, 'Ian');
    const a = await joinRoom(context, link, 'Keira');
    await expect(host.getByRole('status')).toContainText('2 players in');
    await host.bringToFront();
    await host.getByRole('button', { name: /Warm-up/ }).click();
    await host.click('#start-race');
    await expect(a.locator('.countdown')).toHaveCount(0, { timeout: 8000 });

    const late = await joinRoom(context, link, 'Jake');
    await expect(late.getByRole('status')).toContainText('A race is on right now');
    const b = await joinRoom(context, link, 'Ly');
    await expect(host.locator('.opponents [data-player]')).toHaveCount(1); // late joiners aren't racing
    const fifth = await joinRoom(context, link, 'Nana');
    await expect(fifth.getByRole('heading', { name: 'This race is full' })).toBeVisible();

    await solveByTapping(host);
    await solveByTapping(a);
    await a.bringToFront();
    await a.locator('#rematch').click();
    await host.bringToFront();
    await host.locator('#rematch').click();
    for (const p of [late, b]) await expect(p.locator('.heading small')).toContainText('round 2', { timeout: 10_000 });
    await expect(host.locator('.opponents [data-player]')).toHaveCount(3);
  });

  test('a dead room link shows it is connecting (the real transport then says the room was not found)', async ({ page }) => {
    await unlock(page);
    await page.evaluate(() => localStorage.setItem('cs.name', JSON.stringify('Jo')));
    await page.goto('/#room=ABCDEFGHJK');
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
