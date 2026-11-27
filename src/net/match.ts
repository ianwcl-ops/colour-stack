import type { Board, Rods } from '../engine/board';

/**
 * Multiplayer race protocol (2–4 players).
 *
 * The room creator ("host") is the hub: guests only talk to the host, and the host
 * relays moves, decides placings and owns the roster. Players are identified by a
 * saved player id (pid), not by their connection, so a phone that drops off (switching
 * apps, locking, reloading) can reconnect on a new connection and take its seat back.
 * Everything here is pure so it can be tested without a network.
 */

export type Role = 'host' | 'guest';
/** placed = I've finished (or given up) but others are still racing. */
export type Phase = 'lobby' | 'countdown' | 'racing' | 'waiting' | 'placed' | 'finished';
export type ConnState = 'connecting' | 'online' | 'reconnecting';

export const MAX_PLAYERS = 4;
/** Placing points: 1st, 2nd, 3rd, 4th. */
export const POINTS = [3, 2, 1, 0] as const;
export const HOST_ID = 'host';
/** How long a dropped player's seat is held. */
export const SEAT_HOLD_MS = 3 * 60_000;

/** +2 for finishing at or under par, +1 for within 2 moves over par. */
export function bonusPoints(moves: number, par: number): number {
  if (moves <= par) return 2;
  if (moves <= par + 2) return 1;
  return 0;
}

/** The puzzle sent over the wire: no solution, so nobody can peek. */
export interface PuzzleData {
  seed: string;
  level: number;
  start: Board;
  par: number;
  parIsMinimum: boolean;
}

export interface Result {
  /** 1-based place, or null for a player who gave up. */
  place: number | null;
  moves: number;
  ms: number;
  gaveUp: boolean;
  /** Par bonus and total points earned this round. */
  bonus: number;
  earned: number;
}

export interface Player {
  id: string;
  name: string;
  /** In the room (false once they leave or their seat expires). */
  present: boolean;
  /** Has a live connection right now (false while reconnecting). */
  connected: boolean;
  /** Taking part in the current round (false for someone who joined mid-race). */
  inRound: boolean;
  ready: boolean;
  points: number;
  /** Little man mode is switched on for this player. */
  lmm: boolean;
  /** Playing the easier puzzle this round. */
  handicap: boolean;
  rods: Rods;
  moves: number;
  result: Result | null;
}

interface RosterEntry {
  id: string;
  name: string;
  present: boolean;
  connected: boolean;
  inRound: boolean;
  ready: boolean;
  points: number;
  lmm: boolean;
}

interface SyncEntry {
  id: string;
  rods: Rods;
  moves: number;
  result: Result | null;
  inRound: boolean;
  handicap: boolean;
}

export type Msg =
  // guest -> host
  | { t: 'hello'; name: string; pid: string; v: 3 }
  | { t: 'solved'; round: number; moves: number; ms: number }
  | { t: 'giveup'; round: number }
  | { t: 'rematch' }
  | { t: 'leave' }
  // host -> guest
  | { t: 'welcome'; you: string; level: number; round: number; raceInProgress: boolean }
  | { t: 'roster'; players: RosterEntry[] }
  | { t: 'level'; level: number }
  | { t: 'start'; round: number; puzzle: PuzzleData; easy: PuzzleData | null; players: string[]; handicapped: string[] }
  | { t: 'sync'; round: number; phase: 'lobby' | 'racing' | 'finished'; puzzle: PuzzleData | null; easy: PuzzleData | null; players: SyncEntry[] }
  | { t: 'placed'; round: number; id: string; result: Result; points: number }
  | { t: 'finished'; round: number }
  | { t: 'full' }
  | { t: 'closed' }
  // both ways (the host adds the mover's id when relaying)
  | { t: 'progress'; round: number; rods: Rods; moves: number; id?: string };

export interface Out {
  /** A player id, a raw connection id (before hello), 'host', or 'all' (host only). */
  to: string;
  msg: Msg;
  /** With to: 'all', skip this player. */
  except?: string;
  /** Disconnect after sending. */
  close?: boolean;
}

