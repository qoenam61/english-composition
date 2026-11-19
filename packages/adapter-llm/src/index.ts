import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JudgeInfo, JudgeOutcome, LlmJudge } from "@app/contracts";

const PROMPT = `You judge one English answer from a Korean learner in a conversation-practice app.
Korean prompt (what the learner wanted to say): {ko}
Context line before the learner's turn: {context}
Target pattern: {template}
Model answer(s): {answers}
Learner's answer: {input}
{gender}
Choose ONE verdict:
- PASS: uses the target pattern correctly; grammar and meaning are right (wording may differ).
- OK_NO_COUNT: grammatical, natural and same meaning, but does NOT use the intended target pattern (e.g. "Will you go to the party?" instead of "Are you going to the party?").
- FAIL: grammar error, tense mismatch, or the meaning is distorted.
Greetings or fillers such as "Yes," / "Well," at the start are fine and never an error.
Then write "comment": ONE short Korean sentence (max 60 chars), no preamble.
- FAIL: the single most important correction (e.g. "과거 시점(yesterday)이므로 go 대신 went를 써야 해요.").
- OK_NO_COUNT: one-line nuance of why the model answer's pattern fits this situation better.
- PASS: a very short praise or pattern note.
Return ONLY JSON: {"verdict":"PASS|OK_NO_COUNT|FAIL","comment":"..."}`;

export function parseJudge(text: string): JudgeOutcome {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("판정 응답을 해석하지 못했다");
  const o = JSON.parse(m[0]) as { verdict?: string; comment?: string };
  if (o.verdict !== "PASS" && o.verdict !== "OK_NO_COUNT" && o.verdict !== "FAIL") throw new Error("알 수 없는 판정값");
  return { verdict: o.verdict, comment: typeof o.comment === "string" ? o.comment.trim().slice(0, 120) : undefined };
}

/** 사용자 컴퓨터의 `claude` CLI(구독 로그인)로 판정한다. 지침이 로드되지 않는 빈 디렉터리에서 최소 옵션으로 실행. */
export class ClaudeCliJudge implements LlmJudge {
  constructor(private opts: { model?: string; timeoutMs?: number; bin?: string } = {}) {}

  judge(input: string, answers: string[], context?: string, info: JudgeInfo = {}): Promise<JudgeOutcome> {
    const prompt = PROMPT.replace("{ko}", info.ko ?? "(none)").replace("{context}", context ?? "(none)").replace("{template}", info.template || "(none)")
      .replace("{answers}", answers.join(" / ")).replace("{input}", input)
      .replace("{gender}", info.genderFree ? "The Korean prompt has no gender, so he/she/him/her are interchangeable and never an error." : "");
    const dir = join(tmpdir(), "epa-judge"); mkdirSync(dir, { recursive: true });
    return new Promise((resolve, reject) => {
      const p = spawn(this.opts.bin ?? "claude", ["-p", "--model", this.opts.model ?? "sonnet", "--no-session-persistence", "--disable-slash-commands", "--tools", "", "--setting-sources", "", "--output-format", "json", prompt], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
      let out = ""; const timer = setTimeout(() => { p.kill(); reject(new Error("판정 시간 초과")); }, this.opts.timeoutMs ?? 45_000);
      p.stdout.on("data", (d) => (out += d)); p.on("error", (e) => { clearTimeout(timer); reject(e); });
      p.on("close", () => { clearTimeout(timer); try { resolve(parseJudge(String((JSON.parse(out) as { result?: string }).result ?? ""))); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); } });
    });
  }
}
