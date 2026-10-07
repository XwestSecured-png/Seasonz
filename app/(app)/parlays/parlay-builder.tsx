"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LegPicker, type LegPickerGame, type LegPickerProp } from "./leg-picker";
import { PayoutCalc } from "./payout-calc";

interface LegDraft {
  label: string;
  priceAmerican: string;
  mode: "picker" | "manual";
}

function emptyLeg(hasDropdownData: boolean): LegDraft {
  return { label: "", priceAmerican: "", mode: hasDropdownData ? "picker" : "manual" };
}

export interface OtherSportPick {
  id: string;
  sportLabel: string;
  matchup: string;
  pickLabel: string;
  priceAmerican: number;
}

export function ParlayBuilder({
  games,
  propOptions,
  otherSportsPicks = [],
}: {
  games: LegPickerGame[];
  propOptions: LegPickerProp[];
  otherSportsPicks?: OtherSportPick[];
}) {
  const hasDropdownData = games.length > 0 || propOptions.length > 0;
  const [title, setTitle] = useState("");
  const [legs, setLegs] = useState<LegDraft[]>([
    emptyLeg(hasDropdownData),
    emptyLeg(hasDropdownData),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const [showAi, setShowAi] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // The chat thread itself (for display) plus the slip ids the AI last
  // settled on (so a follow-up message — "swap leg 2" — edits that slip
  // instead of starting over). Both reset together on "Clear chat".
  const [aiMessages, setAiMessages] = useState<{ role: "user" | "assistant"; content: string }[]>(
    []
  );
  const [aiCurrentIds, setAiCurrentIds] = useState<string[]>([]);

  // Pulls a trailing American-odds token (e.g. "-115" or "+120") off the
  // end of each pasted line and treats the rest as the leg's description —
  // a quick way to fill in several legs at once instead of one field at a
  // time (inspired by paste-a-betslip tools like Gambly's).
  function parsePaste() {
    setPasteNote(null);
    const oddsPattern = /([+-]\d{2,4})\s*$/;
    const parsedLegs: LegDraft[] = [];
    let skipped = 0;
    for (const rawLine of pasteText.split("\n")) {
      const line = rawLine.trim().replace(/^[-•\d.)\s]+/, "");
      if (!line) continue;
      const match = line.match(oddsPattern);
      if (!match) {
        skipped++;
        continue;
      }
      const label = line.slice(0, match.index).trim().replace(/[,@]\s*$/, "").trim();
      if (!label) {
        skipped++;
        continue;
      }
      parsedLegs.push({ label, priceAmerican: match[1], mode: "manual" });
    }

    if (parsedLegs.length < 2) {
      setPasteNote(
        "Couldn't find at least 2 legs with a trailing price (e.g. \"Mahomes Over 250 Pass Yds -115\"). Try one bet per line."
      );
      return;
    }

    setLegs(parsedLegs);
    setPasteNote(
      `Filled in ${parsedLegs.length} leg(s)${skipped > 0 ? ` (${skipped} line(s) skipped — no price found)` : ""}. Review below, then save.`
    );
    setPasteText("");
  }

  // "Ask AI" — a back-and-forth chat (like Gambly's) where each message can
  // refine the slip ("swap the Chiefs leg", "make it 4 legs") instead of
  // starting over. The server still only ever selects real ids from this
  // week's actual picks — it can't invent a bet; see app/api/parlay-ai/route.ts.
  // aiCurrentIds is the trusted slip state sent with every turn; aiMessages
  // is just the transcript for display + conversational context.
  function sendAiMessage() {
    const text = aiInput.trim();
    setAiError(null);
    if (!text) {
      setAiError("Describe what you want first.");
      return;
    }
    const history = aiMessages;
    setAiMessages((prev) => [...prev, { role: "user", content: text }]);
    setAiInput("");
    setAiLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/parlay-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text, history, currentIds: aiCurrentIds }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setAiError(data?.error ?? "Something went wrong — try again.");
          return;
        }
        const newLegs: LegDraft[] = (data.legs ?? []).map(
          (l: { label: string; priceAmerican: number }) => ({
            label: l.label,
            priceAmerican: String(l.priceAmerican),
            mode: "manual" as const,
          })
        );
        if (newLegs.length < 2) {
          setAiError("The AI didn't return enough legs — try rephrasing.");
          return;
        }
        setLegs(newLegs);
        if (data.title) setTitle(data.title);
        setAiCurrentIds(Array.isArray(data.ids) ? data.ids : []);
        setAiMessages((prev) => [...prev, { role: "assistant", content: data.reply ?? "Here's the updated slip." }]);
      } finally {
        setAiLoading(false);
      }
    })();
  }

  function clearAiChat() {
    setAiMessages([]);
    setAiCurrentIds([]);
    setAiError(null);
    setAiInput("");
  }

  function updateLeg(i: number, patch: Partial<LegDraft>) {
    setLegs((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  // "Other sports" quick-add — fills the first still-empty leg (dropdown
  // mode with nothing picked yet, or manual mode with nothing typed) so a
  // fresh builder's two blank legs get used first, rather than always
  // appending a third/fourth.
  function addOtherSportLeg(pick: OtherSportPick) {
    const draft: LegDraft = {
      label: `${pick.pickLabel} (${pick.sportLabel}, model pick)`,
      priceAmerican: String(pick.priceAmerican),
      mode: "manual",
    };
    setLegs((prev) => {
      const emptyIdx = prev.findIndex((l) => !l.label.trim() && !l.priceAmerican.trim());
      if (emptyIdx === -1) return [...prev, draft];
      return prev.map((l, idx) => (idx === emptyIdx ? draft : l));
    });
  }

  function addLeg() {
    setLegs((prev) => [...prev, emptyLeg(hasDropdownData)]);
  }

  function removeLeg(i: number) {
    setLegs((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  function submit() {
    setError(null);
    const cleaned = legs
      .map((l) => ({ label: l.label.trim(), priceAmerican: Number(l.priceAmerican) }))
      .filter((l) => l.label && Number.isFinite(l.priceAmerican) && l.priceAmerican !== 0);

    if (cleaned.length < 2) {
      setError("Enter at least 2 legs, each with a description and an American odds price (e.g. -110 or +150).");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/parlays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || null, legs: cleaned }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Something went wrong — try again.");
        return;
      }
      setTitle("");
      setLegs([emptyLeg(hasDropdownData), emptyLeg(hasDropdownData)]);
      router.refresh();
    });
  }

  // Live preview, using whatever legs currently parse to a valid price — so
  // it updates as dropdown picks (or manual entries) are filled in, before
  // the parlay is even saved.
  const previewLegs = useMemo(
    () =>
      legs
        .map((l) => ({ priceAmerican: Number(l.priceAmerican) }))
        .filter((l) => Number.isFinite(l.priceAmerican) && l.priceAmerican !== 0),
    [legs]
  );

  return (
    <div className="rounded-md border border-neutral-800 p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setShowAi((o) => !o);
            setShowPaste(false);
          }}
          className="text-xs rounded-full px-3 py-1 border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
        >
          ✨ Ask AI
        </button>
        <button
          type="button"
          onClick={() => {
            setShowPaste((o) => !o);
            setShowAi(false);
          }}
          className="text-xs rounded-full px-3 py-1 border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
        >
          📋 Paste a parlay
        </button>
      </div>

      {showAi && (
        <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-neutral-500">
              Chat to build or refine the parlay — it&rsquo;s built only from this week&rsquo;s
              real picks, never made up.
            </label>
            {aiMessages.length > 0 && (
              <button
                type="button"
                onClick={clearAiChat}
                className="text-[11px] text-neutral-500 hover:text-neutral-300 whitespace-nowrap"
              >
                Clear chat
              </button>
            )}
          </div>

          {aiMessages.length > 0 && (
            <div className="max-h-64 overflow-y-auto space-y-2 rounded-md border border-neutral-800/80 bg-neutral-950/60 p-2">
              {aiMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-neutral-800 text-neutral-100"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {aiLoading && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-lg px-3 py-1.5 text-sm bg-neutral-800 text-neutral-400">
                    Thinking…
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !aiLoading) sendAiMessage();
              }}
              placeholder={
                aiMessages.length === 0
                  ? 'e.g. "a 3-leg parlay with the Chiefs and two player overs"'
                  : "e.g. \"swap the Chiefs leg for something on the Bills\""
              }
              className="flex-1 rounded-md bg-neutral-900 border border-neutral-800 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button
              type="button"
              onClick={sendAiMessage}
              disabled={aiLoading}
              className="rounded-md bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 transition-colors px-3 py-1.5 text-sm text-white font-medium whitespace-nowrap"
            >
              {aiLoading ? "…" : aiMessages.length === 0 ? "Build it" : "Send"}
            </button>
          </div>
          {aiError && <p className="text-xs text-red-400">{aiError}</p>}
          {aiMessages.length > 0 && !aiError && (
            <p className="text-xs text-emerald-400">Slip below is updated live — review, then save.</p>
          )}
        </div>
      )}

      {showPaste && (
        <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-3 space-y-2">
          <label className="text-xs text-neutral-500">
            Paste one bet per line, each ending in its price (e.g. &ldquo;Mahomes Over 250 Pass
            Yds -115&rdquo;).
          </label>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={4}
            placeholder={"Mahomes Over 250 Pass Yds -115\nChiefs ML -150\nKelce Anytime TD +120"}
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono"
          />
          <button
            type="button"
            onClick={parsePaste}
            className="rounded-md bg-neutral-800 hover:bg-neutral-700 transition-colors px-3 py-1.5 text-sm text-white font-medium"
          >
            Parse into legs
          </button>
          {pasteNote && (
            <p className={pasteNote.startsWith("Couldn't") ? "text-xs text-red-400" : "text-xs text-emerald-400"}>
              {pasteNote}
            </p>
          )}
        </div>
      )}

      {otherSportsPicks.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs text-neutral-500">
            Other sports — tap to add this week&rsquo;s model pick as a leg (fair price, not a
            real sportsbook line — these sports don&rsquo;t have odds synced yet).
          </label>
          <div className="flex flex-wrap gap-1.5">
            {otherSportsPicks.map((pick) => (
              <button
                key={pick.id}
                type="button"
                onClick={() => addOtherSportLeg(pick)}
                title={pick.matchup}
                className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                <span className="text-neutral-500">{pick.sportLabel}:</span> {pick.pickLabel} (
                {pick.priceAmerican > 0 ? "+" : ""}
                {pick.priceAmerican})
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Parlay name (optional) — e.g. &ldquo;Sunday slate&rdquo;"
        className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
      />
      <div className="space-y-2">
        {legs.map((leg, i) => (
          <div key={i} className="space-y-1">
            <div className="flex gap-2 items-center">
              {leg.mode === "picker" ? (
                <LegPicker
                  games={games}
                  propOptions={propOptions}
                  onChange={(patch) => updateLeg(i, patch)}
                  onUseManual={() => updateLeg(i, { mode: "manual" })}
                />
              ) : (
                <>
                  <input
                    type="text"
                    value={leg.label}
                    onChange={(e) => updateLeg(i, { label: e.target.value })}
                    placeholder={`Leg ${i + 1} — e.g. "Chiefs -3.5" or "Mahomes Over 275.5 Pass Yds"`}
                    className="flex-1 rounded-md bg-neutral-900 border border-neutral-800 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <input
                    type="number"
                    value={leg.priceAmerican}
                    onChange={(e) => updateLeg(i, { priceAmerican: e.target.value })}
                    placeholder="-110"
                    className="w-24 rounded-md bg-neutral-900 border border-neutral-800 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </>
              )}
              <button
                type="button"
                onClick={() => removeLeg(i)}
                disabled={legs.length <= 2}
                className="text-neutral-500 hover:text-neutral-300 disabled:opacity-30 disabled:cursor-not-allowed text-sm px-1"
                aria-label="Remove leg"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-3 pl-0.5">
              {leg.mode === "picker" ? (
                <button
                  type="button"
                  onClick={() => updateLeg(i, { mode: "manual", label: "", priceAmerican: "" })}
                  className="text-[11px] text-neutral-500 hover:text-neutral-300"
                >
                  Type it in instead
                </button>
              ) : (
                hasDropdownData && (
                  <button
                    type="button"
                    onClick={() => updateLeg(i, { mode: "picker", label: "", priceAmerican: "" })}
                    className="text-[11px] text-neutral-500 hover:text-neutral-300"
                  >
                    Use dropdowns instead
                  </button>
                )
              )}
              {leg.label && leg.priceAmerican && (
                <span className="text-[11px] text-neutral-600">
                  {leg.label} ({Number(leg.priceAmerican) > 0 ? "+" : ""}
                  {leg.priceAmerican})
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={addLeg}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          + Add leg
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors px-4 py-1.5 text-sm text-white font-medium"
        >
          {isPending ? "Saving…" : "Save parlay"}
        </button>
      </div>
      {previewLegs.length >= 2 && (
        <div className="rounded-md bg-neutral-900/50 border border-neutral-800 px-3 py-2">
          <PayoutCalc legs={previewLegs} />
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <p className="text-xs text-neutral-500">
        American odds: a minus number is a favorite (e.g. -150 means bet $150 to win $100), a
        plus number is an underdog (e.g. +150 means bet $100 to win $150).
      </p>
    </div>
  );
}
