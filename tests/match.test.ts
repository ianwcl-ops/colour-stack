import { describe, expect, it } from 'vitest';
import {
  allReady,
  canStart,
  createMatch,
  isMsg,
  me,
  opponents,
  reduce,
  MAX_PLAYERS,
  POINTS,
  type MatchEvent,
  type MatchState,
  type Out,
  type PuzzleData,
} from '../src/net/match';

const puzzle: PuzzleData = {
  seed: 's',
  level: 1,
  start: { rods: [[0, 1], [1, 0], []], capacity: 2 },
  par: 3,
  parIsMinimum: true,
};

/**
 * A fake room: the host plus guests, delivering every message the reducers send,
 * the way the real transport does (guests only ever talk to the host).
 */
class Room {
  host: MatchState = createMatch('host', 'Ian', 1);
  guests = new Map<string, MatchState>();

  private deliverAll(fromId: string, outs: Out[]): void {
    for (const o of outs) {
      if (fromId === 'host') {
        const targets = o.to === 'all' ? [...this.guests.keys()].filter((g) => g !== o.except) : [o.to];
        for (const t of targets) this.toGuest(t, o.msg);
        if (o.close) this.guests.delete(o.to);
      } else this.toHost(fromId, o.msg);
    }
  }
  private toGuest(id: string, msg: Out['msg']): void {
    const g = this.guests.get(id);
    if (!g) return;
    const r = reduce(g, { kind: 'recv', from: 'host', msg });
    this.guests.set(id, r.state);
    this.deliverAll(id, r.outbox);
  }
  private toHost(from: string, msg: Out['msg']): void {
    const r = reduce(this.host, { kind: 'recv', from, msg });
    this.host = r.state;
    this.deliverAll('host', r.outbox);
  }

  join(id: string, name: string): void {
    this.guests.set(id, createMatch('guest', name));
    this.hostDo({ kind: 'peer-joined', id });
    this.guestDo(id, { kind: 'connected' });
  }
  leave(id: string): void {
    this.guests.delete(id);
    this.hostDo({ kind: 'peer-left', id });
  }
  hostDo(e: MatchEvent): void {
    const r = reduce(this.host, e);
    this.host = r.state;
    this.deliverAll('host', r.outbox);
  }
  guestDo(id: string, e: MatchEvent): void {
    const r = reduce(this.guests.get(id)!, e);
    this.guests.set(id, r.state);
    this.deliverAll(id, r.outbox);
  }
  g(id: string): MatchState {
    return this.guests.get(id)!;
  }
  startRace(): void {
    this.hostDo({ kind: 'start-round', puzzle });
    this.hostDo({ kind: 'go' });
    for (const id of this.guests.keys()) this.guestDo(id, { kind: 'go' });
  }
}

const names = (s: MatchState) => s.players.filter((p) => p.present).map((p) => p.name);

