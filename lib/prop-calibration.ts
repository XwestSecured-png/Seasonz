// Prop-model check: replays every player's history and asks, game by game,
// "using only the games before this one, what chance would the model have
// given the Over at a typical line, and did it hit?" Lines are simulated at
// the projection and half / one standard deviation either side (rounded to
// .5 like a book's), so the check covers the whole range of confidences.
//
// Two settings are scored: the spread multiplier (how wide the model
// thinks a player's outcomes are) and whether games where the player
// recorded zero of the stat count toward his average.

export interface StatSeries {
  player: string;
  values: { t: number; v: number }[]; // chronological; v may be 0
}

export interface CalSetting {
  sdMult: number;
  includeZeros: boolean;
}

export interface CalResult {
  n: number;
  current: { ll: number; brier: number; bucket70: { n: number; predicted: number; actual: number } };
  best: CalSetting & { ll: number; brier: number; bucket70: { n: number; predicted: number; actual: number } };
}

const WINDOW = 5;
const MIN_PRIOR = 3;
const FLOOR_PCT = 0.12;

function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/** The props model's projection: recency-weighted mean of the last 5 games and their std dev, floored. */
export function projectFrom(prior: number[], floorAbs: number, includeZeros: boolean): { mean: number; sd: number } | null {
  const vals = (includeZeros ? prior : prior.filter((v) => v > 0)).slice(-WINDOW).reverse(); // most recent first
  const n = vals.length;
  if (n < MIN_PRIOR) return null;
  const w = vals.map((_, i) => n - i);
  const ws = w.reduce((a, b) => a + b, 0);
  const mean = vals.reduce((a, v, i) => a + v * w[i], 0) / ws;
  const raw = vals.reduce((a, v) => a + v, 0) / n;
  const variance = n > 1 ? vals.reduce((a, v) => a + (v - raw) ** 2, 0) / (n - 1) : 0;
  const sd = Math.max(Math.sqrt(variance), Math.max(mean * FLOOR_PCT, floorAbs));
  return { mean, sd };
}

interface Sample {
  pBySetting: number[];
  hit: number;
}

const SETTINGS: CalSetting[] = [];
for (const includeZeros of [false, true]) {
  for (let m = 0.8; m <= 2.21; m += 0.1) SETTINGS.push({ sdMult: +m.toFixed(1), includeZeros });
}
const CURRENT = SETTINGS.findIndex((s) => s.sdMult === 1 && !s.includeZeros);

export function calibrateStat(series: StatSeries[], floorAbs: number): CalResult | null {
  const samples: Sample[] = [];
  for (const s of series) {
    const vals = s.values.map((x) => x.v);
    for (let i = MIN_PRIOR; i < vals.length; i++) {
      const prior = vals.slice(Math.max(0, i - 20), i);
      const actual = vals[i];
      // Lines from the CURRENT model's projection, so every setting is
      // graded on the same set of lines.
      const base = projectFrom(prior, floorAbs, false);
      if (!base || base.mean <= 0) continue;
      for (const d of [-1, -0.5, 0, 0.5, 1]) {
        const lineHalf = Math.max(0.5, Math.floor(base.mean + d * base.sd) + 0.5); // books post .5 lines
        const prZero = projectFrom(prior, floorAbs, true);
        const pBySetting = SETTINGS.map((st) => {
          const pr = st.includeZeros ? prZero : base;
          if (!pr) return NaN;
          return 1 - normalCdf((lineHalf - pr.mean) / (pr.sd * st.sdMult));
        });
        if (pBySetting.some((p) => Number.isNaN(p))) continue;
        samples.push({ pBySetting, hit: actual > lineHalf ? 1 : 0 });
      }
    }
  }
  if (samples.length < 200) return null;
  const score = (k: number) => {
    let ll = 0;
    let br = 0;
    let bn = 0;
    let bp = 0;
    let ba = 0;
    for (const s of samples) {
      const p = Math.min(0.999, Math.max(0.001, s.pBySetting[k]));
      ll -= s.hit * Math.log(p) + (1 - s.hit) * Math.log(1 - p);
      br += (p - s.hit) ** 2;
      // The pick the model would make (whichever side it favors) at 70%+.
      const pick = Math.max(p, 1 - p);
      if (pick >= 0.7) {
        bn++;
        bp += pick;
        ba += p >= 0.5 ? s.hit : 1 - s.hit;
      }
    }
    return {
      ll: ll / samples.length,
      brier: br / samples.length,
      bucket70: { n: bn, predicted: bn ? bp / bn : 0, actual: bn ? ba / bn : 0 },
    };
  };
  let bestK = CURRENT;
  let bestScore = score(CURRENT);
  const current = bestScore;
  for (let k = 0; k < SETTINGS.length; k++) {
    const sc = score(k);
    if (sc.ll < bestScore.ll) {
      bestScore = sc;
      bestK = k;
    }
  }
  return { n: samples.length, current, best: { ...SETTINGS[bestK], ...bestScore } };
}
