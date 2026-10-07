import { WhatItMeans } from "../what-it-means";
import { TryIt } from "./try-it";
import { PARLAY_RULE } from "@/lib/bet-explainer";

export const metadata = { title: "What it means · Seasonz" };

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="text-base font-semibold text-neutral-100">{title}</h2>
      <div className="space-y-2 text-sm leading-6 text-neutral-300">{children}</div>
    </section>
  );
}

const TOC = [
  ["odds", "Reading the odds"],
  ["moneyline", "Moneyline (ML)"],
  ["spread", "Spread"],
  ["total", "Over/Under (totals)"],
  ["alternate", "Alternate lines"],
  ["props", "Player props"],
  ["parlays", "Parlays"],
  ["push", "Pushes and voids"],
  ["try", "Try it yourself"],
] as const;

export default function LearnPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">What it means</h1>
        <p className="max-w-2xl text-sm text-neutral-400">
          How each bet works and exactly what has to happen for you to win. Every bet you build in
          Seasonz also has its own &ldquo;What it means&rdquo; box with the same breakdown for that
          specific bet.
        </p>
        <nav className="flex flex-wrap gap-1.5 pt-1">
          {TOC.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-full border border-neutral-800 px-2.5 py-1 text-xs text-neutral-400 hover:border-emerald-700 hover:text-emerald-300"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      <Section id="odds" title="Reading the odds">
        <p>
          Odds are shown American-style. A <strong>minus</strong> number (like −150) is the favorite: it&rsquo;s how
          much you bet to win $100. A <strong>plus</strong> number (like +130) is the underdog: it&rsquo;s how much
          you win on a $100 bet.
        </p>
        <p>
          −110 is the standard price on spreads and totals. You risk $110 to win $100. The extra $10 is the
          book&rsquo;s cut, so at −110 you need to win about 52.4% of your bets just to break even.
        </p>
      </Section>

      <Section id="moneyline" title="Moneyline (ML)">
        <p>You&rsquo;re picking who wins the game. That&rsquo;s it. The score margin doesn&rsquo;t matter.</p>
        <WhatItMeans bet={{ market: "ML", sport: "nfl", pick: "Falcons", opponent: "Saints", priceAmerican: -150, stakeUsd: 150 }} />
        <WhatItMeans bet={{ market: "ML", sport: "nfl", pick: "Saints", opponent: "Falcons", priceAmerican: 130, stakeUsd: 100 }} />
      </Section>

      <Section id="spread" title="Spread">
        <p>
          The spread evens out a mismatch. The favorite gets a minus number and has to win by more than
          that many points. The underdog gets a plus number and can lose by less than that and still win
          your bet.
        </p>
        <p>
          Lines ending in .5 can&rsquo;t push. Whole-number lines can: if the margin lands exactly on the
          number, you get your money back.
        </p>
        <WhatItMeans bet={{ market: "SPREAD", sport: "nfl", pick: "Falcons", opponent: "Saints", line: -3.5, priceAmerican: -110, stakeUsd: 110 }} />
        <WhatItMeans bet={{ market: "SPREAD", sport: "nfl", pick: "Saints", opponent: "Falcons", line: 3.5, priceAmerican: -110, stakeUsd: 110 }} />
        <WhatItMeans bet={{ market: "SPREAD", sport: "nfl", pick: "Falcons", opponent: "Saints", line: -7, priceAmerican: -110, stakeUsd: 110 }} />
      </Section>

      <Section id="total" title="Over/Under (totals)">
        <p>
          You&rsquo;re betting on the combined score of both teams, not who wins. Over means more than the
          number, Under means fewer. Overtime counts.
        </p>
        <WhatItMeans bet={{ market: "TOTAL", sport: "nfl", side: "OVER", line: 44.5, priceAmerican: -110, stakeUsd: 110 }} />
        <WhatItMeans bet={{ market: "TOTAL", sport: "nfl", side: "UNDER", line: 45, priceAmerican: -110, stakeUsd: 110 }} />
      </Section>

      <Section id="alternate" title="Alternate lines">
        <p>
          Books let you move the spread or total off the main number. Move it in your favor and it&rsquo;s
          easier to win but pays less. Move it against you and it&rsquo;s harder to win but pays more. The
          win rules are exactly the same as a normal spread or total, just with the new number.
        </p>
        <WhatItMeans
          bet={{ market: "SPREAD", sport: "nfl", pick: "Falcons", opponent: "Saints", line: -0.5, mainLine: -3.5, priceAmerican: -200, stakeUsd: 100 }}
        />
        <WhatItMeans
          bet={{ market: "SPREAD", sport: "nfl", pick: "Falcons", opponent: "Saints", line: -10.5, mainLine: -3.5, priceAmerican: 240, stakeUsd: 100 }}
        />
        <WhatItMeans bet={{ market: "TOTAL", sport: "nfl", side: "OVER", line: 38.5, mainLine: 44.5, priceAmerican: -250, stakeUsd: 100 }} />
      </Section>

      <Section id="props" title="Player props">
        <p>
          A bet on one player&rsquo;s stat line, like passing yards or receptions. It works like an
          Over/Under, just for one player. The team result doesn&rsquo;t matter.
        </p>
        <WhatItMeans
          bet={{ market: "PROP", sport: "nfl", pick: "Drake London", stat: "Rec Yds", side: "OVER", line: 64.5, priceAmerican: -115, stakeUsd: 115 }}
        />
        <p className="text-neutral-400">
          Anytime touchdown props are a yes/no: you win if the player scores a touchdown at any point in the
          game. Passing touchdowns thrown by a quarterback don&rsquo;t count for the quarterback.
        </p>
      </Section>

      <Section id="parlays" title="Parlays">
        <p>{PARLAY_RULE}</p>
        <p>
          The payout multiplies across legs, which is why parlays pay big: two −110 legs pay about +264, three
          pay about +596. The catch is the chance of hitting drops just as fast. Two coin-flip legs hit about
          25% of the time; three hit about 12.5%.
        </p>
      </Section>

      <Section id="push" title="Pushes and voids">
        <p>
          <strong>Push:</strong> the result lands exactly on a whole-number line. Your stake comes back, no
          win or loss.
        </p>
        <p>
          <strong>Void:</strong> the bet is canceled and refunded, for example when a player in a prop
          doesn&rsquo;t play or a game is postponed. Rules vary by book, so check yours.
        </p>
      </Section>

      <Section id="try" title="Try it yourself">
        <p>Set up any bet and see exactly what it takes to win.</p>
        <TryIt />
      </Section>

      <p className="text-xs text-neutral-600">
        Seasonz is for information and entertainment. Bet only what you can afford to lose. If gambling
        stops being fun, call or text 1-800-GAMBLER.
      </p>
    </div>
  );
}
