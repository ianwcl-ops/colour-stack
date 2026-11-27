import { describe, expect, it } from 'vitest';
import {
  allReady,
  bonusPoints,
  canStart,
  createMatch,
  isMsg,
  me,
  opponents,
  playerPuzzle,
  reduce,
  restoreHost,
  MAX_PLAYERS,
  POINTS,
  type MatchEvent,
  type MatchState,
  type Msg,
  type Out,
  type PuzzleData,
} from '../src/net/match';

const puzzle: PuzzleData = {
  seed: 's',
  level: 3,
  start: { rods: [[0, 1], [1, 0], []], capacity: 2 },
  par: 3,
  parIsMinimum: true,
};
const easy: PuzzleData = {
  seed: 'e',
  level: 2,
  start: { rods: [[0, 1], [0, 1], [], []], capacity: 2 },
  par: 2,
  parIsMinimum: true,
};
/** Well over par, so placing points can be checked without bonuses. */
const SLOW = 20;

interface Guest {
  state: MatchState;
  conn: string | null;
  queue: Msg[];
  n: number;
}

/**
 * A fake room: the host plus guests, delivering every message the reducers send the
 * way the real transport does. Guests can drop off and come back on a new connection;
 * while offline their messages queue up, as the real client does.
 */
class Room {
  host: MatchState = createMatch('host', 'Ian', 3);
  guests = new Map<string, Guest>();

  private deliver(fromPid: string, outs: Out[]): void {
    for (const o of outs) {
      if (fromPid === 'host') {
        const pids = o.to === 'all' ? [...this.guests.keys()].filter((g) => g !== o.except) : [this.pidFor(o.to)];
        for (const pid of pids) if (pid) this.toGuest(pid, o.msg);
      } else {
        const g = this.guests.get(fromPid)!;
        if (g.conn) this.toHost(g.conn, o.msg);
        else g.queue.push(o.msg);
      }
    }
  }
  private pidFor(to: string): string | undefined {
    if (this.guests.has(to)) return to;
    return [...this.guests.entries()].find(([, g]) => g.conn === to)?.[0];
  }
  private toGuest(pid: string, msg: Msg): void {
    const g = this.guests.get(pid);
    if (!g || !g.conn) return; // offline: lost, like a dead connection
    const r = reduce(g.state, { kind: 'recv', from: 'host', msg });
    g.state = r.state;
    this.deliver(pid, r.outbox);
  }
  private toHost(conn: string, msg: Msg): void {
    const r = reduce(this.host, { kind: 'recv', from: conn, msg });
    this.host = r.state;
    this.deliver('host', r.outbox);
  }

  join(pid: string, name: string): void {
    this.guests.set(pid, { state: createMatch('guest', name, 3, pid), conn: null, queue: [], n: 0 });
    this.connect(pid);
  }
  private connect(pid: string): void {
    const g = this.guests.get(pid)!;
    g.n++;
    g.conn = `${pid}#${g.n}`;
    this.hostDo({ kind: 'peer-joined', id: g.conn });
    this.guestDo(pid, { kind: 'connected' });
    const queued = g.queue.splice(0);
    for (const m of queued) this.toHost(g.conn, m);
  }
  /** Phone switched apps: the connection dies on both ends. */
  drop(pid: string): void {
    const g = this.guests.get(pid)!;
    const conn = g.conn!;
    g.conn = null;
    this.hostDo({ kind: 'peer-dropped', id: conn });
    this.guestDo(pid, { kind: 'disconnected' });
  }
  reconnect(pid: string): void {
    this.connect(pid);
  }
  /** Browser closed and link reopened: fresh state, same saved player id. */
  reload(pid: string, name: string): void {
    const g = this.guests.get(pid)!;
    if (g.conn) this.drop(pid);
    g.state = createMatch('guest', name, 3, pid);
    g.queue = [];
    this.connect(pid);
  }
  /** Tapping Leave. */
  leave(pid: string): void {
    this.guestDo(pid, { kind: 'leave' });
    const g = this.guests.get(pid)!;
    this.hostDo({ kind: 'peer-dropped', id: g.conn! });
    this.guests.delete(pid);
  }
  hostDo(e: MatchEvent): void {
    const r = reduce(this.host, e);
    this.host = r.state;
    this.deliver('host', r.outbox);
  }
  guestDo(pid: string, e: MatchEvent): void {
    const g = this.guests.get(pid)!;
    const r = reduce(g.state, e);
    g.state = r.state;
    this.deliver(pid, r.outbox);
  }
  g(pid: string): MatchState {
    return this.guests.get(pid)!.state;
  }
  startRace(withEasy = false): void {
    this.hostDo(withEasy ? { kind: 'start-round', puzzle, easy } : { kind: 'start-round', puzzle });
    this.hostDo({ kind: 'go' });
    for (const pid of this.guests.keys()) this.guestDo(pid, { kind: 'go' });
  }
}

