# NFL backtest

    node backtest.mjs   # downloads nflverse games.csv (needs open internet)

Tunes Elo on 2012-2022 and scores 2023-2025 (854 games), plus the closing
moneyline (vig removed) from the same file.

| model | log loss | Brier | picked winner | weeks 1-4 |
|---|---|---|---|---|
| old Elo (reset every season, home +65) | .6477 | .2287 | 60.7% | 50.3% |
| Elo v2 (carryover, regress 50%, home +48) | .6339 | .2219 | 63.9% | 60.2% |
| closing moneyline | .6077 | .2102 | 67.9% | |
| best blend (model weight 0) | .6077 | .2102 | 67.9% | |

The factor nudges (weather, referee, FPI/QBR, NGS, injuries) sit on top of
Elo in the app; they aren't in this file's history, so they're untested here.

## EPA rating (1.7.0)

    node epa.mjs   # nflverse weekly player stats 2012-25 + games.csv

Net EPA (own offensive passing + rushing EPA minus the opponent's, last 10
games, last season at half weight), added on top of Elo v2. Fit 2013-22,
tested 2023-25 (932 games with EPA history):

| model | log loss | picked winner |
|---|---|---|
| Elo v2 | .6343 | 64.1% |
| Elo v2 + EPA (shipped in model-only) | .6334 | 64.8% |
| closing moneyline | .6113 | 67.6% |
| best blend with the line | .6113 | 67.6% (model weight still 0) |

So EPA sharpens the model-only number (and the value edges built on it);
the final number still follows the line.
