import type { AttemptRecord } from "@app/contracts";

export interface DayStat { date: string; attempts: number; firstTryCorrectRate: number; avgElapsedMs: number; patternsCompleted: number }
export interface StatsView { totalAttempts: number; totalCompleted: number; streakDays: number; today: DayStat; days: DayStat[] }

const day = (t: number, tzOffsetMin: number) => new Date(t - tzOffsetMin * 60_000).toISOString().slice(0, 10);

/** 첫 시도 정답률: 그 패턴·문장을 그날 처음 푼 시도가 PASS 인 비율(힌트 없이). */
export function summarize(attempts: AttemptRecord[], completions: Array<{ patternId: number; at: number; undoneAt?: number }>, now: number, tzOffsetMin = -540): StatsView {
  const byDay = new Map<string, { n: number; first: number; firstOk: number; elapsed: number; done: number; seen: Set<number> }>();
  const get = (d: string) => byDay.get(d) ?? (byDay.set(d, { n: 0, first: 0, firstOk: 0, elapsed: 0, done: 0, seen: new Set() }), byDay.get(d)!);
  for (const a of attempts) {
    const g = get(day(a.at, tzOffsetMin)); g.n++; g.elapsed += a.elapsedMs;
    if (!g.seen.has(a.sentenceId)) { g.seen.add(a.sentenceId); g.first++; if (a.verdict === "PASS" && !a.usedHint) g.firstOk++; }
  }
  for (const c of completions) get(day(c.at, tzOffsetMin)).done++;
  const days: DayStat[] = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, g]) => ({ date, attempts: g.n, firstTryCorrectRate: g.first ? g.firstOk / g.first : 0, avgElapsedMs: g.n ? Math.round(g.elapsed / g.n) : 0, patternsCompleted: g.done }));
  const today = day(now, tzOffsetMin);
  let streak = 0; const set = new Set(days.map((d) => d.date));
  for (let t = now; set.has(day(t, tzOffsetMin)) || (streak === 0 && day(t, tzOffsetMin) === today); t -= 86_400_000) { if (set.has(day(t, tzOffsetMin))) streak++; else break; }
  return { totalAttempts: attempts.length, totalCompleted: new Set(completions.filter((c) => c.undoneAt === undefined).map((c) => c.patternId)).size, streakDays: streak, today: days.find((d) => d.date === today) ?? { date: today, attempts: 0, firstTryCorrectRate: 0, avgElapsedMs: 0, patternsCompleted: 0 }, days };
}
