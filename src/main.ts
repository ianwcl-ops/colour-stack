import '@fontsource-variable/fredoka';
import './style.css';
import { checkPasscode } from './access/passcode';
import { newRoomCode, roomFromHash, roomLink } from './access/room';
import { E2E, PASSCODE_HASH, transport } from './config';
import { dailyPuzzleSpec } from './engine/daily';
import type { Puzzle } from './engine/generate';
import { getLevel, LEVELS } from './engine/levels';
import { makePuzzle } from './engine/make-puzzle';
import { stars } from './engine/score';
import {
  allReady,
  canStart,
  createMatch,
  HOST_ID,
  MAX_PLAYERS,
  me,
  newPid,
  playerPuzzle,
  reduce,
  restoreHost,
  SEAT_HOLD_MS,
  type MatchEvent,
  type MatchState,
  type Out,
  type Player,
  type PuzzleData,
} from './net/match';
import { resilientGuest, type ResilientGuest } from './net/resilient';
import type { HostTransport, TransportError } from './net/transport';
import { store } from './storage';
import { formatTime, h, mount, reducedMotion } from './ui/dom';
import { OpponentsPanel, ordinal } from './ui/opponents';
import { ringEl } from './ui/rings';
import { GameSession } from './ui/session';

const app = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

function show(...nodes: Node[]): void {
  cleanup?.();
  cleanup = null;
  mount(app, ...nodes);
  window.scrollTo(0, 0);
}

const toData = (p: Puzzle): PuzzleData => ({
  seed: p.seed,
  level: p.level,
  start: p.start,
  par: p.par,
  parIsMinimum: p.parIsMinimum,
});

/* ---------- Gate ---------- */

function gate(next: () => void): void {
  if (store.unlockedHash() === PASSCODE_HASH) return next();
  const input = h<'input'>('input', {
    type: 'password',
    id: 'passcode',
    autocomplete: 'current-password',
    autocapitalize: 'none',
    required: true,
  });
  const error = h('p.error', { role: 'alert' });
  const button = h<'button'>('button.primary', { type: 'submit' }, 'Unlock');
  const form = h<'form'>(
    'form.gate',
    {
      onsubmit: async (ev) => {
        ev.preventDefault();
        button.disabled = true;
        error.textContent = '';
        if (await checkPasscode(input.value, PASSCODE_HASH)) {
          store.setUnlockedHash(PASSCODE_HASH);
          next();
        } else {
          error.textContent = 'That passcode isn’t right. Check with whoever sent you the link.';
          button.disabled = false;
          input.select();
        }
      },
    },
    h('label', { for: 'passcode' }, 'Family passcode'),
    input,
    error,
    button,
  );
  show(h('main.screen.centre', {}, logo(), h('p.lede', {}, 'This game is just for family.'), form));
  input.focus();
}

/* ---------- Home ---------- */

function logo(animated = false): HTMLElement {
  // A single rod with rings dropping on: the one orchestrated moment.
  const colours = [3, 2, 1, 0];
  const stack = h('span.stack', {}, ...colours.map((c) => ringEl(c)));
  const el = h('div.logo', {}, h('div.logo-rod', {}, h('span.pole'), stack), h('h1', {}, 'Colour Stack'));
  if (animated && !reducedMotion()) {
    [...stack.children].forEach((ring, i) =>
      (ring as HTMLElement).animate(
        [{ transform: 'translateY(-160px)', opacity: 0 }, { transform: 'translateY(4px)', opacity: 1, offset: 0.8 }, { transform: 'none' }],
        { duration: 520, delay: 120 + i * 140, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'backwards' },
      ),
    );
  }
  return el;
}

