import pg from "pg";
import type { SessionRevocation } from "../auth.js";
import { INSTANCE_ID } from "../instance.js";

/**
 * Realtime bus — how a frame fanned out on ONE instance reaches the sockets
 * held by EVERY instance (E1 multi-instance safety, docs/ENTERPRISE_READINESS.md).
 *
 * The WebSocket hub (server/ws/index.ts) delivers every frame to its own
 * sockets first, then `publish`es it here; a frame that arrives from another
 * instance is delivered to local sockets only (never re-published). Session
 * control travels the same way: a password change / deactivation / "sign out
 * all" / app lock announced on one instance closes that person's sockets on
 * all of them, so a revoked session is never left streaming on a sibling.
 *
 * Two transports, one wire format:
 *  - InProcessBus — no DATABASE_URL (PGlite dev / trial / the Render demo):
 *    a single process, so there is nobody to publish to. Several buses in one
 *    process can share a `channel` (tests: two hubs, two servers, one
 *    process — a faithful fake transport that applies the same payload limit).
 *  - PostgresBus — DATABASE_URL set: Postgres LISTEN / NOTIFY on a dedicated
 *    listener connection (LISTEN cannot share the query pool), publishing
 *    through the application's pool with `SELECT pg_notify($1, $2)`.
 *
 * NOTIFY payloads are capped at 8000 bytes, so a frame whose JSON exceeds
 * MAX_NOTIFY_PAYLOAD_BYTES is published BY REFERENCE: `{type, ids}` from the
 * frame's registered resolver (routes/messaging.ts for MESSAGE_RECEIVED,
 * routes/broadcasts.ts for BROADCAST_CREATED — the only frames that carry
 * free text), and the receiving instance re-reads the row and rebuilds the
 * full frame. Every other frame is ids-only and always fits. Nothing here
 * logs a payload: counts and kinds only.
 */

export type BusFrame =
  | { kind: "users"; userIds: number[]; message: unknown }
  | { kind: "org"; orgId: number; message: unknown }
  | { kind: "revoke"; revocation: SessionRevocation }
  | { kind: "lock"; userId: number; connectionId: string };

export type BusKind = "in-process" | "postgres";

export interface BusStatus {
  kind: BusKind;
  instanceId: string;
  /** PostgresBus: the LISTEN connection is up. InProcessBus: always true. */
  connected: boolean;
  published: number;
  received: number;
  /** Frames that went out as {type, ids} because they exceeded the payload cap. */
  byReference: number;
  /** Oversized frames with no resolver, or publish failures — never silently zero. */
  dropped: number;
  reconnects: number;
}

export type BusSubscriber = (frame: BusFrame) => void;

export interface RealtimeBus {
  readonly kind: BusKind;
  readonly instanceId: string;
  /** Hand a frame to every OTHER instance. Fire-and-forget: never throws, never blocks a route. */
  publish(frame: BusFrame): void;
  /** Frames from other instances. Returns the unsubscribe function. */
  subscribe(fn: BusSubscriber): () => void;
  status(): BusStatus;
  close(): Promise<void>;
}

/** Postgres caps a NOTIFY payload at 8000 bytes; stay well under it. */
export const MAX_NOTIFY_PAYLOAD_BYTES = 7_000;

/* ── by-reference resolvers ──────────────────────────────────────────────── */

export interface FrameRef {
  type: string;
  [k: string]: unknown;
}
export interface FrameResolver {
  /** Reduce a full message to the ids needed to rebuild it, or null if it cannot be referenced. */
  toRef(message: Record<string, unknown>): FrameRef | null;
  /** Re-read and rebuild the full message on the receiving instance; null if it no longer exists. */
  fromRef(ref: FrameRef): Promise<unknown | null>;
}
const resolvers = new Map<string, FrameResolver>();

/** Routes register the resolver for a frame type they emit (idempotent). */
export function registerFrameResolver(type: string, resolver: FrameResolver): void {
  resolvers.set(type, resolver);
}
/** Tests: which frame types can travel by reference. */
export function frameResolverTypes(): string[] {
  return [...resolvers.keys()].sort();
}

/* ── wire format ─────────────────────────────────────────────────────────── */

interface Wire {
  /** Origin instance id — the receiver skips its own frames. */
  o: string;
  f: BusFrame | ({ kind: "users"; userIds: number[] } | { kind: "org"; orgId: number }) & { ref: FrameRef };
}

export type Encoded =
  | { ok: true; payload: string; byReference: boolean }
  | { ok: false; reason: "oversized_control_frame" | "oversized_no_resolver" | "oversized_reference" | "unserializable" };

