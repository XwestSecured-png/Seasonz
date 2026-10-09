# NBA stat-factor backtest (Oct 2026)

Data: ESPN game summaries for every completed 2023-24, 2024-25 and 2025-26
game (3,944): team box scores, play-by-play offensive fouls, officials.

Method: tuned Elo (lib/sports/sport-elo.ts) gives a log-odds; each candidate
factor is home-minus-away average over the team's last N games this season
(5+ games required). Logistic regression with light L2, fit on 2024-25,
scored on held-out 2025-26 (1,237 games).

| model                         | log loss | Brier | picked winner |
|-------------------------------|----------|-------|---------------|
| Elo only                      | .5985    | .2059 | 68.5%         |
| + margin & paint, last 20     | .5956    | .2044 | 69.3%         |

No gain (or worse) on held-out games: rebounds, turnovers, total fouls,
offensive fouls, FTA, threes, mid-range makes, head-to-head, referee crew
home-win rate. Window sizes 5/10/15/30 were also tried; 20 was best.

Weights live in lib/sports/nba-model.ts.