function home(): void {
  history.replaceState(null, '', location.pathname);
  const today = dailyPuzzleSpec(new Date());
  const done = store.daily(today.key);
  const dailyNote = done
    ? done.moves <= done.par
      ? `Won today in ${done.moves} moves`
      : `Best today: ${done.moves} moves, par ${done.par}`
    : `${getLevel(today.level).name} level`;

  show(
    h(
      'main.screen.home',
      {},
      logo(true),
      h('p.lede', {}, 'Sort the rings so every rod holds just one colour. Fewest moves wins the stars.'),
      h(
        'nav.menu',
        {},
        h(
          'button.primary.big',
          { type: 'button', onclick: () => withName(hostRace) },
          h('span', {}, 'Race someone'),
          h('small', {}, '2 to 4 players, same puzzle, live'),
        ),
        h(
          'button.big.daily',
          { type: 'button', onclick: () => daily() },
          h('span', {}, 'Daily challenge'),
          h('small', {}, dailyNote),
        ),
        h(
          'button.big',
          { type: 'button', onclick: () => practiceMenu() },
          h('span', {}, 'Practice'),
          h('small', {}, 'Pick a level from 1 to 5'),
        ),
      ),
      store.name()
        ? h(
            'p.whoami',
            {},
            `Playing as ${store.name()}. `,
            h('button.link', { type: 'button', onclick: () => askName(home) }, 'Change name'),
          )
        : null,
    ),
  );
}

function askName(next: () => void): void {
  const input = h<'input'>('input', { id: 'name', maxlength: 16, autocomplete: 'nickname', value: store.name(), required: true });
  show(
    h(
      'main.screen.centre',
      {},
      h(
        'form.gate',
        {
          onsubmit: (ev) => {
            ev.preventDefault();
            const n = input.value.trim();
            if (!n) return;
            store.setName(n);
            next();
          },
        },
        h('label', { for: 'name' }, 'Your name'),
        h('p.help', {}, 'Your opponent sees this.'),
        input,
        h('button.primary', { type: 'submit' }, 'Continue'),
      ),
    ),
  );
  input.focus();
}

function withName(next: () => void): void {
  if (store.name()) next();
  else askName(next);
}

/* ---------- Shared bits ---------- */

function loading(text: string): void {
  show(h('main.screen.centre', {}, h('div.spinner', { 'aria-hidden': 'true' }, ringEl(0), ringEl(1), ringEl(2)), h('p.lede', { role: 'status' }, text)));
}

function starRow(n: number): HTMLElement {
  return h('div.stars', { 'aria-label': `${n} of 3 stars` }, ...[1, 2, 3].map((i) => h(`span.star${i <= n ? '.on' : ''}`, { style: `--i:${i}` }, '★')));
}

function sheet(title: string, body: (Node | null)[], actions: HTMLElement[], focus = true): HTMLElement {
  const el = h(
    'div.sheet-backdrop',
    {},
    h('section.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' }, h('h2', { id: 'sheet-title' }, title), ...body, h('div.sheet-actions', {}, ...actions)),
  );
  document.body.append(el);
  if (focus) actions[0]?.focus();
  return el;
}

/* ---------- Practice ---------- */

function practiceMenu(): void {
  const current = store.practiceLevel();
  show(
    h(
      'main.screen.levels',
      {},
      h('header.bar', {}, h('button.back', { type: 'button', onclick: home }, 'Back'), h('div.heading', {}, h('span', {}, 'Practice'))),
      h('h2.title', {}, 'Choose a level'),
      h(
        'ol.level-list',
        {},
        ...LEVELS.map((l) =>
          h(
            'li',
            {},
            h(
              `button.level${l.id === current ? '.current' : ''}`,
              { type: 'button', onclick: () => practice(l.id) },
              h('span.num', {}, String(l.id)),
              h('span.name', {}, l.name),
              h('span.desc', {}, `${l.colours} colours, ${l.height} rings each, ${l.spare === 1 ? 'only 1 spare rod' : `${l.spare} spare rods`}`),
            ),
          ),
        ),
      ),
    ),
  );
}

