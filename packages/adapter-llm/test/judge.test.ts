import { describe, expect, it } from "vitest";
import { parseJudge } from "../src/index.js";

describe("parseJudge", () => {
  it("JSON 판정을 해석한다", () => expect(parseJudge('{"verdict":"OK_NO_COUNT","comment":"계획을 물을 땐 be going to"}')).toEqual({ verdict: "OK_NO_COUNT", comment: "계획을 물을 땐 be going to" }));
  it("코드펜스·앞뒤 말이 있어도 해석한다", () => expect(parseJudge('```json\n{"verdict":"FAIL","comment":"go→went"}\n```').verdict).toBe("FAIL"));
  it("알 수 없는 판정값은 오류", () => expect(() => parseJudge('{"verdict":"MAYBE"}')).toThrow());
  it("JSON 이 없으면 오류", () => expect(() => parseJudge("모르겠어요")).toThrow());
});

import { ChainJudge, OpenAiCompatJudge, buildPrompt } from "../src/index.js";
import { vi } from "vitest";

describe("판정기 조합", () => {
  it("앞 판정기가 실패하면 다음으로 넘어간다", async () => {
    const bad = { judge: async () => { throw new Error("429"); } }, ok = { judge: async () => ({ verdict: "PASS" as const, comment: "굿" }) };
    expect(await new ChainJudge([bad, ok]).judge("a", ["a"])).toEqual({ verdict: "PASS", comment: "굿" });
  });
  it("모두 실패하면 마지막 오류를 던진다", async () => { await expect(new ChainJudge([{ judge: async () => { throw new Error("x"); } }]).judge("a", ["a"])).rejects.toThrow("x"); });
  it("OpenAI 호환 응답을 해석하고 키는 헤더로만 보낸다", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"verdict":"FAIL","comment":"go→went"}' } }] }) }));
    vi.stubGlobal("fetch", f);
    const r = await new OpenAiCompatJudge({ baseUrl: "https://x/v1/", apiKey: "K", model: "m" }).judge("I go", ["I went"]);
    expect(r).toEqual({ verdict: "FAIL", comment: "go→went" });
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://x/v1/chat/completions"); expect(init.headers.authorization).toBe("Bearer K"); expect(init.body).not.toContain("\"K\"");
    vi.unstubAllGlobals();
  });
  it("프롬프트에 입력이 그대로 들어간다($ 패턴 포함)", () => expect(buildPrompt("cost $& now", ["a"])).toContain("cost $& now"));
});

import { GeminiJudge } from "../src/index.js";

describe("실패 단계 건너뛰기와 Gemini 모델 선택", () => {
  it("실패한 판정기는 쉬는 동안 다시 부르지 않는다", async () => {
    let t = 0, bad = 0;
    const flaky = { judge: async () => { bad++; throw new Error("429"); } }, ok = { judge: async () => ({ verdict: "PASS" as const }) };
    const c = new ChainJudge([flaky, ok], 60_000, () => t);
    await c.judge("a", ["a"]); await c.judge("a", ["a"]); expect(bad).toBe(1);
    t = 61_000; await c.judge("a", ["a"]); expect(bad).toBe(2);
  });
  it("모두 쉬는 중이어도 처음부터 다시 시도한다", async () => {
    let n = 0; const only = { judge: async () => { n++; if (n < 2) throw new Error("x"); return { verdict: "PASS" as const }; } };
    const c = new ChainJudge([only], 60_000, () => 0);
    await expect(c.judge("a", ["a"])).rejects.toThrow("x"); expect((await c.judge("a", ["a"])).verdict).toBe("PASS");
  });
  it("모델을 지정하지 않으면 가장 최신 flash-lite 를 고른다(preview·latest 제외)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: { body?: string }) => {
      calls.push(u);
      if (u.includes("/v1beta/models?")) return { ok: true, json: async () => ({ models: [
        { name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.0-flash-lite", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.5-flash-lite-preview", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-flash-lite-latest", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] }] }) };
      return { ok: true, json: async () => ({ choices: [{ message: { content: `{"verdict":"PASS","comment":"${JSON.parse(init!.body!).model}"}` } }] }) };
    }));
    const r = await new GeminiJudge({ apiKey: "K" }).judge("a", ["a"]);
    expect(r).toEqual({ verdict: "PASS", comment: "gemini-3.0-flash-lite" });
    expect(calls.some((u) => u.includes("/v1beta/openai/chat/completions"))).toBe(true);
    vi.unstubAllGlobals();
  });
});
