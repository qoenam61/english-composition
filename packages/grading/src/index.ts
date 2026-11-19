import type { Verdict } from "@app/domain";
import type { JudgeInfo, LlmJudge } from "@app/contracts";

export const GRADER_VERSION = "code-2";

/** 표준 축약형 → 풀어쓴 형태. (he's/she's 는 is 로 본다) */
const CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bi'm\b/g, "i am"], [/\bi've\b/g, "i have"], [/\bi'll\b/g, "i will"], [/\bi'd\b/g, "i would"],
  [/\b(you|we|they)'re\b/g, "$1 are"], [/\b(you|we|they)'ve\b/g, "$1 have"], [/\b(you|we|they|he|she|it)'ll\b/g, "$1 will"], [/\b(you|we|they|he|she)'d\b/g, "$1 would"],
  [/\b(he|she|it|that|there|here|what|who|where|how|when|why)'s\b/g, "$1 is"], [/\blet's\b/g, "let us"],
  [/\bdon't\b/g, "do not"], [/\bdoesn't\b/g, "does not"], [/\bdidn't\b/g, "did not"],
  [/\bcan't\b/g, "cannot"], [/\bwon't\b/g, "will not"], [/\bisn't\b/g, "is not"], [/\baren't\b/g, "are not"],
  [/\bwasn't\b/g, "was not"], [/\bweren't\b/g, "were not"], [/\bhaven't\b/g, "have not"], [/\bhasn't\b/g, "has not"], [/\bhadn't\b/g, "had not"],
  [/\bwouldn't\b/g, "would not"], [/\bcouldn't\b/g, "could not"], [/\bshouldn't\b/g, "should not"], [/\bmustn't\b/g, "must not"],
  [/\b(could|would|should|must)'ve\b/g, "$1 have"],
  [/\bgonna\b/g, "going to"], [/\bwanna\b/g, "want to"], [/\bgotta\b/g, "got to"], [/\bgimme\b/g, "give me"], [/\blemme\b/g, "let me"],
];

/** 대화 맥락상 자연스러운 추임새: 문장 맨 앞의 "Yes, " "Well, " 등(구두점이 붙은 경우만). */
export const FILLER_RE = /^\s*(?:(?:yes|yeah|yep|yup|no|nope|well|sure|actually|oh|okay|ok|hmm|honestly|anyway|um|uh|so|right)\s*[,.!…]+\s*)+/i;
export const stripFillers = (s: string) => s.replace(FILLER_RE, "");

/** 대소문자·구두점·공백·축약형·앞 추임새 차이를 없앤 비교용 문자열. genderFree 면 he/she 류를 한 부류로 본다. */
export function normalize(s: string, genderFree = false): string {
  let t = stripFillers(s).toLowerCase().replace(/[’‘]/g, "'");
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  t = t.replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
  if (genderFree) t = t.replace(/\b(he|she)\b/g, "3sg").replace(/\b(him|her|his|hers)\b/g, "3obj").replace(/\b(himself|herself)\b/g, "3self");
  return t;
}
const stripArticles = (s: string) => s.split(" ").filter((w) => w !== "a" && w !== "an" && w !== "the").join(" ");

/** 한국어 제시문에 성별이 드러나는 지칭(그녀·그는 등)이 없으면 he/she 를 구분하지 않는다. 친족어(언니·남편 등)는 주어의 성별을 정하지 못하므로 지칭으로 보지 않는다(관대하게 처리). */
export function isGenderFree(ko?: string): boolean {
  if (!ko) return false;
  return !/(그녀|그는|그가|그의|그를|그에게|그한테|그분이|그분은|그 남자|그 여자|그 사람은 남자|그 사람은 여자)/.test(ko);
}

export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)] as number[]);
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m]![n]!;
}

export type GradeResult = { verdict: Verdict; by: "code" | "llm"; comment?: string } | { verdict: "ERROR"; error: string };

/** 1차 로컬 판정: 정규화 일치 PASS, 관사만 다르면 PASS, 오타 수준이면 MINOR_TYPO, 아니면 undefined(LLM에 넘김). */
export function codeJudge(input: string, answers: string[], genderFree = false): Verdict | undefined {
  const i = normalize(input, genderFree);
  if (!i) return "FAIL";
  const ans = answers.map((a) => normalize(a, genderFree));
  if (ans.includes(i)) return "PASS";
  const ia = stripArticles(i);
  if (ans.some((a) => stripArticles(a) === ia)) return "PASS";
  const best = Math.min(...ans.map((a) => editDistance(i, a)));
  const len = Math.max(...ans.map((a) => a.length));
  if (best <= Math.max(1, Math.floor(len * 0.08)) && i.split(" ").length === ans[0]!.split(" ").length) return "MINOR_TYPO";
  return undefined;
}

export class GradingService {
  private cache = new Map<string, { verdict: Verdict; comment?: string }>();
  constructor(private llm?: LlmJudge) {}

  /** 1차 로컬 비교 → 불일치 시 2차 LLM 판정. info.ko 로 성별 무관 여부를 정한다. */
  async grade(input: string, answers: string[], context?: string, info: JudgeInfo = {}): Promise<GradeResult> {
    const genderFree = info.genderFree ?? isGenderFree(info.ko);
    const c = codeJudge(input, answers, genderFree);
    if (c) return { verdict: c, by: "code" };
    const key = normalize(input, genderFree) + "|" + answers.join("|");
    const hit = this.cache.get(key);
    if (hit) return { ...hit, by: "llm" };
    if (!this.llm) return { verdict: "FAIL", by: "code" }; // LLM 미연결 시 코드 기준으로 오답
    try {
      const r = await this.llm.judge(input, answers, context, { ...info, genderFree });
      const out = typeof r === "string" ? { verdict: r } : r;
      this.cache.set(key, out);
      return { ...out, by: "llm" };
    } catch (e) {
      return { verdict: "ERROR", error: e instanceof Error ? e.message : String(e) }; // 오류는 FAIL이 아니다
    }
  }
}