export type MatchEvent =
  | { kind: 'connected' }
  | { kind: 'disconnected' }
  | { kind: 'reconnect-failed' }
  | { kind: 'leave' }
  | { kind: 'close-room' }
  | { kind: 'peer-joined'; id: string }
  | { kind: 'peer-dropped'; id: string }
  | { kind: 'peer-expired'; id: string }
  | { kind: 'recv'; from: string; msg: Msg }
  | { kind: 'set-level'; level: number }
  | { kind: 'toggle-lmm'; id: string }
  | { kind: 'start-round'; puzzle: PuzzleData; easy?: PuzzleData }
  | { kind: 'go' }
  | { kind: 'local-move'; rods: Rods; moves: number }
  | { kind: 'local-solved'; moves: number; ms: number }
  | { kind: 'give-up' }
  | { kind: 'request-rematch' };

export interface MatchState {
  role: Role;
  myId: string;
  players: Player[];
  level: number;
  phase: Phase;
  round: number;
  /** The chosen level's puzzle. */
  puzzle: PuzzleData | null;
  /** One level easier, for players in Little man mode (null on Warm-up). */
  easy: PuzzleData | null;
  /** Host: which connection belongs to which player. */
  links: Record<string, string>;
  /** Guest: connection to the host. */
  conn: ConnState;
  /** Guest: rebuilt mid-race from the host after reopening the page. */
  resumed: boolean;
  /** Guest joined while a race was on: waiting for the next round. */
  raceInProgress: boolean;
  /** Guest: the room has closed. */
  closed: boolean;
  /** Guest: turned away because the room already had 4 players. */
  full: boolean;
}

const newPlayer = (id: string, name: string): Player => ({
  id,
  name,
  present: true,
  connected: true,
  inRound: false,
  ready: false,
  points: 0,
  lmm: false,
  handicap: false,
  rods: [],
  moves: 0,
  result: null,
});

export function newPid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return 'p' + [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

export function createMatch(role: Role, myName: string, level = 3, pid?: string): MatchState {
  const myId = role === 'host' ? HOST_ID : (pid ?? newPid());
  return {
    role,
    myId,
    players: [newPlayer(myId, cleanName(myName))],
    level,
    phase: 'lobby',
    round: 0,
    puzzle: null,
    easy: null,
    links: {},
    conn: 'connecting',
    resumed: false,
    raceInProgress: false,
    closed: false,
    full: false,
  };
}

/** Host page reopened: guests' old connections are gone, so hold every seat while they reconnect. */
export function restoreHost(saved: MatchState): MatchState {
  return {
    ...saved,
    links: {},
    phase: saved.phase === 'countdown' ? 'racing' : saved.phase,
    players: saved.players.map((p) => (p.id === HOST_ID ? { ...p, connected: true } : { ...p, connected: false })),
  };
}

/* ---------- Selectors ---------- */

export const me = (s: MatchState): Player => s.players.find((p) => p.id === s.myId) ?? s.players[0]!;
export const opponents = (s: MatchState): Player[] => s.players.filter((p) => p.id !== s.myId && p.present);
export const presentCount = (s: MatchState): number => s.players.filter((p) => p.present).length;
export const playerPuzzle = (s: MatchState, p: Player): PuzzleData => (p.handicap && s.easy ? s.easy : s.puzzle!);

export const canStart = (s: MatchState): boolean =>
  s.role === 'host' && (s.phase === 'lobby' || s.phase === 'finished') && presentCount(s) >= 2;

/** Rematch can start: everyone who raced has tapped Rematch (late joiners count as ready). */
export const allReady = (s: MatchState): boolean =>
  s.phase === 'finished' && presentCount(s) >= 2 && s.players.every((p) => !p.present || !p.inRound || p.ready);

/* ---------- Validation ---------- */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length <= 64;
const isRods = (v: unknown): v is Rods =>
  Array.isArray(v) && v.length <= 12 && v.every((r) => Array.isArray(r) && r.length <= 12 && r.every(isNum));
const isPuzzle = (v: unknown): v is PuzzleData => {
  const p = v as Record<string, unknown> | null;
  const start = p?.start as Record<string, unknown> | undefined;
  return !!p && !!start && isRods(start.rods) && isNum(start.capacity) && isNum(p.par) && isNum(p.level);
};

/** Validate anything arriving from the network before trusting it. */
export function isMsg(v: unknown): v is Msg {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return isStr(m.name) && isStr(m.pid) && m.pid.length > 0 && m.v === 3;
    case 'solved':
      return isNum(m.round) && isNum(m.moves) && isNum(m.ms);
    case 'giveup':
      return isNum(m.round);
    case 'rematch':
    case 'leave':
    case 'full':
    case 'closed':
      return true;
    case 'welcome':
      return isStr(m.you) && isNum(m.level) && isNum(m.round) && typeof m.raceInProgress === 'boolean';
    case 'roster':
      return (
        Array.isArray(m.players) &&
        m.players.length <= MAX_PLAYERS * 4 &&
        m.players.every((p: Record<string, unknown>) => p && isStr(p.id) && isStr(p.name) && isNum(p.points))
      );
    case 'level':
      return isNum(m.level);
    case 'start':
      return (
        isNum(m.round) &&
        isPuzzle(m.puzzle) &&
        (m.easy === null || isPuzzle(m.easy)) &&
        Array.isArray(m.players) &&
        m.players.every(isStr) &&
        Array.isArray(m.handicapped) &&
        m.handicapped.every(isStr)
      );
    case 'sync':
      return (
        isNum(m.round) &&
        (m.phase === 'lobby' || m.phase === 'racing' || m.phase === 'finished') &&
        (m.puzzle === null || isPuzzle(m.puzzle)) &&
        (m.easy === null || isPuzzle(m.easy)) &&
        Array.isArray(m.players) &&
        m.players.every((p: Record<string, unknown>) => p && isStr(p.id) && isRods(p.rods) && isNum(p.moves))
      );
    case 'placed':
      return isNum(m.round) && isStr(m.id) && !!m.result && typeof m.result === 'object' && isNum(m.points);
    case 'finished':
      return isNum(m.round);
    case 'progress':
      return isNum(m.round) && isRods(m.rods) && isNum(m.moves) && (m.id === undefined || isStr(m.id));
    default:
      return false;
  }
}

