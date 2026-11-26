import type { Board, Rods } from '../engine/board';

/**
 * Multiplayer race protocol (2–4 players).
 *
 * The room creator ("host") is the hub: guests only talk to the host, and the host
 * relays moves, decides placings and owns the roster. Everything here is pure so it
 * can be tested without a network.
 */

export type Role = 'host' | 'guest';
/** placed = I've finished (or given up) but others are still racing. */
export type Phase = 'lobby' | 'countdown' | 'racing' | 'waiting' | 'placed' | 'finished';

export const MAX_PLAYERS = 4;
/** Points by finishing place: 1st, 2nd, 3rd, 4th. */
export const POINTS = [3, 2, 1, 0] as const;
export const HOST_ID = 'host';

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
}

export interface Player {
  id: string;
  name: string;
  present: boolean;
  /** Taking part in the current round (false for someone who joined mid-race). */
  inRound: boolean;
  ready: boolean;
  points: number;
  rods: Rods;
  moves: number;
  result: Result | null;
}

interface RosterEntry {
  id: string;
  name: string;
  present: boolean;
  inRound: boolean;
  ready: boolean;
  points: number;
}

export type Msg =
  // guest -> host
  | { t: 'hello'; name: string; v: 2 }
  | { t: 'solved'; round: number; moves: number; ms: number }
  | { t: 'giveup'; round: number }
  | { t: 'rematch' }
  // host -> guest
  | { t: 'welcome'; you: string; level: number; round: number; raceInProgress: boolean }
  | { t: 'roster'; players: RosterEntry[] }
  | { t: 'level'; level: number }
  | { t: 'start'; round: number; puzzle: PuzzleData; players: string[] }
  | { t: 'placed'; round: number; id: string; result: Result; points: number }
  | { t: 'finished'; round: number }
  | { t: 'full' }
  // both ways (the host adds the mover's id when relaying)
  | { t: 'progress'; round: number; rods: Rods; moves: number; id?: string };

export interface Out {
  /** A player id, 'host', or 'all' (host only). */
  to: string;
  msg: Msg;
  /** With to: 'all', skip this player. */
  except?: string;
  /** Disconnect this player after sending. */
  close?: boolean;
}

export type MatchEvent =
  | { kind: 'connected' }
  | { kind: 'disconnected' }
  | { kind: 'peer-joined'; id: string }
  | { kind: 'peer-left'; id: string }
  | { kind: 'recv'; from: string; msg: Msg }
  | { kind: 'set-level'; level: number }
  | { kind: 'start-round'; puzzle: PuzzleData }
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
  puzzle: PuzzleData | null;
  /** Guest joined while a race was on: waiting for the next round. */
  raceInProgress: boolean;
  /** Guest: the creator closed the room. */
  closed: boolean;
  /** Guest: turned away because the room already had 4 players. */
  full: boolean;
}

const newPlayer = (id: string, name: string): Player => ({
  id,
  name,
  present: true,
  inRound: false,
  ready: false,
  points: 0,
  rods: [],
  moves: 0,
  result: null,
});

export function createMatch(role: Role, myName: string, level = 3): MatchState {
  const myId = role === 'host' ? HOST_ID : '';
  return {
    role,
    myId,
    players: [newPlayer(myId, cleanName(myName))],
    level,
    phase: 'lobby',
    round: 0,
    puzzle: null,
    raceInProgress: false,
    closed: false,
    full: false,
  };
}

/* ---------- Selectors ---------- */

export const me = (s: MatchState): Player => s.players.find((p) => p.id === s.myId) ?? s.players[0]!;
export const opponents = (s: MatchState): Player[] => s.players.filter((p) => p.id !== s.myId && p.present);
export const presentCount = (s: MatchState): number => s.players.filter((p) => p.present).length;

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

