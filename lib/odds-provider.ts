// Seasonz odds-key rotation — one pool across two providers that speak the
// same REST shape:
//
//   The Odds API  https://api.the-odds-api.com/v4   (free: ~500 req/month)
//   PropLine      https://api.prop-line.com/v1      (free: 1,000 req/day;
//                                                    Pro: 25,000 req/day)
//
// Both serve /sports/{sport}/events, /sports/{sport}/odds and
// /sports/{sport}/events/{id}/odds with the same event/bookmakers/markets/
// outcomes JSON, so lib/odds.ts and lib/sports/odds.ts call oddsApiGet()
// without caring which provider answers.
//
// ORDER: free keys first, the paid key last, so free quota is spent before
// paid quota is touched.
//   ODDS_API_KEYS_FREE      comma/newline list of free The Odds API keys
//   PROPLINE_API_KEYS_FREE  comma/newline list of free PropLine keys
//   PROPLINE_API_KEY        the paid PropLine key (always tried last)
//
// QUOTA: every response's quota headers (x-requests-remaining for The Odds
// API, X-Daily-Remaining / X-Daily-Reset for PropLine) are recorded per key
// in odds_api_key_usage. A key at 0 remaining, or one that answered
// 401/403 (out of credits / bad key), is skipped until its reset time
// (PropLine: the reset header; The Odds API: retried after 24h, since its
// monthly reset date isn't in the headers). 429 (too many requests at
// once) just moves on to the next key without marking anything.
//
// EVENT IDS differ between providers, so an event id is remembered with the
// provider that returned it, and its /events/{id}/odds call only goes to
// keys of that provider.
import { createHash } from "crypto";
import { db } from "@/db";
import { oddsApiKeyUsage } from "@/db/schema";
import { sql } from "drizzle-orm";

export type OddsProvider = "theoddsapi" | "propline";

const BASE_URL: Record<OddsProvider, string> = {
  theoddsapi: "https://api.the-odds-api.com/v4",
  propline: "https://api.prop-line.com/v1",
};

export const PROVIDER_LABELS: Record<OddsProvider, string> = {
  theoddsapi: "The Odds API",
  propline: "PropLine",
};

/** Kept for any old import; The Odds API base URL. */
export const ODDS_BASE = BASE_URL.theoddsapi;

export interface PoolKey {
  keyId: string;
  label: string;
  provider: OddsProvider;
  kind: "free" | "paid";
  key: string;
}

interface KeyState {
  remaining: number | null;
  used: number | null;
  lastStatus: number | null;
  exhaustedAt: Date | null;
  resetAt: Date | null;
}

const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 5 * 60 * 1000;

function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** The configured pool, in rotation order: free The Odds API, free PropLine, then paid PropLine. Duplicate keys are dropped. */
export function getKeyPool(): PoolKey[] {
  const pool: PoolKey[] = [];
  const seen = new Set<string>();
  const add = (provider: OddsProvider, kind: "free" | "paid", key: string, label: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    pool.push({ keyId: hashKey(key), label, provider, kind, key });
  };
  splitList(process.env.ODDS_API_KEYS_FREE || process.env.odds_papi_api_key || process.env.odds_api_key).forEach((k, i) =>
    add("theoddsapi", "free", k, `Free ${i + 1} (The Odds API)`)
  );
  splitList(process.env.PROPLINE_API_KEYS_FREE).forEach((k, i) =>
    add("propline", "free", k, `Free ${i + 1} (PropLine)`)
  );
  const paid = (process.env.PROPLINE_API_KEY || process.env.propline_api_key)?.trim();
  if (paid) add("propline", "paid", paid, "Paid (PropLine)");
  return pool;
}

// --- per-key state, shared across instances through the DB ---------------

const state = new Map<string, KeyState>();
let stateLoadedAt = 0;

