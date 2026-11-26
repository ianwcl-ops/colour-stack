import { describe, expect, it } from 'vitest';
import { createMatch, reduce, type MatchState, type PuzzleData, type Msg } from '../src/net/match';

const puzzle: PuzzleData = {
  seed: 's',
  level: 1,
  start: { rods: [[0, 1], [1, 0], []], capacity: 2 },
  par: 3,
  parIsMinimum: true,
};

function run(state: MatchState, ...events: Parameters<typeof reduce>[1][]) {
  const out: Msg[] = [];
  for (const e of events) {
    const r = reduce(state, e);
    state = r.state;
    out.push(...r.outbox);
  }
  return { state, out };
}

describe('match protocol', () => {
  it('guest says hello when connected and host welcomes them with the level', () => {
    const guest = run(createMatch('guest', 'Jo'), { kind: 'connected' });
    expect(guest.out).toEqual([{ t: 'hello', name: 'Jo', v: 1 }]);

    const host = run(createMatch('host', 'Sam', 3), { kind: 'recv', msg: { t: 'hello', name: 'Jo', v: 1 } });
    expect(host.state.oppName).toBe('Jo');
    expect(host.state.oppPresent).toBe(true);
    expect(host.out).toEqual([{ t: 'welcome', name: 'Sam', level: 3 }]);
  });

  it('host starting a round sends the same puzzle and both sides enter the countdown', () => {
    const host = run(createMatch('host', 'Sam'), { kind: 'start-round', puzzle });
    expect(host.state.phase).toBe('countdown');
    expect(host.out).toEqual([{ t: 'start', round: 1, puzzle }]);

    const guest = run(createMatch('guest', 'Jo'), { kind: 'recv', msg: host.out[0]! });
    expect(guest.state.phase).toBe('countdown');
    expect(guest.state.puzzle).toEqual(puzzle);
    expect(guest.state.round).toBe(1);
  });

  it('guest cannot start a round', () => {
    const guest = run(createMatch('guest', 'Jo'), { kind: 'start-round', puzzle });
    expect(guest.state.phase).toBe('lobby');
    expect(guest.out).toEqual([]);
  });

  it('shares each move with the opponent so they can watch live', () => {
    const s = run(createMatch('host', 'Sam'), { kind: 'start-round', puzzle }, { kind: 'go' }).state;
    const moved = run(s, { kind: 'local-move', rods: [[1], [], [0]], moves: 1 });
    expect(moved.out).toEqual([{ t: 'progress', round: 1, rods: [[1], [], [0]], moves: 1 }]);

    const watched = run(s, { kind: 'recv', msg: { t: 'progress', round: 1, rods: [[], [0], [1]], moves: 1 } });
    expect(watched.state.opp.rods).toEqual([[], [0], [1]]);
    expect(watched.state.opp.moves).toBe(1);
  });

  it('ignores progress from an old round', () => {
    const s = run(createMatch('host', 'Sam'), { kind: 'start-round', puzzle }, { kind: 'go' }).state;
    const r = run(s, { kind: 'recv', msg: { t: 'progress', round: 0, rods: [], moves: 9 } });
    expect(r.state.opp.moves).toBe(0);
  });

  it('host decides the winner: first solve wins and the result goes to the guest', () => {
    let host = run(createMatch('host', 'Sam'), { kind: 'start-round', puzzle }, { kind: 'go' }).state;
    const r = run(host, { kind: 'recv', msg: { t: 'solved', round: 1, moves: 4, ms: 9000 } });
    host = r.state;
    expect(host.phase).toBe('finished');
    expect(host.winner).toBe('guest');
    expect(host.score).toEqual({ host: 0, guest: 1 });
    expect(r.out).toEqual([
      { t: 'result', round: 1, winner: 'guest', host: null, guest: { moves: 4, ms: 9000 }, score: { host: 0, guest: 1 } },
    ]);

    // A later solve by the host doesn't change the result.
    const late = run(host, { kind: 'local-solved', moves: 3, ms: 9500 });
    expect(late.state.winner).toBe('guest');
    expect(late.state.score).toEqual({ host: 0, guest: 1 });
  });

  it('host solving first wins', () => {
    const r = run(createMatch('host', 'Sam'), { kind: 'start-round', puzzle }, { kind: 'go' }, { kind: 'local-solved', moves: 3, ms: 5000 });
    expect(r.state.winner).toBe('host');
    expect(r.out.at(-1)).toMatchObject({ t: 'result', winner: 'host', host: { moves: 3, ms: 5000 } });
  });

  it('guest reports its solve and waits for the host result', () => {
    let g = run(createMatch('guest', 'Jo'), { kind: 'recv', msg: { t: 'start', round: 1, puzzle } }, { kind: 'go' }).state;
    const r = run(g, { kind: 'local-solved', moves: 3, ms: 4000 });
    expect(r.out).toEqual([{ t: 'solved', round: 1, moves: 3, ms: 4000 }]);
    expect(r.state.phase).toBe('waiting');
    g = run(r.state, {
      kind: 'recv',
      msg: { t: 'result', round: 1, winner: 'guest', host: null, guest: { moves: 3, ms: 4000 }, score: { host: 0, guest: 1 } },
    }).state;
    expect(g.phase).toBe('finished');
    expect(g.winner).toBe('guest');
    expect(g.score).toEqual({ host: 0, guest: 1 });
  });

  describe('rematch: both players tap, then the host starts the next round', () => {
    const finishedHost = () =>
      run(createMatch('host', 'Sam'), { kind: 'start-round', puzzle }, { kind: 'go' }, { kind: 'local-solved', moves: 3, ms: 1 }).state;
    const finishedGuest = () =>
      run(
        createMatch('guest', 'Jo'),
        { kind: 'recv', msg: { t: 'start', round: 1, puzzle } },
        { kind: 'go' },
        { kind: 'recv', msg: { t: 'result', round: 1, winner: 'host', host: { moves: 3, ms: 1 }, guest: null, score: { host: 1, guest: 0 } } },
      ).state;

    it('either player tapping Rematch tells the other they are ready', () => {
      const g = run(finishedGuest(), { kind: 'request-rematch' });
      expect(g.state.meReady).toBe(true);
      expect(g.out).toEqual([{ t: 'rematch' }]);

      const h = run(finishedHost(), { kind: 'request-rematch' });
      expect(h.state.meReady).toBe(true);
      expect(h.out).toEqual([{ t: 'rematch' }]);
    });

    it('each side sees when the other is ready', () => {
      const h = run(finishedHost(), { kind: 'recv', msg: { t: 'rematch' } });
      expect(h.state.oppReady).toBe(true);
      const g = run(finishedGuest(), { kind: 'recv', msg: { t: 'rematch' } });
      expect(g.state.oppReady).toBe(true);
    });

    it('only when both are ready is the next round due (host side)', () => {
      let h = run(finishedHost(), { kind: 'request-rematch' }).state;
      expect(h.bothReady).toBe(false);
      h = run(h, { kind: 'recv', msg: { t: 'rematch' } }).state;
      expect(h.bothReady).toBe(true);
    });

    it('cannot ask for a rematch mid-race', () => {
      const s = run(createMatch('host', 'Sam'), { kind: 'start-round', puzzle }, { kind: 'go' }).state;
      const r = run(s, { kind: 'request-rematch' });
      expect(r.out).toEqual([]);
      expect(r.state.meReady).toBe(false);
    });

    it('the room creator can change the level before the rematch, and the guest sees it', () => {
      const h = run(finishedHost(), { kind: 'set-level', level: 5 });
      expect(h.state.level).toBe(5);
      expect(h.out).toEqual([{ t: 'level', level: 5 }]);
      const g = run(finishedGuest(), { kind: 'recv', msg: { t: 'level', level: 5 } });
      expect(g.state.level).toBe(5);
      // The guest cannot change it.
      expect(run(finishedGuest(), { kind: 'set-level', level: 2 }).state.level).toBe(1);
    });

    it('starting the next round clears ready flags', () => {
      let h = run(finishedHost(), { kind: 'request-rematch' }, { kind: 'recv', msg: { t: 'rematch' } }).state;
      h = run(h, { kind: 'start-round', puzzle }).state;
      expect([h.meReady, h.oppReady, h.bothReady]).toEqual([false, false, false]);
    });
  });

  it('second round keeps the running score and resets the boards', () => {
    let h = run(createMatch('host', 'Sam'), { kind: 'start-round', puzzle }, { kind: 'go' }, { kind: 'local-solved', moves: 3, ms: 1 }).state;
    h = run(h, { kind: 'start-round', puzzle }).state;
    expect(h.round).toBe(2);
    expect(h.score).toEqual({ host: 1, guest: 0 });
    expect(h.winner).toBeNull();
    expect(h.opp.moves).toBe(0);
  });

  it('marks the opponent as gone when the connection drops', () => {
    const r = run(createMatch('host', 'Sam'), { kind: 'recv', msg: { t: 'hello', name: 'Jo', v: 1 } }, { kind: 'disconnected' });
    expect(r.state.oppPresent).toBe(false);
  });

  it('host can change the level in the lobby and the guest sees it', () => {
    const h = run(createMatch('host', 'Sam'), { kind: 'set-level', level: 4 });
    expect(h.state.level).toBe(4);
    expect(h.out).toEqual([{ t: 'level', level: 4 }]);
    const g = run(createMatch('guest', 'Jo'), { kind: 'recv', msg: { t: 'level', level: 4 } });
    expect(g.state.level).toBe(4);
  });

  it('rejects malformed messages safely', () => {
    const s = createMatch('host', 'Sam');
    const r = run(s, { kind: 'recv', msg: { t: 'nonsense' } as unknown as Msg });
    expect(r.state).toEqual(s);
  });
});
