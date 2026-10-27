import type { Catalog } from "./providers.ts";

/** An outage must not become a successful zero-result response. */
export function availableAssistantCatalogs(results: PromiseSettledResult<Catalog>[]) {
  const catalogs = results.flatMap(result => result.status === "fulfilled" && (!result.value.sources?.length || result.value.sources.some(source => source.status === "ok")) ? [result.value] : []);
  if (!catalogs.length) return null;
  return {
    jobs: catalogs.flatMap(catalog => catalog.jobs),
    warnings: [...new Set([...catalogs.flatMap(catalog => catalog.warnings), ...(catalogs.length < results.length ? ["Some feeds could not load. Results may be incomplete."] : [])])],
  };
}
