import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { oddsLines, games } from "@/db/schema";
import { and, eq, max, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/current-user";
import { otherSportsPickCandidates } from "@/lib/sports/best-bets";

function currentNflSeason(): number {
  const now = new Date();
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

interface Candidate {
  id: string;
  label: string;
  priceAmerican: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Which AI provider powers "Ask AI" — checked in this order so a free,
// no-credit-card option (Groq) is used automatically when it's the only
// one configured, without needing any other code changes. ANTHROPIC_API_KEY
// still works exactly as before if that's what's set.
type AiProvider = "groq" | "anthropic";

function activeAiProvider(): AiProvider | null {
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

/** Calls whichever AI provider is configured and returns its raw text reply. `messages` is the full user/assistant turn history (oldest first), ending on the latest user turn. Throws with a user-facing message on any failure. */
async function callAiModel(provider: AiProvider, systemPrompt: string, messages: ChatMessage[]): Promise<string> {
  if (provider === "groq") {
    // Groq (https://console.groq.com) — free tier, no credit card required,
    // generous enough rate limits (tens of requests/minute) that a small
    // private group's occasional Ask AI use never comes close. Its API is
    // OpenAI-compatible chat completions.
    // Groq retired llama-3.3-70b-versatile on 2026-08-16 — every request
    // against it now 404s with "model_not_found". openai/gpt-oss-120b is
    // Groq's own documented replacement (console.groq.com/docs/deprecations):
    // strong instruction-following for a strict-JSON task like this one,
    // still on the free tier. Override via GROQ_MODEL if Groq retires this
    // one too — check console.groq.com/docs/models for the current roster
    // before picking a replacement, the same way this one was picked.
    const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        temperature: 0.3,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`AI request failed (${res.status}). ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }

  // Anthropic fallback — used when ANTHROPIC_API_KEY is set (and GROQ_API_KEY isn't).
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}). ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.content?.[0]?.text ?? "";
}

/**
 * "Ask AI" parlay builder (inspired by Gambly's natural-language betslip
 * builder) — a back-and-forth chat where the user describes what they want
 * ("a 3-leg parlay with the Chiefs and two overs") and can keep refining it
 * ("swap the Chiefs leg for something on the Bills", "make it 4 legs") turn
 * by turn. Critically, every turn the model only ever selects from a
 * supplied candidate list by id — it's never asked to invent a player,
 * line, or price, so the result can't hallucinate a bet that doesn't
 * actually exist. The candidate list and the client's `currentIds` are the
 * only state that's trusted; `history` is passed along purely so replies
 * read like a continuous conversation, never as a source of picks. Works
 * with either a free Groq key or a paid Anthropic key — see
 * activeAiProvider() above.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const provider = activeAiProvider();
  if (!provider) {
    return NextResponse.json(
      {
        error:
          "Ask AI isn't set up yet — add a free GROQ_API_KEY (console.groq.com, no credit card) " +
          "or an ANTHROPIC_API_KEY to enable it.",
      },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 500) : "";
  if (!prompt) {
    return NextResponse.json({ error: "Describe the parlay you want first." }, { status: 400 });
  }

  // Prior turns, for conversational continuity only — capped so a long
  // chat can't blow up the token budget or the request size. The model is
  // never allowed to pull picks out of this; see the system prompt below.
  const rawHistory: unknown[] = Array.isArray(body?.history) ? body.history : [];
  const history: ChatMessage[] = rawHistory
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === "object" &&
        ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).content === "string"
    )
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 500) }));

  // The slip as the client currently has it rendered — the model treats a
  // follow-up ("drop the Bills leg") as an edit to this, not a fresh start.
  const currentIds: string[] = Array.isArray(body?.currentIds)
    ? body.currentIds.filter((id: unknown): id is string => typeof id === "string").slice(0, 4)
    : [];

  const season = currentNflSeason();

  const [latestPropsWeek] = await db
    .select({ week: max(oddsLines.week) })
    .from(oddsLines)
    .where(eq(oddsLines.season, season));

  const propRows =
    latestPropsWeek?.week != null
      ? await db
          .select()
          .from(oddsLines)
          .where(and(eq(oddsLines.season, season), eq(oddsLines.week, latestPropsWeek.week)))
          .orderBy(sql`abs(${oddsLines.edgePct}) desc`)
          .limit(80)
      : [];

  const gameRows = await db
    .select()
    .from(games)
    .where(and(eq(games.season, season), eq(games.isFinal, false)));

  // The candidate pool is the ONLY thing the model is allowed to choose
  // from — every real player prop pick and moneyline value pick currently
  // on the board, each tagged with an opaque id it must echo back verbatim.
  // Rebuilt fresh on every turn (not cached from earlier in the chat) so a
  // multi-message conversation never drifts onto stale picks.
  const candidates: Candidate[] = [];
  for (const p of propRows) {
    if (!p.player || !p.statType || p.priceAmerican === null || p.line === null) continue;
    candidates.push({
      id: `prop-${p.id}`,
      label: `${p.player} (${p.team ?? "?"}) ${p.side} ${p.line} ${p.statType}`,
      priceAmerican: p.priceAmerican,
    });
  }
  for (const g of gameRows) {
    if (!g.aiPickTeam) continue;
    const price = g.aiPickTeam === g.homeTeam ? g.moneylineHomeOdds : g.moneylineAwayOdds;
    if (price === null) continue;
    const opponent = g.aiPickTeam === g.homeTeam ? g.awayTeam : g.homeTeam;
    candidates.push({
      id: `game-${g.id}`,
      label: `${g.aiPickTeam} ML (Wk ${g.week} vs ${opponent})`,
      priceAmerican: price,
    });
  }
  // Every other sport's active-week model favorite — no real sportsbook
  // line exists for these yet, so the price is the model's own fair (no-vig)
  // implied odds, not a book's price. Labeled "model pick" right in the
  // candidate text so the assistant's own reply reflects that distinction
  // rather than describing it as a real edge.
  for (const c of await otherSportsPickCandidates()) {
    candidates.push({
      id: c.id,
      label: `${c.pickLabel} (${c.sportLabel}, model pick — fair price, not a sportsbook line)`,
      priceAmerican: c.priceAmerican,
    });
  }

  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "No current picks to build from yet — sync the app first." },
      { status: 400 }
    );
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const idSet = new Set(candidates.map((c) => c.id));
  // currentIds may contain ids that rolled off the board (a game went
  // final, a prop expired) since the last turn — drop those silently
  // rather than asking the model to reason about a ghost leg.
  const liveCurrentIds = currentIds.filter((id) => idSet.has(id));

  const candidateList = candidates
    .map((c) => `${c.id}: ${c.label} (${c.priceAmerican > 0 ? "+" : ""}${c.priceAmerican})`)
    .join("\n");

  const currentSlipText =
    liveCurrentIds.length > 0
      ? liveCurrentIds.map((id) => `${id}: ${byId.get(id)!.label}`).join("\n")
      : "(empty — nothing picked yet)";

  const systemPrompt =
    "You build parlays for a personal sports prediction app (NFL plus NBA, WNBA, NHL, MLB, " +
    "college football, and college basketball) through a back-and-forth chat. Each turn you " +
    "choose 2 to 4 legs from a supplied list of currently available picks — you never invent a " +
    "player, team, stat line, or price that isn't in the list, only select ids that are " +
    "literally present. Some candidates are real sportsbook lines (NFL); others are tagged " +
    '"model pick" with a fair price because that sport has no real line synced yet — when you ' +
    "mention a model-pick leg in your reply, describe it as the model's own favorite, not as a " +
    "betting edge. You're also told the slip as it currently stands; treat a follow-up message " +
    "as an edit to that slip (swap a leg, add one, drop one, start over) unless the user clearly " +
    "wants something unrelated. If nothing in the list matches well, fall back to the " +
    "highest-edge (or, for model picks, highest-confidence) items and say so briefly. Respond " +
    'with ONLY a JSON object of the form {"reply": string, "title": string, "ids": string[]} and ' +
    'nothing else — no markdown fencing. "reply" is a short, conversational sentence or two (like ' +
    'a chat message) explaining what you picked or changed and why. "title" is a short parlay ' +
    'name, or an empty string to leave the existing title alone. "ids" must be 2 to 4 of the ' +
    "exact id strings from the list, never a new or modified id — this is the FULL updated slip, " +
    "not just what changed.";

  const groundedUserTurn =
    `Current slip:\n${currentSlipText}\n\n` +
    `Available picks:\n${candidateList}\n\n` +
    `User: ${prompt}`;

  const messages: ChatMessage[] = [...history, { role: "user", content: groundedUserTurn }];

  let aiText: string;
  try {
    aiText = await callAiModel(provider, systemPrompt, messages);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI request failed." },
      { status: 502 }
    );
  }

  let parsed: { reply?: string; title?: string; ids?: string[] };
  try {
    // Instructed to return raw JSON, but strip code fences defensively in
    // case the model wraps the response in ```json anyway.
    const cleaned = aiText.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json(
      { error: "Couldn't understand the AI's response — try rephrasing." },
      { status: 502 }
    );
  }

  const chosenIds = Array.isArray(parsed.ids) ? parsed.ids.filter((id) => idSet.has(id)) : [];
  if (chosenIds.length < 2) {
    return NextResponse.json(
      {
        error:
          "Couldn't find enough matching picks for that request — try being more specific, or broader.",
      },
      { status: 502 }
    );
  }

  const finalIds = chosenIds.slice(0, 4);
  const legs = finalIds.map((id) => {
    const c = byId.get(id)!;
    return { label: c.label, priceAmerican: c.priceAmerican };
  });

  return NextResponse.json({
    reply:
      typeof parsed.reply === "string" && parsed.reply.trim()
        ? parsed.reply.trim().slice(0, 600)
        : "Here's the updated slip.",
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.slice(0, 200) : null,
    ids: finalIds,
    legs,
  });
}
