import type { Msg } from './match';

export type TransportError = 'room-not-found' | 'room-taken' | 'network';

/** The room creator's side: one connection per guest. */
export interface HostTransport {
  send(conn: string, msg: Msg): void;
  broadcast(msg: Msg): void;
  kick(conn: string): void;
  /** After the phone wakes up: re-register with the matchmaking server if needed. */
  refresh(): void;
  close(): void;
}
export interface HostHandlers {
  onJoin(conn: string): void;
  onMessage(conn: string, msg: unknown): void;
  onLeave(conn: string): void;
  onStatus(online: boolean): void;
  onError(reason: TransportError): void;
}

/** A guest's side: a single connection to the host. */
export interface GuestTransport {
  send(msg: Msg): void;
  close(): void;
}
export interface GuestHandlers {
  onOpen(): void;
  onMessage(msg: unknown): void;
  onClose(): void;
  onError(reason: TransportError): void;
}

export interface TransportFactory {
  host(code: string, h: HostHandlers): HostTransport;
  join(code: string, h: GuestHandlers): GuestTransport;
}

const PEER_PREFIX = 'colourstack-';

/**
 * Browser-to-browser via WebRTC. PeerJS's free public server only introduces the
 * browsers; game moves then travel directly between each guest and the host.
 */
export const peerTransport: TransportFactory = {
  host(code, h) {
    type Peer = import('peerjs').Peer;
    type Conn = import('peerjs').DataConnection;
    let peer: Peer | null = null;
    const conns = new Map<string, Conn>();
    let closed = false;
    let attempts = 0;

    const start = async (): Promise<void> => {
      if (closed) return;
      const { Peer } = await import('peerjs');
      peer?.destroy();
      const p = new Peer(PEER_PREFIX + code);
      peer = p;
      p.on('open', () => {
        attempts = 0;
        h.onStatus(true);
      });
      p.on('connection', (c) => {
        const id = c.connectionId;
        c.on('open', () => {
          conns.set(id, c);
          h.onJoin(id);
        });
        c.on('data', (d) => h.onMessage(id, d));
        const gone = () => {
          if (conns.delete(id)) h.onLeave(id);
        };
        c.on('close', gone);
        c.on('error', gone);
      });
      p.on('disconnected', () => {
        h.onStatus(false);
        if (!closed && !p.destroyed) p.reconnect();
      });
      p.on('error', (err) => {
        if (closed) return;
        // After a reload the server may still hold our room id for a little while: keep trying.
        if (err.type === 'unavailable-id' && attempts > 30) return h.onError('room-taken');
        if (['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
          h.onStatus(false);
          attempts++;
          setTimeout(() => void start(), Math.min(2000 * attempts, 5000));
        }
      });
    };
    void start();

    const sendTo = (c: Conn | undefined, m: Msg) => {
      if (c?.open) void c.send(m);
    };
    return {
      send: (conn, m) => sendTo(conns.get(conn), m),
      broadcast: (m) => conns.forEach((c) => sendTo(c, m)),
      kick: (conn) => {
        const c = conns.get(conn);
        conns.delete(conn);
        setTimeout(() => c?.close(), 300);
      },
      refresh: () => {
        if (!peer || peer.destroyed) void start();
        else if (peer.disconnected) peer.reconnect();
      },
      close: () => {
        closed = true;
        peer?.destroy();
      },
    };
  },

  join(code, h) {
    let peer: import('peerjs').Peer | null = null;
    let conn: import('peerjs').DataConnection | null = null;
    let closed = false;
    void import('peerjs').then(({ Peer }) => {
      if (closed) return;
      peer = new Peer();
      peer.on('open', () => {
        conn = peer!.connect(PEER_PREFIX + code, { reliable: true });
        conn.on('open', h.onOpen);
        conn.on('data', h.onMessage);
        conn.on('close', h.onClose);
        conn.on('error', h.onClose);
      });
      peer.on('error', (err) => h.onError(err.type === 'peer-unavailable' ? 'room-not-found' : 'network'));
      peer.on('disconnected', () => h.onClose());
    });
    return {
      send: (m) => {
        if (conn?.open) void conn.send(m);
      },
      close: () => {
        closed = true;
        peer?.destroy();
      },
    };
  },
};

/** Same-browser transport (BroadcastChannel) used by the automated multi-player tests. */
export const localTransport: TransportFactory = {
  host(code, h) {
    const bc = new BroadcastChannel(PEER_PREFIX + code);
    const guests = new Set<string>();
    bc.onmessage = (ev: MessageEvent<{ from: string; to: string; kind: string; msg?: unknown }>) => {
      const d = ev.data;
      if (d.to !== 'host') return;
      if (d.kind === 'join') {
        guests.add(d.from);
        bc.postMessage({ from: 'host', to: d.from, kind: 'ack' });
        h.onJoin(d.from);
      } else if (d.kind === 'bye') {
        if (guests.delete(d.from)) h.onLeave(d.from);
      } else if (d.kind === 'msg' && guests.has(d.from)) h.onMessage(d.from, d.msg);
    };
    setTimeout(() => h.onStatus(true), 0);
    let closed = false;
    const post = (to: string, msg: Msg) => {
      if (!closed) bc.postMessage({ from: 'host', to, kind: 'msg', msg });
    };
    return {
      send: post,
      broadcast: (msg) => guests.forEach((g) => post(g, msg)),
      kick: (id) => {
        guests.delete(id);
        setTimeout(() => !closed && bc.postMessage({ from: 'host', to: id, kind: 'bye' }), 100);
      },
      refresh: () => {},
      close: () => {
        if (closed) return;
        closed = true;
        guests.forEach((g) => bc.postMessage({ from: 'host', to: g, kind: 'bye' }));
        bc.close();
      },
    };
  },

  join(code, h) {
    const bc = new BroadcastChannel(PEER_PREFIX + code);
    const me = `g-${Math.random().toString(36).slice(2, 10)}`;
    let open = false;
    bc.onmessage = (ev: MessageEvent<{ from: string; to: string; kind: string; msg?: unknown }>) => {
      const d = ev.data;
      if (d.to !== me) return;
      if (d.kind === 'ack' && !open) {
        open = true;
        h.onOpen();
      } else if (d.kind === 'bye') h.onClose();
      else if (d.kind === 'msg') h.onMessage(d.msg);
    };
    let closed = false;
    bc.postMessage({ from: me, to: 'host', kind: 'join' });
    return {
      send: (msg) => {
        if (!closed) bc.postMessage({ from: me, to: 'host', kind: 'msg', msg });
      },
      close: () => {
        if (closed) return;
        closed = true;
        bc.postMessage({ from: me, to: 'host', kind: 'bye' });
        bc.close();
      },
    };
  },
};
