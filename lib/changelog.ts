// Seasonz patch notes — shown on the "What's new" page, and as a banner
// for anyone who hasn't seen the newest release yet.
//
// TO SHIP AN UPDATE: add a new release at the TOP of RELEASES with a higher
// version. Write each change for users, not developers:
//   whatChanged — what's different in the app, in one or two sentences
//   whatItMeans — why it matters to the user / how it affects their bets
// Mark admin-only changes with audience: "admin" so regular users don't
// see them.
//
// Client-safe: no server imports.

export type ChangeKind = "new" | "improved" | "fixed";

export interface Change {
  kind: ChangeKind;
  title: string;
  whatChanged: string;
  whatItMeans: string;
  /** Deep link to the part of the app this change is about. */
  href?: string;
  audience?: "everyone" | "admin";
}

export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  summary: string;
  changes: Change[];
}

export const RELEASES: Release[] = [
  {
    version: "1.21.0",
    date: "2026-10-23",
    title: "NFL: when a star is out",
    summary: "NFL teammates' projections now react when a lead back, top target or starting QB is out, and college football props account for road rushing.",
    changes: [
      {
        kind: "improved",
        title: "NFL: lead back, top target or QB out",
        whatChanged:
          "When a team's lead back (40%+ of carries), top target (20%+ of targets) or starting QB is listed Out, his teammates' projections change the same week: the other backs' rushing yards x1.45 and catches x1.3, depth receivers' catches x1.18, the QB's passing yards x0.92 without his top target, and backs' receiving yards x0.88 with a backup QB. Measured on every NFL game 2020-26 (fitted on 2020-23, checked on 2024-26): those props got 4-14% more accurate.",
        whatItMeans: "The backup running back's Over shows up the week the starter is ruled out, not two weeks later. The trust details say who's out.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "College football: road rushing",
        whatChanged: "Now that last season's college box scores are in, the home/road check ran for college: rushing on the road comes in about 7% lower, and catches were projected 5% low everywhere. Both are now built in.",
        whatItMeans: "Fewer road rushing Overs in college.",
        href: "/props?sport=ncaaf",
      },
      {
        kind: "fixed",
        title: "Test suite",
        whatChanged: "An outdated check of the default model share was updated; every model check passes.",
        whatItMeans: "Nothing visible.",
      },
    ],
  },
  {
    version: "1.20.0",
    date: "2026-10-23",
    title: "Stars out, alt lines priced right, Over bias by stat",
    summary: "Basketball teammates get a bump when a star is out, alternate-line prices are no longer taken at face value, and the Over bias is now learned stat by stat.",
    changes: [
      {
        kind: "improved",
        title: "Basketball: when a star is out",
        whatChanged:
          "When one of a team's top-2 scorers is listed Out, his teammates' projections go up: bench players at his position about 18%, other bench players 8-12%, starters about 5% on points and combos. Measured on every NBA box score of last season and both WNBA seasons; those games' props got 3-8% more accurate.",
        whatItMeans: "Earlier, better Overs on role players about to see more shots. The trust details say 'more shots with … out'.",
        href: "/props?sport=nba",
      },
      {
        kind: "fixed",
        title: "Alternate lines (one-sided prices)",
        whatChanged:
          "When a book posts only one side of a line (alt ladders like '25+ points'), the app used that price minus 4.5% as the market's chance. Graded lines showed those prices are far richer than that: NBA Overs priced around 15% hit 9%, around 6% hit 1%. The market chance for those lines now takes the right-sized cut (fitted on two weeks of graded lines, checked on the half it wasn't fitted on: 4-6% more accurate in the NBA, NHL and college football) and keeps re-fitting it nightly.",
        whatItMeans: "Far fewer long-shot alt-line Overs that look like value but aren't.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "Over bias learned per stat",
        whatChanged:
          "The market's Over bias isn't the same for every stat: NBA rebound and NHL shot Overs hit about as often as priced, while points, threes, assists and combos hit well below. Each stat now gets its own correction, pulled toward its sport's until it has enough graded lines.",
        whatItMeans: "Rebound and shot Overs aren't trimmed for a bias they don't have.",
      },
      {
        kind: "improved",
        title: "Tested and not used",
        whatChanged: "Opponent defense by position (what a team allows to guards vs centers) didn't beat the opponent adjustment the app already uses, and hockey showed no 'star out' effect on teammates.",
        whatItMeans: "Nothing changes there.",
      },
    ],
  },
  {
    version: "1.19.1",
    date: "2026-10-23",
    title: "Grading and college data fixes",
    summary: "Fixes picks stuck as pending after postponed games, speeds up grading of the line archive, and fills in last season's college box scores.",
    changes: [
      {
        kind: "fixed",
        title: "Picks stuck on pending",
        whatChanged:
          "A pick on a game that was postponed, moved to a new game, or never got a box score stayed pending forever (21 MLB playoff picks from Oct 17-21 were stuck). Those are now voided 4 days after the game date. Makeup games and doubleheaders now grade against the game that was actually played.",
        whatItMeans: "Results and hit rates no longer carry phantom pending picks.",
        href: "/results",
      },
      {
        kind: "fixed",
        title: "Line archive grading",
        whatChanged:
          "The nightly grader picked 20,000 waiting lines in no particular order, so with 100,000+ waiting (mostly for games not played yet) it could keep missing lines that were ready. It now grades oldest first, takes twice as many per run, and voids lines whose game never finished.",
        whatItMeans: "The data behind the sharp-book weights and the learned Over bias fills in faster.",
      },
      {
        kind: "fixed",
        title: "College box scores from last season",
        whatChanged:
          "College football and college basketball only ever saved this season's box scores, though the props model is built to use this season plus last season. College projections were running on 8 games at most. Last season's games now backfill (newest first, 900 a night).",
        whatItMeans: "Steadier college football props within a few days, and college basketball props have a track record when its season starts.",
        href: "/props?sport=ncaaf",
      },
      {
        kind: "fixed",
        title: "Smaller fixes",
        whatChanged:
          "The box-score stage reported 1,299 college games as 'queued' when they were games ESPN has no box score for. A menu could flash its old position when reopened. A backtest script printed an outdated referee cap.",
        whatItMeans: "Cleaner sync reports and a steadier menu.",
      },
    ],
  },
  {
    version: "1.19.0",
    date: "2026-10-22",
    title: "Minutes first, sharper market, and a model that learns",
    summary: "Basketball props now start from expected minutes, the market number leans on the sharpest books, and the app re-learns the market's Over bias and how hard to lean on its own adjustments every day.",
    changes: [
      {
        kind: "improved",
        title: "Basketball: minutes first",
        whatChanged:
          "Every NBA and WNBA prop (including Pts+Reb+Ast and the other combos) is now per-minute production times expected minutes, and expected minutes blend the last 5 games with the last 20 instead of the last 5 alone. One short or long night no longer swings a player's whole projection. Checked on every box score of the last two seasons: points 0.3-0.5% more accurate, rebounds 0.6-0.8%.",
        whatItMeans: "Steadier projections after blowouts, foul trouble or a single big-minutes game.",
        href: "/props?sport=nba",
      },
      {
        kind: "improved",
        title: "The sharpest books count more",
        whatChanged:
          "We graded every prop line from the past week, book by book, on the same props. Prediction markets and exchanges (Kalshi, Polymarket, Novig, ProphetX) and Pinnacle were the most accurate, so they now count 2-3x in the market's number. That made the market number 0.3-0.5% more accurate in the NBA and NHL.",
        whatItMeans: "The 'market' half of every prop chance is a better starting point.",
        href: "/props",
      },
      {
        kind: "new",
        title: "Learns the Over bias and line moves every day",
        whatChanged:
          "Bettors like Overs, so books shade them: last week NBA Overs priced at 47% hit 45%. Every night the app now re-fits that bias per sport from its own graded line archive and moves it in gradually. It also tracks whether props that moved between open and close keep moving; the first week was mixed, so that part waits for more data (1,500 graded player-games) before it's used.",
        whatItMeans: "Slightly more Unders where the market overprices Overs, and the correction grows or shrinks with the evidence.",
        href: "/props",
      },
      {
        kind: "new",
        title: "Learns how hard to lean on its own adjustments",
        whatChanged:
          "Every pick now logs its chance with and without the matchup, game-day, efficiency and streak adjustments. Once 100+ player-games are graded, the app fits how strongly those adjustments should count (softer or stronger) per sport and keeps re-fitting it nightly.",
        whatItMeans: "If the adjustments over- or under-react in real results, the model corrects itself.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "Tested and not used",
        whatChanged:
          "The game's over/under (pace) as a player-prop factor didn't hold up across both seasons in the NBA, WNBA or NHL, and hockey ice time didn't beat the current per-game projection. College football didn't have enough box scores per player to test the newest factors yet.",
        whatItMeans: "Nothing changes there until the data supports it.",
      },
    ],
  },
  {
    version: "1.18.0",
    date: "2026-10-22",
    title: "Efficiency, streaks and opponent mistakes",
    summary: "Props now account for players running hot or cold on efficiency, streaks that tend to even out, and opponents who rarely make mistakes. Same-game parlays run up to 500,000 simulations.",
    changes: [
      {
        kind: "improved",
        title: "NFL: yards per carry, per target, per play and after contact",
        whatChanged:
          "A player's yards are volume times efficiency, and efficiency swings a lot. A back averaging well above the league in yards per carry or yards after contact, a receiver with a high catch rate or yards per target, or a QB on a hot offense (yards per play) usually comes back toward normal while his volume holds. Projections now lean that way. Tested on 2020-23 and checked on 2024-26: 0.4-0.9% more accurate.",
        whatItMeans: "Fewer Overs on players riding an unsustainable efficiency run, more on volume players who've been unlucky. The trust details say 'Running hot/cold on efficiency' with the numbers.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "Hot and cold streaks",
        whatChanged:
          "After 3 big games, the next one tends to come in lower than the projection said, and after 3 quiet ones, higher. Projections now correct for that in the NFL (passing and receiving), NBA, WNBA, NHL and MLB (hits, batter strikeouts, earned runs), at strengths measured on two seasons.",
        whatItMeans: "Less chasing of the hot hand. The trust details say 'Hot streak' or 'Cold streak' when it applies.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "Basketball: opponents who rarely turn it over",
        whatChanged: "Steals, blocks, threes, assists and points are trimmed a little against teams that rarely turn the ball over (and raised against sloppy ones), based on each opponent's last 10 games.",
        whatItMeans: "Better steals and points lines against careful teams.",
        href: "/props?sport=nba",
      },
      {
        kind: "improved",
        title: "More same-game parlay simulations",
        whatChanged: "Same-game parlays now simulate at least 100,000 games and keep going until the answer is precise to within 0.5% of itself (up to 500,000). Before it was a flat 40,000, which left long parlays with a few percent of noise. The slip shows how many games were simulated.",
        whatItMeans: "Steadier same-game parlay chances, especially for 4+ legs.",
        href: "/parlays",
      },
      {
        kind: "improved",
        title: "What we tested and didn't use",
        whatChanged:
          "\"Clutch\" records and mental toughness: teams and players who did well in close games did NOT keep doing so. Their next close games were average or worse, in every sport, so a close-game record is luck, not a trait. Bouncing back after a loss, a blowout, or a bad game: no reliable effect. Human errors: NFL turnovers and penalties were already in the game model; opponent missed tackles, yards after catch, basketball fouls, and hockey giveaways and penalty minutes added nothing on top of what's already there.",
        whatItMeans: "The model ignores these on purpose, because the data says they don't predict the next game.",
      },
    ],
  },
  {
    version: "1.17.1",
    date: "2026-10-20",
    title: "Home, road and back-to-backs",
    summary: "Props now account for where the game is and how tired the team is, but only where the numbers held up over two seasons.",
    changes: [
      {
        kind: "improved",
        title: "NHL: back-to-backs and the road",
        whatChanged:
          "On the second night of a back-to-back, shots on goal are projected 6% lower and points and assists 8% lower. On the road, shots are 5% lower. At home, goals are 5% higher and goalie saves 3% lower, because home goalies face fewer shots. Each held up on last season and this one (up to 2% more accurate).",
        whatItMeans: "Fewer Overs on tired skaters. The trust details say 'second night of a back-to-back' or 'on the road' when it applies.",
        href: "/props?sport=nhl",
      },
      {
        kind: "improved",
        title: "WNBA road games and NFL yardage levels",
        whatChanged:
          "WNBA points are projected 5% lower on the road, and rebounds 3% lower. NFL yardage and receptions projections were running slightly high across two seasons, so they've been brought down 2-5%.",
        whatItMeans: "Slightly fewer Overs in these spots. NBA, MLB and college showed no reliable home/away or rest effect, so nothing changed there.",
        href: "/props",
      },
    ],
  },
  {
    version: "1.17.0",
    date: "2026-10-19",
    title: "Smarter game-day props in every sport",
    summary: "Props now react to who's starting, who's pitching, the ballpark, the wind and the opponent. The app also keeps every line it sees and tunes itself stat by stat.",
    changes: [
      {
        kind: "improved",
        title: "Basketball: backups stepping into the lineup",
        whatChanged:
          "When a usual starter is listed Out, the bench player at his position who's been getting the most minutes moves into his spot, and his projection goes up 8-15%. Checked on two seasons of NBA and WNBA games: those players beat their usual numbers by about 20%. This made combo props (Pts+Reb+Ast) 4-6% more accurate.",
        whatItMeans: "Fewer Unders on players about to play big minutes. The trust details show 'stepping in for…' when it applies.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "MLB: the opposing pitcher and the ballpark",
        whatChanged:
          "Batter props now account for the opposing probable starter's strikeout and hit rates over his last 15 starts, and for the ballpark (hits, home runs, RBIs and runs at that park vs the league).",
        whatItMeans: "A batter facing an ace in a pitcher-friendly park is projected lower, and vice versa.",
        href: "/props?sport=mlb",
      },
      {
        kind: "improved",
        title: "NHL goalie saves, NFL wind, college rushing",
        whatChanged:
          "Goalie saves props now project from the goalie's starts only; relief outings were dragging the average down (2-3% more accurate). NFL passing and receiving yards are trimmed 1.5% per mph of forecast wind above 10 mph at outdoor stadiums. College rushing yards now account for opponent strength.",
        whatItMeans: "More realistic numbers in the spots where game conditions matter most.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "Same-game parlays for hockey and baseball",
        whatChanged:
          "The parlay builder's same-game math now uses measured links for NHL and MLB, from about 6,000 games: a hitter's home run and RBIs (0.61), points and assists (0.78), a pitcher's hits and earned runs allowed (0.65), a batter vs the opposing pitcher, and so on.",
        whatItMeans: "Same-game parlay chances in hockey and baseball are no longer treated as independent, so they're more honest.",
        href: "/parlays",
      },
      {
        kind: "new",
        title: "Every line saved, plus stat-by-stat self-tuning",
        whatChanged:
          "The app now keeps every prop and game line it sees, with its opening and closing price, and grades each one after the game. The model's share in each prop now tunes itself per stat, not just per sport, and trust scores correct themselves from graded results.",
        whatItMeans: "The model keeps learning where it beats the books and where it doesn't, stat by stat.",
        audience: "admin",
      },
      {
        kind: "improved",
        title: "Tested and not used",
        whatChanged:
          "We also tested MLB batting-order position, blowout risk in basketball, NFL target share and air yards, and opponent strength for college passing and receiving. None improved accuracy, so they aren't used.",
        whatItMeans: "Only changes that tested better made it in.",
        audience: "admin",
      },
    ],
  },
  {
    version: "1.16.0",
    date: "2026-10-19",
    title: "Anytime TD parlays and stat picking",
    summary: "Auto Parlays can now be built from one stat, including an Anytime TD parlay priced at real sportsbook odds.",
    changes: [
      {
        kind: "new",
        title: "Anytime TD parlay",
        whatChanged:
          "Auto Parlays' player props section has an Anytime TD option. It builds 2- to 8-leg touchdown parlays, one player per team, from players with a 20%+ chance to score (30%+ preferred). Each leg's chance blends the TD model with the real sportsbooks' price, and the payout uses the best real price available.",
        whatItMeans: "Touchdown scorers used to be left out because they rarely clear 52%. Now you get a real TD parlay with honest odds.",
        href: "/parlays",
      },
      {
        kind: "new",
        title: "Pick the stat for a props parlay",
        whatChanged:
          "Choose 'All stats' or one stat (Rec Yds, Points, Shots on Goal...) and the props parlay is built from that stat only. It works with the Build by menu (most confident, highest chance, best payout).",
        whatItMeans: "Build the parlay you'd actually bet, like an all-receiving-yards parlay, without picking legs by hand.",
        href: "/parlays",
      },
    ],
  },
  {
    version: "1.15.1",
    date: "2026-10-18",
    title: "Sort Best Bets, build parlays your way, sharper combo props",
    summary: "Best Bets has a Sort by row, Auto Parlays can be built by confidence, chance or payout, and several props got better-fitting models.",
    changes: [
      {
        kind: "new",
        title: "Sort Best Bets",
        whatChanged:
          "Best Bets now has a 'Sort by' row: biggest edge (the default), most confident, highest chance, best payout, or starting soonest. Game bets now show a trust badge too.",
        whatItMeans: "Sort by what matters to you: the biggest edge, the safest bet, or what's starting next.",
        href: "/best-bets",
      },
      {
        kind: "new",
        title: "Build Auto Parlays your way",
        whatChanged:
          "Auto Parlays have a 'Build by' menu. 'Most confident' (the default) picks the legs with the strongest trust scores. 'Highest chance' picks the likeliest legs, and 'Best payout' picks the best-paying legs that still clear the model's bar.",
        whatItMeans: "Choose between a safer parlay and a bigger payout without building it by hand.",
        href: "/parlays",
      },
      {
        kind: "improved",
        title: "Better models for combo and pitcher props",
        whatChanged:
          "We re-checked every prop stat in every sport against more model settings. NBA and WNBA combos (Pts+Reb+Ast, Pts+Reb, Reb+Ast), WNBA points, and MLB earned runs and hits allowed switched to settings that tested more accurate. We also tested using the betting market's team point totals in NFL yardage props. It didn't improve accuracy, so it isn't used.",
        whatItMeans: "Slightly more accurate chances on those props. Everything else was already at its best-tested settings.",
        href: "/props",
      },
    ],
  },
  {
    version: "1.15.0",
    date: "2026-10-18",
    title: "Sort props by confidence",
    summary: "Every prop list now has a Sort by menu, and starts with the props we're most confident in.",
    changes: [
      {
        kind: "new",
        title: "Sort by confidence, chance, payout or team",
        whatChanged:
          "The Props page's model picks (every sport) and the every-line list now have a 'Sort by' menu. 'Most confident' is the default: High trust first, then Medium, then Low, and within each, the props that have hit most often in our backtests. You can also sort by highest chance, best payout, or by team.",
        whatItMeans: "The props worth looking at first are now at the top instead of scattered by team.",
        href: "/props",
      },
    ],
  },
  {
    version: "1.14.1",
    date: "2026-10-17",
    title: "Sharper home run, RBI and goal props, plus returns in basketball and hockey",
    summary: "Home run, RBI and NHL goal props get a new model, and NBA, WNBA, college basketball and NHL props now account for key players back from injury.",
    changes: [
      {
        kind: "improved",
        title: "New model for home runs, RBIs and NHL goals",
        whatChanged:
          "These three props were still on our original bell-curve model, which overrated '1+' on rare events: chances shown as about 80% hit about 92%. They now use a count model built for rare events, checked on every batter and skater with 10+ games. Accuracy improved 28% for home runs, 14% for RBIs and 20% for goals, and shown chances now match how often they hit.",
        whatItMeans: "Home run, RBI and anytime goal chances are realistic now instead of too pessimistic.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "Basketball and hockey props account for returns",
        whatChanged:
          "When a key player comes back from injury, his first game is trimmed 5-10% (players usually start slow). In basketball, teammates at his position are trimmed about 10%, since the minutes and shots they picked up while he was out go back to him. These sizes come from checking two seasons of box scores against ordinary games.",
        whatItMeans: "Fewer Overs on players about to lose their bigger role, and on stars easing back in.",
        href: "/props",
      },
    ],
  },
  {
    version: "1.14.0",
    date: "2026-10-17",
    title: "Back-from-injury alerts",
    summary: "Get an alert when a key player comes back from injury, and NFL props now account for a player's first game back.",
    changes: [
      {
        kind: "new",
        title: "Alert when a key player returns",
        whatChanged:
          "When a key player (a top scorer, a starting QB, a starting goalie or pitcher) has missed games while listed Out and comes off the Out list, you get a push alert before his team's next game. Alerts cover the sports you've picked or bet in the last 30 days. You can turn them off under Alerts ('Key players back from injury').",
        whatItMeans: "Lines often move when a star returns. You'll hear about it before the game, not after.",
        href: "/injury-impact",
      },
      {
        kind: "new",
        title: "Back from injury list",
        whatChanged: "The Injury Impact page now lists every key player back from injury in the last 7 days, across all sports.",
        whatItMeans: "One place to check who's returning this week.",
        href: "/injury-impact",
      },
      {
        kind: "improved",
        title: "NFL props account for a player's return",
        whatChanged:
          "In his first game back, a returning player's projection is trimmed 10-15% (players usually start slow), and same-position teammates are trimmed up to 15%, since the bigger role they had while he was out is going away. Tested on 2020-23 NFL seasons and checked on 2024-25: more accurate for every yardage and catch stat.",
        whatItMeans: "Fewer Overs on players about to lose targets or carries, and on stars easing back in.",
        href: "/props",
      },
    ],
  },
  {
    version: "1.13.0",
    date: "2026-10-17",
    title: "More honest prop chances in every sport",
    summary: "Prop chances now lean more on the betting market and less on our model, after our graded picks showed the model was too sure of itself.",
    changes: [
      {
        kind: "improved",
        title: "Prop chances lean more on the market",
        whatChanged:
          "We graded every prop pick the app has listed so far. Picks we rated about 84% hit about 72%. The biggest misses came when our model disagreed sharply with the sportsbooks, which usually means the books knew something (a role change, an injury) that past box scores don't show. Each sport's prop chance now gives the model a 15-30% say instead of 50%, and that share keeps re-tuning itself from graded picks.",
        whatItMeans:
          "Fewer 'very likely' props that miss. The chances and verdicts you see should match how often props actually hit, in every sport.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "Better spread for yardage props",
        whatChanged:
          "Passing, rushing, receiving and rush + rec yardage props now measure how much a player's numbers swing over the last 20 games, not just the last 5. Tested on NFL games from 2022 to now, this improved accuracy on every NFL yardage stat. College football tested better without it, so college props keep the old method.",
        whatItMeans: "Long-shot and near-lock yardage chances are more realistic.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "Auto-tuning learns sooner and fairer",
        whatChanged:
          "When one player's prop is listed at several alternate lines, those lines now count as one result when the app re-tunes itself. Tuning starts after 40 graded player-games instead of 300, and it moves gradually.",
        whatItMeans: "The model corrects itself within weeks, and one odd game can't swing it.",
        audience: "admin",
      },
    ],
  },
  {
    version: "1.12.2",
    date: "2026-10-16",
    title: "More menu fits your phone",
    summary: "The More menu now fits the screen and scrolls, instead of running off the top.",
    changes: [
      {
        kind: "fixed",
        title: "More menu fits the screen",
        whatChanged:
          "The More menu had grown taller than most phone screens (about 1,200 pixels with all the new pages), so its top, including the close button, ran off the screen and it couldn't scroll. It's now capped at the screen height with the title and close button pinned, the list scrolls inside it, pages show in two columns, and the page behind it no longer scrolls while it's open.",
        whatItMeans: "Every link and setting in More is reachable on any phone, from the smallest iPhone SE up.",
      },
    ],
  },
  {
    version: "1.12.1",
    date: "2026-10-15",
    title: "Fits every screen",
    summary: "Seasonz now fits phones, tablets and laptops without sideways scrolling or zooming.",
    changes: [
      {
        kind: "fixed",
        title: "Fits tablets and laptops",
        whatChanged:
          "The page list at the top was wider than most screens (about 1,800 pixels), which pushed every page wider than the screen on tablets and laptops. It's now its own row that scrolls sideways, with the page you're on kept in view.",
        whatItMeans: "No more sideways scrolling or a zoomed-out page on an iPad or laptop.",
      },
      {
        kind: "fixed",
        title: "Fits phones",
        whatChanged:
          "Prop rows, the bet tracker, the bankroll box and the Make your own pick form no longer run off the side of small phones. Tapping a box no longer zooms the page in on iPhone.",
        whatItMeans: "Every page stays the width of your screen. Checked on 24 pages at 10 screen sizes, from a small phone to a wide laptop.",
      },
    ],
  },
  {
    version: "1.12.0",
    date: "2026-10-15",
    title: "Role changes in NFL props",
    summary: "NFL prop projections now react to a player's snap share trend, the clearest sign of a coach changing his role.",
    changes: [
      {
        kind: "improved",
        title: "Snap share trend",
        whatChanged:
          "When a player's share of offensive snaps over his last 2 games is up or down from his recent norm, his NFL yardage and receptions projections move with it, and the trust badge says so.",
        whatItMeans:
          "Role changes from the coaching staff (or a teammate's injury) show up a week or two before the stat averages catch up. In testing on 2025-26 games it improved every NFL prop stat.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "Tested and left out",
        whatChanged:
          "We also tested recent target/carry trends, team pass-rate trends, a teammate-out boost and players in the last year of their contracts. None made predictions better, so none were added.",
        whatItMeans: "Only signals that actually help go into the model.",
        href: "/props",
      },
    ],
  },
  {
    version: "1.11.2",
    date: "2026-10-14",
    title: "Sharper prop projections, faster syncs",
    summary: "Smarter opponent adjustments for NFL props, Rush + Rec yards in Make your own pick, a TD Props fix and faster syncs.",
    changes: [
      {
        kind: "improved",
        title: "Smarter opponent adjustments",
        whatChanged:
          "How much a defense moves an NFL prop projection was re-tested stat by stat. Pass yards keep the full adjustment, receiving stats use a narrower range, rushing yards drop it (it didn't help), and a defense with only a few games counts less.",
        whatItMeans: "Every NFL yardage and receptions projection scored better in testing on 2025-26 games, passing yards the most.",
        href: "/props",
      },
      {
        kind: "new",
        title: "Rush + Rec yards in Make your own pick",
        whatChanged: "College football's Make your own pick has Rush + Rec yards, with the posted line, and grades itself after the game.",
        whatItMeans: "You can track the combo props you play.",
        href: "/props",
      },
      {
        kind: "fixed",
        title: "TD Props and model-only props were being wiped",
        whatChanged:
          "The NFL props sync was deleting the model's own anytime-TD, turnover and defensive props right after writing them, so TD Props and those parlay legs came up empty. Fixed.",
        whatItMeans: "TD Props, turnover props and those parlay legs show again.",
        href: "/td-props",
      },
      {
        kind: "improved",
        title: "Faster syncs",
        whatChanged: "Schedules, prop picks and the prop log now save in batches instead of one row at a time.",
        whatItMeans: "Fresher numbers sooner, and less risk of a sync timing out.",
        audience: "admin",
      },
    ],
  },
  {
    version: "1.11.1",
    date: "2026-10-14",
    title: "Rushing + receiving yards props",
    summary: "The prop model now covers rushing + receiving yards combo props, NFL and college.",
    changes: [
      {
        kind: "new",
        title: "Rush + Rec Yds props",
        whatChanged:
          "The model now projects combined rushing + receiving yards, so those lines get a chance, a plain-English verdict, a trust badge and can be model picks, parlay legs and Best Bets. Logged bets on them grade themselves.",
        whatItMeans:
          "Tested on 2024-26 games before going live: when the model said 70%+, it said about 83% on average and those picks hit 83%.",
        href: "/props",
      },
    ],
  },
  {
    version: "1.11.0",
    date: "2026-10-14",
    title: "Every prop, spelled out",
    summary: "Every posted prop line now shows our chance it hits in plain words, from \"almost no chance\" to \"very, very likely\", with a trust badge.",
    changes: [
      {
        kind: "new",
        title: "Our chance on every prop line",
        whatChanged:
          "\"Every prop this week\" now scores every line the books posted, not just the model's picks: the chance it hits, a plain-English verdict, the projection, and a trust badge on the likely side. Every sport now has this list, not just football.",
        whatItMeans: "You can check any prop you're eyeing, not only the ones the model picked.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "Chances in plain words",
        whatChanged:
          "Props, model picks, parlay legs, Best Bets and TD props spell out each chance: Very, very likely (90%+), Very likely (80%+), Likely (70%+), Leans toward hitting (58%+), Toss-up, Leans toward missing, Unlikely (under 30%), Very unlikely (under 20%) and Almost no chance (10% or less).",
        whatItMeans: "No need to translate percentages: you can see at a glance how a prop is likely to go.",
        href: "/props",
      },
    ],
  },
  {
    version: "1.10.1",
    date: "2026-10-14",
    title: "More honest prop chances",
    summary: "Prop chances now use last season's games, ignore pick'em apps' fake prices, and blend in the betting market.",
    changes: [
      {
        kind: "fixed",
        title: "Early-season props were overconfident",
        whatChanged:
          "Projections now include last season's games, not just this season's handful. In testing on games 4-8 of past seasons, 70%+ receiving-yards picks said 75% but hit 66%; with last season included they said 73% and hit 73%.",
        whatItMeans: "Fewer props that look great on a few games of data and then miss.",
        href: "/props",
      },
      {
        kind: "fixed",
        title: "Pick'em apps no longer count as prices",
        whatChanged:
          "PrizePicks, DraftKings Pick6, Underdog and similar apps list lines at even money that aren't real odds. They're no longer used as a pick's price or to judge an edge.",
        whatItMeans: "Edges shown are against prices you can actually bet.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "Prop chances blend in the betting market",
        whatChanged:
          "A prop's chance is now the model blended 50/50 with the market's own chance for that line. Every listed prop is logged and graded, and the mix re-tunes itself once 300+ have results.",
        whatItMeans:
          "When the model is far from the books it's usually missing news (a role change, an injury), so you'll see fewer but more believable 70%+ props. The Results page shows how they do.",
        href: "/results",
      },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-10-14",
    title: "Trust scores on props and parlays",
    summary: "Every prop pick and every model parlay leg now has a High / Medium / Low trust badge, and each parlay gets an overall rating.",
    changes: [
      {
        kind: "new",
        title: "Trust badge on every prop",
        whatChanged:
          "Props, Best Bets and parlay legs show High, Medium or Low trust. It weighs games of data, how often the player cleared that exact line lately, how up-and-down the stat is, and steady minutes. Tap a badge to see why.",
        whatItMeans:
          "Every pick is already 70%+, so trust separates them: in testing on past games, High-trust picks hit about 85-88%, Medium about 75%, Low about 70%.",
        href: "/props",
      },
      {
        kind: "new",
        title: "Overall parlay trust",
        whatChanged:
          "Each model parlay gets an overall trust that's only as good as its weakest leg. Long parlays (5+ legs) or ones under a 30% combined chance can't be High.",
        whatItMeans: "One shaky leg is easy to spot, so you can swap it before you bet.",
        href: "/parlays",
      },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-10-14",
    title: "Results, best bets, alerts and a smarter TD model",
    summary:
      "See how the model has really done, find the day's best edges at the best price, log bets in one tap, get alerts, and see every touchdown, interception and fumble.",
    changes: [
      {
        kind: "new",
        title: "Results page",
        whatChanged:
          "A report card for every sport: the live record (numbers locked before kickoff), a bigger rebuilt record, calibration, how the model did against the book favorite, and how often the line moved our way.",
        whatItMeans: "You can judge the model on its real track record before trusting a pick.",
        href: "/results",
      },
      {
        kind: "new",
        title: "Best Bets",
        whatChanged:
          "One feed of the strongest edges across every sport, game lines and props, with the best price and which book has it.",
        whatItMeans: "Less hunting: the biggest gaps between our number and the price are in one place, ready to log.",
        href: "/best-bets",
      },
      {
        kind: "new",
        title: "One-tap bet logging with closing-line value",
        whatChanged:
          "A Log bet button on game cards, Best Bets and parlays. Game and prop bets grade themselves; the Bet Tracker now shows ROI and whether you beat the closing line, by sport.",
        whatItMeans: "Beating the closing line is the best early sign you're betting well, even before results catch up.",
        href: "/bet-tracker",
      },
      {
        kind: "new",
        title: "Push alerts",
        whatChanged:
          "Turn on alerts in My Picks for games about to lock that you haven't picked, the day's best edges, and big line moves on your picks and bets.",
        whatItMeans: "You won't miss a pick or a line move. On iPhone, add Seasonz to your Home Screen first.",
        href: "/my-picks",
      },
      {
        kind: "new",
        title: "TDs & Turnovers",
        whatChanged:
          "Every touchdown, interception and fumble by player and week, with filters by team and position, plus a ranked list of who's most likely to score next week.",
        whatItMeans: "Quick reference for anytime-TD bets and turnover props.",
        href: "/touchdowns",
      },
      {
        kind: "improved",
        title: "Better anytime-TD predictions",
        whatChanged:
          "The touchdown model now starts from each player's carries and targets (recent games count more), a touchdown rate pulled toward his position's average, and how many points his team is expected to score from the spread and total. Players on a bye are left out.",
        whatItMeans:
          "Tested on past games it picked scorers much better than the old touchdowns-per-game average (log loss 0.46 vs 0.74), so TD Props and TD parlays are built on sharper numbers.",
        href: "/touchdowns",
      },
      {
        kind: "improved",
        title: "Model vs line weights re-test themselves",
        whatChanged:
          "How much each sport's final number trusts the model versus the betting line is re-tested daily on live graded games, and only changes once a sport has 300+ games and the change clearly helps.",
        whatItMeans: "The blend keeps improving from real results, without one odd week swinging it.",
        href: "/results",
      },
      {
        kind: "new",
        title: "Sync health checks",
        whatChanged:
          "Hourly checks for stale syncs, failed stages, odds that didn't match, games missing lines and games stuck live, shown on the admin page and pushed to admins.",
        whatItMeans: "Problems get caught and fixed before they reach your picks.",
        href: "/admin",
        audience: "admin",
      },
    ],
  },
  {
    version: "1.8.1",
    date: "2026-10-14",
    title: "Your record vs the model",
    summary: "My Picks has a Record tab: your full pick history, graded side by side with the model.",
    changes: [
      {
        kind: "new",
        title: "Record tab in My Picks",
        whatChanged:
          "Your all-time record next to the model's on the same games, how you do when you agree vs go against the model, how both do by model confidence, by sport and month by month, plus streaks and your prop record.",
        whatItMeans:
          "See where your instincts beat the model and where they don't. Every graded pick is kept, every season (preseason left out), and the sport and pick-type filters work here too.",
        href: "/my-picks",
      },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-10-13",
    title: "My Picks: all your picks in one place",
    summary: "A new My Picks tab collects every pick you've made, for every sport, in one list.",
    changes: [
      {
        kind: "new",
        title: "My Picks tab",
        whatChanged:
          "Your NFL picks, game picks for every other sport and your player-prop picks now live together on one page, split into Upcoming and Results, with a sport filter and your overall record.",
        whatItMeans:
          "No more jumping between sport pages to see what you've picked. Each result shows the final score and whether the model agreed with you, and tapping a pick takes you to its game.",
        href: "/my-picks",
      },
    ],
  },
  {
    version: "1.7.1",
    date: "2026-10-13",
    title: "NBA preseason games",
    summary: "NBA preseason games now show up with betting lines and picks, marked Preseason.",
    changes: [
      {
        kind: "new",
        title: "NBA preseason",
        whatChanged:
          "Preseason games are on the NBA page with their lines, a model number and the Why panel, tagged Preseason. Every game on the books' board now matches, including college games with similar school names and playoff games ESPN hadn't filled in yet.",
        whatItMeans:
          "Starters often sit in the preseason and the books know the rotation plans, so the pick follows the betting line. Preseason results don't change team ratings, recent form or the model's record, and there are no preseason player props.",
        href: "/sports/nba",
      },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-10-13",
    title: "Sharper lines, smarter props and same-game parlay odds",
    summary:
      "The model now reads the market from every major book (including sharp ones like Pinnacle), simulates each game's final score, prices player props with better math, and shows how same-game parlay legs move together. Each change was tested on past seasons first.",
    changes: [
      {
        kind: "improved",
        title: "Props: better math for every stat",
        whatChanged:
          "Rebounds, assists, threes, receptions and other count stats now use a counting model instead of a bell curve. Projections lean on a player's longer track record, not just his last 5 games, and basketball projections use his scoring rate per minute times his expected minutes.",
        whatItMeans:
          "In a replay of every NBA, WNBA and NFL game of the last few seasons, prop chances were clearly more accurate for every stat tested. When the model says 80%, those props hit about 80% of the time.",
        href: "/props",
      },
      {
        kind: "new",
        title: "Same-game parlay odds",
        whatChanged:
          "When two or more legs in the parlay builder come from the same game, it shows the real chance all of them hit, using how those stats actually move together (for example, a QB's passing yards and his top receiver's yards).",
        whatItMeans:
          "Legs that tend to hit together are more likely to cash than plain multiplication says, and legs that work against each other are less likely. Books price same-game parlays this way, so you can compare their payout with the real chance.",
        href: "/parlays",
      },
      {
        kind: "improved",
        title: "Every book's line, not just one",
        whatChanged:
          "The betting line the model blends with is now the consensus of FanDuel, BetMGM, DraftKings, Caesars and the sharp books (Pinnacle, BetOnline, LowVig, counted double), with the book's margin removed by a better method (Shin's).",
        whatItMeans:
          "Sharp books set lines for professional bettors, so the consensus is a more accurate starting point. The better margin removal was more accurate on 10,000+ past games, mostly for big favorites and underdogs.",
      },
      {
        kind: "new",
        title: "Projected score, spread and total for every game",
        whatChanged:
          "Each game's Why panel now shows a projected final score, a fair spread, and the chance each side covers the book's spread and goes over the total.",
        whatItMeans:
          "The win chance, spread and total now all come from one consistent picture of the game. Totals follow the book's own price: our own total didn't beat it in testing, so we don't claim an edge there.",
      },
      {
        kind: "improved",
        title: "NFL: team efficiency (EPA) added",
        whatChanged:
          "The NFL model now includes each team's expected points added per play over its last 10 games, on top of its team rating.",
        whatItMeans:
          "On 2023-25 games it picked more winners (64.8% vs 64.1%). The betting line is still the strongest single predictor, so this mainly sharpens the model's own view and its value edges.",
      },
      {
        kind: "improved",
        title: "Basketball injuries weighted from real results",
        whatChanged:
          "Missing players are still valued by their scoring, but NBA absences now move a team's chance about a third as much as before.",
        whatItMeans:
          "Replaying the 2025-26 NBA season showed teammates absorb most of a missing scorer's points, so the old adjustment was too big. A plus-minus rating was also tested and didn't add anything.",
      },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-10-13",
    title: "More accurate NFL picks and honest prop percentages",
    summary:
      "The NFL model now carries team strength over from past seasons and uses the betting line, prop percentages were tested against real results and corrected, and lines and starters refresh before games.",
    changes: [
      {
        kind: "improved",
        title: "NFL picks",
        whatChanged:
          "NFL team ratings now carry over from the last three seasons instead of starting fresh every September, and each pick uses the betting line once it's posted.",
        whatItMeans:
          "Tested on 2023-2025: the model alone went from 60.7% to 63.9% of winners (weeks 1-4: 50% to 60%); with the line, 67.9%.",
        href: "/model-tracker",
      },
      {
        kind: "fixed",
        title: "Prop percentages tested and corrected",
        whatChanged:
          "Replaying last season's games showed props marked \"70%+\" were winning less often than shown (about 71-78% when the app said ~80%). Games where a player recorded zero now count, the spread of outcomes is wider, and a prop is only picked when it also beats the book's price.",
        whatItMeans:
          "The percentages now match how often picks actually hit, and you'll see fewer, better props — no more heavy favorites at prices that lose money.",
        href: "/props",
      },
      {
        kind: "improved",
        title: "Lines for more games",
        whatChanged:
          "College football now gets ESPN's line for FCS games too, and FanDuel/BetMGM lines match neutral-site games listed with home and away swapped.",
        whatItMeans: "More picks use a betting line, which tested as the most accurate input.",
      },
      {
        kind: "new",
        title: "Pre-game refresh and closing-line check",
        whatChanged:
          "Lines, injuries, starting pitchers and goalies refresh at 11am and 5pm ET as well as the 12am and 2pm syncs. The Model Tracker shows how often the line moved toward our side after we disagreed with it.",
        whatItMeans: "Late scratches and line moves are caught before games, and you can see whether the model is ahead of the market long before win-loss records settle.",
        href: "/model-tracker",
      },
      {
        kind: "fixed",
        title: "College player stats",
        whatChanged: "College box scores now keep every stat for a player — a quarterback's rushing yards were being dropped when his passing yards were saved.",
        whatItMeans: "College football props and injury values use complete numbers.",
      },
    ],
  },
  {
    version: "1.5.3",
    date: "2026-10-10",
    title: "Every prop on the Props page",
    summary: "Player Props now has an \"Every prop this week\" browser for the NFL and college football.",
    changes: [
      {
        kind: "new",
        title: "Browse every prop",
        whatChanged:
          "Player Props lists every line FanDuel, DraftKings, BetMGM and Caesars posted, sorted into Touchdowns, Quarterback, Rushing, Receiving, Turnovers, Defense and Kicking, with the best price first. Fumbles, QB sacked, INT thrown and 2+ TDs show the model's chance too.",
        whatItMeans: "Find any prop and the book paying the most for it, not just the model's 70%+ picks.",
        href: "/props",
      },
    ],
  },
  {
    version: "1.5.2",
    date: "2026-10-10",
    title: "Every football prop in the parlay builder",
    summary: "The builder's stat dropdown now covers touchdowns (anytime, 1+, 2+, 3+, first and last), QB stats, turnovers, sacks, tackles and kicking for the NFL and college football.",
    changes: [
      {
        kind: "new",
        title: "Touchdowns, QB, turnovers and defense",
        whatChanged:
          "Pick a player and the Stat type list now includes Anytime TD, 2+ TDs, First/Last TD, Pass/Rush/Rec TDs, completions, attempts, INTs thrown, longest plays, sacks, tackles, defensive INTs, field goals and extra points, with every FanDuel, DraftKings, BetMGM and Caesars price posted.",
        whatItMeans: "Build parlays from any prop the books offer, not just yards and catches.",
        href: "/parlays",
      },
      {
        kind: "new",
        title: "Fumbles and QB sacked, priced by the model",
        whatChanged:
          "For NFL props books rarely post — Fumble Lost, QB Sacked, INT Thrown, Anytime Sack, Anytime INT and 2+ TDs — the builder offers the model's fair price, from each player's rate this season.",
        whatItMeans: "Any of these can be a leg. The price is labelled \"Seasonz model (fair price)\"; check your book's actual price before betting.",
        href: "/parlays",
      },
    ],
  },
  {
    version: "1.5.1",
    date: "2026-10-10",
    title: "More basketball props",
    summary: "Points + Rebounds + Assists, Points + Rebounds, Rebounds + Assists, Turnovers and Steals for NBA, WNBA and college basketball.",
    changes: [
      {
        kind: "new",
        title: "Combo, turnover and steal props",
        whatChanged:
          "Player Props now cover P+R+A, P+R, R+A, Turnovers and Steals: the model's picks use the FanDuel and BetMGM lines, and Make Your Own Pick lists them in the stat dropdown with each player's averages filled in.",
        whatItMeans: "Bet the combo lines most books feature, and picks on them grade automatically when the game ends.",
        href: "/props",
      },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-10-10",
    title: "Sharper picks in every sport",
    summary:
      "Game picks for NBA, WNBA, NHL, MLB, college football and college basketball now use the betting line, starting pitchers and goalies, injuries, recent form and weather, and the model grades itself every week.",
    changes: [
      {
        kind: "improved",
        title: "Picks use the betting line",
        whatChanged:
          "Each game's chance now blends our model with the FanDuel, BetMGM or ESPN moneyline, after taking out the book's built-in margin.",
        whatItMeans:
          "Tested on last season's games, this picked more winners: on games with a posted line, NHL went from 51.8% to 55.2% and college football from 69.1% to 73.7%, and every sport's percentages got more accurate. Each pick's \"Why\" panel shows the model's own number next to the book's.",
      },
      {
        kind: "new",
        title: "Starting pitchers and goalies",
        whatChanged:
          "MLB picks rate both probable starting pitchers. NHL picks check whether a team is starting its backup goalie.",
        whatItMeans: "Picks change when a team's ace or its backup goalie is going, and the Why panel names them.",
      },
      {
        kind: "improved",
        title: "Injuries count in every sport",
        whatChanged:
          "Players listed out, on the IL or suspended now lower their team's chance in every sport, based on how much they produce.",
        whatItMeans: "A star sitting out moves the pick. The biggest absences are listed in the Why panel.",
      },
      {
        kind: "new",
        title: "Recent form and weather",
        whatChanged:
          "Every sport now weighs each team's recent scoring margin. Outdoor MLB and college football games show the game-time forecast.",
        whatItMeans: "Hot and cold teams are reflected. Weather is shown for context and isn't used in the pick (in baseball testing it didn't help predict winners).",
      },
      {
        kind: "new",
        title: "Weekly scorecard",
        whatChanged:
          "The Model Tracker shows each sport's record this week and this season, a calibration score, and how the betting favorite did on the same games.",
        whatItMeans:
          "Picks are graded on the number shown before each game started, so the record can't be rewritten. If a sport's numbers drift, the model corrects itself.",
        href: "/model-tracker",
      },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-10-09",
    title: "Parlays for every sport, 2 to 8 legs",
    summary: "Parlays can switch between all sports or any one sport, auto parlays come in every size from 2 to 8 legs, and Player Props fill in for every sport.",
    changes: [
      {
        kind: "new",
        title: "Pick a sport on Parlays",
        whatChanged:
          "Parlays has buttons for All sports, NFL, NBA, WNBA, NHL, MLB, NCAAF and NCAAB. Auto parlays and the builder's games and props switch to that sport.",
        whatItMeans: "Build a parlay from one sport or mix them, with that sport's real lines in the dropdowns.",
        href: "/parlays",
      },
      {
        kind: "improved",
        title: "Auto parlays from 2 to 8 legs",
        whatChanged:
          "Auto parlays now come in every size from 2 to 8 legs, from game picks and from player props, for today or this week. Tap any leg to see why it was picked.",
        whatItMeans:
          "Pick the size you want. On a light slate the bigger ones are filled with the model's next-best sides, so check the chance shown before betting.",
        href: "/parlays",
      },
      {
        kind: "fixed",
        title: "Player Props for every sport",
        whatChanged:
          "Props for NBA, NHL, MLB and the rest now fill in like NFL. Early in a season, a player's projection uses last season's games until he has 3 this season, and newer box scores load first.",
        whatItMeans: "You'll see real projections against FanDuel and other book lines instead of an empty page.",
        href: "/props",
      },
      {
        kind: "new",
        title: "Build your own prop from menus",
        whatChanged:
          "Make your own pick on Player Props now uses menus: game, team, player, then stat. Each player shows only the stats they actually record, with their recent average, and the line fills in from the sportsbook (or just above their average when no book line is posted).",
        whatItMeans: "No typing names or stat codes, and every pick grades correctly against the box score.",
        href: "/props",
      },
      {
        kind: "new",
        title: "Legacy admins use Seasonz free",
        whatChanged: "Legacy admins always get full Super Pro access, can't be sent to checkout, and aren't counted in Est. MRR.",
        whatItMeans: "No legacy admin is ever charged.",
        href: "/admin",
        audience: "admin",
      },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-10-09",
    title: "NBA deep dive and one week at a time",
    summary:
      "Model Tracker now shows only this week's games for every sport, and every pick has a Why panel. The NBA model adds recent form, paint scoring and injuries, with FanDuel and BetMGM lines.",
    changes: [
      {
        kind: "improved",
        title: "Model Tracker: this week only",
        whatChanged:
          "Each sport's tracker shows this week's games (Monday to Sunday, Eastern time) with the dates on top, and only this week's results. Times are shown in Eastern time.",
        whatItMeans: "No more old or far-off games mixed in. Your season record still counts every week.",
        href: "/model-tracker",
      },
      {
        kind: "new",
        title: "Why the model picked it, on every game",
        whatChanged:
          "Tap Why under any game to see what drove the pick, a side-by-side of both teams, home and road records, the last meetings with final scores, trends, injuries and suspensions, the officiating crew and how they call games, the schedule (rest, back-to-backs) and FanDuel and BetMGM lines.",
        whatItMeans:
          "You can check every number behind a pick before you bet it. All data comes from ESPN and the sportsbooks, not expert opinion.",
      },
      {
        kind: "improved",
        title: "Sharper NBA picks",
        whatChanged:
          "The NBA model now adds each team's last 20 games of scoring margin and points in the paint, plus who is out injured or suspended. We tested rebounds, turnovers, fouls, offensive fouls, threes, mid-range, head-to-head and referee crews too, and only kept what made picks better.",
        whatItMeans:
          "Tested on the full 2025-26 season it hadn't seen: picked 69.3% of winners, up from 68.5%, with better-calibrated chances. Everything else still shows in the Why panel.",
        href: "/sports/nba",
      },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-10-09",
    title: "Model Builds and sharper picks in every sport",
    summary:
      "The model now builds its own parlays and player-prop parlays every day and every week, the other sports' predictions were rebuilt and tested on past seasons, and Model Tracker shows one week at a time with a tab for every sport.",
    changes: [
      {
        kind: "new",
        title: "Model Builds: best parlays and player props, 2 to 8 legs",
        whatChanged:
          "A new Model Builds page shows today's and this week's best parlay and best player-prop parlay in every size from 2 to 8 legs. Tap any leg to see why the model picked it.",
        whatItMeans:
          "You get the model's strongest picks already stacked, with the chance that all of them hit and the payout. Each leg is from a different game, and picks above 90% are left out because they add risk without adding payout.",
        href: "/best-builds",
      },
      {
        kind: "improved",
        title: "Better predictions for NBA, WNBA, NHL, MLB and college",
        whatChanged:
          "Each sport now has its own settings, tested on the last 3 to 4 seasons. Ratings carry over from last season instead of resetting, neutral-site games get no home edge, and back-to-backs and short rest count against a team.",
        whatItMeans:
          "On the most recent full season, the model picked more winners: college football 67.8% to 72.9%, MLB 53.9% to 55.8%, NBA 66.6% to 67.9%, WNBA 67.0% to 67.8%, college basketball 72.2% to 72.9%. NHL picks are better calibrated. Early-season picks improve the most.",
      },
      {
        kind: "fixed",
        title: "MLB and NBA now use the full season",
        whatChanged:
          "The model was only reading the current phase of the season (just MLB's playoffs, just NBA preseason). It now reads the regular season and playoffs, and preseason games are no longer counted.",
        whatItMeans: "MLB playoff and NBA predictions are based on the whole season, not a handful of games.",
      },
      {
        kind: "improved",
        title: "Model Tracker: one week at a time, a tab for every sport",
        whatChanged:
          "Model Tracker shows only this week's games and results, and has tabs for NFL, NBA, WNBA, NHL, MLB, NCAAF and NCAAB, each with Make your own pick vs the model.",
        whatItMeans: "Less scrolling through old weeks, and you can pick against the model in every sport.",
        href: "/model-tracker",
      },
      {
        kind: "fixed",
        title: "Platform menu no longer cut off",
        whatChanged: "The betting-platform menu opens above other content and flips upward near the bottom of the screen.",
        whatItMeans: "You can see and choose every platform on a phone.",
      },
      {
        kind: "improved",
        title: "Animated Seasonz logo and background",
        whatChanged: "The logo and fire background now flicker and glow. If your phone is set to reduce motion, they stay still.",
        whatItMeans: "Just a new look.",
      },
      {
        kind: "new",
        title: "Scheduled syncs twice a day",
        whatChanged:
          "Data syncs automatically at 12am ET, and again at 2pm ET if nobody has synced since 10am. The Sync button is now for legacy admins only.",
        whatItMeans: "Odds, injuries and picks stay fresh without anyone pressing a button.",
        href: "/admin",
        audience: "admin",
      },
      {
        kind: "new",
        title: "Role picker and invite-code sheets",
        whatChanged:
          "Legacy admins can set anyone to User, Admin or Legacy admin. Each admin has their own sheet of invite codes per platform, can paste a whole list at once, and the app rotates through your own sheet first. Legacy admins can see and download every admin's sheet.",
        whatItMeans: "Hand out codes from your own list and see how many sign-ups each one brought in.",
        href: "/admin",
        audience: "admin",
      },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-10-09",
    title: "Smarter NFL model and a new look",
    summary:
      "The NFL model now reads Next Gen Stats tracking data and pass-rush pressure, the ticker is easier to read, and Seasonz has a new fire background.",
    changes: [
      {
        kind: "improved",
        title: "Next Gen Stats and pressure data in NFL predictions",
        whatChanged:
          "The model now looks at how open each team's receivers get (Next Gen Stats separation) and how much pressure each team's pass rush creates and its offensive line allows.",
        whatItMeans:
          "Win chances, spreads, and Best Bets account for matchups the old stats missed. In testing on the 2024-2025 seasons, picks got slightly more accurate. You'll see these listed as \u201cNGS separation\u201d and \u201cPressure\u201d in a game's factor breakdown.",
        href: "/model-tracker",
      },
      {
        kind: "improved",
        title: "Slower scores ticker",
        whatChanged: "The scores and injuries ticker at the bottom scrolls much more slowly, and pauses when you hover over it.",
        whatItMeans: "You can actually read the scores as they go by.",
      },
      {
        kind: "new",
        title: "New background",
        whatChanged: "Seasonz has a new dark background with the Seasonz name outlined in fire.",
        whatItMeans: "Just a new look. If your phone is set to reduce motion, the flames stay still.",
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-07",
    title: "Welcome to Seasonz",
    summary:
      "Seasonz launches with the full prediction model across NFL, NBA, WNBA, NHL, MLB, and college, plus new ways to learn how every bet works.",
    changes: [
      {
        kind: "new",
        title: "“What it means” on every bet",
        whatChanged:
          "When you log a bet in Bet Tracker, a “What it means” box spells out exactly what has to happen for you to win, when it’s a push, and what it pays. Your open bets show the same breakdown.",
        whatItMeans:
          "No more guessing what “-3.5” or “Under 44.5” needs. You see the exact score you need before you place it.",
        href: "/bet-tracker",
      },
      {
        kind: "new",
        title: "Betting guide: Moneyline, Spread, Over/Under, Alternate lines",
        whatChanged:
          "A new What it means page covers reading odds, moneylines, spreads, totals, alternate lines, player props, parlays, and pushes, with a playground to try any bet.",
        whatItMeans:
          "Learn how each bet type wins or loses, and how moving a line changes both your chances and your payout.",
        href: "/learn",
      },
      {
        kind: "new",
        title: "Patch notes",
        whatChanged: "This page. Every update to Seasonz is listed here in plain English.",
        whatItMeans:
          "When the model or a feature changes, you’ll see a banner and can read what’s different and how it affects your picks.",
        href: "/whats-new",
      },
      {
        kind: "new",
        title: "Promo codes for free months",
        whatChanged:
          "You can redeem a promo code on the Upgrade page for 3, 6, 9, or 12 months of Pro or Super Pro free.",
        whatItMeans:
          "If an admin gives you a code, enter it on Upgrade. Free time stacks with any free time you already have on the same plan.",
        href: "/upgrade",
      },
      {
        kind: "new",
        title: "Install it like an app",
        whatChanged:
          "Seasonz works on iPhone, Android, and computers. On iPhone use Share → Add to Home Screen; on Android use Install app.",
        whatItMeans: "It opens full-screen from your home screen, just like an app from the store.",
      },
      {
        kind: "new",
        title: "Rotating invite codes per platform",
        whatChanged:
          "Admin shows a different invite code for iPhone, Android, and desktop each time the page loads, from each platform’s list.",
        whatItMeans: "Hand out the code for the person’s device. Turn off or delete any code that leaks.",
        href: "/admin",
        audience: "admin",
      },
      {
        kind: "new",
        title: "Legacy admins and promo approvals",
        whatChanged:
          "Up to 5 legacy admins. Promo codes need an admin approval, then a legacy admin approval, before they work.",
        whatItMeans:
          "Two different people sign off on every free-months code, so no single admin can hand out free time alone.",
        href: "/admin",
        audience: "admin",
      },
      {
        kind: "new",
        title: "Odds key rotation",
        whatChanged:
          "Free odds keys are used first and the paid PropLine key last. Admin shows requests left on each key.",
        whatItMeans: "Odds and props keep syncing when a free key runs out, without burning the paid plan first.",
        href: "/admin",
        audience: "admin",
      },
    ],
  },
];

export const LATEST_RELEASE = RELEASES[0];

export function releasesFor(isAdmin: boolean): Release[] {
  return RELEASES.map((r) => ({
    ...r,
    changes: r.changes.filter((c) => isAdmin || (c.audience ?? "everyone") === "everyone"),
  })).filter((r) => r.changes.length > 0);
}

/** Compares "1.2.10" style versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function hasUnseenUpdate(lastSeen: string | null | undefined): boolean {
  if (!LATEST_RELEASE) return false;
  return !lastSeen || compareVersions(LATEST_RELEASE.version, lastSeen) > 0;
}