const names = (s: MatchState) => s.players.filter((p) => p.present).map((p) => p.name);
const pts = (s: MatchState) => Object.fromEntries(s.players.map((p) => [p.name, p.points]));

describe('joining the lobby', () => {
  it('up to 4 players join from the same link and everyone sees the full list', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    room.join('c', 'Ly');
    expect(names(room.host)).toEqual(['Ian', 'Keira', 'Jake', 'Ly']);
    expect(names(room.g('a'))).toEqual(['Ian', 'Keira', 'Jake', 'Ly']);
    expect(me(room.g('b')).name).toBe('Jake');
    expect(MAX_PLAYERS).toBe(4);
  });

  it('a 5th player is told the room is full and disconnected', () => {
    const room = new Room();
    for (const [id, n] of [['a', 'A'], ['b', 'B'], ['c', 'C']] as const) room.join(id, n);
    room.hostDo({ kind: 'peer-joined', id: 'e#1' });
    const r = reduce(room.host, { kind: 'recv', from: 'e#1', msg: { t: 'hello', name: 'E', pid: 'e', v: 3 } });
    expect(r.outbox).toEqual([{ to: 'e#1', msg: { t: 'full' }, close: true }]);
    expect(names(r.state)).toHaveLength(4);
    expect(reduce(createMatch('guest', 'E'), { kind: 'recv', from: 'host', msg: { t: 'full' } }).state.full).toBe(true);
  });

  it('only the creator can start, and only with at least 2 players', () => {
    const room = new Room();
    expect(canStart(room.host)).toBe(false);
    room.join('a', 'Keira');
    expect(canStart(room.host)).toBe(true);
    expect(canStart(room.g('a'))).toBe(false);
    room.guestDo('a', { kind: 'start-round', puzzle });
    expect(room.g('a').phase).toBe('lobby');
  });

  it('the creator picks the level and everyone sees it', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.hostDo({ kind: 'set-level', level: 4 });
    expect(room.g('a').level).toBe(4);
    room.guestDo('a', { kind: 'set-level', level: 2 });
    expect(room.host.level).toBe(4);
  });

  it('cleans up names from the network', () => {
    const room = new Room();
    room.join('a', '<b>Keira</b>!!');
    expect(me(room.g('a')).name).toBe('bKeirab');
  });
});

