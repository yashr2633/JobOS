/** Prefer explicit role sections over company introductions when deriving fit. */
export function roleEvidenceText(description: string): string {
  const start = /^\s*(?:(?:key|your)\s+responsibilities|responsibilities|(?:required|preferred|minimum)\s+qualifications|qualifications|requirements|what you(?:'|’)ll do|what you will do)\s*:?\s*$/im.exec(description);
  return start ? description.slice(start.index) : description;
}
