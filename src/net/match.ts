import type { Board, Rods } from '../engine/board';

export type Role = 'host' | 'guest';
export type Phase = 'lobby' | 'countdown' | 'racing' | 'waiting' | 'finished';

/** The puzzle sent over the wire: no solution, so nobody can peek. */
export interface PuzzleData {
  seed: string;
  level: number;
  start: Board;
  par: number;
  parIsMinimum: boolean;
}

export interface SolveStat {
  moves: number;
  ms: number;
}
export interface Score {
  host: number;
  guest: number;
}

export type Msg =
  | { t: 'hello'; name: string; v: 1 }
  | { t: 'welcome'; name: string; level: number }
  | { t: 'level'; level: number }
  | { t: 'start'; round: number; puzzle: PuzzleData }
  | { t: 'progress'; round: number; rods: Rods; moves: number }
  | { t: 'solved'; round: number; moves: number; ms: number }
  | { t: 'result'; round: number; winner: Role; host: SolveStat | null; guest: SolveStat | null; score: Score }
  | { t: 'rematch' };

export type MatchEvent =
  | { kind: 'connected' }
  | { kind: 'disconnected' }
  | { kind: 'recv'; msg: Msg }
  | { kind: 'set-level'; level: number }
  | { kind: 'start-round'; puzzle: PuzzleData }
  | { kind: 'go' }
  | { kind: 'local-move'; rods: Rods; moves: number }
  | { kind: 'local-solved'; moves: number; ms: number }
  | { kind: 'request-rematch' };

export interface MatchState {
  role: Role;
  myName: string;
  oppName: string;
  oppPresent: boolean;
  level: number;
  phase: Phase;
  round: number;
  puzzle: PuzzleData | null;
  opp: { rods: Rods; moves: number };
  mySolve: SolveStat | null;
  oppSolve: SolveStat | null;
  winner: Role | null;
  score: Score;
  /** Rematch: I've tapped it / they've tapped it / both, so the host starts the next round. */
  meReady: boolean;
  oppReady: boolean;
  bothReady: boolean;
}

