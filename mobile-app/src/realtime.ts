import { ApiClient } from "./api";

/**
 * Native WebSocket connection sharing the session cookie captured by ApiClient.
 * Exponential-backoff reconnect; callers subscribe to typed events.
 */
type Listener = (msg: any) => void;

export class Realtime {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private backoff = 1000;
  private closed = false;

  connect() {
    const cookie = ApiClient.sessionCookie();
    const wsUrl = ApiClient.baseUrl.replace(/^http/, "ws") + "/ws";
    // React Native's WebSocket accepts a headers option as a 3rd arg that the
    // DOM lib types don't model, so construct through an untyped alias.
    const RNWebSocket = WebSocket as unknown as new (
      url: string,
      protocols?: string | string[],
      options?: { headers?: Record<string, string> },
    ) => WebSocket;
    this.ws = new RNWebSocket(wsUrl, undefined, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    this.ws.onopen = () => {
      this.backoff = 1000;
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        for (const fn of this.listeners) fn(msg);
      } catch {
        /* ignore */
      }
    };
    this.ws.onclose = () => {
      if (this.closed) return;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 15000);
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

export const realtime = new Realtime();
