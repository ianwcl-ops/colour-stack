import '@fontsource-variable/fredoka';
import './style.css';
import { checkPasscode } from './access/passcode';
import { newRoomCode, roomFromHash, roomLink } from './access/room';
import { PASSCODE_HASH, transport } from './config';
import { dailyPuzzleSpec } from './engine/daily';
import type { Puzzle } from './engine/generate';
import { getLevel, LEVELS } from './engine/levels';
import { makePuzzle } from './engine/make-puzzle';
import { stars } from './engine/score';
import { createMatch, reduce, type MatchEvent, type MatchState, type PuzzleData } from './net/match';
import type { Transport } from './net/transport';
import { store } from './storage';
import { formatTime, h, mount, reducedMotion } from './ui/dom';
import { miniBoard, ringEl } from './ui/rings';
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
          h('small', {}, 'Same puzzle, live, head to head'),
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

/* ---------- Race ---------- */

function hostRace(): void {
  startRace('host', newRoomCode());
}

function startRace(role: 'host' | 'guest', code: string): void {
  let state: MatchState = createMatch(role, store.name(), store.practiceLevel() > 1 ? store.practiceLevel() : 2);
  let session: GameSession | null = null;
  let oppMini: HTMLElement | null = null;
  let oppMoves: HTMLElement | null = null;
  let sheetEl: HTMLElement | null = null;
  let error: string | null = null;
  let left = false;
  const link = roomLink(location.href, code);

  const conn: Transport = (role === 'host' ? transport.host : transport.join)(code, {
    onOpen: () => dispatch({ kind: 'connected' }),
    onMessage: (msg) => dispatch({ kind: 'recv', msg: msg as never }),
    onClose: () => dispatch({ kind: 'disconnected' }),
    onError: (reason) => {
      error =
        reason === 'room-not-found'
          ? 'This race has ended or hasn’t started yet. Ask for a fresh link.'
          : reason === 'room-taken'
            ? 'That room code is in use. Go back and start a new race.'
            : 'Couldn’t connect. Check your internet connection and try again.';
      paint(state, state);
    },
  });

  const leave = (): void => home();

  function dispatch(e: MatchEvent): void {
    if (left) return;
    const prev = state;
    const r = reduce(state, e);
    state = r.state;
    r.outbox.forEach((m) => conn.send(m));
    paint(prev, state);
  }

  async function newRound(): Promise<void> {
    const p = await makePuzzle(`${code}-${state.round + 1}-${Date.now()}`, state.level);
    dispatch({ kind: 'start-round', puzzle: toData(p) });
  }

  function lobby(s: MatchState): HTMLElement {
    const copyBtn = h<'button'>('button.primary', {
      type: 'button',
      onclick: async () => {
        try {
          if (navigator.share) await navigator.share({ title: 'Colour Stack race', text: `${s.myName} wants a Colour Stack race`, url: link });
          else {
            await navigator.clipboard.writeText(link);
            copyBtn.textContent = 'Link copied';
          }
        } catch {
          /* share sheet dismissed */
        }
      },
    }, 'Send invite link');

    const levelPicker =
      s.role === 'host'
        ? h(
            'fieldset.level-pick',
            {},
            h('legend', {}, 'Level'),
            ...LEVELS.map((l) =>
              h(
                `button.chip${l.id === s.level ? '.on' : ''}`,
                { type: 'button', 'aria-pressed': l.id === s.level ? 'true' : 'false', onclick: () => dispatch({ kind: 'set-level', level: l.id }) },
                h('b', {}, String(l.id)),
                h('span', {}, l.name),
              ),
            ),
          )
        : h('p.lede', {}, `Level ${s.level}: ${getLevel(s.level).name}`);

    const status = error
      ? h('p.error', { role: 'alert' }, error)
      : s.oppPresent
        ? h('p.status.ready', { role: 'status' }, s.role === 'host' ? `${s.oppName} is here and ready.` : `Connected to ${s.oppName}. Waiting for them to start.`)
        : h('p.status', { role: 'status' }, s.role === 'host' ? 'Waiting for player 2 to open the link…' : 'Connecting…');

    return h(
      'main.screen.lobby',
      {},
      h('header.bar', {}, h('button.back', { type: 'button', onclick: leave }, 'Leave'), h('div.heading', {}, h('span', {}, 'Race'))),
      h(
        'section.versus',
        {},
        h('div.player.me', {}, h('span.avatar', {}, s.myName.slice(0, 1).toUpperCase()), h('span', {}, s.myName)),
        h('span.vs', {}, 'vs'),
        h(
          `div.player${s.oppPresent ? '' : '.empty'}`,
          {},
          h('span.avatar', {}, s.oppPresent ? s.oppName.slice(0, 1).toUpperCase() : '?'),
          h('span', {}, s.oppPresent ? s.oppName : 'Player 2'),
        ),
      ),
      s.score.host + s.score.guest > 0
        ? h('p.score', {}, `Score: ${s.myName} ${s.score[s.role]}, ${s.oppName} ${s.score[s.role === 'host' ? 'guest' : 'host']}`)
        : null,
      status,
      s.role === 'host' && !s.oppPresent && !error
        ? h('div.invite', {}, h('p.help', {}, 'Only people with this link can join, and it works for this race only.'), copyBtn, h('code.link-text', {}, link))
        : null,
      levelPicker,
      s.role === 'host'
        ? h('button.primary.big', { type: 'button', disabled: !s.oppPresent, onclick: () => void newRound(), id: 'start-race' }, h('span', {}, 'Start race'))
        : null,
    );
  }

  function opponentPanel(s: MatchState): HTMLElement {
    oppMini = h('div.opp-board', {}, miniBoard(s.opp.rods, s.puzzle!.start.capacity));
    oppMoves = h('strong', {}, String(s.opp.moves));
    return h('aside.opponent', { 'aria-label': `${s.oppName}'s board` }, oppMini, h('p', {}, h('span', {}, s.oppName), ' ', oppMoves, ' moves'));
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

  /** Result sheet with the rematch flow. Rebuilt whenever the match state changes. */
  function results(s: MatchState, first: boolean): void {
    const iWon = s.winner === s.role;
    const mine = s.mySolve;
    const level = getLevel(s.level);

    const rematch = h<'button'>(
      'button.primary',
      { type: 'button', id: 'rematch', disabled: s.meReady, onclick: () => dispatch({ kind: 'request-rematch' }) },
      s.meReady ? `Waiting for ${s.oppName}…` : 'Rematch',
    );
    const readiness = s.oppReady
      ? h('p.status.ready', { role: 'status' }, `${s.oppName} is ready for a rematch.`)
      : s.meReady
        ? h('p.status', { role: 'status' }, `Waiting for ${s.oppName} to tap Rematch.`)
        : null;

    const levelChoice =
      s.role === 'host'
        ? h(
            'fieldset.level-pick',
            {},
            h('legend', {}, 'Next level'),
            ...LEVELS.map((l) =>
              h(
                `button.chip${l.id === s.level ? '.on' : ''}`,
                { type: 'button', 'aria-pressed': l.id === s.level ? 'true' : 'false', onclick: () => dispatch({ kind: 'set-level', level: l.id }) },
                h('b', {}, String(l.id)),
                h('span', {}, l.name),
              ),
            ),
          )
        : h('p.help', {}, `Next level: ${level.id} ${level.name}. ${s.oppName} can change it.`);

    const old = sheetEl;
    sheetEl = sheet(
      iWon ? 'You win!' : `${s.oppName} wins`,
      [
        h('p.result', {}, iWon ? `You sorted it first${mine ? ` in ${mine.moves} moves (${formatTime(mine.ms)})` : ''}.` : `${s.oppName} sorted it first.`),
        mine && s.puzzle ? starRow(stars(mine.moves, s.puzzle.par)) : null,
        h('p.score', {}, `${s.myName} ${s.score[s.role]}, ${s.oppName} ${s.score[s.role === 'host' ? 'guest' : 'host']}`),
        levelChoice,
        readiness,
      ],
      [rematch, h('button.ghost', { type: 'button', onclick: leave }, 'Leave')],
      first,
    );
    old?.remove();
    sheetEl.classList.add(iWon ? 'won' : 'lost');
    if (!first) sheetEl.querySelector('.sheet')?.classList.add('static');
  }

  function paint(prev: MatchState, s: MatchState): void {
    if (left) return;
    // New round: build a fresh board and count down.
    if (s.phase === 'countdown' && (prev.phase !== 'countdown' || prev.round !== s.round)) {
      sheetEl?.remove();
      sheetEl = null;
      session?.destroy();
      session = new GameSession({
        puzzle: s.puzzle!,
        heading: `Race vs ${s.oppName}`,
        sub: `${getLevel(s.level).name}, round ${s.round}`,
        allowReset: false,
        side: opponentPanel(s),
        onBack: leave,
        onMove: (rods, moves) => dispatch({ kind: 'local-move', rods, moves }),
        onSolved: (moves, ms) => dispatch({ kind: 'local-solved', moves, ms }),
      });
      mount(app, session.el);
      countdown(() => {
        dispatch({ kind: 'go' });
        session?.start();
      });
      return;
    }

    if (s.phase === 'lobby') {
      mount(app, lobby(s));
      return;
    }

    if (session && s.opp !== prev.opp && oppMini && oppMoves && s.puzzle) {
      oppMini.replaceChildren(miniBoard(s.opp.rods, s.puzzle.start.capacity));
      oppMoves.textContent = String(s.opp.moves);
    }

    if (s.phase === 'waiting' && prev.phase !== 'waiting') session?.el.classList.add('waiting');

    if (s.phase === 'finished' && prev.phase !== 'finished') {
      session?.lock();
      setTimeout(() => {
        if (state.phase === 'finished' && state.round === s.round) results(state, true);
      }, reducedMotion() ? 0 : 400);
    } else if (s.phase === 'finished' && sheetEl) {
      results(s, false);
    }

    // Both tapped Rematch: the room creator deals the next puzzle.
    if (s.role === 'host' && s.bothReady && !prev.bothReady) {
      sheetEl?.querySelector('.sheet')?.append(h('p.status', { role: 'status' }, 'Shuffling the rings…'));
      void newRound();
    }

    if (!s.oppPresent && prev.oppPresent) {
      const banner = h('div.banner', { role: 'alert' }, `${s.oppName} left the game.`, h('button', { type: 'button', onclick: leave }, 'Home'));
      sheetEl?.remove();
      document.body.querySelector('.banner')?.remove();
      document.body.append(banner);
      session?.lock();
    }
  }

  show(lobby(state));
  cleanup = () => {
    left = true;
    conn.close();
    session?.destroy();
    sheetEl?.remove();
    document.querySelector('.banner')?.remove();
  };
}

/* ---------- Boot ---------- */

function route(): void {
  const room = roomFromHash(location.hash);
  gate(() => {
    if (room) withName(() => startRace('guest', room));
    else home();
  });
}

route();
// Pasting a race link into a tab that already has the game open only changes the #hash.
window.addEventListener('hashchange', () => {
  if (roomFromHash(location.hash)) route();
});