async function practice(level: number): Promise<void> {
  store.setPracticeLevel(level);
  loading('Shuffling the rings…');
  const p = await makePuzzle(`practice-${Date.now()}-${Math.random()}`, level);
  playSolo(toData(p), `Practice`, getLevel(level).name, (moves, ms, s) => {
    const n = stars(moves, p.par);
    const box = sheet(
      n === 3 ? 'Perfect!' : 'Solved!',
      [starRow(n), h('p.result', {}, `${moves} moves in ${formatTime(ms)}. Par was ${p.par}.`)],
      [
        h('button.primary', { type: 'button', onclick: () => (box.remove(), practice(level)) }, 'Next puzzle'),
        level < 5 && n >= 2
          ? h('button', { type: 'button', onclick: () => (box.remove(), practice(level + 1)) }, `Try ${getLevel(level + 1).name}`)
          : h('button', { type: 'button', onclick: () => (box.remove(), s.retry()) }, 'Try again'),
        h('button.ghost', { type: 'button', onclick: () => (box.remove(), home()) }, 'Home'),
      ].filter(Boolean) as HTMLElement[],
    );
  });
}

function playSolo(
  puzzle: PuzzleData,
  heading: string,
  sub: string,
  onDone: (moves: number, ms: number, s: { retry: () => void }) => void,
): void {
  const run = (): void => {
    const session = new GameSession({
      puzzle,
      heading,
      sub,
      allowReset: true,
      onBack: home,
      onSolved: (moves, ms) => setTimeout(() => onDone(moves, ms, { retry: run }), reducedMotion() ? 0 : 450),
    });
    show(session.el);
    session.start();
    cleanup = () => {
      session.destroy();
      document.querySelector('.sheet-backdrop')?.remove();
    };
  };
  run();
}

/* ---------- Daily ---------- */

async function daily(): Promise<void> {
  const spec = dailyPuzzleSpec(new Date());
  loading('Fetching today’s card…');
  const p = await makePuzzle(spec.seed, spec.level);
  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long' });
  playSolo(toData(p), 'Daily challenge', `${weekday}: win in ${p.par} moves or fewer`, (moves, ms, s) => {
    store.saveDaily(spec.key, moves, p.par);
    const won = moves <= p.par;
    const best = store.daily(spec.key)!;
    const box = sheet(
      won ? 'Challenge won!' : 'So close',
      [
        starRow(stars(moves, p.par)),
        h(
          'p.result',
          {},
          won
            ? `${moves} moves in ${formatTime(ms)}. That beats today’s par of ${p.par}.`
            : `${moves} moves. Today’s target is ${p.par} or fewer. Your best is ${best.moves}.`,
        ),
        h('p.help', {}, 'A new challenge appears every day, and it gets harder towards the weekend.'),
      ],
      [
        h('button.primary', { type: 'button', onclick: () => (box.remove(), s.retry()) }, won ? 'Play again' : 'Try again'),
        h('button.ghost', { type: 'button', onclick: () => (box.remove(), home()) }, 'Home'),
      ],
    );
  });
}

/* ---------- Race (2–4 players) ---------- */

function hostRace(): void {
  startRace('host', newRoomCode());
}

const listNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

