# Game model backtest (all sports except NFL)

Picks the weights in `lib/sports/game-model.ts`. Needs open internet (ESPN, Open-Meteo).

    node fetch.mjs nba,nhl          # schedules + closing moneylines (ESPN) + starters (MLB/NHL box scores)
    node weather.mjs mlb            # adds game-time weather to outdoor games (Open-Meteo archive)
    node tune.mjs nba 20            # fit on the tune season(s), score on the held-out last season
    BASE=eloBackup node tune.mjs nhl 20

Each layer was kept only if it beat the layer below on the held-out season.
Held-out log loss / share of winners picked (lower log loss is better):

| sport | Elo | + form / starters | book line alone | blended (shipped) | model weight |
|---|---|---|---|---|---|
| NBA 2025-26 | .6005 / 67.9% | .5983 / 68.3% | .5761 / 69.1% | .5761 / 68.5% | 6% |
| WNBA 2026 | .5949 / 68.0% | .5920 / 68.3% | .5820 / 70.3% | .5794 / 70.0% | 17% |
| NHL 2025-26 | .6952 / 53.0% | .6928 / 54.6% (backup goalie) | .6854 / 54.7% | .6834 / 55.2% | 17% |
| MLB 2026 | .6846 / 56.1% | .6833 / 56.5% (starting pitchers) | .6828 / 55.6% | .6822 / 56.5% | 24% |
| NCAAF 2025 | .5339 / 72.6% | .5308 / 73.1% | .5181 / 74.0% | .5183 / 73.7% | 8% |
| NCAAB 2025-26 | .5345 / 73.0% | .5327 / 73.5% | .5283 / 72.1% | .5290 / 72.0% | 2% |

The blend is a weighted average in log-odds (final always lands between the
model's number and the book's), with the weight fit on the tune season.

Book-line columns are scored on the games that had a closing line (all NBA/WNBA;
2,045 of 2,453 MLB; 1,010 of 1,394 NHL; 867 NCAAF; 5,569 NCAAB).

Tested and not used in the pick: NHL goalie save percentage (no gain over the
backup flag), weather (MLB held-out log loss .6833 -> .6839, worse). Weather is
still shown as context.

## Round 3 (1.7.0): devig, consensus, simulation, injuries, props, same-game parlays

    node fetch-lines.mjs nba,wnba,nhl,mlb,nfl,ncaaf,ncaab   # closing ML / spread / total + prices
    node sim.mjs                                            # devig + score simulation
    node box.mjs basketball nba nba; node box.mjs basketball wnba wnba
    node impact.mjs nba                                     # injury value: scoring vs plus-minus
    node corr.mjs                                           # same-game correlations
    node props.mts nba,wnba ; node props.mts nfl            # prop distributions (Node 22.6+, type stripping)

### Removing the book's margin (closing moneylines, log loss on winners)

| sport | games | proportional | Shin (shipped) | power |
|---|---|---|---|---|
| NBA | 2,631 | .58078 | .58035 | .58032 |
| NFL | 568 | .59930 | .59837 | .59795 |
| NCAAF | 902 | .52976 | .52911 | .52946 |
| WNBA | 658 | .59486 | .59614 | .59736 |
| NHL | 2,792 | .66882 | .66883 | .66887 |
| MLB | 4,934 | .67758 | .67765 | .67771 |

Shin wins where favorites are big (NBA, NFL, college football), ties in
NHL/MLB, loses slightly on WNBA's smaller sample; better overall.