describe('racing with 3 players', () => {
  const threeRacing = () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    room.startRace();
    return room;
  };

  it('everyone gets the same puzzle', () => {
    const room = threeRacing();
    for (const s of [room.host, room.g('a'), room.g('b')]) {
      expect(playerPuzzle(s, me(s))).toEqual(puzzle);
      expect(s.round).toBe(1);
    }
  });

  it('each move is relayed to every other player', () => {
    const room = threeRacing();
    room.guestDo('a', { kind: 'local-move', rods: [[0], [1, 0], [1]], moves: 1 });
    expect(opponents(room.g('b')).find((p) => p.name === 'Keira')!.moves).toBe(1);
    expect(opponents(room.host).find((p) => p.name === 'Keira')!.rods).toEqual([[0], [1, 0], [1]]);
    expect(opponents(room.g('a')).every((p) => p.moves === 0)).toBe(true);
  });

  it('the race continues after the first finisher, and places are 1st, 2nd, 3rd', () => {
    const room = threeRacing();
    room.guestDo('a', { kind: 'local-solved', moves: SLOW, ms: 9000 });
    expect(me(room.g('a')).result?.place).toBe(1);
    expect(room.g('a').phase).toBe('placed');
    expect(room.host.phase).toBe('racing');
    room.hostDo({ kind: 'local-solved', moves: SLOW, ms: 11000 });
    room.guestDo('b', { kind: 'local-solved', moves: SLOW, ms: 15000 });
    for (const s of [room.host, room.g('a'), room.g('b')]) {
      expect(s.phase).toBe('finished');
      expect(Object.fromEntries(s.players.map((p) => [p.name, p.result?.place]))).toEqual({ Ian: 2, Keira: 1, Jake: 3 });
    }
  });

  it('placing points are 3 / 2 / 1 / 0 and add up over rounds', () => {
    expect(POINTS).toEqual([3, 2, 1, 0]);
    const room = threeRacing();
    room.guestDo('b', { kind: 'local-solved', moves: SLOW, ms: 1 });
    room.guestDo('a', { kind: 'local-solved', moves: SLOW, ms: 2 });
    room.hostDo({ kind: 'local-solved', moves: SLOW, ms: 3 });
    expect(pts(room.g('a'))).toEqual({ Ian: 1, Keira: 2, Jake: 3 });
  });

  it('giving up ends your race with no points and no place', () => {
    const room = threeRacing();
    room.hostDo({ kind: 'local-solved', moves: SLOW, ms: 1 });
    room.guestDo('b', { kind: 'give-up' });
    expect(me(room.g('b')).result).toMatchObject({ gaveUp: true, place: null });
    room.guestDo('a', { kind: 'local-solved', moves: 3, ms: 2 });
    expect(room.host.phase).toBe('finished');
    expect(room.g('a').players.find((p) => p.name === 'Jake')!.points).toBe(0);
  });

  it('tapping Leave mid-race removes the player at once and the race carries on', () => {
    const room = threeRacing();
    room.hostDo({ kind: 'local-solved', moves: SLOW, ms: 1 });
    room.guestDo('a', { kind: 'local-solved', moves: SLOW, ms: 2 });
    room.leave('b');
    expect(room.host.phase).toBe('finished');
    expect(names(room.g('a'))).toEqual(['Ian', 'Keira']);
  });

  it('a guest is told when the creator closes the room', () => {
    const room = threeRacing();
    room.hostDo({ kind: 'close-room' });
    expect(room.g('a').closed).toBe(true);
  });
});

describe('par bonus', () => {
  it('+2 at or under par, +1 within 2 moves of par, otherwise nothing', () => {
    expect(bonusPoints(10, 10)).toBe(2);
    expect(bonusPoints(9, 10)).toBe(2);
    expect(bonusPoints(11, 10)).toBe(1);
    expect(bonusPoints(12, 10)).toBe(1);
    expect(bonusPoints(13, 10)).toBe(0);
  });

  it('is added to placing points and shown in the result', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    room.startRace();
    room.guestDo('a', { kind: 'local-solved', moves: 3, ms: 1 }); // 1st (3) + at par (2)
    room.hostDo({ kind: 'local-solved', moves: 5, ms: 2 }); //        2nd (2) + within 2 (1)
    room.guestDo('b', { kind: 'local-solved', moves: 9, ms: 3 }); //  3rd (1) + nothing
    expect(pts(room.g('b'))).toEqual({ Ian: 3, Keira: 5, Jake: 1 });
    expect(room.g('b').players.find((p) => p.name === 'Keira')!.result).toMatchObject({ place: 1, bonus: 2, earned: 5 });
  });

  it('nobody gets a bonus for giving up', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.startRace();
    room.guestDo('a', { kind: 'give-up' });
    expect(room.host.players.find((p) => p.name === 'Keira')!.points).toBe(0);
  });
});

