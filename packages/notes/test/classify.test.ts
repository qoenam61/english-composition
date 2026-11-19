import { describe, expect, it } from "vitest";
import { classifyError } from "../src/index";

describe("classifyError", () => {
  it("어순만 다르면 패턴/어순", () => expect(classifyError("I like very much it", "I like it very much").type).toBe("pattern_order"));
  it("관사만 다르면 관사/전치사", () => expect(classifyError("I bought car", "I bought a car").type).toBe("article_prep"));
  it("-s·시제 변형은 시제/수일치", () => expect(classifyError("She go home", "She goes home").type).toBe("tense"));
  it("다른 단어는 어휘 선택", () => expect(classifyError("I like pizza", "I love pasta").type).toBe("vocab"));
  it("대소문자·문장부호는 무시한다", () => expect(classifyError("I like it!", "i like it").type).not.toBe("article_prep"));
});
