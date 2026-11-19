import { describe, expect, it } from "vitest";
import { parseJudge } from "../src/index.js";

describe("parseJudge", () => {
  it("JSON 판정을 해석한다", () => expect(parseJudge('{"verdict":"OK_NO_COUNT","comment":"계획을 물을 땐 be going to"}')).toEqual({ verdict: "OK_NO_COUNT", comment: "계획을 물을 땐 be going to" }));
  it("코드펜스·앞뒤 말이 있어도 해석한다", () => expect(parseJudge('```json\n{"verdict":"FAIL","comment":"go→went"}\n```').verdict).toBe("FAIL"));
  it("알 수 없는 판정값은 오류", () => expect(() => parseJudge('{"verdict":"MAYBE"}')).toThrow());
  it("JSON 이 없으면 오류", () => expect(() => parseJudge("모르겠어요")).toThrow());
});