function startRace(role: 'host' | 'guest', code: string, restored?: MatchState): void {
  const pid = role === 'guest' ? store.seat(code) || newPid() : HOST_ID;
  if (role === 'guest') store.setSeat(code, pid);
  let state: MatchState = restored
    ? restoreHost(restored)
    : createMatch(role, store.name(), store.practiceLevel() > 1 ? store.practiceLevel() : 2, pid);
  let session: GameSession | null = null;
  let panel: OpponentsPanel | null = null;
  let sheetEl: HTMLElement | null = null;
  let banner: HTMLElement | null = null;
  let error: string | null = null;
  let left = false;
  let starting = false;
  const expiry = new Map<string, ReturnType<typeof setTimeout>>();
  const link = roomLink(location.href, code);
  // Keep the room in the address bar, so a reload brings the creator back to it.
  history.replaceState(null, '', link);

  const setBanner = (text: string | null): void => {
    if (!text) {
      banner?.remove();
      banner = null;
      return;
    }
    if (!banner) {
      banner = h('div.banner.soft', { role: 'status' });
      document.body.append(banner);
    }
    banner.textContent = text;
  };

  const hostConn: HostTransport | null =
    role === 'host'
      ? transport.host(code, {
          onJoin: (id) => dispatch({ kind: 'peer-joined', id }),
          onMessage: (id, msg) => dispatch({ kind: 'recv', from: id, msg: msg as never }),
          onLeave: (id) => dispatch({ kind: 'peer-dropped', id }),
          onStatus: (online) => setBanner(online ? null : 'Reconnecting… everyone’s games carry on.'),
          onError: (reason: TransportError) => {
            error = reason === 'room-taken' ? 'Couldn’t reopen this room. Go back and start a new race.' : 'Couldn’t connect. Check your internet connection.';
            paint(state, state);
          },
        })
      : null;
  const guestConn: ResilientGuest | null =
    role === 'guest'
      ? resilientGuest(
          transport,
          code,
          {
            onOpen: () => dispatch({ kind: 'connected' }),
            onMessage: (msg) => dispatch({ kind: 'recv', from: 'host', msg: msg as never }),
            onDown: () => dispatch({ kind: 'disconnected' }),
            onGiveUp: (never) => {
              if (never) {
                error = 'This race has ended or hasn’t started yet. Ask for a fresh link.';
                paint(state, state);
              } else dispatch({ kind: 'reconnect-failed' });
            },
          },
          { holdMs: SEAT_HOLD_MS },
        )
      : null;
  if (E2E && guestConn) (window as unknown as { __csNet: unknown }).__csNet = { drop: () => guestConn.drop() };

  // Phone back on screen: make sure the room creator is reachable again.
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') hostConn?.refresh();
  };
  document.addEventListener('visibilitychange', onVisible);
  // Closing the tab or the browser is not leaving: the seat (or room) is kept.
  const onPageHide = (): void => {
    hostConn?.close();
    guestConn?.close();
  };
  window.addEventListener('pagehide', onPageHide);

  const leave = (): void => home();

  function send(outs: Out[]): void {
    for (const o of outs) {
      if (hostConn) {
        const links = Object.entries(state.links);
        if (o.to === 'all') {
          for (const [c, p] of links) if (p !== o.except) hostConn.send(c, o.msg);
        } else {
          const conns = links.filter(([, p]) => p === o.to).map(([c]) => c);
          for (const c of conns.length ? conns : [o.to]) {
            hostConn.send(c, o.msg);
            if (o.close) hostConn.kick(c);
          }
        }
      } else guestConn?.send(o.msg);
    }
  }

  function dispatch(e: MatchEvent): void {
    if (left) return;
    const prev = state;
    const r = reduce(state, e);
    state = r.state;
    send(r.outbox);
    if (role === 'host' && state !== prev) store.saveHostRoom(code, state);
    paint(prev, state);
  }

  async function newRound(): Promise<void> {
    if (starting) return;
    starting = true;
    try {
      const seed = `${code}-${state.round + 1}-${Date.now()}`;
      const needEasy = state.level > 1 && state.players.some((p) => p.present && p.lmm);
      const [main, easy] = await Promise.all([makePuzzle(seed, state.level), needEasy ? makePuzzle(`${seed}-lmm`, state.level - 1) : null]);
      dispatch(easy ? { kind: 'start-round', puzzle: toData(main), easy: toData(easy) } : { kind: 'start-round', puzzle: toData(main) });
    } finally {
      starting = false;
    }
  }

  const inviteButton = (label = 'Send invite link'): HTMLButtonElement => {
    const b = h<'button'>('button.primary', {
      type: 'button',
      onclick: async () => {
        try {
          if (navigator.share) await navigator.share({ title: 'Colour Stack race', text: `${me(state).name} wants a Colour Stack race`, url: link });
          else {
            await navigator.clipboard.writeText(link);
            b.textContent = 'Link copied';
          }
        } catch {
          /* share sheet dismissed */
        }
      },
    }, label);
    return b;
  };

  const levelPicker = (s: MatchState, legend: string): HTMLElement =>
    h(
      'fieldset.level-pick',
      {},
      h('legend', {}, legend),
      ...LEVELS.map((l) =>
        h(
          `button.chip${l.id === s.level ? '.on' : ''}`,
          { type: 'button', 'aria-pressed': l.id === s.level ? 'true' : 'false', onclick: () => dispatch({ kind: 'set-level', level: l.id }) },
          h('b', {}, String(l.id)),
          h('span', {}, l.name),
        ),
      ),
    );

  const lmmSwitch = (p: Player): HTMLElement =>
    h(
      `button.lmm-toggle${p.lmm ? '.on' : ''}`,
      { type: 'button', 'aria-pressed': p.lmm ? 'true' : 'false', 'aria-label': `Little man mode for ${p.name}`, onclick: () => dispatch({ kind: 'toggle-lmm', id: p.id }) },
      h('span.knob', { 'aria-hidden': 'true' }),
      'Little man mode',
    );

  /** One row per player: easier puzzle plus hint, big rings and cheers. */
  const lmmPicker = (s: MatchState): HTMLElement =>
    h(
      'fieldset.lmm-pick',
      {},
      h('legend', {}, 'Little man mode'),
      h('p.help', {}, 'One level easier, with a hint button, bigger rings and a cheer for every finished rod.'),
      ...s.players.filter((p) => p.present).map((p) => h('div.lmm-row', {}, h('span', {}, p.name), lmmSwitch(p))),
    );

  const lmmNote = (s: MatchState): HTMLElement | null =>
    s.players.some((p) => p.present && p.lmm)
      ? h('p.help', {}, s.level > 1 ? `Little man mode players race ${getLevel(s.level - 1).name} while everyone else races ${getLevel(s.level).name}.` : 'On Warm-up everyone races the same puzzle.')
      : null;

  function lobby(s: MatchState): HTMLElement {
    const present = s.players.filter((p) => p.present);
    const host = s.players.find((p) => p.id === HOST_ID);
    const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => {
      const p = present[i];
      if (!p) return h('li.player.empty', {}, h('span.avatar', {}, '?'), h('span', {}, 'Open spot'));
      return h(
        `li.player${p.id === s.myId ? '.me' : ''}${p.connected ? '' : '.away'}`,
        {},
        h('span.avatar', {}, p.name.slice(0, 1).toUpperCase()),
        h('span', {}, p.id === s.myId ? `${p.name} (you)` : p.name),
        p.id === HOST_ID ? h('small', {}, 'Room creator') : null,
        !p.connected ? h('small', {}, 'Reconnecting…') : null,
        p.points ? h('small', {}, `${p.points} pts`) : null,
        p.lmm ? h('small.lmm-tag', {}, 'Little man mode') : null,
      );
    });

    let status: HTMLElement;
    if (error) status = h('p.error', { role: 'alert' }, error);
    else if (s.role === 'host')
      status =
        present.length < 2
          ? h('p.status', { role: 'status' }, 'Waiting for players to open the link…')
          : h('p.status.ready', { role: 'status' }, `${present.length} players in. Start whenever you’re ready.`);
    else if (s.conn !== 'online') status = h('p.status', { role: 'status' }, s.conn === 'reconnecting' ? 'Reconnecting…' : 'Connecting…');
    else if (s.raceInProgress) status = h('p.status', { role: 'status' }, 'A race is on right now. You’ll join the next one.');
    else status = h('p.status.ready', { role: 'status' }, `You’re in. Waiting for ${host?.name ?? 'the room creator'} to start.`);

    return h(
      'main.screen.lobby',
      {},
      h('header.bar', {}, h('button.back', { type: 'button', onclick: leave }, 'Leave'), h('div.heading', {}, h('span', {}, 'Race'), h('small', {}, `${present.length} of ${MAX_PLAYERS} players`))),
      h('ul.players', { 'aria-label': 'Players' }, ...slots),
      status,
      s.role === 'host' && present.length < MAX_PLAYERS && !error
        ? h(
            'div.invite',
            {},
            h('p.help', {}, `Send this link to up to ${MAX_PLAYERS - present.length} more. It only works for this room. It’s fine to switch apps to send it.`),
            inviteButton(),
            h('code.link-text', {}, link),
          )
        : null,
      s.role === 'host' ? levelPicker(s, 'Level') : h('p.lede', {}, `Level ${s.level}: ${getLevel(s.level).name}`),
      s.role === 'host' ? lmmPicker(s) : null,
      lmmNote(s),
      s.role === 'host'
        ? h(
            'button.primary.big',
            { type: 'button', disabled: !canStart(s) || starting, onclick: () => void newRound(), id: 'start-race' },
            h('span', {}, present.length >= 2 ? `Start race with ${present.length} players` : 'Start race'),
          )
        : null,
    );
  }

  function countdown(onGo: () => void): void {
    const n = h('span.count-num', {}, '3');
    const overlay = h('div.countdown', { role: 'status', 'aria-live': 'assertive' }, n);
    session?.el.append(overlay);
    let i = 3;
    const tick = (): void => {
      i--;
      if (i > 0) n.textContent = String(i);
      else if (i === 0) n.textContent = 'Go!';
      else {
        overlay.remove();
        onGo();
        return;
      }
      if (!reducedMotion()) n.animate([{ transform: 'scale(1.4)', opacity: 0.2 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300, easing: 'ease-out' });
      setTimeout(tick, i === 0 ? 500 : 800);
    };
    setTimeout(tick, 800);
  }

  /** Build the board for this round: with a countdown for a new round, or straight in when resuming. */
  function buildSession(s: MatchState, withCountdown: boolean): void {
    sheetEl?.remove();
    sheetEl = null;
    session?.destroy();
    panel?.destroy();
    const mine = me(s);
    const puzzle = playerPuzzle(s, mine);
    panel = new OpponentsPanel(s);
    const others = s.players.filter((p) => p.inRound && p.id !== s.myId).map((p) => p.name);
    session = new GameSession({
      puzzle,
      heading: others.length === 1 ? `Race vs ${others[0]}` : `${others.length + 1}-player race`,
      sub: `${getLevel(puzzle.level).name}, round ${s.round}`,
      allowReset: false,
      side: panel.el,
      onBack: leave,
      onMove: (rods, moves) => dispatch({ kind: 'local-move', rods, moves }),
      onSolved: (moves, ms) => dispatch({ kind: 'local-solved', moves, ms }),
      onGiveUp: () => dispatch({ kind: 'give-up' }),
      ...(withCountdown ? {} : { resume: { rods: mine.rods, moves: mine.moves } }),
      littleMan: mine.lmm,
    });
    mount(app, session.el);
    if (withCountdown)
      countdown(() => {
        dispatch({ kind: 'go' });
        session?.start();
      });
    else session.start();
  }

  /** Waiting line shown after you finish while others are still going. */
  function placedNote(s: MatchState): string {
    const mine = me(s).result;
    const still = s.players.filter((p) => p.present && p.inRound && !p.result).map((p) => (p.connected ? p.name : `${p.name} (reconnecting)`));
    const head = mine?.gaveUp ? 'You gave up.' : mine?.place ? `You came ${ordinal(mine.place)}!` : 'Checking…';
    return still.length ? `${head} Waiting for ${listNames(still)} to finish.` : head;
  }

  /** Standings and rematch. Rebuilt whenever the match state changes. */
  function results(s: MatchState, first: boolean): void {
    const mine = me(s);
    const ranked = s.players
      .filter((p) => p.inRound)
      .sort((a, b) => (a.result?.place ?? 99) - (b.result?.place ?? 99) || (b.present ? 1 : 0) - (a.present ? 1 : 0));
    const rows = ranked.map((p) => {
      const r = p.result;
      return h(
        `tr${p.id === s.myId ? '.mine' : ''}`,
        {},
        h('td.place', {}, r?.place ? ordinal(r.place) : '–'),
        h('th', { scope: 'row' }, p.name, p.handicap ? h('small.lmm-tag', {}, 'Little man mode') : null),
        h('td', {}, r?.gaveUp ? 'gave up' : !p.present && !r ? 'left' : r ? `${r.moves}` : ''),
        h('td.round', {}, r && !r.gaveUp ? `+${r.earned}` : '0', r?.bonus ? h('small.bonus', {}, `incl. +${r.bonus} par bonus`) : null),
        h('td.pts', {}, `${p.points}`),
      );
    });
    const table = h(
      'table.standings',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Player'), h('th', {}, 'Moves'), h('th', {}, 'Round'), h('th', {}, 'Total'))),
      h('tbody', {}, ...rows),
    );

    const needed = s.players.filter((p) => p.present && p.inRound);
    const ready = needed.filter((p) => p.ready).map((p) => p.name);
    const waiting = needed.filter((p) => !p.ready).map((p) => p.name);
    const tooFew = s.players.filter((p) => p.present).length < 2;
    const readiness = tooFew
      ? h('p.status', { role: 'status' }, 'Everyone else has left. Invite more players to keep going.')
      : ready.length
        ? h('p.status.ready', { role: 'status' }, waiting.length ? `Ready: ${listNames(ready)}. Waiting for ${listNames(waiting)}.` : 'Everyone’s ready!')
        : null;

    const rematch = h<'button'>(
      'button.primary',
      { type: 'button', id: 'rematch', disabled: mine.ready || tooFew, onclick: () => dispatch({ kind: 'request-rematch' }) },
      mine.ready ? 'Waiting for the others…' : 'Rematch',
    );
    const title = mine.result?.place === 1 ? 'You win!' : mine.result?.place ? `You came ${ordinal(mine.result.place)}` : 'Race over';
    const extra =
      s.role === 'host'
        ? [
            levelPicker(s, 'Next level'),
            lmmPicker(s),
            lmmNote(s),
          ]
        : [h('p.help', {}, `Next level: ${s.level} ${getLevel(s.level).name}. The room creator can change it.`)];

    const old = sheetEl;
    sheetEl = sheet(
      title,
      [
        mine.result?.place ? starRow(stars(mine.result.moves, playerPuzzle(s, mine).par)) : null,
        table,
        h('p.help.points-rule', {}, 'Places score 3, 2, 1 and 0. Par bonus: +2 at or under par, +1 within 2 moves of it.'),
        ...extra,
        readiness,
      ],
      [rematch, ...(s.role === 'host' && s.players.filter((p) => p.present).length < MAX_PLAYERS ? [inviteButton('Invite more players')] : []), h('button.ghost', { type: 'button', onclick: leave }, 'Leave')],
      first,
    );
    old?.remove();
    sheetEl.classList.add(mine.result?.place === 1 ? 'won' : 'lost');
    sheetEl.querySelector('.sheet-actions button:nth-child(2).primary')?.classList.remove('primary');
    if (!first) sheetEl.querySelector('.sheet')?.classList.add('static');
  }

  function message(title: string, text: string): void {
    sheetEl?.remove();
    session?.destroy();
    panel?.destroy();
    session = null;
    setBanner(null);
    mount(app, h('main.screen.centre', {}, h('h2.title', {}, title), h('p.lede', {}, text), h('button.primary', { type: 'button', onclick: leave }, 'Home')));
  }

  /** Host: hold a dropped player's seat for a few minutes, then free it. */
  function trackSeats(prev: MatchState, s: MatchState): void {
    if (s.role !== 'host') return;
    for (const p of s.players) {
      if (p.id === HOST_ID) continue;
      const was = prev.players.find((x) => x.id === p.id);
      const dropped = p.present && !p.connected;
      if (dropped && (!was || was.connected || prev === s) && !expiry.has(p.id)) {
        expiry.set(p.id, setTimeout(() => {
          expiry.delete(p.id);
          dispatch({ kind: 'peer-expired', id: p.id });
        }, SEAT_HOLD_MS));
      }
      if (!dropped && expiry.has(p.id)) {
        clearTimeout(expiry.get(p.id));
        expiry.delete(p.id);
      }
    }
  }

  function paint(prev: MatchState, s: MatchState): void {
    if (left) return;
    trackSeats(prev, s);
    if (s.full) return message('This race is full', `A room holds up to ${MAX_PLAYERS} players. Ask the room creator to start a new race.`);
    if (s.closed) {
      if (!prev.closed) {
        guestConn?.close();
        message('The room has closed', 'The room creator ended the race, or couldn’t be reached for a few minutes. Ask them for a new link.');
      }
      return;
    }
    if (role === 'guest') setBanner(s.conn === 'reconnecting' ? 'Reconnecting… keep playing, your moves will catch up.' : null);

    // New round: build a fresh board and count down together.
    if (s.phase === 'countdown' && (prev.phase !== 'countdown' || prev.round !== s.round)) {
      buildSession(s, true);
      return;
    }

    if (s.phase === 'lobby') {
      if (prev.phase !== 'lobby' || !session) {
        session?.destroy();
        panel?.destroy();
        sheetEl?.remove();
        sheetEl = null;
        session = null;
        panel = null;
      }
      mount(app, lobby(s));
      return;
    }

    // Back after reopening the page (or the creator restoring the room): rebuild without a countdown.
    if (!session && me(s).inRound) {
      buildSession(s, false);
      if (s.phase === 'finished') {
        (session as GameSession | null)?.lock();
        results(s, true);
      }
    }

    panel?.update(s);

    if ((s.phase === 'placed' || s.phase === 'waiting') && session) {
      session.lock();
      session.setNote(placedNote(s));
    }

    if (s.phase === 'finished' && prev.phase !== 'finished' && !sheetEl) {
      session?.lock();
      setTimeout(() => {
        if (state.phase === 'finished' && state.round === s.round && !sheetEl) results(state, true);
      }, reducedMotion() ? 0 : 400);
    } else if (s.phase === 'finished' && sheetEl) {
      results(s, false);
    }

    // Everyone tapped Rematch: the room creator deals the next puzzle.
    if (s.role === 'host' && allReady(s) && !allReady(prev)) {
      sheetEl?.querySelector('.sheet')?.append(h('p.status', { role: 'status' }, 'Shuffling the rings…'));
      void newRound();
    }
  }

  if (restored) {
    paint(createMatch('host', ''), state);
    trackSeats(state, state);
  } else show(lobby(state));
  if (role === 'host') store.saveHostRoom(code, state);

  cleanup = () => {
    // Leaving through the app is a real goodbye.
    if (!left) {
      if (role === 'host') {
        dispatch({ kind: 'close-room' });
        store.forgetHostRoom(code);
      } else dispatch({ kind: 'leave' });
    }
    left = true;
    expiry.forEach((t) => clearTimeout(t));
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pagehide', onPageHide);
    // Let the goodbye message go out before closing.
    setTimeout(() => {
      hostConn?.close();
      guestConn?.close();
    }, 300);
    session?.destroy();
    panel?.destroy();
    sheetEl?.remove();
    setBanner(null);
    document.querySelector('.banner')?.remove();
  };
}

/* ---------- Boot ---------- */

function route(): void {
  const room = roomFromHash(location.hash);
  gate(() => {
    if (!room) return home();
    // The room creator's phone reloaded: bring the room back rather than joining it as a guest.
    const saved = store.hostRoom(room) as MatchState | null;
    if (saved) startRace('host', room, saved);
    else withName(() => startRace('guest', room));
  });
}

route();
// Pasting a race link into a tab that already has the game open only changes the #hash.
let currentRoom = roomFromHash(location.hash);
window.addEventListener('hashchange', () => {
  const room = roomFromHash(location.hash);
  if (room && room !== currentRoom) {
    currentRoom = room;
    route();
  }
});
