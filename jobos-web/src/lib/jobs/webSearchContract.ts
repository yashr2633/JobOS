export interface WebSearchResult { text: string; suggestionsHtml: string; sources: { title: string; url: string }[]; citations: { start: number; end: number; sourceIndexes: number[] }[]; searchedAt: string }
export function acceptableSearchText(text: string, today: string): boolean {
  if (/₹|\b\d[\d,]*\s*(?:[\p{L}&/-]+\s+){0,6}(?:vacanc(?:y|ies)|openings|posts|jobs)\b/iu.test(text)) return false;
  if ([...text.matchAll(/^\s*\d+[.)]\s/gm)].length > 6) return false;
  const deadlines = text.match(/[^\n.!?]*(?:deadline|last date|apply by|closing date|applications? close)[^\n.!?]*/gi) ?? [];
  return deadlines.every(sentence => {
    if (/\b(?:passed|expired|closed)\b/i.test(sentence)) return false;
    const dates = sentence.match(/\b(?:\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/g) ?? [];
    return dates.every(date => { const time = Date.parse(date); return !Number.isFinite(time) || time >= Date.parse(today); });
  });
}
export function publicSearchLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || /^\d+(\.\d+){3}$/.test(url.hostname)
      || url.hostname.startsWith("[") || !url.hostname.includes(".") || /(^|\.)(localhost|local|internal|home|test)$/.test(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}
/** Google-provided suggestion markup is displayed unchanged, in a shadow root. */
export function safeSearchSuggestions(html: unknown): html is string {
  if (typeof html !== "string" || !html.trim() || html.length > 30_000) return false;
  if (/<\s*(script|iframe|object|embed|form|input|button|link|meta|base|img|video|audio|foreignObject|animate|use)\b|\bon[a-z]+\s*=|javascript\s*:|@(?!media\b)|\burl\s*\(|image-set\s*\(|\\/i.test(html)) return false;
  const tags = [...html.matchAll(/<\/?\s*([a-z][a-z0-9-]*)\b/gi)].map(match => match[1].toLowerCase());
  if (tags.some(tag => !["style", "div", "span", "a", "svg", "path", "circle", "p", "br"].includes(tag))) return false;
  const links = [...html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)];
  if ((html.match(/\bhref\s*=/gi) ?? []).length !== links.length) return false;
  return links.length > 0 && links.every(([, , href]) => {
    const safe = publicSearchLink(href);
    return !!safe && ["vertexaisearch.cloud.google.com", "www.google.com", "google.com"].includes(new URL(safe).hostname);
  });
}
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
export function readGroundedResponse(value: unknown, searchedAt: string): WebSearchResult | null {
  const body = row(value), candidate = row(Array.isArray(body.candidates) ? body.candidates[0] : null);
  if (candidate.finishReason !== "STOP") return null;
  const content = row(candidate.content), grounding = row(candidate.groundingMetadata);
  const text = (Array.isArray(content.parts) ? content.parts : []).map(part => row(part).text).filter((part): part is string => typeof part === "string").join("");
  const suggestionsHtml = row(grounding.searchEntryPoint).renderedContent;
  if (!text.trim() || text.length > 25_000 || !acceptableSearchText(text, searchedAt.slice(0, 10)) || !safeSearchSuggestions(suggestionsHtml)) return null;
  const indexMap = new Map<number, number>();
  const sources = (Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks : []).flatMap((chunk, index) => {
    const source = row(row(chunk).web), url = publicSearchLink(source.uri);
    if (!url || typeof source.title !== "string") return [];
    indexMap.set(index, indexMap.size); return [{ title: source.title, url }];
  });
  const bytes = new TextEncoder().encode(text), decoder = new TextDecoder();
  const citations = (Array.isArray(grounding.groundingSupports) ? grounding.groundingSupports : []).flatMap(support => {
    const item = row(support), segment = row(item.segment);
    if (segment.partIndex && segment.partIndex !== 0) return [];
    if (typeof segment.endIndex !== "number" || segment.endIndex <= 0 || segment.endIndex > bytes.length) return [];
    const start = decoder.decode(bytes.slice(0, typeof segment.startIndex === "number" ? segment.startIndex : 0)).length;
    const end = decoder.decode(bytes.slice(0, segment.endIndex)).length;
    const sourceIndexes = (Array.isArray(item.groundingChunkIndices) ? item.groundingChunkIndices : []).flatMap(index => typeof index === "number" && indexMap.has(index) ? [indexMap.get(index)!] : []);
    return sourceIndexes.length && start < end ? [{ start, end, sourceIndexes }] : [];
  });
  return sources.length && citations.length ? { text, suggestionsHtml, sources, citations, searchedAt } : null;
}
export function validateWebQuery(value: unknown): { keywords: string; location: string } | null {
  const input = row(value);
  if (typeof input.keywords !== "string" || typeof input.location !== "string") return null;
  const keywords = input.keywords.trim(), location = input.location.trim();
  if (keywords.length > 120 || location.length < 2 || location.length > 100) return null;
  const combined = `${keywords} ${location}`;
  if (/[@<>]|https?:|\b\d{10,}\b/.test(combined) || !/^[\p{L}\p{N}\p{M}\s&/+.#(),'-]+$/u.test(combined)) return null;
  return { keywords, location };
}
