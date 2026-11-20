import { describe, expect, it, vi } from "vitest";
import { PROVIDERS, accountId, authorizeUrl, cookieHeader, enabledProviders, identify, newState, parseCookies, sameState, signSession, verifySession } from "./auth.js";

const base = { PUBLIC_BASE_URL: "https://x.example" };
const google = PROVIDERS.find((p) => p.name === "google")!, naver = PROVIDERS.find((p) => p.name === "naver")!, kakao = PROVIDERS.find((p) => p.name === "kakao")!;

describe("제공사 활성화", () => {
  it("키가 없으면 하나도 켜지지 않는다", () => expect(enabledProviders(base)).toEqual([]));
  it("PUBLIC_BASE_URL 이 없으면 키가 있어도 꺼진다", () => expect(enabledProviders({ OAUTH_GOOGLE_CLIENT_ID: "i", OAUTH_GOOGLE_CLIENT_SECRET: "s" })).toEqual([]));
  it("시크릿이 필요한 제공사는 ID만으로 켜지지 않고, 카카오는 ID만으로 켜진다", () => {
    expect(enabledProviders({ ...base, OAUTH_GOOGLE_CLIENT_ID: "i" }).map((p) => p.name)).toEqual([]);
    expect(enabledProviders({ ...base, OAUTH_KAKAO_CLIENT_ID: "i", OAUTH_GOOGLE_CLIENT_ID: "i", OAUTH_GOOGLE_CLIENT_SECRET: "s" }).map((p) => p.name)).toEqual(["google", "kakao"]);
  });
});

describe("세션 쿠키", () => {
  const now = 1_000_000;
  it("서명한 쿠키는 통과한다", () => expect(verifySession("k", signSession("k", { u: "u-1", p: "google", exp: now + 1 }), now)?.u).toBe("u-1"));
  it("변조·다른 비밀·만료는 거부한다", () => {
    const t = signSession("k", { u: "u-1", p: "google", exp: now + 1000 });
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "me", p: "x", exp: now + 1000 })).toString("base64url");
    expect(verifySession("k", `${forged}.${sig}`, now)).toBeUndefined();
    expect(verifySession("other", t, now)).toBeUndefined();
    expect(verifySession("k", t, now + 2000)).toBeUndefined();
    expect(verifySession("k", `${body}`, now)).toBeUndefined(); expect(verifySession("k", undefined, now)).toBeUndefined();
  });
  it("쿠키 파서와 헤더", () => { expect(parseCookies("a=1; epa_s=x.y")).toEqual({ a: "1", epa_s: "x.y" }); expect(cookieHeader("n", "v", { maxAge: 5, secure: true })).toBe("n=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=5; Secure"); });
});

describe("계정 ID", () => {
  it("같은 제공사 ID는 같은 계정, 원본 ID는 드러나지 않는다", () => {
    expect(accountId("google", "12345")).toBe(accountId("google", "12345")); expect(accountId("google", "12345")).not.toBe(accountId("kakao", "12345"));
    expect(accountId("google", "12345")).toMatch(/^u-[0-9a-f]{16}$/); expect(accountId("google", "12345")).not.toContain("12345");
  });
});

describe("로그인 흐름(가짜 제공사)", () => {
  const env = { ...base, OAUTH_GOOGLE_CLIENT_ID: "cid", OAUTH_GOOGLE_CLIENT_SECRET: "sec", OAUTH_NAVER_CLIENT_ID: "n", OAUTH_NAVER_CLIENT_SECRET: "ns" };
  it("인증 주소에 state·PKCE·고정된 redirect_uri 가 들어간다", () => {
    const { state, challenge } = newState(); const u = new URL(authorizeUrl(google, env, state, challenge));
    expect(u.searchParams.get("state")).toBe(state); expect(u.searchParams.get("code_challenge_method")).toBe("S256"); expect(u.searchParams.get("scope")).toBe("openid email");
    expect(u.searchParams.get("redirect_uri")).toBe("https://x.example/auth/google/callback");
    expect(new URL(authorizeUrl(naver, env, state, challenge)).searchParams.has("code_challenge")).toBe(false);
  });
  it("state 불일치는 거부한다", () => { expect(sameState("abc", "abc")).toBe(true); expect(sameState("abc", "abd")).toBe(false); expect(sameState(undefined, "abc")).toBe(false); expect(sameState("abc", "abcd")).toBe(false); });
  it("코드를 토큰으로 바꿔 고유 ID만 읽고, 시크릿은 본문으로만 보낸다", async () => {
    const f = vi.fn(async (u: string) => u.includes("token") ? { ok: true, json: async () => ({ access_token: "AT" }) } : { ok: true, json: async () => ({ sub: "g-777" }) });
    expect((await identify(google, env, "CODE", "st", "VER", f as unknown as typeof fetch)).id).toBe("g-777");
    const tokenCall = f.mock.calls[0] as unknown as [string, { body: URLSearchParams; headers: Record<string, string> }];
    expect(tokenCall[1].body.get("code_verifier")).toBe("VER"); expect(tokenCall[1].body.get("client_secret")).toBe("sec");
    expect((f.mock.calls[1] as unknown as [string, { headers: Record<string, string> }])[1].headers.authorization).toBe("Bearer AT");
  });
  it("네이버는 중첩 ID(response.id)와 token 요청의 state 를 쓰고, 카카오 숫자 ID도 문자열로 받는다", async () => {
    const f = vi.fn(async (u: string) => u.includes("oauth2.0/token") ? { ok: true, json: async () => ({ access_token: "AT" }) } : { ok: true, json: async () => ({ response: { id: "nv1" } }) });
    expect((await identify(naver, env, "C", "ST", "V", f as unknown as typeof fetch)).id).toBe("nv1");
    expect(((f.mock.calls[0] as unknown as [string, { body: URLSearchParams }])[1]).body.get("state")).toBe("ST");
    const k = vi.fn(async (u: string) => u.includes("oauth/token") ? { ok: true, json: async () => ({ access_token: "AT" }) } : { ok: true, json: async () => ({ id: 987654321 }) });
    expect((await identify(kakao, { ...base, OAUTH_KAKAO_CLIENT_ID: "k" }, "C", "S", "V", k as unknown as typeof fetch)).id).toBe("987654321");
  });
  it("구글은 검증된 이메일만 소문자로 돌려주고, 미검증이면 버린다", async () => {
    const mk = (verified: unknown) => vi.fn(async (u: string) => u.includes("token") ? { ok: true, json: async () => ({ access_token: "AT" }) } : { ok: true, json: async () => ({ sub: "s1", email: "Me@Example.com", email_verified: verified }) });
    expect((await identify(google, env, "C", "S", "V", mk(true) as unknown as typeof fetch)).email).toBe("me@example.com");
    expect((await identify(google, env, "C", "S", "V", mk(false) as unknown as typeof fetch)).email).toBeUndefined();
    expect((await identify(google, env, "C", "S", "V", mk(undefined) as unknown as typeof fetch)).email).toBeUndefined();
  });
  it("제공사 오류는 내용을 드러내지 않는 일반 오류로 바뀐다", async () => {
    await expect(identify(google, env, "C", "S", "V", (async () => ({ ok: false, json: async () => ({ secret: "leak" }) })) as unknown as typeof fetch)).rejects.toThrow("token");
    const noId = vi.fn(async (u: string) => u.includes("token") ? { ok: true, json: async () => ({ access_token: "AT" }) } : { ok: true, json: async () => ({}) });
    await expect(identify(google, env, "C", "S", "V", noId as unknown as typeof fetch)).rejects.toThrow("userinfo");
  });
});
