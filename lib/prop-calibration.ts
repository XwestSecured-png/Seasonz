// Prop-model check: replays every player's history and asks, game by game,
// "using only the games before this one, what chance would the model have
// given the Over at a typical line, and did it hit?" Lines are simulated at
// the old model's projection and up to two standard deviations either side
// (rounded to .5 like a book's), so every model is graded on the same lines
// and the check covers the whole range of confidences.
//
// Scored: the original model (last-5 average, bell curve), the model the
// app runs now for that stat (lib/prop-dist.ts settings), and a small grid
// of alternatives (bell curve / Poisson / negative binomial, light or heavy
// shrinkage, per-minute or per-game, with or without a calibration pull).
import { projectProp, propChance, LEGACY_PROP_MODEL, type DistKind, type PropModelConfig } from "./prop-dist";

export interface StatSeries {
  player: string;
  values: { t: number; v: number; min?: number | null }[]; // chronological; v may be 0
}

interface Score {
  ll: number;
  brier: number;
  bucket70: { n: number; predicted: number; actual: number };
}

export interface CalResult {
  n: number;
  legacy: Score;
  current: Score & { model: PropModelConfig };
  best: Score & { model: PropModelConfig };
  /** Normal stats: the 20-game spread pull (sdShrinkK 10, spread x0.9) on top of the current model. */
  spreadPull?: Score & { model: PropModelConfig };
}

const MAX_SAMPLES = 40000;

function candidates(sdMult: number, hasMinutes: boolean): PropModelConfig[] {
  const out: PropModelConfig[] = [];
  for (const dist of ["normal", "poisson", "negbin"] as DistKind[])
    for (const shrinkK of [5, 40])
      for (const useMinutes of hasMinutes ? [false, true] : [false])
        for (const temper of [0.88, 1]) out.push({ dist, sdMult, shrinkK, useMinutes, temper });
  return out;
}

export function calibrateStat(series: StatSeries[], floorAbs: number, current: PropModelConfig, isCount: boolean): CalResult | null {
  const legacy = LEGACY_PROP_MODEL(current.sdMult);
  const hasMinutes = series.some((s) => s.values.some((x) => x.min != null && x.min > 0));
  const grid = candidates(current.sdMult, hasMinutes).filter((c) => isCount || c.dist === "normal");
  const pull: PropModelConfig | null =
    current.dist === "normal" && !current.sdShrinkK ? { ...current, sdMult: +(current.sdMult * 0.9).toFixed(3), sdShrinkK: 10 } : null;
  const models = [legacy, current, ...grid, ...(pull ? [pull] : [])];
  const acc = models.map(() => ({ ll: 0, br: 0, bn: 0, bp: 0, ba: 0, n: 0 }));

  // Evenly thin very large histories so the check fits in one request.
  const total = series.reduce((a, s) => a + Math.max(0, s.values.length - 3), 0);
  const step = Math.max(1, Math.ceil(total / MAX_SAMPLES));
  let k = 0;
  for (const s of series) {
    const vals = s.values.map((x) => x.v);
    const mins = s.values.map((x) => x.min ?? null);
    const minsOk = hasMinutes && mins.every((m) => m !== null);
    for (let i = 3; i < vals.length; i++) {
      if (k++ % step !== 0) continue;
      if (minsOk && !((mins[i] ?? 0) > 0)) continue; // didn't play
      const lo = Math.max(0, i - 20);
      const prior = vals.slice(lo, i);
      const pm = minsOk ? mins.slice(lo, i) : undefined;
      const base = projectProp(prior, legacy, floorAbs, pm);
      if (!base || base.mean <= 0) continue;
      const projs = models.map((m) => projectProp(prior, m, floorAbs, m.useMinutes ? pm : undefined));
      if (projs.some((p) => !p)) continue;
      const actual = vals[i];
      for (const d of [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]) {
        const line = Math.max(0.5, Math.floor(base.mean + (d * base.sd) / legacy.sdMult) + 0.5);
        const hit = actual > line ? 1 : 0;
        models.forEach((m, j) => {
          const p = Math.min(0.999, Math.max(0.001, propChance(projs[j]!, line, m, "Over")));
          const a = acc[j];
          a.ll -= hit * Math.log(p) + (1 - hit) * Math.log(1 - p);
          a.br += (p - hit) ** 2;
          a.n++;
          const pick = Math.max(p, 1 - p);
          if (pick >= 0.7) {
            a.bn++;
            a.bp += pick;
            a.ba += p >= 0.5 ? hit : 1 - hit;
          }
        });
      }
    }
  }
  if (acc[0].n < 200) return null;
  const score = (j: number): Score => {
    const a = acc[j];
    return {
      ll: +(a.ll / a.n).toFixed(4),
      brier: +(a.br / a.n).toFixed(4),
      bucket70: { n: a.bn, predicted: a.bn ? +(a.bp / a.bn).toFixed(3) : 0, actual: a.bn ? +(a.ba / a.bn).toFixed(3) : 0 },
    };
  };
  let bestJ = 1;
  for (let j = 2; j < models.length; j++) if (acc[j].ll / acc[j].n < acc[bestJ].ll / acc[bestJ].n) bestJ = j;
  return {
    n: acc[0].n,
    legacy: score(0),
    current: { ...score(1), model: current },
    best: { ...score(bestJ), model: models[bestJ] },
    ...(pull ? { spreadPull: { ...score(models.length - 1), model: pull } } : {}),
  };
}
