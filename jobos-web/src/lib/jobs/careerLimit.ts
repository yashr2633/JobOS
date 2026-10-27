export interface CareerTurnWindow { startedAt: number; count: number; pending: boolean }
/** Four model turns per minute, with immediate clarification replies allowed. */
export function reserveCareerTurn(windows: Map<string, CareerTurnWindow>, userId: string, now: number): { ok: true; window: CareerTurnWindow } | { ok: false; error: string } {
  if (windows.size >= 2000) for (const [id, window] of windows) if (now - window.startedAt >= 60_000) windows.delete(id);
  const previous = windows.get(userId), current = previous && now - previous.startedAt < 60_000 ? previous : undefined;
  if (current?.pending) return { ok: false, error: "Please wait for your current reply to finish." };
  if (current && current.count >= 4) return { ok: false, error: "The assistant allowance for this minute is reached. Try shortly, or use the guided choices." };
  if (!current && windows.size >= 2000) return { ok: false, error: "The assistant is busy. The guided choices still work." };
  const window = { startedAt: current?.startedAt ?? now, count: (current?.count ?? 0) + 1, pending: true };
  windows.set(userId, window);
  return { ok: true, window };
}
