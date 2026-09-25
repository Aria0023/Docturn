/**
 * Attachment byte storage — the ONE place message-attachment bytes are written
 * and read. The messaging routes never touch bytes directly; they hand a Buffer
 * to `put` and get an opaque storage REF back, which is what the
 * message_attachments.data_base64 column now holds:
 *
 *   "db"           ref = the base64 of the bytes themselves (the historical
 *                  inline-in-database format — byte-for-byte compatible with
 *                  every existing row, so old uploads keep working unchanged).
 *   "fs-encrypted" ref = "fsenc:<32 hex id>", pointing at a file under
 *                  ATTACHMENT_DIR that holds AES-256-GCM ciphertext. Plaintext
 *                  is never written to disk.
 *
 * Selection is by env at call time:
 *   ATTACHMENT_STORE = "db" (default) | "fs-encrypted"
 *   ATTACHMENT_DIR   = directory for the encrypted files (fs-encrypted only)
 *   ATTACHMENT_KEY   = 32-byte key as 64 hex chars or 44-char base64
 *
 * Reads always resolve the store FROM THE REF (see attachmentStoreFor), so a
 * deployment can switch to fs-encrypted and still serve rows uploaded while the
 * db store was active.
 *
 * NEXT STEP (not implemented here): an "s3" / "gcs" implementation of the same
 * interface — put() streams the bytes to an object key under a bucket covered
 * by a BAA with SSE-KMS (or client-side AES-GCM with a KMS-wrapped data key),
 * returns "s3:<bucket>/<key>", and get() either proxies the object or mints a
 * short-lived signed URL. Add server-side antivirus scanning at put() before the
 * object becomes fetchable. Nothing in the routes needs to change for that: the
 * ref prefix is the only contract.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type AttachmentStoreKind = "db" | "fs-encrypted";

export interface AttachmentMeta {
  organizationId: number;
  uploaderId?: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
}

export interface AttachmentStore {
  readonly kind: AttachmentStoreKind;
  /** Persist bytes; returns the opaque ref to store in the attachment row. */
  put(bytes: Buffer, meta: AttachmentMeta): Promise<string>;
  /** Load the bytes behind a ref produced by `put`. */
  get(ref: string): Promise<Buffer>;
  /** Remove the bytes behind a ref (no-op for refs that carry their own bytes). */
  delete(ref: string): Promise<void>;
}

/** Thrown when the operator asked for a store this process cannot honour. */
export class AttachmentStoreError extends Error {
  constructor(
    readonly code: "attachment_store_misconfigured" | "attachment_not_found" | "attachment_corrupt",
    message: string,
  ) {
    super(message);
    this.name = "AttachmentStoreError";
  }
}

export const FS_REF_PREFIX = "fsenc:";
const FS_REF_RE = /^fsenc:([0-9a-f]{32})$/;
/** On-disk layout: MAGIC(4) | IV(12) | TAG(16) | CIPHERTEXT. */
const FILE_MAGIC = Buffer.from("DTA1");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/* ── "db": bytes live inline as base64 in the row (historical behaviour) ─── */

class DbAttachmentStore implements AttachmentStore {
  readonly kind = "db" as const;
  async put(bytes: Buffer): Promise<string> {
    return bytes.toString("base64");
  }
  async get(ref: string): Promise<Buffer> {
    return Buffer.from(ref, "base64");
  }
  async delete(): Promise<void> {
    // The bytes ARE the row; deleting the row deletes them.
  }
}

/* ── "fs-encrypted": AES-256-GCM files under ATTACHMENT_DIR ───────────────── */

class FsEncryptedAttachmentStore implements AttachmentStore {
  readonly kind = "fs-encrypted" as const;
  constructor(
    private readonly dir: string,
    private readonly key: Buffer,
  ) {}

  private pathFor(id: string): string {
    return join(this.dir, id + ".bin");
  }