/** Serialise a frame for the transport, switching to {type, ids} when it exceeds `limit`. */
export function encodeFrame(frame: BusFrame, origin: string, limit = MAX_NOTIFY_PAYLOAD_BYTES): Encoded {
  let inline: string;
  try {
    inline = JSON.stringify({ o: origin, f: frame } satisfies Wire);
  } catch {
    return { ok: false, reason: "unserializable" };
  }
  if (Buffer.byteLength(inline, "utf8") <= limit) return { ok: true, payload: inline, byReference: false };
  if (frame.kind !== "users" && frame.kind !== "org") return { ok: false, reason: "oversized_control_frame" };
  const message = frame.message;
  const type =
    message && typeof message === "object" && typeof (message as { type?: unknown }).type === "string"
      ? ((message as { type: string }).type)
      : null;
  const resolver = type ? resolvers.get(type) : undefined;
  const ref = resolver ? resolver.toRef(message as Record<string, unknown>) : null;
  if (!ref) return { ok: false, reason: "oversized_no_resolver" };
  const { message: _dropped, ...rest } = frame;
  const byRef = JSON.stringify({ o: origin, f: { ...rest, ref } } satisfies Wire);
  if (Buffer.byteLength(byRef, "utf8") > limit) return { ok: false, reason: "oversized_reference" };
  return { ok: true, payload: byRef, byReference: true };
}

/**
 * Parse a transport payload into a frame for THIS instance: null for its own
 * frames, malformed payloads, or a reference whose row is gone.
 */
export async function decodePayload(payload: string, self: string): Promise<BusFrame | null> {
  let wire: Wire;
  try {
    wire = JSON.parse(payload) as Wire;
  } catch {
    return null;
  }
  if (!wire || typeof wire !== "object" || wire.o === self || !wire.f || typeof wire.f !== "object") return null;
  const f = wire.f as BusFrame & { ref?: FrameRef };
  if (f.ref) {
    const resolver = typeof f.ref.type === "string" ? resolvers.get(f.ref.type) : undefined;
    if (!resolver) return null;
    const message = await resolver.fromRef(f.ref);
    if (message == null) return null;
    const { ref: _r, ...rest } = f;
    return { ...rest, message } as BusFrame;
  }
  return f;
}

/* ── shared subscriber plumbing ──────────────────────────────────────────── */

abstract class BaseBus implements RealtimeBus {
  abstract readonly kind: BusKind;
  readonly instanceId: string;
  protected subscribers = new Set<BusSubscriber>();
  protected counts = { published: 0, received: 0, byReference: 0, dropped: 0, reconnects: 0 };
  protected readonly limit: number;

  constructor(opts: { instanceId?: string; maxPayloadBytes?: number }) {
    this.instanceId = opts.instanceId ?? INSTANCE_ID;
    this.limit = opts.maxPayloadBytes ?? MAX_NOTIFY_PAYLOAD_BYTES;
  }

  abstract publish(frame: BusFrame): void;
  abstract close(): Promise<void>;
  protected abstract connected(): boolean;

  subscribe(fn: BusSubscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  status(): BusStatus {
    return { kind: this.kind, instanceId: this.instanceId, connected: this.connected(), ...this.counts };
  }

  /** Encode, counting what happened; null when the frame could not go out. */
  protected encode(frame: BusFrame): string | null {
    const enc = encodeFrame(frame, this.instanceId, this.limit);
    if (!enc.ok) {
      this.counts.dropped++;
      // The kind/type only — never the frame.
      console.warn(`[bus] frame not published (${enc.reason}): ${describeFrame(frame)}`);
      return null;
    }
    this.counts.published++;
    if (enc.byReference) this.counts.byReference++;
    return enc.payload;
  }

  /** A payload arrived from the transport: decode and deliver to subscribers. */
  protected async receive(payload: string): Promise<void> {
    let frame: BusFrame | null;
    try {
      frame = await decodePayload(payload, this.instanceId);
    } catch (err) {
      console.error("[bus] frame could not be decoded", err);
      return;
    }
    if (!frame) return;
    this.counts.received++;
    for (const fn of this.subscribers) {
      try {
        fn(frame);
      } catch (err) {
        console.error("[bus] subscriber failed", err);
      }
    }
  }
}

function describeFrame(frame: BusFrame): string {
  if (frame.kind === "users" || frame.kind === "org") {
    const t = (frame.message as { type?: unknown } | null)?.type;
    return `${frame.kind} ${typeof t === "string" ? t : "?"}`;
  }
  return frame.kind;
}

/* ── in-process transport ────────────────────────────────────────────────── */

const channels = new Map<string, Set<InProcessBus>>();

/**
 * Single-process transport. Buses on the same `channel` in one process see
 * each other's frames (a fake cluster for tests); in production there is one
 * bus per process and nothing to publish to, so publishing costs nothing.
 */
export class InProcessBus extends BaseBus {
  readonly kind = "in-process" as const;
  private readonly channel: string;
  private closed = false;

  constructor(opts: { channel?: string; instanceId?: string; maxPayloadBytes?: number } = {}) {
    super(opts);
    this.channel = opts.channel ?? "default";
    if (!channels.has(this.channel)) channels.set(this.channel, new Set());
    channels.get(this.channel)!.add(this);
  }

  protected connected(): boolean {
    return !this.closed;
  }

