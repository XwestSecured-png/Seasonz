import type { PlayerWeekStats } from "./nflverse";

/**
 * Each team's season-to-date pass-yard share — passYds / (passYds + rushYds)
 * across every offensive snap credited in the weekly stats — used as a cheap
 * proxy for "how much does bad weather hurt this offense." A run-heavy team
 * has less to lose in wind/cold than a pass-heavy one.
 */
export function computeTeamPassShare(rows: PlayerWeekStats[]): Map<string, number> {
  const totals = new Map<string, { pass: number; rush: number }>();
  for (const row of rows) {
    const existing = totals.get(row.team) ?? { pass: 0, rush: 0 };
    existing.pass += row.passYds;
    existing.rush += row.rushYds;
    totals.set(row.team, existing);
  }

  const out = new Map<string, number>();
  for (const [team, { pass, rush }] of totals) {
    const total = pass + rush;
    out.set(team, total > 0 ? pass / total : 0.6); // 0.6 ~= league-average pass share, if no data yet
  }
  return out;
}
