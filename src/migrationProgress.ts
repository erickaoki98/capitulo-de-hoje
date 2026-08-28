export async function maybeCollectMigrationProgress<T>(
  enabled: boolean,
  load: () => Promise<T>,
): Promise<T | null> {
  return enabled ? await load() : null;
}
