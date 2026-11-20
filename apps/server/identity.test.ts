import { describe, expect, it } from "vitest";
import { ipKey, parseOwners, userIdFor } from "./identity.js";

describe("접속 IP 기준 계정", () => {
  const none = new Set<string>();
  it("이 컴퓨터에서 직접 연 접속은 기존 계정(me)", () => expect(userIdFor({}, "127.0.0.1", none).userId).toBe("me"));
  it("터널 경유는 CF-Connecting-IP 로 구분하고 같은 IP는 같은 계정, 다른 IP는 다른 계정", () => {
    const a = userIdFor({ "cf-connecting-ip": "1.2.3.4" }, "127.0.0.1", none).userId, b = userIdFor({ "cf-connecting-ip": "1.2.3.4" }, "10.0.0.9", none).userId, c = userIdFor({ "cf-connecting-ip": "5.6.7.8" }, "127.0.0.1", none).userId;
    expect(a).toMatch(/^ip-[0-9a-f]{12}$/); expect(a).toBe(b); expect(a).not.toBe(c);
  });
  it("원본 IP 가 아이디에 드러나지 않는다", () => expect(userIdFor({ "cf-connecting-ip": "1.2.3.4" }, "x", none).userId).not.toContain("1.2.3.4"));
  it("OWNER_IPS 에 적은 IP 는 기존 기록(me)을 쓴다", () => expect(userIdFor({ "cf-connecting-ip": "1.2.3.4" }, "x", parseOwners(" 1.2.3.4 , 9.9.9.9"))).toMatchObject({ userId: "me" }));
  it("X-Forwarded-For 의 첫 주소를 쓴다", () => expect(userIdFor({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, "127.0.0.1", none).userId).toBe(userIdFor({ "cf-connecting-ip": "1.2.3.4" }, "127.0.0.1", none).userId));
  it("IPv6 는 앞 64비트로 묶어 뒤쪽 주소가 바뀌어도 같은 계정", () => {
    expect(ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(ipKey("2001:db8:1:2:1111:2222:3333:4444"));
    expect(ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).not.toBe(ipKey("2001:db8:1:3:aaaa:bbbb:cccc:dddd"));
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64"); expect(ipKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("관리자 판정 재료", () => {
  it("이 컴퓨터 직접 접속만 local, 터널 경유·OWNER_IPS 는 local 아님", () => {
    expect(userIdFor({}, "127.0.0.1", new Set()).local).toBe(true);
    expect(userIdFor({ "cf-connecting-ip": "127.0.0.1" }, "127.0.0.1", new Set()).local).toBe(false);
    expect(userIdFor({ "cf-connecting-ip": "1.2.3.4" }, "x", parseOwners("1.2.3.4")).local).toBe(false);
  });
});