const GUEST_TO_HOST = new Set(['hello', 'solved', 'giveup', 'rematch', 'progress', 'leave']);

export function cleanName(n: string): string {
  return n.replace(/[^\p{L}\p{N} '\-]/gu, '').trim().slice(0, 16) || 'Player';
}

/* ---------- Reducer ---------- */

type R = { state: MatchState; outbox: Out[] };

const update = (s: MatchState, id: string, f: (p: Player) => Player): MatchState => ({
  ...s,
  players: s.players.map((p) => (p.id === id ? f(p) : p)),
});

const rosterMsg = (s: MatchState): Msg => ({
  t: 'roster',
  players: s.players.map(({ id, name, present, connected, inRound, ready, points, lmm }) => ({
    id,
    name,
    present,
    connected,
    inRound,
    ready,
    points,
    lmm,
  })),
});
const toAll = (msg: Msg, except?: string): Out => (except === undefined ? { to: 'all', msg } : { to: 'all', msg, except });
const live = (s: MatchState) => s.phase === 'racing' || s.phase === 'countdown' || s.phase === 'placed';

function syncMsg(s: MatchState): Msg {
  return {
    t: 'sync',
    round: s.round,
    phase: s.phase === 'lobby' ? 'lobby' : s.phase === 'finished' ? 'finished' : 'racing',
    puzzle: s.puzzle,
    easy: s.easy,
    players: s.players.map(({ id, rods, moves, result, inRound, handicap }) => ({ id, rods, moves, result, inRound, handicap })),
  };
}

export function reduce(s: MatchState, e: MatchEvent): R {
  const none: R = { state: s, outbox: [] };
  const racing = s.phase === 'racing' || s.phase === 'countdown';
  const host = s.role === 'host';

  switch (e.kind) {
    case 'connected':
      return host ? none : { state: s, outbox: [{ to: HOST_ID, msg: { t: 'hello', name: me(s).name, pid: s.myId, v: 3 } }] };

    case 'disconnected':
      return host || s.closed ? none : { state: { ...s, conn: 'reconnecting' }, outbox: [] };

    case 'reconnect-failed':
      return host ? none : { state: { ...s, closed: true }, outbox: [] };

    case 'leave':
      return host ? none : { state: s, outbox: [{ to: HOST_ID, msg: { t: 'leave' } }] };

    case 'close-room':
      return host ? { state: s, outbox: [toAll({ t: 'closed' })] } : none;

    case 'peer-joined':
      return none; // nothing happens until they say hello

    case 'peer-dropped': {
      const pid = s.links[e.id];
      if (!host || !pid) return none;
      const links = { ...s.links };
      delete links[e.id];
      const p = s.players.find((x) => x.id === pid);
      // A newer connection may already have taken over this seat.
      const stillLinked = Object.values(links).includes(pid);
      if (!p || !p.present || stillLinked) return { state: { ...s, links }, outbox: [] };
      const next = update({ ...s, links }, pid, (x) => ({ ...x, connected: false }));
      return { state: next, outbox: [toAll(rosterMsg(next))] };
    }

    case 'peer-expired': {
      const p = s.players.find((x) => x.id === e.id);
      if (!host || !p || !p.present || p.connected) return none;
      const next = update(s, e.id, (x) => ({ ...x, present: false, ready: false }));
      return checkDone(next, [toAll(rosterMsg(next))]);
    }

    case 'set-level':
      if (!host || (s.phase !== 'lobby' && s.phase !== 'finished')) return none;
      return { state: { ...s, level: e.level }, outbox: [toAll({ t: 'level', level: e.level })] };

    case 'toggle-lmm': {
      if (!host || (s.phase !== 'lobby' && s.phase !== 'finished') || !s.players.some((p) => p.id === e.id)) return none;
      const next = update(s, e.id, (p) => ({ ...p, lmm: !p.lmm }));
      return { state: next, outbox: [toAll(rosterMsg(next))] };
    }

    case 'start-round': {
      if (!canStart(s)) return none;
      const round = s.round + 1;
      const ids = s.players.filter((p) => p.present).map((p) => p.id);
      const easy = e.easy ?? null;
      const handicapped = easy ? s.players.filter((p) => p.present && p.lmm).map((p) => p.id) : [];
      const next = beginRound(s, round, e.puzzle, easy, ids, handicapped);
      return { state: next, outbox: [toAll({ t: 'start', round, puzzle: e.puzzle, easy, players: ids, handicapped })] };
    }

    case 'go':
      return s.phase === 'countdown' ? { state: { ...s, phase: 'racing' }, outbox: [] } : none;

    case 'local-move': {
      if (!racing) return none;
      const next = update(s, s.myId, (p) => ({ ...p, rods: e.rods, moves: e.moves }));
      if (host) return { state: next, outbox: [toAll({ t: 'progress', round: s.round, rods: e.rods, moves: e.moves, id: HOST_ID })] };
      return { state: next, outbox: [{ to: HOST_ID, msg: { t: 'progress', round: s.round, rods: e.rods, moves: e.moves } }] };
    }

    case 'local-solved':
      if (s.phase !== 'racing') return none;
      if (host) return place(s, HOST_ID, { moves: e.moves, ms: e.ms, gaveUp: false });
      return { state: { ...s, phase: 'waiting' }, outbox: [{ to: HOST_ID, msg: { t: 'solved', round: s.round, moves: e.moves, ms: e.ms } }] };

    case 'give-up':
      if (!racing) return none;
      if (host) return place(s, HOST_ID, { moves: me(s).moves, ms: 0, gaveUp: true });
      return { state: { ...s, phase: 'waiting' }, outbox: [{ to: HOST_ID, msg: { t: 'giveup', round: s.round } }] };

    case 'request-rematch': {
      if (s.phase !== 'finished' || me(s).ready || !me(s).inRound) return none;
      const next = update(s, s.myId, (p) => ({ ...p, ready: true }));
      return host ? { state: next, outbox: [toAll(rosterMsg(next))] } : { state: next, outbox: [{ to: HOST_ID, msg: { t: 'rematch' } }] };
    }

    case 'recv':
      if (!isMsg(e.msg)) return none;
      return host ? hostReceive(s, e.from, e.msg) : guestReceive(s, e.msg);
  }
}

function beginRound(s: MatchState, round: number, puzzle: PuzzleData, easy: PuzzleData | null, ids: string[], handicapped: string[]): MatchState {
  const racing = ids.includes(s.myId);
  return {
    ...s,
    round,
    puzzle,
    easy,
    level: puzzle.level,
    phase: racing ? 'countdown' : 'lobby',
    raceInProgress: !racing,
    resumed: false,
    players: s.players.map((p) => {
      const handicap = handicapped.includes(p.id);
      const start = handicap && easy ? easy.start : puzzle.start;
      return { ...p, inRound: ids.includes(p.id), handicap, ready: false, rods: start.rods.map((r) => r.slice()), moves: 0, result: null };
    }),
  };
}

/** Host: record a finish (or give-up), award points, and end the round if everyone is done. */
function place(s: MatchState, id: string, r: { moves: number; ms: number; gaveUp: boolean }): R {
  const p = s.players.find((x) => x.id === id);
  if (!p || !p.inRound || p.result) return { state: s, outbox: [] };
  const finishers = s.players.filter((x) => x.result && !x.result.gaveUp).length;
  const placeNo = r.gaveUp ? null : finishers + 1;
  const bonus = r.gaveUp ? 0 : bonusPoints(r.moves, playerPuzzle(s, p).par);
  const earned = placeNo === null ? 0 : (POINTS[placeNo - 1] ?? 0) + bonus;
  const result: Result = { place: placeNo, moves: r.moves, ms: r.ms, gaveUp: r.gaveUp, bonus, earned };
  let next = update(s, id, (x) => ({ ...x, result, points: x.points + earned }));
  if (id === HOST_ID) next = { ...next, phase: 'placed' };
  const points = next.players.find((x) => x.id === id)!.points;
  return checkDone(next, [toAll({ t: 'placed', round: s.round, id, result, points })]);
}

/** Host: the round ends when every player still in the room and in the round is done. */
function checkDone(s: MatchState, outbox: Out[]): R {
  const done = s.players.every((p) => !p.present || !p.inRound || p.result);
  if (!live(s) || !done) return { state: s, outbox };
  return { state: { ...s, phase: 'finished' }, outbox: [...outbox, toAll({ t: 'finished', round: s.round })] };
}

function hostReceive(s: MatchState, conn: string, m: Msg): R {
  const none: R = { state: s, outbox: [] };
  if (!GUEST_TO_HOST.has(m.t)) return none;

  if (m.t === 'hello') {
    if (m.pid === HOST_ID) return none;
    const seat = s.players.find((p) => p.id === m.pid);
    if (!seat && presentCount(s) >= MAX_PLAYERS) return { state: s, outbox: [{ to: conn, msg: { t: 'full' }, close: true }] };
    const links = { ...s.links, [conn]: m.pid };
    let next: MatchState = seat
      ? update({ ...s, links }, m.pid, (p) => ({ ...p, name: cleanName(m.name), present: true, connected: true }))
      : { ...s, links, players: [...s.players, newPlayer(m.pid, cleanName(m.name))] };
    const p = next.players.find((x) => x.id === m.pid)!;
    next = { ...next };
    return {
      state: next,
      outbox: [
        { to: m.pid, msg: { t: 'welcome', you: m.pid, level: s.level, round: s.round, raceInProgress: live(s) && !p.inRound } },
        toAll(rosterMsg(next)),
        { to: m.pid, msg: syncMsg(next) },
      ],
    };
  }

  const pid = s.links[conn];
  const sender = pid ? s.players.find((p) => p.id === pid && p.present) : undefined;
  if (!pid || !sender) return none;

  switch (m.t) {
    case 'progress': {
      if (m.round !== s.round || !sender.inRound || sender.result) return none;
      const next = update(s, pid, (p) => ({ ...p, rods: m.rods, moves: m.moves }));
      return { state: next, outbox: [toAll({ t: 'progress', round: m.round, rods: m.rods, moves: m.moves, id: pid }, pid)] };
    }
    case 'solved':
      return m.round === s.round ? place(s, pid, { moves: m.moves, ms: m.ms, gaveUp: false }) : none;
    case 'giveup':
      return m.round === s.round ? place(s, pid, { moves: sender.moves, ms: 0, gaveUp: true }) : none;
    case 'rematch': {
      if (s.phase !== 'finished' || !sender.inRound) return none;
      const next = update(s, pid, (p) => ({ ...p, ready: true }));
      return { state: next, outbox: [toAll(rosterMsg(next))] };
    }
    case 'leave': {
      const next = update(s, pid, (p) => ({ ...p, present: false, connected: false, ready: false }));
      return checkDone(next, [toAll(rosterMsg(next))]);
    }
    default:
      return none;
  }
}

function guestReceive(s: MatchState, m: Msg): R {
  const none: R = { state: s, outbox: [] };
  switch (m.t) {
    case 'welcome':
      return { state: { ...s, conn: 'online', level: m.level, raceInProgress: m.raceInProgress }, outbox: [] };
    case 'roster': {
      const byId = new Map(s.players.map((p) => [p.id, p]));
      const players = m.players.map((r) => {
        const old = byId.get(r.id);
        return { ...(old ?? newPlayer(r.id, r.name)), ...r, name: cleanName(r.name) };
      });
      return { state: { ...s, players }, outbox: [] };
    }
    case 'sync':
      return { state: applySync(s, m), outbox: [] };
    case 'level':
      return { state: { ...s, level: m.level }, outbox: [] };
    case 'start':
      if (m.round <= s.round && s.phase !== 'lobby') return none;
      return { state: beginRound(s, m.round, m.puzzle, m.easy, m.players, m.handicapped), outbox: [] };
    case 'progress':
      if (m.round !== s.round || !m.id || m.id === s.myId) return none;
      return { state: update(s, m.id, (p) => ({ ...p, rods: m.rods, moves: m.moves })), outbox: [] };
    case 'placed': {
      if (m.round !== s.round) return none;
      let next = update(s, m.id, (p) => ({ ...p, result: m.result, points: m.points }));
      if (m.id === s.myId && (s.phase === 'waiting' || s.phase === 'racing')) next = { ...next, phase: 'placed' };
      return { state: next, outbox: [] };
    }
    case 'finished':
      if (m.round !== s.round) return none;
      return me(s).inRound ? { state: { ...s, phase: 'finished' }, outbox: [] } : { state: { ...s, raceInProgress: false }, outbox: [] };
    case 'full':
      return { state: { ...s, full: true }, outbox: [] };
    case 'closed':
      return { state: { ...s, closed: true }, outbox: [] };
    default:
      return none;
  }
}

/** Catch up after (re)connecting: keep my own newer local moves, take everything else from the host. */
function applySync(s: MatchState, m: Extract<Msg, { t: 'sync' }>): MatchState {
  const mine = m.players.find((p) => p.id === s.myId);
  const byId = new Map(m.players.map((p) => [p.id, p]));
  const sameRound = s.round === m.round && s.round > 0 && s.phase !== 'lobby';

  if (m.phase === 'lobby' || !mine?.inRound) {
    return { ...s, round: m.round, phase: 'lobby', raceInProgress: m.phase === 'racing', puzzle: m.puzzle, easy: m.easy };
  }

  const players = s.players.map((p) => {
    const x = byId.get(p.id);
    if (!x) return p;
    if (sameRound && p.id === s.myId) return { ...p, inRound: x.inRound, handicap: x.handicap, result: p.result ?? x.result };
    return { ...p, rods: x.rods, moves: x.moves, result: x.result, inRound: x.inRound, handicap: x.handicap };
  });

  if (sameRound) {
    return { ...s, players, phase: m.phase === 'finished' ? 'finished' : s.phase };
  }
  const phase: Phase = m.phase === 'finished' ? 'finished' : mine.result ? 'placed' : 'racing';
  return { ...s, players, round: m.round, puzzle: m.puzzle, easy: m.easy, level: m.puzzle?.level ?? s.level, phase, resumed: true, raceInProgress: false };
}
