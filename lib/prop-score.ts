// Scores every posted prop line (not only the model's picks): the model's
// chance for each side, blended with the market's no-vig chance the same way
// the picks are (lib/props-model.ts), plus a trust score and a verdict.
import { db } from "@/db";
import { propProjections } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { propChance, type PropModelConfig, type Projection } from "./prop-dist";
import { blendPropChance, isPlaceholderLine, marketOverChances, oneSidedMarket } from "./props-model";
import { propTrust, trustFeatures, type TrustTier } from "./prop-trust";
import { getModelWeights, weightFor } from "./model-weights";

export interface StoredProjection {
  proj: Projection;
  cfg: PropModelConfig;
  values: number[];
  minutes?: (number | null)[];
}

export interface LineScore {
  chance: number; // final chance this side hits
  modelOnly: number;
  market: number | null;
  trust: { tier: TrustTier; reasons: string[] };
  projection: number;
}

/** Saves this week's projections for players with a posted line. */
export async function saveProjections(
  sport: string,
  season: number,
  week: number,
  rows: { player: string; team: string; statType: string; data: StoredProjection }[]
): Promise<number> {
  await db.delete(propProjections).where(and(eq(propProjections.sport, sport), eq(propProjections.season, season), eq(propProjections.week, week)));
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(propProjections).values(
      rows.slice(i, i + 500).map((r) => ({
        sport,
        season,
        week,
        player: r.player,
        team: r.team,
        statType: r.statType,
        // Last 20 games is all the trust score and long window use.
        data: { ...r.data, values: r.data.values.slice(-20), minutes: r.data.minutes?.slice(-20) },
      }))
    );
  }
  return rows.length;
}

const sideOf = (s: string): "Over" | "Under" | null => (s === "Over" || s === "Yes" ? "Over" : s === "Under" || s === "No" ? "Under" : null);

/**
 * Scores lines (raw per-book rows) for one sport/week. Key:
 * `${player}|${statType}|${line}|${side}` with the side as posted.
 */
export async function scoreLines(
  sport: string,
  season: number,
  week: number,
  lines: { player: string; statType: string; line: number; side: string; book: string; priceAmerican: number }[]
): Promise<Record<string, LineScore>> {
  const projRows = await db
    .select()
    .from(propProjections)
    .where(and(eq(propProjections.sport, sport), eq(propProjections.season, season), eq(propProjections.week, week)));
  if (projRows.length === 0) return {};
  const proj = new Map(projRows.map((r) => [`${r.player}|${r.statType}`, r.data as StoredProjection]));
  const weight = weightFor(await getModelWeights().catch(() => ({})), `prop:${sport}`);

  // Per-book Over/Under pairs, for the market consensus.
  const groups = new Map<string, { player: string; statType: string; book: string; line: number; overPrice?: number; underPrice?: number }>();
  for (const l of lines) {
    const side = sideOf(l.side);
    if (!side) continue;
    const k = `${l.player}|${l.statType}|${l.book}|${l.line}`;
    const g = groups.get(k) ?? { player: l.player, statType: l.statType, book: l.book, line: l.line };
    if (side === "Over") g.overPrice = l.priceAmerican;
    else g.underPrice = l.priceAmerican;
    groups.set(k, g);
  }
  const market = marketOverChances(groups.values());
  // Fallback market per line: the best-known single price.
  const oneSided = new Map<string, number>();
  for (const g of groups.values()) {
    if (isPlaceholderLine(g.book, g.overPrice, g.underPrice)) continue;
    const k = `${g.player}|${g.statType}|${g.line}`;
    if (!market.has(k) && !oneSided.has(k)) {
      const m = oneSidedMarket(g.overPrice, g.underPrice);
      if (m !== undefined) oneSided.set(k, m);
    }
  }

  const out: Record<string, LineScore> = {};
  for (const l of lines) {
    const side = sideOf(l.side);
    if (!side) continue;
    const key = `${l.player}|${l.statType}|${l.line}|${l.side}`;
    if (out[key]) continue;
    const p = proj.get(`${l.player}|${l.statType}`);
    if (!p) continue;
    const pOverModel = propChance(p.proj, l.line, p.cfg, "Over");
    const lk = `${l.player}|${l.statType}|${l.line}`;
    const mk = market.get(lk) ?? oneSided.get(lk);
    const pOver = mk === undefined ? pOverModel : blendPropChance(pOverModel, mk, weight);
    const chance = side === "Over" ? pOver : 1 - pOver;
    const modelOnly = side === "Over" ? pOverModel : 1 - pOverModel;
    const marketSide = mk === undefined ? null : side === "Over" ? mk : 1 - mk;
    const played = p.values.map((v, i) => ({ v, m: p.minutes?.[i] ?? null })).filter((x) => !p.cfg.useMinutes || x.m === null || x.m > 0);
    const t = propTrust(sport, modelOnly, trustFeatures(played.map((x) => x.v), l.line, side, played.map((x) => x.m)), marketSide);
    out[key] = { chance, modelOnly, market: marketSide, trust: { tier: t.tier, reasons: t.reasons }, projection: p.proj.mean };
  }
  return out;
}
