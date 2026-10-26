import { getCatalog, type Catalog } from "./providers";

/** The public page must finish even when an ATS has many slow result pages. */
export async function publicCatalogPreview(): Promise<Catalog | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getCatalog().catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 5000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
