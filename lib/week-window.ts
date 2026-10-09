// "This week" for every sport except NFL and college football (which have
// real numbered weeks): Monday 12:00am to the next Monday 12:00am, Eastern
// time. Replaces the old 7-day buckets counted from each season's first
// game, whose "Week 2" / "Week 14" labels didn't match any real calendar
// week and confused people.
const ET = "America/New_York";

function etParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return p as Record<string, string>;
}

/** UTC instant of 12:00am Eastern on the given ET calendar date. */
function etMidnight(y: number, m: number, d: number): Date {
  // Start from 05:00 UTC (midnight EST) and correct by however far off the
  // real Eastern offset (EST or EDT) is on that date.
  const guess = new Date(Date.UTC(y, m - 1, d, 5));
  const p = etParts(guess);
  const shownHour = Number(p.hour);
  return new Date(guess.getTime() - shownHour * 3600_000 - Number(p.minute) * 60_000);
}

const WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export interface WeekWindow {
  start: Date; // Monday 12:00am ET
  end: Date; // next Monday 12:00am ET
  label: string; // "Oct 5 – Oct 11"
}

export function etWeekWindow(now = new Date()): WeekWindow {
  const p = etParts(now);
  const y = Number(p.year);
  const m = Number(p.month);
  const d = Number(p.day);
  const back = WEEKDAY[p.weekday] ?? 0;
  const mondayUtcNoon = new Date(Date.UTC(y, m - 1, d - back, 12));
  const start = etMidnight(mondayUtcNoon.getUTCFullYear(), mondayUtcNoon.getUTCMonth() + 1, mondayUtcNoon.getUTCDate());
  const sundayUtcNoon = new Date(mondayUtcNoon.getTime() + 6 * 86_400_000);
  const nextMonUtcNoon = new Date(mondayUtcNoon.getTime() + 7 * 86_400_000);
  const end = etMidnight(nextMonUtcNoon.getUTCFullYear(), nextMonUtcNoon.getUTCMonth() + 1, nextMonUtcNoon.getUTCDate());
  const fmt = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return { start, end, label: `${fmt(mondayUtcNoon)} – ${fmt(sundayUtcNoon)}` };
}

export function inWindow(t: Date | null | undefined, w: WeekWindow): boolean {
  return !!t && t.getTime() >= w.start.getTime() && t.getTime() < w.end.getTime();
}

/** "Fri, Oct 9, 7:30 PM ET" — always Eastern, never the server's UTC. */
export function formatEt(t: Date | null | undefined): string {
  if (!t) return "Time TBD";
  return (
    t.toLocaleString("en-US", {
      timeZone: ET,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " ET"
  );
}
