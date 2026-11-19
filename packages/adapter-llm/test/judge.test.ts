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