  async put(bytes: Buffer): Promise<string> {
    const id = randomBytes(16).toString("hex");
    const iv = randomBytes(IV_BYTES); // fresh random IV per file — never reused
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    // Bind the ciphertext to its own id so a file cannot be swapped under
    // another ref without failing authentication.
    cipher.setAAD(Buffer.from(id, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.pathFor(id), Buffer.concat([FILE_MAGIC, iv, tag, ciphertext]), {
      mode: 0o600,
    });
    return FS_REF_PREFIX + id;
  }

  async get(ref: string): Promise<Buffer> {
    const id = parseFsRef(ref);
    let blob: Buffer;
    try {
      blob = await readFile(this.pathFor(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        throw new AttachmentStoreError("attachment_not_found", "attachment file is missing");
      }
      throw err;
    }
    const header = FILE_MAGIC.length + IV_BYTES + TAG_BYTES;
    if (blob.length < header || !blob.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
      throw new AttachmentStoreError("attachment_corrupt", "attachment file has an unexpected layout");
    }
    const iv = blob.subarray(FILE_MAGIC.length, FILE_MAGIC.length + IV_BYTES);
    const tag = blob.subarray(FILE_MAGIC.length + IV_BYTES, header);
    const ciphertext = blob.subarray(header);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(Buffer.from(id, "utf8"));
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      // Wrong key or tampered file — GCM authentication failed.
      throw new AttachmentStoreError("attachment_corrupt", "attachment file failed authentication");
    }
  }

  async delete(ref: string): Promise<void> {
    const id = parseFsRef(ref);
    try {
      await unlink(this.pathFor(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    }
  }
}

function parseFsRef(ref: string): string {
  const m = FS_REF_RE.exec(ref);
  if (!m) throw new AttachmentStoreError("attachment_not_found", "not an fs-encrypted ref");
  return m[1]!;
}

/* ── configuration ────────────────────────────────────────────────────────── */

/** Decode ATTACHMENT_KEY (64 hex chars or base64 of 32 bytes); null if unusable. */
export function parseAttachmentKey(raw: string | undefined | null): Buffer | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, "hex");
  if (/^[A-Za-z0-9+/]+=*$/.test(s)) {
    const b = Buffer.from(s, "base64");
    if (b.length === KEY_BYTES) return b;
  }
  return null;
}

export interface AttachmentStoreConfig {
  /** What the operator asked for (unknown values fall back to "db"). */
  mode: AttachmentStoreKind;
  /** Only meaningful for fs-encrypted. */
  dir: string;
  keyConfigured: boolean;
  keyValid: boolean;
  /** True when `put` will actually work in the requested mode. */
  ready: boolean;
  problem: string | null;
}

/** Read the store configuration from env AT CALL TIME (never cached). */
export function attachmentStoreConfig(): AttachmentStoreConfig {
  const requested = (process.env.ATTACHMENT_STORE ?? "db").trim().toLowerCase();
  const mode: AttachmentStoreKind = requested === "fs-encrypted" ? "fs-encrypted" : "db";
  const dir = resolve(process.env.ATTACHMENT_DIR?.trim() || join(process.cwd(), ".attachments"));
  const rawKey = process.env.ATTACHMENT_KEY;
  const keyConfigured = !!(rawKey && rawKey.trim());
  const keyValid = parseAttachmentKey(rawKey) != null;
  if (mode === "db") {
    return { mode, dir, keyConfigured, keyValid, ready: true, problem: null };
  }
  const problem = !keyConfigured
    ? "ATTACHMENT_STORE=fs-encrypted but ATTACHMENT_KEY is not set"
    : !keyValid
      ? "ATTACHMENT_KEY must be a 32-byte key as 64 hex characters or base64"
      : null;
  return { mode, dir, keyConfigured, keyValid, ready: problem == null, problem };
}

function fsStoreOrThrow(cfg: AttachmentStoreConfig): FsEncryptedAttachmentStore {
  const key = parseAttachmentKey(process.env.ATTACHMENT_KEY);
  if (!key) {
    throw new AttachmentStoreError(
      "attachment_store_misconfigured",
      cfg.problem ?? "ATTACHMENT_KEY is missing or invalid",
    );
  }
  return new FsEncryptedAttachmentStore(cfg.dir, key);
}

/**
 * The store NEW uploads go to. Throws AttachmentStoreError when fs-encrypted is
 * requested without a valid key — we refuse to silently fall back to plaintext.
 */
export function getAttachmentStore(): AttachmentStore {
  const cfg = attachmentStoreConfig();
  if (cfg.mode === "fs-encrypted") return fsStoreOrThrow(cfg);
  return new DbAttachmentStore();
}

/** The store that can READ a given ref, regardless of the current default. */
export function attachmentStoreFor(ref: string): AttachmentStore {
  if (ref.startsWith(FS_REF_PREFIX)) return fsStoreOrThrow(attachmentStoreConfig());
  return new DbAttachmentStore();
}