export function createMatch(role: Role, myName: string, level = 3): MatchState {
  return {
    role,
    myName,
    oppName: '',
    oppPresent: false,
    level,
    phase: 'lobby',
    round: 0,
    puzzle: null,
    opp: { rods: [], moves: 0 },
    mySolve: null,
    oppSolve: null,
    winner: null,
    score: { host: 0, guest: 0 },
    meReady: false,
    oppReady: false,
    bothReady: false,
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRods = (v: unknown): v is Rods => Array.isArray(v) && v.every((r) => Array.isArray(r) && r.every(isNum));

/** Validate anything arriving from the network before trusting it. */
export function isMsg(v: unknown): v is Msg {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return typeof m.name === 'string' && m.v === 1;
    case 'welcome':
      return typeof m.name === 'string' && isNum(m.level);
    case 'level':
      return isNum(m.level);
    case 'start': {
      const p = m.puzzle as Record<string, unknown> | undefined;
      const start = p?.start as Record<string, unknown> | undefined;
      return isNum(m.round) && !!p && !!start && isRods(start.rods) && isNum(start.capacity) && isNum(p.par);
    }
    case 'progress':
      return isNum(m.round) && isRods(m.rods) && isNum(m.moves);
    case 'solved':
      return isNum(m.round) && isNum(m.moves) && isNum(m.ms);
    case 'result':
      return isNum(m.round) && (m.winner === 'host' || m.winner === 'guest') && !!m.score;
    case 'rematch':
      return true;
    default:
      return false;
  }
}

const cleanName = (n: string) => n.replace(/[^\p{L}\p{N} '\-]/gu, '').trim().slice(0, 16) || 'Player';

function decide(s: MatchState, winner: Role, stat: SolveStat): { state: MatchState; outbox: Msg[] } {
  const score = { ...s.score, [winner]: s.score[winner] + 1 };
  const hostStat = winner === 'host' ? stat : null;
  const guestStat = winner === 'guest' ? stat : null;
  return {
    state: { ...s, phase: 'finished', winner, score },
    outbox: [{ t: 'result', round: s.round, winner, host: hostStat, guest: guestStat, score }],
  };
}

export function reduce(s: MatchState, e: MatchEvent): { state: MatchState; outbox: Msg[] } {
  const none = { state: s, outbox: [] as Msg[] };
  const racing = s.phase === 'racing' || s.phase === 'countdown';

  switch (e.kind) {
    case 'connected':
      return s.role === 'guest' ? { state: s, outbox: [{ t: 'hello', name: s.myName, v: 1 }] } : none;

    case 'disconnected':
      return { state: { ...s, oppPresent: false }, outbox: [] };

    case 'set-level':
      // Only the room creator, and never mid-race.
      if (s.role !== 'host' || (s.phase !== 'lobby' && s.phase !== 'finished')) return none;
      return { state: { ...s, level: e.level }, outbox: [{ t: 'level', level: e.level }] };

    case 'start-round': {
      if (s.role !== 'host') return none;
      const round = s.round + 1;
      return {
        state: startRound(s, round, e.puzzle),
        outbox: [{ t: 'start', round, puzzle: e.puzzle }],
      };
    }

    case 'go':
      return s.phase === 'countdown' ? { state: { ...s, phase: 'racing' }, outbox: [] } : none;

    case 'local-move':
      if (!racing) return none;
      return { state: s, outbox: [{ t: 'progress', round: s.round, rods: e.rods, moves: e.moves }] };

    case 'local-solved': {
      if (s.phase !== 'racing') return none;
      const stat = { moves: e.moves, ms: e.ms };
      const withMine = { ...s, mySolve: stat };
      if (s.role === 'host') return decide(withMine, 'host', stat);
      return {
        state: { ...withMine, phase: 'waiting' },
        outbox: [{ t: 'solved', round: s.round, moves: e.moves, ms: e.ms }],
      };
    }

    case 'request-rematch':
      if (s.phase !== 'finished' || s.meReady) return none;
      return { state: ready({ ...s, meReady: true }), outbox: [{ t: 'rematch' }] };

    case 'recv':
      return isMsg(e.msg) ? receive(s, e.msg) : none;
  }
}

function startRound(s: MatchState, round: number, puzzle: PuzzleData): MatchState {
  return {
    ...s,
    phase: 'countdown',
    round,
    puzzle,
    level: puzzle.level,
    opp: { rods: puzzle.start.rods.map((r) => r.slice()), moves: 0 },
    mySolve: null,
    oppSolve: null,
    winner: null,
    meReady: false,
    oppReady: false,
    bothReady: false,
  };
}

const ready = (s: MatchState): MatchState => ({ ...s, bothReady: s.meReady && s.oppReady });

function receive(s: MatchState, m: Msg): { state: MatchState; outbox: Msg[] } {
  const none = { state: s, outbox: [] as Msg[] };
  switch (m.t) {
    case 'hello':
      if (s.role !== 'host') return none;
      return {
        state: { ...s, oppName: cleanName(m.name), oppPresent: true },
        outbox: [{ t: 'welcome', name: s.myName, level: s.level }],
      };
    case 'welcome':
      if (s.role !== 'guest') return none;
      return { state: { ...s, oppName: cleanName(m.name), oppPresent: true, level: m.level }, outbox: [] };
    case 'level':
      return s.role === 'guest' ? { state: { ...s, level: m.level }, outbox: [] } : none;
    case 'start':
      if (s.role !== 'guest' || m.round <= s.round) return none;
      return { state: startRound(s, m.round, m.puzzle), outbox: [] };
    case 'progress':
      if (m.round !== s.round) return none;
      return { state: { ...s, opp: { rods: m.rods, moves: m.moves } }, outbox: [] };
    case 'solved': {
      if (s.role !== 'host' || m.round !== s.round || s.winner) return none;
      const stat = { moves: m.moves, ms: m.ms };
      return decide({ ...s, oppSolve: stat }, 'guest', stat);
    }
    case 'result':
      if (s.role !== 'guest' || m.round !== s.round) return none;
      return {
        state: { ...s, phase: 'finished', winner: m.winner, score: m.score, oppSolve: m.host ?? s.oppSolve },
        outbox: [],
      };
    case 'rematch':
      return s.phase === 'finished' ? { state: ready({ ...s, oppReady: true }), outbox: [] } : none;
  }
}
