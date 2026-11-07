// Google Sheets copy of the app (1.43.0). Run by .github/workflows/sheet.yml.
//   npx tsx --tsconfig tsconfig.json scripts/sheet-export.ts --out=sheet.json   -> write every tab to a file
//   npx tsx --tsconfig tsconfig.json scripts/sheet-export.ts --push             -> refresh the Google Sheet
// The repo is public: this prints only tab names and row counts.
import { writeFileSync } from "node:fs";
import { buildSheetTabs, pushToGoogleSheet } from "@/lib/sheet-export";

async function main() {
  const out = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1];
  const tabs = await buildSheetTabs();
  for (const t of tabs) console.log(`${t.name}: ${t.rows.length} rows`);
  if (out) writeFileSync(out, JSON.stringify({ builtAt: new Date().toISOString(), tabs }));
  if (process.argv.includes("--push")) console.log(`Google Sheet: ${await pushToGoogleSheet(tabs)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`failed: ${String(e instanceof Error ? e.message : e).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://…").slice(0, 200)}`);
    process.exit(1);
  });