describe('staying connected when switching apps', () => {
  const racing = () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    room.startRace();
    return room;
  };

  it('a dropped player keeps their seat and others see them as reconnecting', () => {
    const room = racing();
    room.drop('a');
    const keira = room.host.players.find((p) => p.name === 'Keira')!;
    expect(keira.present).toBe(true);
    expect(keira.connected).toBe(false);
    expect(room.g('b').players.find((p) => p.name === 'Keira')!.connected).toBe(false);
    expect(room.g('a').conn).toBe('reconnecting');
  });

  it('moves made while away are sent on return, and the player carries on', () => {
    const room = racing();
    room.drop('a');
    room.guestDo('a', { kind: 'local-move', rods: [[0], [1, 0], [1]], moves: 1 });
    room.reconnect('a');
    expect(room.g('a').conn).toBe('online');
    expect(room.g('a').phase).toBe('racing');
    expect(room.host.players.find((p) => p.name === 'Keira')!).toMatchObject({ connected: true, moves: 1 });
    expect(names(room.host)).toEqual(['Ian', 'Keira', 'Jake']);
  });

  it('a finish made while offline still counts when they come back', () => {
    const room = racing();
    room.drop('a');
    room.guestDo('a', { kind: 'local-solved', moves: SLOW, ms: 5000 });
    room.hostDo({ kind: 'local-solved', moves: SLOW, ms: 6000 });
    room.reconnect('a');
    expect(me(room.g('a')).result?.place).toBe(2);
    expect(me(room.host).result?.place).toBe(1);
  });

  it('the race waits for a dropped player rather than ending without them', () => {
    const room = racing();
    room.drop('b');
    room.hostDo({ kind: 'local-solved', moves: SLOW, ms: 1 });
    room.guestDo('a', { kind: 'local-solved', moves: SLOW, ms: 2 });
    expect(room.host.phase).toBe('placed');
    room.reconnect('b');
    room.guestDo('b', { kind: 'local-solved', moves: SLOW, ms: 3 });
    expect(room.host.phase).toBe('finished');
    expect(me(room.g('b')).result?.place).toBe(3);
  });

  it('after the seat-hold time runs out, the player is removed and the race can end', () => {
    const room = racing();
    room.drop('b');
    room.hostDo({ kind: 'local-solved', moves: SLOW, ms: 1 });
    room.guestDo('a', { kind: 'local-solved', moves: SLOW, ms: 2 });
    room.hostDo({ kind: 'peer-expired', id: 'b' });
    expect(room.host.phase).toBe('finished');
    expect(names(room.g('a'))).toEqual(['Ian', 'Keira']);
  });

  it('expiry does nothing if they already came back', () => {
    const room = racing();
    room.drop('b');
    room.reconnect('b');
    room.hostDo({ kind: 'peer-expired', id: 'b' });
    expect(names(room.host)).toEqual(['Ian', 'Keira', 'Jake']);
  });

  it('closing the browser and reopening the link restores board, moves and place', () => {
    const room = racing();
    room.guestDo('a', { kind: 'local-move', rods: [[0], [1, 0], [1]], moves: 1 });
    room.reload('a', 'Keira');
    const s = room.g('a');
    expect(s.round).toBe(1);
    expect(s.phase).toBe('racing');
    expect(s.resumed).toBe(true);
    expect(me(s)).toMatchObject({ rods: [[0], [1, 0], [1]], moves: 1, inRound: true });
    expect(playerPuzzle(s, me(s))).toEqual(puzzle);
    // Points and other players come back too.
    expect(names(s)).toEqual(['Ian', 'Keira', 'Jake']);
  });

  it('reopening after finishing shows your place, or the standings if the race is over', () => {
    const room = racing();
    room.guestDo('a', { kind: 'local-solved', moves: SLOW, ms: 1 });
    room.reload('a', 'Keira');
    expect(room.g('a').phase).toBe('placed');
    room.hostDo({ kind: 'local-solved', moves: SLOW, ms: 2 });
    room.guestDo('b', { kind: 'local-solved', moves: SLOW, ms: 3 });
    room.reload('b', 'Jake');
    expect(room.g('b').phase).toBe('finished');
    expect(me(room.g('b')).result?.place).toBe(3);
  });

  it('reconnecting in the lobby just puts you back in the lobby', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.reload('a', 'Keira');
    expect(room.g('a').phase).toBe('lobby');
    expect(names(room.host)).toEqual(['Ian', 'Keira']);
  });

  it('the room creator can restore the room after their phone reloads, and players rejoin their seats', () => {
    const room = racing();
    room.guestDo('a', { kind: 'local-move', rods: [[0], [1, 0], [1]], moves: 1 });
    const saved = JSON.parse(JSON.stringify(room.host)) as MatchState;
    room.host = restoreHost(saved);
    expect(room.host.players.filter((p) => p.id !== 'host').every((p) => !p.connected && p.present)).toBe(true);
    // Guests' connections died with the old page.
    for (const pid of ['a', 'b']) {
      room.guests.get(pid)!.conn = null;
      room.guestDo(pid, { kind: 'disconnected' });
      room.reconnect(pid);
    }
    expect(room.host.players.every((p) => p.connected)).toBe(true);
    expect(room.host.players.find((p) => p.name === 'Keira')!.moves).toBe(1);
    room.hostDo({ kind: 'local-solved', moves: SLOW, ms: 1 });
    room.guestDo('a', { kind: 'local-solved', moves: SLOW, ms: 2 });
    room.guestDo('b', { kind: 'local-solved', moves: SLOW, ms: 3 });
    expect(room.g('b').phase).toBe('finished');
  });

  it('a guest who cannot reach the room for too long sees it as closed', () => {
    const room = racing();
    room.drop('a');
    room.guestDo('a', { kind: 'reconnect-failed' });
    expect(room.g('a').closed).toBe(true);
  });
});

