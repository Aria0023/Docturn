/**
 * Usernames are identifiers people type — on phone keyboards that capitalise
 * the first letter and append a space after autocomplete. The server
 * therefore treats them case- and surrounding-whitespace-insensitively
 * (A.CON-SHO-12 / A.CON-SHO-57):
 *
 *  - STORED trimmed, with the case the account was created with (display);
 *  - COMPARED by usernameKey(): trimmed and lower-cased — sign-in lookup,
 *    registration / approval / provisioning uniqueness, the pending-request
 *    de-duplication — and the database enforces one account per
 *    (organization_id, lower(username)) (server/db.ts).
 */
export function normalizeUsername(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** The comparison key: trimmed, lower-cased. */
export function usernameKey(raw: unknown): string {
  return normalizeUsername(raw).toLowerCase();
}
