import type { Msg } from './match';

export interface Transport {
  send(msg: Msg): void;
  close(): void;
}

export interface TransportHandlers {
  onOpen(): void;
  onMessage(msg: unknown): void;
  onClose(): void;
  onError(reason: TransportError): void;
}

export type TransportError = 'room-not-found' | 'room-taken' | 'network' | 'room-full';

export interface TransportFactory {
  host(code: string, h: TransportHandlers): Transport;
  join(code: string, h: TransportHandlers): Transport;
}

const PEER_PREFIX = 'colourstack-';

/**
 * Browser-to-browser via WebRTC. PeerJS's free public server only introduces the
 * two browsers; game moves then travel directly between them.
 */
export const peerTransport: TransportFactory = {
  host(code, h) {
    let peer: import('peerjs').Peer | null = null;
    let conn: import('peerjs').DataConnection | null = null;
    let closed = false;
    void import('peerjs').then(({ Peer }) => {
      if (closed) return;
      peer = new Peer(PEER_PREFIX + code);
      peer.on('connection', (c) => {
        if (conn && conn.open) {
          c.on('open', () => c.close());
          return;
        }
        conn = c;
        c.on('open', h.onOpen);
        c.on('data', h.onMessage);
        c.on('close', h.onClose);
      });
      peer.on('error', (err) => h.onError(err.type === 'unavailable-id' ? 'room-taken' : 'network'));
      peer.on('disconnected', () => peer?.reconnect());
    });
    return {
      send: (m) => conn?.open && conn.send(m),
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
      send: (m) => conn?.open && conn.send(m),
      close: () => {
        closed = true;
        peer?.destroy();
      },
    };
  },
};

/** Same-browser transport used by the automated two-player tests. */
export const localTransport: TransportFactory = {
  host(code, h) {
    return channel(code, 'host', h);
  },
  join(code, h) {
    return channel(code, 'guest', h);
  },
};

function channel(code: string, me: 'host' | 'guest', h: TransportHandlers): Transport {
  const bc = new BroadcastChannel(PEER_PREFIX + code);
  let open = false;
  const markOpen = () => {
    if (!open) {
      open = true;
      h.onOpen();
    }
  };
  bc.onmessage = (ev: MessageEvent<{ from: string; kind: string; msg?: unknown }>) => {
    const d = ev.data;
    if (d.from === me) return;
    if (d.kind === 'join' && me === 'host') {
      bc.postMessage({ from: me, kind: 'ack' });
      markOpen();
    } else if (d.kind === 'ack' && me === 'guest') markOpen();
    else if (d.kind === 'bye') h.onClose();
    else if (d.kind === 'msg') h.onMessage(d.msg);
  };
  if (me === 'guest') bc.postMessage({ from: me, kind: 'join' });
  return {
    send: (msg) => bc.postMessage({ from: me, kind: 'msg', msg }),
    close: () => {
      bc.postMessage({ from: me, kind: 'bye' });
      bc.close();
    },
  };
}
