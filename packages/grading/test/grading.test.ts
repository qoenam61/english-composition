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

describe("1차 로컬 정규화", () => {
  it.each([
    ["He's a doctor.", ["He is a doctor."]], ["It's raining.", ["It is raining."]], ["I'm tired.", ["I am tired."]],
    ["I don't know.", ["I do not know."]], ["I'm gonna leave.", ["I am going to leave."]], ["They're here", ["They are here."]],
    ["Yes, I do.", ["I do."]], ["Well, I think so.", ["I think so."]], ["No, I don't.", ["I do not."]], ["Actually,  it's fine!", ["It is fine."]],
  ])("%s 는 정답", (input, ans) => expect(codeJudge(input, ans)).toBe("PASS"));
  it("구두점 없는 No problem 은 추임새로 보지 않는다", () => expect(codeJudge("No problem.", ["Problem."])).not.toBe("PASS"));
  it("한국어에 성별 지칭이 없으면 he/she 는 같은 것", () => {
    expect(codeJudge("She is a doctor.", ["He is a doctor."], true)).toBe("PASS");
    expect(codeJudge("She is a doctor.", ["He is a doctor."], false)).not.toBe("PASS");
  });
  it("성별 판정", async () => { const { isGenderFree } = await import("../src/index.js"); expect(isGenderFree("걔 내 언니랑 동갑이야.")).toBe(true); expect(isGenderFree("그녀는 의사예요.")).toBe(false); expect(isGenderFree("그는 학생이에요.")).toBe(false); });
  it("LLM 코멘트를 그대로 전달한다", async () => {
    const g = new GradingService({ judge: async () => ({ verdict: "FAIL" as const, comment: "go→went" }) });
    expect(await g.grade("I go there yesterday.", A, undefined, { ko: "어제 거기 갔어요." })).toMatchObject({ verdict: "FAIL", comment: "go→went", by: "llm" });
  });
});
