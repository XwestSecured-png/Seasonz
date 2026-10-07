/**
 * A collapsible "what am I looking at?" explainer, placed under every page's
 * title. Collapsed by default so it doesn't crowd the actual data, but
 * always there for anyone (especially a new tester) who wants the full
 * explanation of what the page shows and how to read it.
 */
export function PageInfo({
  title = "What am I looking at?",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-md border border-neutral-800 bg-neutral-900/40 open:bg-neutral-900/60">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-neutral-300 flex items-center gap-2 list-none [&::-webkit-details-marker]:hidden">
        <span className="text-neutral-500 transition-transform group-open:rotate-90">▸</span>
        {title}
      </summary>
      <div className="px-4 pb-4 pt-1 text-sm text-neutral-400 space-y-2 max-w-3xl">
        {children}
      </div>
    </details>
  );
}