describe('Little man mode', () => {
  it('only the creator can switch it on, for specific players, and everyone sees the badge', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    room.guestDo('a', { kind: 'toggle-lmm', id: 'b' });
    expect(room.host.players.find((p) => p.name === 'Jake')!.lmm).toBe(false);
    room.hostDo({ kind: 'toggle-lmm', id: 'b' });
    expect(room.g('a').players.find((p) => p.name === 'Jake')!.lmm).toBe(true);
    expect(me(room.g('b')).lmm).toBe(true);
    room.hostDo({ kind: 'toggle-lmm', id: 'b' });
    expect(me(room.g('b')).lmm).toBe(false);
  });

  it('that player races the easier puzzle; everyone else races the chosen level', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    room.hostDo({ kind: 'toggle-lmm', id: 'b' });
    room.startRace(true);
    expect(playerPuzzle(room.g('b'), me(room.g('b')))).toEqual(easy);
    expect(playerPuzzle(room.g('a'), me(room.g('a')))).toEqual(puzzle);
    // Others watch his progress on his own board.
    const jakeSeenByKeira = room.g('a').players.find((p) => p.name === 'Jake')!;
    expect(jakeSeenByKeira.rods).toEqual(easy.start.rods);
    expect(playerPuzzle(room.g('a'), jakeSeenByKeira)).toEqual(easy);
  });

  it('competes for the same placings, with the bonus based on his own puzzle’s par', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    room.hostDo({ kind: 'toggle-lmm', id: 'b' });
    room.startRace(true);
    room.guestDo('b', { kind: 'local-solved', moves: 2, ms: 1 }); // easy par is 2
    expect(me(room.g('b')).result).toMatchObject({ place: 1, bonus: 2, earned: 5 });
  });

  it('stays on across rematches', () => {
    const room = new Room();
    room.join('b', 'Jake');
    room.hostDo({ kind: 'toggle-lmm', id: 'b' });
    room.startRace(true);
    room.hostDo({ kind: 'local-solved', moves: SLOW, ms: 1 });
    room.guestDo('b', { kind: 'local-solved', moves: SLOW, ms: 2 });
    room.guestDo('b', { kind: 'request-rematch' });
    room.hostDo({ kind: 'request-rematch' });
    room.startRace(true);
    expect(me(room.g('b')).lmm).toBe(true);
    expect(playerPuzzle(room.g('b'), me(room.g('b')))).toEqual(easy);
  });

  it('on Warm-up there is nothing easier, so everyone plays the same puzzle', () => {
    const room = new Room();
    room.join('b', 'Jake');
    room.hostDo({ kind: 'toggle-lmm', id: 'b' });
    room.startRace(false);
    expect(playerPuzzle(room.g('b'), me(room.g('b')))).toEqual(puzzle);
  });

  it('cannot be changed mid-race', () => {
    const room = new Room();
    room.join('b', 'Jake');
    room.startRace();
    room.hostDo({ kind: 'toggle-lmm', id: 'b' });
    expect(me(room.g('b')).lmm).toBe(false);
  });
});

