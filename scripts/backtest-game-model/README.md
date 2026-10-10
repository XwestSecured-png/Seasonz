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
