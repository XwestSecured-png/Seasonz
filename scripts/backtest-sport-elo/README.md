# Per-sport Elo backtest

Tunes `SPORT_ELO` in `lib/sports/sport-elo.ts`. Needs open internet (ESPN).

    node fetch.mjs            # pulls 3-4 past seasons per sport into <sport>.json
    node tune.mjs nba         # grid search, tuned on older seasons, scored on the latest (held out)
    node tune2.mjs nba '<json params>'   # wider coordinate search from a starting point

Picks by log loss. `baseTest` is the old one-size model (K 20, home 65, reset each season).