describe('joining the lobby', () => {
  it('up to 4 players join from the same link and everyone sees the full list', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    room.join('c', 'Ly');
    expect(names(room.host)).toEqual(['Ian', 'Keira', 'Jake', 'Ly']);
    expect(names(room.g('a'))).toEqual(['Ian', 'Keira', 'Jake', 'Ly']);
    expect(names(room.g('c'))).toEqual(['Ian', 'Keira', 'Jake', 'Ly']);
    expect(me(room.g('b')).name).toBe('Jake');
    expect(MAX_PLAYERS).toBe(4);
  });

  it('a 5th player is told the room is full and disconnected', () => {
    const room = new Room();
    for (const [id, n] of [['a', 'A'], ['b', 'B'], ['c', 'C']] as const) room.join(id, n);
    room.hostDo({ kind: 'peer-joined', id: 'e' });
    const r = reduce(room.host, { kind: 'recv', from: 'e', msg: { t: 'hello', name: 'E', v: 2 } });
    expect(r.outbox).toEqual([{ to: 'e', msg: { t: 'full' }, close: true }]);
    expect(names(r.state)).toHaveLength(4);
    const guestView = reduce(createMatch('guest', 'E'), { kind: 'recv', from: 'host', msg: { t: 'full' } }).state;
    expect(guestView.full).toBe(true);
  });

  it('only the creator can start, and only with at least 2 players', () => {
    const room = new Room();
    expect(canStart(room.host)).toBe(false);
    room.hostDo({ kind: 'start-round', puzzle });
    expect(room.host.phase).toBe('lobby');

    room.join('a', 'Keira');
    expect(canStart(room.host)).toBe(true);
    expect(canStart(room.g('a'))).toBe(false);
    room.guestDo('a', { kind: 'start-round', puzzle });
    expect(room.g('a').phase).toBe('lobby');
  });

  it('the creator picks the level and everyone sees it', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    room.hostDo({ kind: 'set-level', level: 4 });
    expect(room.g('b').level).toBe(4);
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

  it('everyone gets the same puzzle and the countdown together', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    room.hostDo({ kind: 'start-round', puzzle });
    for (const s of [room.host, room.g('a'), room.g('b')]) {
      expect(s.phase).toBe('countdown');
      expect(s.puzzle).toEqual(puzzle);
      expect(s.round).toBe(1);
    }
  });

  it('each move is relayed to every other player', () => {
    const room = threeRacing();
    room.guestDo('a', { kind: 'local-move', rods: [[0], [1, 0], [1]], moves: 1 });
    const seenByJake = opponents(room.g('b')).find((p) => p.name === 'Keira')!;
    const seenByIan = opponents(room.host).find((p) => p.name === 'Keira')!;
    expect(seenByJake.moves).toBe(1);
    expect(seenByJake.rods).toEqual([[0], [1, 0], [1]]);
    expect(seenByIan.moves).toBe(1);
    expect(opponents(room.g('a')).every((p) => p.moves === 0)).toBe(true);
  });

  it('the race continues after the first finisher, and places are 1st, 2nd, 3rd', () => {
    const room = threeRacing();
    room.guestDo('a', { kind: 'local-solved', moves: 4, ms: 9000 });
    expect(me(room.g('a')).result?.place).toBe(1);
    expect(room.g('a').phase).toBe('placed');
    expect(room.host.phase).toBe('racing');
    expect(room.g('b').phase).toBe('racing');

    room.hostDo({ kind: 'local-solved', moves: 5, ms: 11000 });
    expect(me(room.host).result?.place).toBe(2);
    expect(room.host.phase).toBe('placed');

    room.guestDo('b', { kind: 'local-solved', moves: 3, ms: 15000 });
    for (const s of [room.host, room.g('a'), room.g('b')]) {
      expect(s.phase).toBe('finished');
      const places = Object.fromEntries(s.players.map((p) => [p.name, p.result?.place]));
      expect(places).toEqual({ Ian: 2, Keira: 1, Jake: 3 });
    }
  });

  it('points are 3 / 2 / 1 / 0 by place and add up over rounds', () => {
    expect(POINTS).toEqual([3, 2, 1, 0]);
    const room = threeRacing();
    room.guestDo('b', { kind: 'local-solved', moves: 4, ms: 1 });
    room.guestDo('a', { kind: 'local-solved', moves: 4, ms: 2 });
    room.hostDo({ kind: 'local-solved', moves: 4, ms: 3 });
    const pts = (s: MatchState) => Object.fromEntries(s.players.map((p) => [p.name, p.points]));
    expect(pts(room.g('a'))).toEqual({ Ian: 1, Keira: 2, Jake: 3 });

    for (const id of ['a', 'b']) room.guestDo(id, { kind: 'request-rematch' });
    room.hostDo({ kind: 'request-rematch' });
    room.startRace();
    room.hostDo({ kind: 'local-solved', moves: 4, ms: 1 });
    room.guestDo('a', { kind: 'local-solved', moves: 4, ms: 2 });
    room.guestDo('b', { kind: 'local-solved', moves: 4, ms: 3 });
    expect(pts(room.g('b'))).toEqual({ Ian: 4, Keira: 4, Jake: 4 });
  });

  it('giving up ends your race with no points and no place', () => {
    const room = threeRacing();
    room.hostDo({ kind: 'local-solved', moves: 4, ms: 1 });
    room.guestDo('b', { kind: 'give-up' });
    expect(me(room.g('b')).result).toMatchObject({ gaveUp: true, place: null });
    expect(room.host.phase).toBe('placed');
    room.guestDo('a', { kind: 'local-solved', moves: 9, ms: 2 });
    expect(room.host.phase).toBe('finished');
    expect(room.g('a').players.find((p) => p.name === 'Jake')!.points).toBe(0);
    expect(room.g('a').players.find((p) => p.name === 'Keira')!.result?.place).toBe(2);
  });

  it('a player leaving mid-race does not stop the race for the others', () => {
    const room = threeRacing();
    room.hostDo({ kind: 'local-solved', moves: 4, ms: 1 });
    room.guestDo('a', { kind: 'local-solved', moves: 4, ms: 2 });
    expect(room.host.phase).toBe('placed');
    room.leave('b');
    expect(room.host.phase).toBe('finished');
    expect(room.g('a').phase).toBe('finished');
    expect(names(room.g('a'))).toEqual(['Ian', 'Keira']);
  });

  it('a guest sees the room closed when the creator leaves', () => {
    const room = threeRacing();
    room.guestDo('a', { kind: 'disconnected' });
    expect(room.g('a').closed).toBe(true);
  });

  it('ignores progress from an old round', () => {
    const room = threeRacing();
    room.hostDo({ kind: 'recv', from: 'a', msg: { t: 'progress', round: 0, rods: [], moves: 9 } });
    expect(opponents(room.host).find((p) => p.name === 'Keira')!.moves).toBe(0);
  });
});