/** Validate anything arriving from the network before trusting it. */
export function isMsg(v: unknown): v is Msg {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return isStr(m.name) && m.v === 2;
    case 'solved':
      return isNum(m.round) && isNum(m.moves) && isNum(m.ms);
    case 'giveup':
      return isNum(m.round);
    case 'rematch':
    case 'full':
      return true;
    case 'welcome':
      return isStr(m.you) && isNum(m.level) && isNum(m.round) && typeof m.raceInProgress === 'boolean';
    case 'roster':
      return (
        Array.isArray(m.players) &&
        m.players.length <= MAX_PLAYERS * 3 &&
        m.players.every((p: Record<string, unknown>) => p && isStr(p.id) && isStr(p.name) && isNum(p.points))
      );
    case 'level':
      return isNum(m.level);
    case 'start': {
      const p = m.puzzle as Record<string, unknown> | undefined;
      const start = p?.start as Record<string, unknown> | undefined;
      return (
        isNum(m.round) && !!start && isRods(start.rods) && isNum(start.capacity) && isNum(p?.par) && Array.isArray(m.players) && m.players.every(isStr)
      );
    }
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

const GUEST_TO_HOST = new Set(['hello', 'solved', 'giveup', 'rematch', 'progress']);

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
  players: s.players.map(({ id, name, present, inRound, ready, points }) => ({ id, name, present, inRound, ready, points })),
});
const toAll = (msg: Msg, except?: string): Out => (except === undefined ? { to: 'all', msg } : { to: 'all', msg, except });

