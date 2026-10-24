// Bulk database writes in bigger batches. Concurrency 1 for the big tables:
// the database is disk-bound, and parallel batches only fought each other.
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
