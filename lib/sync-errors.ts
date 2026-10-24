/** Error message plus the top stack frames, so a failed stage can be traced from sync_runs. */
export function errorDetail(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const frames = (err.stack ?? "")
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("at ") && !l.includes("node_modules") && !l.includes("node:internal"))
    .slice(0, 3)
    .map((l) => l.replace(/^at /, "").replace(/\(?(?:file:\/\/)?[^()]*\/(?:\.next\/server\/)?/, "(").slice(0, 120));
  return frames.length ? `${err.message} [${frames.join(" < ")}]` : err.message;
}