async function loadState(): Promise<void> {
  if (Date.now() - stateLoadedAt < STATE_TTL_MS) return;
  try {
    const rows = await db.select().from(oddsApiKeyUsage);
    for (const r of rows) {
      state.set(r.keyId, {
        remaining: r.requestsRemaining,
        used: r.requestsUsed,
        lastStatus: r.lastStatus,
        exhaustedAt: r.exhaustedAt,
        resetAt: r.resetAt,
      });
    }
  } catch (err) {
    // Usage tracking is best-effort; rotation still works from memory.
    console.error("[odds-provider] couldn't load key usage:", err);
  }
  stateLoadedAt = Date.now();
}

async function saveState(k: PoolKey, s: KeyState): Promise<void> {
  state.set(k.keyId, s);
  try {
    await db
      .insert(oddsApiKeyUsage)
      .values({
        keyId: k.keyId,
        label: k.label,
        provider: k.provider,
        kind: k.kind,
        requestsRemaining: s.remaining,
        requestsUsed: s.used,
        lastStatus: s.lastStatus,
        exhaustedAt: s.exhaustedAt,
        resetAt: s.resetAt,
      })
      .onConflictDoUpdate({
        target: oddsApiKeyUsage.keyId,
        set: {
          label: k.label,
          provider: k.provider,
          kind: k.kind,
          requestsRemaining: s.remaining,
          requestsUsed: s.used,
          lastStatus: s.lastStatus,
          exhaustedAt: s.exhaustedAt,
          resetAt: s.resetAt,
          updatedAt: sql`now()`,
        },
      });
  } catch (err) {
    console.error("[odds-provider] couldn't save key usage:", err);
  }
}

/** Whether a key should be skipped right now (out of quota and not yet reset). */
function isResting(s: KeyState | undefined, now = Date.now()): boolean {
  if (!s) return false;
  const out = s.exhaustedAt !== null || (s.remaining !== null && s.remaining <= 0);
  if (!out) return false;
  if (s.resetAt) return s.resetAt.getTime() > now;
  const since = s.exhaustedAt?.getTime() ?? 0;
  return now - since < RETRY_AFTER_MS;
}

