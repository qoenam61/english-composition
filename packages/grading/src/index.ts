import type { Verdict } from "@app/domain";
import type { LlmJudge } from "@app/contracts";

export const GRADER_VERSION = "code-1";

const CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bi'm\b/g, "i am"], [/\bi've\b/g, "i have"], [/\bi'll\b/g, "i will"], [/\bi'd\b/g, "i would"],
  [/\byou're\b/g, "you are"], [/\bwe're\b/g, "we are"], [/\bthey're\b/g, "they are"],
  [/\bit's\b/g, "it is"], [/\bthat's\b/g, "that is"], [/\bthere's\b/g, "there is"], [/\blet's\b/g, "let us"],
  [/\bdon't\b/g, "do not"], [/\bdoesn't\b/g, "does not"], [/\bdidn't\b/g, "did not"],
  [/\bcan't\b/g, "cannot"], [/\bwon't\b/g, "will not"], [/\bisn't\b/g, "is not"], [/\baren't\b/g, "are not"],
];

/** 대소문자·구두점·공백·축약형 차이를 없앤 비교용 문자열. */
export function normalize(s: string): string {
  let t = s.toLowerCase().replace(/[’‘]/g, "'");
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  return t.replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
}
const stripArticles = (s: string) => s.split(" ").filter((w) => w !== "a" && w !== "an" && w !== "the").join(" ");

export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)] as number[]);
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m]![n]!;
}

export type GradeResult = { verdict: Verdict; by: "code" | "llm" } | { verdict: "ERROR"; error: string };

/** 코드 판정: 정규화 일치 PASS, 관사만 다르면 PASS, 오타 수준이면 MINOR_TYPO, 아니면 undefined(LLM에 넘김). */
export function codeJudge(input: string, answers: string[]): Verdict | undefined {
  const i = normalize(input);
  if (!i) return "FAIL";
  const ans = answers.map(normalize);
  if (ans.includes(i)) return "PASS";
  const ia = stripArticles(i);
  if (ans.some((a) => stripArticles(a) === ia)) return "PASS";
  const best = Math.min(...ans.map((a) => editDistance(i, a)));
  const len = Math.max(...ans.map((a) => a.length));
  if (best <= Math.max(1, Math.floor(len * 0.08)) && i.split(" ").length === ans[0]!.split(" ").length) return "MINOR_TYPO";
  return undefined;
}

export class GradingService {
  private cache = new Map<string, Verdict>();
  constructor(private llm?: LlmJudge) {}

  async grade(input: string, answers: string[], context?: string): Promise<GradeResult> {
    const c = codeJudge(input, answers);
    if (c) return { verdict: c, by: "code" };
    const key = normalize(input) + "|" + answers.join("|");
    const hit = this.cache.get(key);
    if (hit) return { verdict: hit, by: "llm" };
    if (!this.llm) return { verdict: "FAIL", by: "code" }; // LLM 미연결 시 코드 기준으로 오답
    try {
      const v = await this.llm.judge(input, answers, context);
      this.cache.set(key, v);
      return { verdict: v, by: "llm" };
    } catch (e) {
      return { verdict: "ERROR", error: e instanceof Error ? e.message : String(e) }; // 오류는 FAIL이 아니다
    }
  }
}
