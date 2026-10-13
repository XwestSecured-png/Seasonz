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