describe('late joiners and rematch', () => {
  it('someone opening the link mid-race waits and plays the next round', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.startRace();
    room.join('b', 'Jake');
    expect(room.g('b').phase).toBe('lobby');
    expect(room.g('b').raceInProgress).toBe(true);
    room.hostDo({ kind: 'local-solved', moves: SLOW, ms: 1 });
    room.guestDo('a', { kind: 'local-solved', moves: SLOW, ms: 2 });
    room.guestDo('a', { kind: 'request-rematch' });
    expect(allReady(room.host)).toBe(false);
    room.hostDo({ kind: 'request-rematch' });
    expect(allReady(room.host)).toBe(true);
    room.startRace();
    expect(room.g('b').phase).toBe('racing');
  });

  const finishedThree = () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    room.startRace();
    room.hostDo({ kind: 'local-solved', moves: SLOW, ms: 1 });
    room.guestDo('a', { kind: 'local-solved', moves: SLOW, ms: 2 });
    room.guestDo('b', { kind: 'local-solved', moves: SLOW, ms: 3 });
    return room;
  };

  it('waits until everyone has tapped Rematch, and everyone sees who is ready', () => {
    const room = finishedThree();
    room.guestDo('a', { kind: 'request-rematch' });
    room.hostDo({ kind: 'request-rematch' });
    expect(allReady(room.host)).toBe(false);
    expect(room.g('b').players.filter((p) => p.ready).map((p) => p.name)).toEqual(['Ian', 'Keira']);
    room.guestDo('b', { kind: 'request-rematch' });
    expect(allReady(room.host)).toBe(true);
  });

  it('cannot tap Rematch mid-race', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.startRace();
    room.guestDo('a', { kind: 'request-rematch' });
    expect(me(room.g('a')).ready).toBe(false);
  });

  it('needs at least 2 players to rematch', () => {
    const room = finishedThree();
    room.leave('a');
    room.leave('b');
    room.hostDo({ kind: 'request-rematch' });
    expect(allReady(room.host)).toBe(false);
  });

  it('a new round clears results and ready flags but keeps points', () => {
    const room = finishedThree();
    for (const id of ['a', 'b']) room.guestDo(id, { kind: 'request-rematch' });
    room.hostDo({ kind: 'request-rematch' });
    room.startRace();
    for (const s of [room.host, room.g('b')]) {
      expect(s.round).toBe(2);
      expect(s.players.every((p) => p.result === null && !p.ready && p.moves === 0)).toBe(true);
      expect(s.players.map((p) => p.points)).toEqual([3, 2, 1]);
    }
  });

  it('the creator can change the level between rounds, but not mid-race', () => {
    const room = finishedThree();
    room.hostDo({ kind: 'set-level', level: 5 });
    expect(room.g('a').level).toBe(5);
    room.startRace();
    room.hostDo({ kind: 'set-level', level: 2 });
    expect(room.host.level).toBe(3);
  });
});

describe('message validation', () => {
  it('rejects malformed messages safely', () => {
    const s = createMatch('host', 'Ian');
    expect(isMsg({ t: 'nonsense' })).toBe(false);
    expect(isMsg({ t: 'progress', round: 1, rods: 'x', moves: 1 })).toBe(false);
    expect(reduce(s, { kind: 'recv', from: 'a', msg: { t: 'nonsense' } as never }).state).toEqual(s);
  });

  it('a guest cannot send host-only messages', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.hostDo({ kind: 'recv', from: 'a#1', msg: { t: 'start', round: 5, puzzle, easy: null, players: ['host', 'a'], handicapped: [] } });
    expect(room.host.round).toBe(0);
  });

  it('a guest cannot take over someone else’s seat by reusing a connection', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    // Jake's connection tries to report a solve: it only ever counts for Jake.
    room.startRace();
    room.hostDo({ kind: 'recv', from: 'b#1', msg: { t: 'solved', round: 1, moves: SLOW, ms: 1 } });
    expect(room.host.players.find((p) => p.name === 'Keira')!.result).toBeNull();
    expect(room.host.players.find((p) => p.name === 'Jake')!.result?.place).toBe(1);
  });
});
