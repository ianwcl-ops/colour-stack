import type { Msg } from './match';
import type { GuestTransport, TransportFactory } from './transport';

export interface ResilientHandlers {
  onOpen(): void;
  onMessage(msg: unknown): void;
  /** Lost the connection; trying again in the background. */
  onDown(): void;
  /** Never reached the room (bad or dead link), or couldn't get back in time. */
  onGiveUp(neverConnected: boolean): void;
}

export interface ResilientGuest {
  send(msg: Msg): void;
  /** Test hook: behave as if the phone dropped off. */
  drop(): void;
  close(): void;
}

/**
 * A guest connection that survives the phone sleeping or switching apps:
 * messages queue while offline, and it keeps reconnecting until the seat-hold time
 * runs out. Coming back to the page forces a fresh connection straight away,
 * because a connection that was frozen in the background is often silently dead.
 */
export function resilientGuest(
  factory: TransportFactory,
  code: string,
  h: ResilientHandlers,
  opts: { holdMs: number; firstTryMs?: number; connectTimeoutMs?: number },
): ResilientGuest {
  let t: GuestTransport | null = null;
  let open = false;
  let stopped = false;
  let everOpen = false;
  let downSince = Date.now();
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let hiddenAt = 0;
  const queue: Msg[] = [];

  const flush = () => {
    while (open && t && queue.length) t.send(queue.shift()!);
  };

  const connect = (): void => {
    if (stopped) return;
    clearTimeout(retryTimer);
    clearTimeout(connectTimer);
    t?.close();
    open = false;
    const mine: GuestTransport = factory.join(code, {
      onOpen: () => {
        if (t !== mine || stopped) return;
        clearTimeout(connectTimer);
        open = true;
        everOpen = true;
        attempt = 0;
        h.onOpen(); // sends hello first…
        flush(); // …then anything queued while offline
      },
      onMessage: (m) => {
        if (t === mine) h.onMessage(m);
      },
      onClose: () => {
        if (t === mine) down();
      },
      onError: () => {
        if (t === mine) down();
      },
    });
    t = mine;
    connectTimer = setTimeout(() => {
      if (t === mine && !open) down();
    }, opts.connectTimeoutMs ?? 10_000);
  };

  const down = (): void => {
    if (stopped) return;
    const wasOpen = open;
    open = false;
    t?.close();
    if (wasOpen) {
      downSince = Date.now();
      h.onDown();
    }
    const limit = everOpen ? opts.holdMs : (opts.firstTryMs ?? 25_000);
    if (Date.now() - downSince > limit) {
      stopped = true;
      t?.close();
      h.onGiveUp(!everOpen);
      return;
    }
    attempt++;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, Math.min(1000 * attempt, 5000));
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    // Back on screen: if we were away for more than a moment, start afresh.
    if (!open || Date.now() - hiddenAt > 4000) {
      if (open) {
        open = false;
        downSince = Date.now();
        h.onDown();
      }
      attempt = 0;
      connect();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onVisibility);

  connect();

  return {
    send: (m) => {
      if (open && t) t.send(m);
      else queue.push(m);
    },
    drop: () => {
      t?.close();
      t = null;
      if (open) {
        open = false;
        downSince = Date.now();
        h.onDown();
      }
      attempt = 0;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, 1500);
    },
    close: () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(connectTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onVisibility);
      t?.close();
    },
  };
}