export function reduce(s: MatchState, e: MatchEvent): R {
  const none: R = { state: s, outbox: [] };
  const racing = s.phase === 'racing' || s.phase === 'countdown';
  const host = s.role === 'host';

  switch (e.kind) {
    case 'connected':
      return host ? none : { state: s, outbox: [{ to: HOST_ID, msg: { t: 'hello', name: me(s).name, v: 2 } }] };

    case 'disconnected':
      return host ? none : { state: { ...s, closed: true }, outbox: [] };

    case 'peer-joined':
      return none; // nothing happens until they say hello

    case 'peer-left': {
      if (!host || !s.players.some((p) => p.id === e.id && p.present)) return none;
      const next = update(s, e.id, (p) => ({ ...p, present: false, ready: false }));
      return checkDone(next, [toAll(rosterMsg(next))]);
    }

    case 'set-level':
      if (!host || (s.phase !== 'lobby' && s.phase !== 'finished')) return none;
      return { state: { ...s, level: e.level }, outbox: [toAll({ t: 'level', level: e.level })] };

    case 'start-round': {
      if (!canStart(s)) return none;
      const round = s.round + 1;
      const next = beginRound(s, round, e.puzzle, s.players.filter((p) => p.present).map((p) => p.id));
      return {
        state: next,
        outbox: [toAll({ t: 'start', round, puzzle: e.puzzle, players: next.players.filter((p) => p.inRound).map((p) => p.id) })],
      };
    }

    case 'go':
      return s.phase === 'countdown' ? { state: { ...s, phase: 'racing' }, outbox: [] } : none;

    case 'local-move':
      if (!racing) return none;
      if (host) {
        const next = update(s, HOST_ID, (p) => ({ ...p, rods: e.rods, moves: e.moves }));
        return { state: next, outbox: [toAll({ t: 'progress', round: s.round, rods: e.rods, moves: e.moves, id: HOST_ID })] };
      }
      return { state: s, outbox: [{ to: HOST_ID, msg: { t: 'progress', round: s.round, rods: e.rods, moves: e.moves } }] };

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

function beginRound(s: MatchState, round: number, puzzle: PuzzleData, ids: string[]): MatchState {
  const racing = ids.includes(s.myId);
  return {
    ...s,
    round,
    puzzle,
    level: puzzle.level,
    phase: racing ? 'countdown' : 'lobby',
    raceInProgress: !racing,
    players: s.players.map((p) => ({
      ...p,
      inRound: ids.includes(p.id),
      ready: false,
      rods: puzzle.start.rods.map((r) => r.slice()),
      moves: 0,
      result: null,
    })),
  };
}

/** Host: record a finish (or give-up), award points, and end the round if everyone is done. */
function place(s: MatchState, id: string, r: { moves: number; ms: number; gaveUp: boolean }): R {
  const p = s.players.find((x) => x.id === id);
  if (!p || !p.inRound || p.result) return { state: s, outbox: [] };
  const finishers = s.players.filter((x) => x.result && !x.result.gaveUp).length;
  const placeNo = r.gaveUp ? null : finishers + 1;
  const earned = placeNo === null ? 0 : (POINTS[placeNo - 1] ?? 0);
  const result: Result = { place: placeNo, moves: r.moves, ms: r.ms, gaveUp: r.gaveUp };
  let next = update(s, id, (x) => ({ ...x, result, points: x.points + earned }));
  if (id === HOST_ID) next = { ...next, phase: 'placed' };
  const points = next.players.find((x) => x.id === id)!.points;
  return checkDone(next, [toAll({ t: 'placed', round: s.round, id, result, points })]);
}

/** Host: the round ends when every present player in it has finished or given up. */
function checkDone(s: MatchState, outbox: Out[]): R {
  const live = s.phase === 'racing' || s.phase === 'countdown' || s.phase === 'placed';
  const done = s.players.every((p) => !p.present || !p.inRound || p.result);
  if (!live || !done) return { state: s, outbox };
  return { state: { ...s, phase: 'finished' }, outbox: [...outbox, toAll({ t: 'finished', round: s.round })] };
}

function hostReceive(s: MatchState, from: string, m: Msg): R {
  const none: R = { state: s, outbox: [] };
  if (!GUEST_TO_HOST.has(m.t)) return none;
  const sender = s.players.find((p) => p.id === from && p.present);

  if (m.t === 'hello') {
    if (sender) return none;
    if (presentCount(s) >= MAX_PLAYERS) return { state: s, outbox: [{ to: from, msg: { t: 'full' }, close: true }] };
    const midRace = s.phase !== 'lobby' && s.phase !== 'finished';
    const next = { ...s, players: [...s.players.filter((p) => p.id !== from), newPlayer(from, cleanName(m.name))] };
    return {
      state: next,
      outbox: [
        { to: from, msg: { t: 'welcome', you: from, level: s.level, round: s.round, raceInProgress: midRace } },
        toAll(rosterMsg(next)),
      ],
    };
  }
  if (!sender) return none;

  switch (m.t) {
    case 'progress': {
      if (m.round !== s.round || !sender.inRound) return none;
      const next = update(s, from, (p) => ({ ...p, rods: m.rods, moves: m.moves }));
      return { state: next, outbox: [toAll({ t: 'progress', round: m.round, rods: m.rods, moves: m.moves, id: from }, from)] };
    }
    case 'solved':
      return m.round === s.round ? place(s, from, { moves: m.moves, ms: m.ms, gaveUp: false }) : none;
    case 'giveup':
      return m.round === s.round ? place(s, from, { moves: sender.moves, ms: 0, gaveUp: true }) : none;
    case 'rematch': {
      if (s.phase !== 'finished' || !sender.inRound) return none;
      const next = update(s, from, (p) => ({ ...p, ready: true }));
      return { state: next, outbox: [toAll(rosterMsg(next))] };
    }
    default:
      return none;
  }
}

function guestReceive(s: MatchState, m: Msg): R {
  const none: R = { state: s, outbox: [] };
  switch (m.t) {
    case 'welcome':
      return {
        state: {
          ...s,
          myId: m.you,
          level: m.level,
          round: m.round,
          raceInProgress: m.raceInProgress,
          players: s.players.map((p) => (p.id === '' ? { ...p, id: m.you } : p)),
        },
        outbox: [],
      };
    case 'roster': {
      const byId = new Map(s.players.map((p) => [p.id, p]));
      const players = m.players.map((r) => {
        const old = byId.get(r.id);
        return { ...(old ?? newPlayer(r.id, r.name)), ...r, name: cleanName(r.name) };
      });
      return { state: { ...s, players }, outbox: [] };
    }
    case 'level':
      return { state: { ...s, level: m.level }, outbox: [] };
    case 'start':
      if (m.round <= s.round && s.phase !== 'lobby') return none;
      return { state: beginRound(s, m.round, m.puzzle, m.players), outbox: [] };
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
    default:
      return none;
  }
}
