// Small inline explanation for one section/table within a page — the
// top-of-page PageInfo block explains the whole page at once, but a page
// with several distinct sections (tiers, categories, tables) benefits from
// a one-line note on each one too, right where it's needed.
export function SectionNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-neutral-500 mb-2 max-w-2xl">{children}</p>;
}
