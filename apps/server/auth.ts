import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 소셜 로그인: 제공사 정보는 표(데이터)이고 흐름은 하나다. 제공사에서 받는 것은 사용자 고유 ID뿐이며, 액세스 토큰은 ID를 받은 직후 버린다(저장·로그 금지). */
export interface Provider {
  name: string; label: string;
  authorize: string; token: string; userinfo: string;
  scope?: string; idPath: string;
  pkce?: boolean;            // 인증 코드 탈취 방지(PKCE)를 문서가 지원하는 제공사만 켠다
  secretOptional?: boolean;  // 클라이언트 시크릿이 선택인 제공사(카카오: 콘솔 설정에 따라)
  tokenNeedsState?: boolean; // 토큰 요청에 state 를 함께 보내야 하는 제공사(네이버)
  userinfoHeaders?: Record<string, string>;
  emailPath?: string;        // 관리자 이메일 확인에 쓰는 필드(검증된 이메일을 주는 제공사만)
  verifiedPath?: string;
}

// 2026-11-20 작성: 각 값은 제공사 공식 문서 기준으로 기억에서 옮긴 것이며 실제 키로 확인한 제공사는 아직 없다.
export const PROVIDERS: readonly Provider[] = [
  { name: "google", label: "Google", authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", userinfo: "https://openidconnect.googleapis.com/v1/userinfo", scope: "openid email", idPath: "sub", pkce: true, emailPath: "email", verifiedPath: "email_verified" },
  { name: "kakao", label: "카카오", authorize: "https://kauth.kakao.com/oauth/authorize", token: "https://kauth.kakao.com/oauth/token", userinfo: "https://kapi.kakao.com/v2/user/me", idPath: "id", secretOptional: true },
  { name: "naver", label: "네이버", authorize: "https://nid.naver.com/oauth2.0/authorize", token: "https://nid.naver.com/oauth2.0/token", userinfo: "https://openapi.naver.com/v1/nid/me", idPath: "response.id", tokenNeedsState: true },
  { name: "github", label: "GitHub", authorize: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token", userinfo: "https://api.github.com/user", idPath: "id", userinfoHeaders: { "user-agent": "english-pattern-app", accept: "application/vnd.github+json" } },
  { name: "discord", label: "Discord", authorize: "https://discord.com/oauth2/authorize", token: "https://discord.com/api/oauth2/token", userinfo: "https://discord.com/api/users/@me", scope: "identify", idPath: "id", pkce: true },
  { name: "microsoft", label: "Microsoft", authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token", userinfo: "https://graph.microsoft.com/oidc/userinfo", scope: "openid", idPath: "sub", pkce: true },
  { name: "facebook", label: "Facebook", authorize: "https://www.facebook.com/dialog/oauth", token: "https://graph.facebook.com/oauth/access_token", userinfo: "https://graph.facebook.com/me?fields=id", scope: "public_profile", idPath: "id" },
];

export type Env = Record<string, string | undefined>;
const envName = (p: Provider, k: "CLIENT_ID" | "CLIENT_SECRET") => `OAUTH_${p.name.toUpperCase()}_${k}`;
export const redirectUri = (env: Env, p: Provider) => `${(env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "")}/auth/${p.name}/callback`;

/** 키(와 PUBLIC_BASE_URL)가 .env 에 있는 제공사만 켠다. */
export function enabledProviders(env: Env): Provider[] {
  if (!/^https?:\/\//.test(env.PUBLIC_BASE_URL ?? "")) return [];
  return PROVIDERS.filter((p) => !!env[envName(p, "CLIENT_ID")] && (!!env[envName(p, "CLIENT_SECRET")] || p.secretOptional));
}

/** 계정 ID: 세션 비밀과 무관하게 항상 같은 값이고, 제공사 고유 ID는 해시로만 남긴다. */
export const accountId = (provider: string, sub: string) => "u-" + createHash("sha256").update(`epa:${provider}:${sub}`).digest("hex").slice(0, 16);

// ---- 세션 쿠키(HMAC 서명) ----
export interface Session { u: string; p: string; exp: number }
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest();
export const signSession = (secret: string, s: Session) => { const body = b64(JSON.stringify(s)); return `${body}.${b64(mac(secret, body))}`; };
export function verifySession(secret: string, token: string | undefined, now: number): Session | undefined {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig) return undefined;
  const want = mac(secret, body), got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return undefined;
  try { const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session; return typeof s.u === "string" && typeof s.exp === "number" && s.exp > now ? s : undefined; } catch { return undefined; }
}

export function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h ?? "").split(";")) { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
/** SameSite=Lax: 제공사에서 돌아오는 이동에도 쿠키가 따라와야 해서 Strict 는 쓸 수 없다. */
export const cookieHeader = (name: string, value: string, o: { maxAge: number; secure: boolean }) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${o.maxAge}${o.secure ? "; Secure" : ""}`;

// ---- 로그인 흐름 ----
export function newState() {
  const state = randomBytes(16).toString("hex"), verifier = randomBytes(32).toString("base64url");
  return { state, verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}
export const sameState = (a: string | undefined, b: string | null | undefined) => { if (!a || !b || a.length !== b.length) return false; return timingSafeEqual(Buffer.from(a), Buffer.from(b)); };

export function authorizeUrl(p: Provider, env: Env, state: string, challenge: string): string {
  const q = new URLSearchParams({ response_type: "code", client_id: env[envName(p, "CLIENT_ID")] ?? "", redirect_uri: redirectUri(env, p), state });
  if (p.scope) q.set("scope", p.scope);
  if (p.pkce) { q.set("code_challenge", challenge); q.set("code_challenge_method", "S256"); }
  return `${p.authorize}?${q}`;
}

const dig = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);

/** 인증 코드를 토큰으로 바꿔 사용자 고유 ID만 읽는다. 실패 사유는 밖으로 내보내지 않는다(제공사 응답을 되돌려주지 않기 위해). */
export async function identify(p: Provider, env: Env, code: string, state: string, verifier: string, fetchFn: typeof fetch = fetch): Promise<{ id: string; email?: string }> {
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(env, p), client_id: env[envName(p, "CLIENT_ID")] ?? "" });
  const secret = env[envName(p, "CLIENT_SECRET")]; if (secret) form.set("client_secret", secret);
  if (p.pkce) form.set("code_verifier", verifier);
  if (p.tokenNeedsState) form.set("state", state);
  const t = await fetchFn(p.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form, signal: AbortSignal.timeout(10_000) });
  if (!t.ok) throw new Error("token");
  const access = (await t.json() as { access_token?: unknown }).access_token;
  if (typeof access !== "string" || !access) throw new Error("token");
  const u = await fetchFn(p.userinfo, { headers: { authorization: `Bearer ${access}`, accept: "application/json", ...p.userinfoHeaders }, signal: AbortSignal.timeout(10_000) });
  if (!u.ok) throw new Error("userinfo");
  const ujson: unknown = await u.json(); const id = dig(ujson, p.idPath);
  if ((typeof id !== "string" && typeof id !== "number") || String(id) === "") throw new Error("userinfo");
  // 이메일은 관리자 판별 비교에만 쓰고 저장·로그하지 않는다. 제공사가 "검증됨"이라고 한 경우에만 인정한다.
  const body = ujson;
  const verified = p.verifiedPath ? dig(body, p.verifiedPath) : undefined; const mail = p.emailPath ? dig(body, p.emailPath) : undefined;
  return { id: String(id), email: typeof mail === "string" && (verified === true || verified === "true") ? mail.toLowerCase() : undefined };
}
