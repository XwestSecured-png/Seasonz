// Prefilled "Log bet" choices for a game's posted lines (client-safe).
import type { BetOption } from "@/app/(app)/log-bet-button";

const fmt = (p: number | null) => (p == null ? "" : p > 0 ? `+${p}` : `${p}`);
const sp = (l: number) => (l > 0 ? `+${l}` : `${l}`);

interface GameLines {
  id: number;
  homeTeam: string;
  awayTeam: string;
  moneylineHomeOdds: number | null;
  moneylineAwayOdds: number | null;
  spreadHomeLine: number | null;
  spreadHomePriceAmerican: number | null;
  spreadAwayPriceAmerican: number | null;
  totalLine: number | null;
  totalOverPriceAmerican: number | null;
  totalUnderPriceAmerican: number | null;
}

/** Moneyline, spread and total on both sides, for NFL (`games`) or any other sport (`sport_games`). */
export function gameBetOptions(sport: string, g: GameLines): BetOption[] {
  const ids = sport === "nfl" ? { gameId: g.id } : { sportGameId: g.id };
  const base = { sport, ...ids };
  const out: BetOption[] = [
    { ...base, label: `${g.awayTeam} ML ${fmt(g.moneylineAwayOdds)}`, market: "ML", selection: g.awayTeam, priceAmerican: g.moneylineAwayOdds },
    { ...base, label: `${g.homeTeam} ML ${fmt(g.moneylineHomeOdds)}`, market: "ML", selection: g.homeTeam, priceAmerican: g.moneylineHomeOdds },
  ];
  if (g.spreadHomeLine != null) {
    out.push(
      { ...base, label: `${g.awayTeam} ${sp(-g.spreadHomeLine)} ${fmt(g.spreadAwayPriceAmerican)}`, market: "SPREAD", selection: g.awayTeam, line: g.spreadHomeLine, priceAmerican: g.spreadAwayPriceAmerican ?? -110 },
      { ...base, label: `${g.homeTeam} ${sp(g.spreadHomeLine)} ${fmt(g.spreadHomePriceAmerican)}`, market: "SPREAD", selection: g.homeTeam, line: g.spreadHomeLine, priceAmerican: g.spreadHomePriceAmerican ?? -110 }
    );
  }
  if (g.totalLine != null) {
    out.push(
      { ...base, label: `Over ${g.totalLine} ${fmt(g.totalOverPriceAmerican)}`, market: "TOTAL", selection: "OVER", line: g.totalLine, priceAmerican: g.totalOverPriceAmerican ?? -110 },
      { ...base, label: `Under ${g.totalLine} ${fmt(g.totalUnderPriceAmerican)}`, market: "TOTAL", selection: "UNDER", line: g.totalLine, priceAmerican: g.totalUnderPriceAmerican ?? -110 }
    );
  }
  return out;
}
