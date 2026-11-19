import { describe, expect, it } from "vitest";
import { GradingService, codeJudge, normalize } from "../src/index.js";

const A = ["I would like to book a table for two."];
describe("code judge (골드셋 형태)", () => {
  it.each([
    ["I would like to book a table for two.", "PASS"],
    ["i would like to book a table for two", "PASS"],
    ["I'd like to book a table for two.", "PASS"],
    ["I would like to book the table for two.", "PASS"],
    ["I would like to book a tabel for two.", "MINOR_TYPO"],
    ["", "FAIL"],
  ])("%s -> %s", (input, v) => expect(codeJudge(input, A)).toBe(v));
  it("전혀 다른 문장은 LLM 판정 대상", () => expect(codeJudge("Give me a table.", A)).toBeUndefined());
  it("정규화", () => expect(normalize("I’m  Happy!")).toBe("i am happy"));
});
describe("GradingService", () => {
  it("LLM 오류는 FAIL이 아니라 ERROR", async () => {
    const g = new GradingService({ judge: async () => { throw new Error("down"); } });
    expect(await g.grade("Give me a table.", A)).toEqual({ verdict: "ERROR", error: "down" });
  });
  it("LLM 결과를 캐시한다", async () => {
    let calls = 0;
    const g = new GradingService({ judge: async () => (calls++, "PASS" as const) });
    await g.grade("Please reserve two seats.", A); await g.grade("please reserve two seats", A);
    expect(calls).toBe(1);
  });
  it("LLM 없으면 의미가 다른 입력은 FAIL", async () => {
    expect(await new GradingService().grade("Give me a table.", A)).toMatchObject({ verdict: "FAIL" });
  });
});