describe('late joiners', () => {
  it('someone opening the link mid-race waits and plays the next round', () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.startRace();
    room.join('b', 'Jake');
    expect(room.g('b').phase).toBe('lobby');
    expect(room.g('b').raceInProgress).toBe(true);
    expect(room.host.players.find((p) => p.name === 'Jake')!.inRound).toBe(false);

    room.hostDo({ kind: 'local-solved', moves: 3, ms: 1 });
    room.guestDo('a', { kind: 'local-solved', moves: 3, ms: 2 });
    expect(room.host.phase).toBe('finished');

    // Late joiners count as ready; only the two who raced need to tap.
    room.guestDo('a', { kind: 'request-rematch' });
    expect(allReady(room.host)).toBe(false);
    room.hostDo({ kind: 'request-rematch' });
    expect(allReady(room.host)).toBe(true);

    room.startRace();
    expect(room.g('b').phase).toBe('racing');
    expect(room.host.players.every((p) => p.inRound)).toBe(true);
  });
});

describe('rematch', () => {
  const finishedThree = () => {
    const room = new Room();
    room.join('a', 'Keira');
    room.join('b', 'Jake');
    room.startRace();
    room.hostDo({ kind: 'local-solved', moves: 3, ms: 1 });
    room.guestDo('a', { kind: 'local-solved', moves: 3, ms: 2 });
    room.guestDo('b', { kind: 'local-solved', moves: 3, ms: 3 });
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

  it('if a player leaves after the race, the rest can still rematch', () => {
    const room = finishedThree();
    room.guestDo('a', { kind: 'request-rematch' });
    room.hostDo({ kind: 'request-rematch' });
    room.leave('b');
    expect(allReady(room.host)).toBe(true);
  });

  it('needs at least 2 players to rematch', () => {
    const room = finishedThree();
    room.leave('a');
    room.leave('b');
    room.hostDo({ kind: 'request-rematch' });
    expect(allReady(room.host)).toBe(false);
  });

  it('the creator can change the level between rounds, but not mid-race', () => {
    const room = finishedThree();
    room.hostDo({ kind: 'set-level', level: 5 });
    expect(room.g('a').level).toBe(5);
    room.startRace();
    room.hostDo({ kind: 'set-level', level: 2 });
    expect(room.host.level).toBe(1);
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
    room.join('b', 'Jake');
    room.hostDo({ kind: 'recv', from: 'a', msg: { t: 'start', round: 5, puzzle, players: ['host', 'a'] } });
    expect(room.host.round).toBe(0);
  });
});
