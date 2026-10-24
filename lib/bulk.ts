// Bulk database writes: bigger batches, a few in flight at once. The props
// stages write 15,000-75,000 lines a run; 500 at a time, one after another,
// was most of the sync's time.
export async function inBatches<T>(rows: T[], size: number, concurrency: number, write: (chunk: T[]) => Promise<unknown>): Promise<void> {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, chunks.length) }, async () => {
      while (next < chunks.length) await write(chunks[next++]);
    })
  );
}
