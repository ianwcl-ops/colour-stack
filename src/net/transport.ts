import type { Msg } from './match';

export type TransportError = 'room-not-found' | 'room-taken' | 'network';

/** The room creator's side: one connection per guest. */
export interface HostTransport {
  send(to: string, msg: Msg): void;
  broadcast(msg: Msg, except?: string): void;
  kick(id: string): void;
  close(): void;
}
export interface HostHandlers {
  onJoin(id: string): void;
  onMessage(id: string, msg: unknown): void;
  onLeave(id: string): void;
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
    let peer: import('peerjs').Peer | null = null;
    const conns = new Map<string, import('peerjs').DataConnection>();
    let closed = false;
    void import('peerjs').then(({ Peer }) => {
      if (closed) return;
      peer = new Peer(PEER_PREFIX + code);
      peer.on('connection', (c) => {
        const id = c.connectionId;
        c.on('open', () => {
          conns.set(id, c);
          h.onJoin(id);
        });
        c.on('data', (d) => h.onMessage(id, d));
        c.on('close', () => {
          if (conns.delete(id)) h.onLeave(id);
        });
        c.on('error', () => {
          if (conns.delete(id)) h.onLeave(id);
        });
      });
      peer.on('error', (err) => h.onError(err.type === 'unavailable-id' ? 'room-taken' : 'network'));
      peer.on('disconnected', () => peer?.reconnect());
    });
    const sendTo = (c: import('peerjs').DataConnection | undefined, m: Msg) => {
      if (c?.open) void c.send(m);
    };
    return {
      send: (to, m) => sendTo(conns.get(to), m),
      broadcast: (m, except) => conns.forEach((c, id) => id !== except && sendTo(c, m)),
      kick: (id) => {
        const c = conns.get(id);
        conns.delete(id);
        // Give the "room full" message a moment to arrive before closing.
        setTimeout(() => c?.close(), 300);
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
      });
      peer.on('error', (err) => h.onError(err.type === 'peer-unavailable' ? 'room-not-found' : 'network'));
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
    const post = (to: string, msg: Msg) => bc.postMessage({ from: 'host', to, kind: 'msg', msg });
    return {
      send: post,
      broadcast: (msg, except) => guests.forEach((g) => g !== except && post(g, msg)),
      kick: (id) => {
        guests.delete(id);
        setTimeout(() => bc.postMessage({ from: 'host', to: id, kind: 'bye' }), 100);
      },
      close: () => {
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
    bc.postMessage({ from: me, to: 'host', kind: 'join' });
    return {
      send: (msg) => bc.postMessage({ from: me, to: 'host', kind: 'msg', msg }),
      close: () => {
        bc.postMessage({ from: me, to: 'host', kind: 'bye' });
        bc.close();
      },
    };
  },
};