function readQuota(k: PoolKey, res: Response, prev: KeyState | undefined): KeyState {
  const num = (h: string) => {
    const v = res.headers.get(h);
    if (v === null || v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : null;
  };
  let remaining: number | null;
  let used: number | null;
  let resetAt: Date | null = prev?.resetAt ?? null;
  if (k.provider === "propline") {
    remaining = num("x-daily-remaining") ?? num("ratelimit-remaining");
    used = num("x-daily-used");
    const resetEpoch = num("x-daily-reset");
    if (resetEpoch !== null) resetAt = new Date(resetEpoch * 1000);
  } else {
    remaining = num("x-requests-remaining");
    used = num("x-requests-used");
  }
  return {
    remaining: remaining ?? prev?.remaining ?? null,
    used: used ?? prev?.used ?? null,
    lastStatus: res.status,
    exhaustedAt: remaining !== null && remaining <= 0 ? new Date() : null,
    resetAt,
  };
}

// --- event id -> provider -------------------------------------------------

const eventProvider = new Map<string, OddsProvider>();
let lastProvider: OddsProvider | null = null;
let lastKeyLabel: string | null = null;

function eventIdFromPath(path: string): string | null {
  const m = path.match(/\/events\/([^/]+)\//);
  return m ? decodeURIComponent(m[1]) : null;
}

function rememberEvents(data: unknown, provider: OddsProvider) {
  if (!Array.isArray(data)) return;
  for (const e of data) {
    const id = (e as { id?: unknown })?.id;
    if (typeof id === "string" || typeof id === "number") eventProvider.set(String(id), provider);
  }
}

// --- public API -----------------------------------------------------------

/** Whether any odds key is configured at all — gates the odds-dependent sync stages. */
export function hasOddsApiKey(): boolean {
  return getKeyPool().length > 0;
}

/** Which key served the most recent call (1-based position in the pool) — shown in sync logs. */
export function oddsApiKeyStatus(): { active: number; total: number; label: string | null } {
  const pool = getKeyPool();
  const idx = lastKeyLabel ? pool.findIndex((k) => k.label === lastKeyLabel) : -1;
  return { active: idx >= 0 ? idx + 1 : 0, total: pool.length, label: lastKeyLabel };
}

/** Provider that served the most recent call, if any. */
export function lastOddsProvider(): OddsProvider | null {
  return lastProvider;
}

/**
 * GETs a path from the first key in the pool that isn't out of quota,
 * rotating to the next key on 401/403/429. Any other non-ok status
 * (404/422 — no board or no props posted yet) is a normal answer callers
 * already handle, so it's thrown right away.
 */
export async function oddsApiGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const pool = getKeyPool();
  if (pool.length === 0) {
    throw new Error("No odds key is set (ODDS_API_KEYS_FREE, PROPLINE_API_KEYS_FREE, or PROPLINE_API_KEY)");
  }
  await loadState();

  const eventId = eventIdFromPath(path);
  const pinned = eventId ? eventProvider.get(eventId) : undefined;
  const candidates = pool.filter((k) => !pinned || k.provider === pinned);

  // Rested keys go to the back instead of being dropped, so if every key is
  // marked out we still try them (a reset may have happened early).
  const ordered = [
    ...candidates.filter((k) => !isResting(state.get(k.keyId))),
    ...candidates.filter((k) => isResting(state.get(k.keyId))),
  ];

  let lastError: Error | null = null;
  for (const k of ordered) {
    const url = new URL(`${BASE_URL[k.provider]}${path}`);
    url.searchParams.set("apiKey", k.key);
    for (const [name, v] of Object.entries(params)) url.searchParams.set(name, v);

    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }

    const prev = state.get(k.keyId);
    const next = readQuota(k, res, prev);

    if (res.ok) {
      await saveState(k, next);
      lastProvider = k.provider;
      lastKeyLabel = k.label;
      const data = (await res.json()) as T;
      if (!eventId) rememberEvents(data, k.provider);
      return data;
    }

    const body = await res.text().catch(() => "");
    const err = new Error(`${PROVIDER_LABELS[k.provider]} ${path} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);

    if (res.status === 401 || res.status === 403) {
      await saveState(k, { ...next, exhaustedAt: new Date() });
      lastError = err;
      continue;
    }
    if (res.status === 429) {
      await saveState(k, next);
      lastError = err;
      continue;
    }
    await saveState(k, next);
    throw err;
  }
  throw lastError ?? new Error("Every configured odds key failed.");
}

export interface OddsKeyReport {
  label: string;
  provider: OddsProvider;
  kind: "free" | "paid";
  last4: string;
  remaining: number | null;
  used: number | null;
  lastStatus: number | null;
  resting: boolean;
  resetAt: Date | null;
  updatedAt: Date | null;
}

/** Admin page view of the pool — never returns a full key. */
export async function getOddsKeyReport(): Promise<OddsKeyReport[]> {
  const pool = getKeyPool();
  const rows = pool.length ? await db.select().from(oddsApiKeyUsage) : [];
  const byId = new Map(rows.map((r) => [r.keyId, r]));
  return pool.map((k) => {
    const r = byId.get(k.keyId);
    const s: KeyState | undefined = r
      ? {
          remaining: r.requestsRemaining,
          used: r.requestsUsed,
          lastStatus: r.lastStatus,
          exhaustedAt: r.exhaustedAt,
          resetAt: r.resetAt,
        }
      : undefined;
    return {
      label: k.label,
      provider: k.provider,
      kind: k.kind,
      last4: k.key.slice(-4),
      remaining: s?.remaining ?? null,
      used: s?.used ?? null,
      lastStatus: s?.lastStatus ?? null,
      resting: isResting(s),
      resetAt: s?.resetAt ?? null,
      updatedAt: r?.updatedAt ?? null,
    };
  });
}