Multi-book consensus (Pinnacle/BetOnline/LowVig counted double) can't be
backtested with free historical data (ESPN keeps one book's close); it's
the standard way to reduce single-book noise and is tracked live by the
"line moved our way" (closing-line value) scorecard.

### Score simulation (held-out season)

Measured spread of final margin around the closing spread / total around
the closing total: NBA 13.8 / 17.6, WNBA 13.5 / 16.1, NCAAB 11.2 / 16.9,
NFL 12.2 / 13.0, NCAAF 14.8 / 16.2, NHL 2.7 / 2.3, MLB 4.6 / 4.5. Hockey uses
Poisson goals (negative-binomial size 30 tested best), baseball negative
binomial runs (size 8).

Our scoring-based total vs. the closing total (RMSE, lower is better): NBA
19.8 vs 18.2, WNBA 20.4 vs 18.6, NFL 14.0 vs 13.2, NCAAF 16.5 vs 14.7, NHL 2.41
vs 2.31, MLB 4.73 vs 4.43. Shifting the book's over price toward our total
helped only the NFL (285 games, .6919 -> .6901), so the simulation anchors
totals to the book's price everywhere.

### NBA/WNBA injuries: scoring vs. plus-minus impact

Fit 2024-25, tested 2025-26 (NBA 1,312 games): form only .6103 / 67.0%;
+ missing regulars valued by points per game above 8: .6041; + a shrunk
plus-minus impact rating instead: .6102; both: .6042. Plus-minus added
nothing, so scoring stays the measure — but the fitted weight is a third of
what the app used (teammates absorb most of a missing scorer's points):
NBA 0.037 log-odds per point (was 0.115), WNBA 0.073 (2026, 335 games:
.6016 -> .5970).

### Props: distributions, shrinkage, minutes

Every player-game replayed with only earlier games; lines at the old
projection and ±0.5/1 SD. Log loss old -> new, and the new model's 70%+
picks predicted / actual:

| stat | old | new | 70%+ pred / actual | model |
|---|---|---|---|---|
| NBA Points | .5963 | .5752 | 80.8 / 80.5 | neg. binomial, per-minute, shrink 40, temper .8 |
| NBA Rebounds | .5799 | .5517 | 82.6 / 81.7 | Poisson, per-minute, shrink 40, temper .8 |
| NBA Assists | .5899 | .5621 | 81.4 / 81.6 | Poisson, per-minute, shrink 40, temper .8 |
| NBA Threes | .6084 | .5754 | 81.1 / 80.2 | Poisson, per-minute, shrink 40, temper .88 |
| NBA Steals | .6287 | .5957 | 80.2 / 79.9 | Poisson, per-minute, shrink 40, temper .88 |
| NBA Blocks | .6292 | .5950 | 80.7 / 80.0 | same |
| NBA Turnovers | .6130 | .5750 | 80.5 / 81.1 | same |
| NFL Pass Yds | .6120 | .6019 | 77.7 / 78.8 | bell curve, shrink 5, temper .94 |
| NFL Rush Yds | .6126 | .6091 | 77.2 / 78.1 | bell curve, shrink 5, temper .94 |
| NFL Rec Yds | .6184 | .6102 | 76.7 / 77.7 | bell curve, shrink 5 |
| NFL Receptions | .6022 | .5819 | 80.7 / 79.7 | Poisson, shrink 5, temper .88 |

WNBA matched NBA within a few thousandths. Hockey/baseball/college props are
checked live with /api/health/insights?propcal=<sport> (lib/prop-calibration.ts).

### Same-game correlations (lib/sgp.ts)

Measured, e.g. NFL QB pass yds ~ his top receivers' rec yds .41, QB pass
TDs ~ game over .49, RB rush yds ~ his team covering .28, two receivers on
one team ~0; NBA points ~ threes .65, points ~ rebounds .25, teammates'
points ~0, points ~ game over .17. Spread vs. total of the same game ~0.

Live check on the app's own database (/api/health/insights?propcal=<sport>),
old -> new log loss: NHL Points .621 -> .590, Assists .640 -> .609, Shots
.595 -> .563, Saves .594 -> .554; MLB Hits .629 -> .596, Batter K .629 -> .594,
Pitcher K .572 -> .550, Hits Allowed .581 -> .563, Walks .643 -> .605, Walks
Allowed .599 -> .576, Runs .638 -> .607, Earned Runs .609 -> .592; NCAAF Rec
Yds .612 -> .603, Rush Yds .619 -> .612, Receptions .583 -> .567; NBA P+R+A
.581 -> .565. Home runs, RBIs and NHL goals had too few lines and keep the
old model.