  publish(frame: BusFrame): void {
    if (this.closed) return;
    const peers = [...(channels.get(this.channel) ?? [])].filter((b) => b !== this);
    if (peers.length === 0) return;
    const payload = this.encode(frame);
    if (payload == null) return;
    // Asynchronous like a real transport: a publisher never re-enters its
    // own call stack through a peer's subscriber.
    setImmediate(() => {
      for (const peer of peers) void peer.receive(payload);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    channels.get(this.channel)?.delete(this);
    this.subscribers.clear();
  }
}

/* ── Postgres LISTEN / NOTIFY transport ──────────────────────────────────── */

export const DEFAULT_BUS_CHANNEL = "docturn_realtime";
const CHANNEL_IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 30_000;

export interface PostgresBusOptions {
  /** The application's pool — publishes go through it. */
  pool: pg.Pool;
  /** For the dedicated LISTEN connection. Never logged. */
  connectionString: string;
  channel?: string;
  instanceId?: string;
  maxPayloadBytes?: number;
  /** Tests: a factory for the listener client. */
  createClient?: (connectionString: string) => pg.Client;
}

export class PostgresBus extends BaseBus {
  readonly kind = "postgres" as const;
  private readonly pool: pg.Pool;
  private readonly connectionString: string;
  private readonly channel: string;
  private readonly createClient: (cs: string) => pg.Client;
  private client: pg.Client | null = null;
  private listening = false;
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = RECONNECT_MIN_MS;
  private starting: Promise<void> | null = null;

  constructor(opts: PostgresBusOptions) {
    super(opts);
    this.pool = opts.pool;
    this.connectionString = opts.connectionString;
    this.channel = opts.channel ?? DEFAULT_BUS_CHANNEL;
    if (!CHANNEL_IDENT.test(this.channel)) throw new Error("bus_channel_invalid");
    this.createClient = opts.createClient ?? ((cs) => new pg.Client({ connectionString: cs }));
  }

  protected connected(): boolean {
    return this.listening;
  }

  /** Open the LISTEN connection; resolves once this instance is receiving. */
  start(): Promise<void> {
    if (!this.starting) this.starting = this.connectListener();
    return this.starting;
  }

  private async connectListener(): Promise<void> {
    if (this.closed) return;
    const client = this.createClient(this.connectionString);
    this.client = client;
    let lost = false;
    const onLost = (err?: unknown) => {
      if (lost) return;
      lost = true;
      if (this.client === client) {
        this.client = null;
        this.listening = false;
      }
      if (err) console.error("[bus] listener connection lost", err instanceof Error ? err.message.split("\n")[0] : "error");
      client.removeAllListeners("notification");
      void client.end().catch(() => {});
      this.scheduleReconnect();
    };
    client.on("error", onLost);
    client.on("end", () => onLost());
    client.on("notification", (n) => {
      if (n.channel === this.channel && typeof n.payload === "string") void this.receive(n.payload);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${this.channel}`);
    } catch (err) {
      onLost(err);
      throw err;
    }
    this.listening = true;
    this.backoffMs = RECONNECT_MIN_MS;
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(RECONNECT_MAX_MS, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.counts.reconnects++;
      this.starting = this.connectListener().catch(() => {
        /* scheduled again by onLost */
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  publish(frame: BusFrame): void {
    if (this.closed) return;
    const payload = this.encode(frame);
    if (payload == null) return;
    // NOTIFY takes no bind parameters; pg_notify() does.
    this.pool.query("SELECT pg_notify($1, $2)", [this.channel, payload]).catch((err) => {
      this.counts.dropped++;
      console.error("[bus] publish failed", err instanceof Error ? err.message.split("\n")[0] : "error");
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subscribers.clear();
    const client = this.client;
    this.client = null;
    this.listening = false;
    if (client) {
      client.removeAllListeners("error");
      client.removeAllListeners("end");
      client.on("error", () => {});
      await client.end().catch(() => {});
    }
  }
}

/* ── the process bus ─────────────────────────────────────────────────────── */

let processBus: RealtimeBus | null = null;

/** The bus this process fans out through (an in-process one until initBus() ran). */
export function getBus(): RealtimeBus {
  if (!processBus) processBus = new InProcessBus();
  return processBus;
}

/** Tests / boot: make `bus` the process bus. */
export function setBus(bus: RealtimeBus): void {
  processBus = bus;
}

/**
 * Boot-time selection: Postgres LISTEN/NOTIFY when DATABASE_URL is set (the
 * only configuration that can run more than one instance — sessions, leases
 * and rate-limit counters live there too), else in-process. Reconnects on
 * its own if the listener drops; a listener that cannot connect at boot is
 * reported and retried rather than failing the boot.
 */
export async function initBus(opts: { databaseUrl?: string; pool?: pg.Pool } = {}): Promise<RealtimeBus> {
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL;
  if (databaseUrl && opts.pool) {
    const bus = new PostgresBus({ pool: opts.pool, connectionString: databaseUrl });
    try {
      await bus.start();
    } catch (err) {
      console.error("[bus] Postgres listener did not connect at boot; retrying in the background", err instanceof Error ? err.message.split("\n")[0] : "error");
    }
    processBus = bus;
    return bus;
  }
  const bus = new InProcessBus();
  processBus = bus;
  return bus;
}
