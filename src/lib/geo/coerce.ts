/**
 * Untrusted-value coercion helpers (B9): plain "type-or-null" narrowing shared by the Wix Data row
 * mappers (lib/wix/pinRecords, store/pins). NO range/length validation — that stays inline where
 * the input is untrusted REQUEST data (pinRecords.parseSavePinBody's own `num`/`str`); these are
 * for already-stored rows where only the JS type is in question.
 */

export const numOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);
export const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
