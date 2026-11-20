import { createServer } from "node:http";

// 프로젝트 루트의 .env 를 읽는다(이미 설정된 환경변수가 우선, 파일이 없으면 무시). .env 는 git 에서 제외돼 있다.
try { process.loadEnvFile(new URL("../../.env", import.meta.url)); } catch { /* .env 없음 */ }
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteContentRepository } from "@app/adapter-content";
import { SqliteUserStore } from "@app/adapter-userdb";
import { GradingService } from "@app/grading";
import { ChainJudge, ClaudeCliJudge, GeminiJudge, OpenAiCompatJudge } from "@app/adapter-llm";
import type { LlmJudge } from "@app/contracts";
import { StudyService } from "@app/app";
import { PROVIDERS, accountId, authorizeUrl, cookieHeader, enabledProviders, identify, newState, parseCookies, sameState, signSession, verifySession } from "./auth.js";
import { parseOwners, userIdFor } from "./identity.js";

// 조립 지점(composition root): 어떤 어댑터를 쓸지는 여기서만 정한다.
const root = fileURLToPath(new URL("../../", import.meta.url));
const content = new SqliteContentRepository(process.env.PACK ?? root + "dist/pack-personal.sqlite");
// 저장소: 계정마다 DB 파일을 따로 둔다(data/users/<계정ID>.sqlite). 기존 기록("me")만 data/user.sqlite 를 쓰고, 로그인하지 않은 방문자는 저장하지 않는 메모리 DB를 쓴다.
const meStore = new SqliteUserStore(process.env.USER_DB ?? root + "data/user.sqlite");
const usersDir = process.env.USERS_DIR ?? root + "data/users/";
const validAccount = (id: string) => /^u-[0-9a-f]{16}$/.test(id); // 파일 이름이 되므로 형식을 엄격히 검사한다(경로 조작 방지)
const userFile = (id: string) => usersDir + id + ".sqlite";
function storeFor(userId: string): SqliteUserStore {
  if (userId === "me") return meStore;
  if (validAccount(userId)) { mkdirSync(usersDir, { recursive: true }); return new SqliteUserStore(userFile(userId)); }
  return new SqliteUserStore(); // 비로그인 방문자: 메모리(저장 안 함)
}
// 판정·정정·코멘트 설정(환경변수). JUDGE_CHAIN=앞에서부터 시도할 판정기(쉼표 구분). 기본은 무료 모델을 낮은 단계부터:
//   groq-qwen → gemini(flash-lite 자동 선택) → claude(haiku, 구독 한도, 마지막 비상용). 같은 Groq 의 다른 모델(groq-120b, groq-20b)은 한도를 모델별로 따로 주는지 확인하지 못해 기본에서 뺐고, JUDGE_CHAIN 으로 넣을 수 있다(20b 는 8건 시험에서 정답을 오답 처리하고 응답 해석도 1건 실패).
//   Groq 한도: 모델마다 헤더에 하루 1,000회·분당 8,000토큰이 표시되지만, 한 모델이 소진되면 다른 모델도 막히는지는 확인하지 못했다. 한도·오류가 난 단계는 60초 쉬고 다음으로 넘어간다.
//   키: GROQ_API_KEY, GOOGLE_AI_STUDIO_API_KEY(없는 단계는 건너뜀). 모델 변경: GROQ_MODEL_20B/GROQ_MODEL_QWEN/GROQ_MODEL_120B, GOOGLE_AI_MODEL, JUDGE_MODEL(claude)
//   JUDGE=off 면 LLM 판정 없음. 그 밖의 OpenAI 호환: JUDGE_CHAIN 에 openai 추가 + JUDGE_BASE_URL, JUDGE_API_KEY, JUDGE_API_MODEL
function buildJudge(): LlmJudge | undefined {
  if (process.env.JUDGE === "off") return undefined;
  const groq = (model: string, fast: boolean) => new OpenAiCompatJudge({ baseUrl: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY, model, timeoutMs: 8000, fast });
  const list: LlmJudge[] = [];
  for (const name of (process.env.JUDGE_CHAIN ?? "groq-qwen,gemini,claude").split(",").map((x) => x.trim()).filter(Boolean)) {
    if (name.startsWith("groq") && !process.env.GROQ_API_KEY) continue;
    if (name === "groq-20b") list.push(groq(process.env.GROQ_MODEL_20B ?? "openai/gpt-oss-20b", true));
    else if (name === "groq-qwen") list.push(groq(process.env.GROQ_MODEL_QWEN ?? "qwen/qwen3.8-27b", false));
    else if (name === "groq-120b" || name === "groq") list.push(groq(process.env.GROQ_MODEL_120B ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-120b", true));
    else if (name === "gemini" && process.env.GOOGLE_AI_STUDIO_API_KEY) list.push(new GeminiJudge({ apiKey: process.env.GOOGLE_AI_STUDIO_API_KEY, model: process.env.GOOGLE_AI_MODEL }));
    else if (name === "claude") list.push(new ClaudeCliJudge({ model: process.env.JUDGE_MODEL ?? "haiku" }));
    else if (name === "openai" && process.env.JUDGE_BASE_URL && process.env.JUDGE_API_MODEL) list.push(new OpenAiCompatJudge({ baseUrl: process.env.JUDGE_BASE_URL, apiKey: process.env.JUDGE_API_KEY, model: process.env.JUDGE_API_MODEL }));
  }
  return list.length === 0 ? undefined : list.length === 1 ? list[0] : new ChainJudge(list);
}
// 음성 설정: TTS_CHAIN=앞에서부터 시도할 엔진, 기본 "kokoro,browser" = 1순위 로컬 Kokoro(OpenAI 호환 서버), 실패 시 브라우저 음성.
//   kokoro 서버: TTS_URL(기본 http://127.0.0.1:8880/v1), TTS_VOICE, TTS_MODEL. TTS_CHAIN=browser 면 브라우저 음성만. (옛 TTS_PROVIDER=server|browser 도 인식)
const ttsChain = (process.env.TTS_CHAIN ?? (process.env.TTS_PROVIDER === "browser" ? "browser" : "kokoro,browser")).split(",").map((x) => x.trim());
const ttsWantsServer = ttsChain[0] === "kokoro";
let ttsProbe = { at: 0, up: false };
/** Kokoro 서버가 실제로 살아 있을 때만 서버 음성을 쓴다(꺼져 있으면 브라우저 음성으로 바로 가서, 모바일에서 사용자 동작 밖의 대체 재생이 막히는 일을 피한다). 30초 캐시. */
async function ttsServerUp(): Promise<boolean> {
  if (!ttsWantsServer) return false;
  if (Date.now() - ttsProbe.at < 30_000) return ttsProbe.up;
  let up = false;
  try { up = (await fetch((process.env.TTS_URL ?? "http://127.0.0.1:8880/v1").replace(/\/$/, "") + "/models", { signal: AbortSignal.timeout(1500) })).ok; } catch { up = false; }
  ttsProbe = { at: Date.now(), up }; return up;
}
const ttsCache = new Map<string, Buffer>();
// 질문(q)과 답변(a)은 다른 음성으로 읽는다: TTS_VOICE_Q(기본 af_heart, 구 TTS_VOICE 도 인식) / TTS_VOICE_A(기본 am_adam)
async function ttsAudio(text: string, role: string): Promise<Buffer> {
  const voice = role === "a" ? process.env.TTS_VOICE_A ?? "am_michael" : process.env.TTS_VOICE_Q ?? process.env.TTS_VOICE ?? "af_heart";
  const key = voice + "|" + text;
  const hit = ttsCache.get(key); if (hit) return hit;
  const r = await fetch((process.env.TTS_URL ?? "http://127.0.0.1:8880/v1").replace(/\/$/, "") + "/audio/speech", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.TTS_MODEL ?? "kokoro", voice, input: text, response_format: "wav" }), signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`음성 서버 오류 (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (ttsCache.size >= 300) ttsCache.delete(ttsCache.keys().next().value!);
  ttsCache.set(key, buf); return buf;
}
// 접속 IP 기준 계정: 접속자마다 별도 StudyService(진도·오답·완료)를 둔다. 이 컴퓨터에서 직접 연 접속과 OWNER_IPS 의 IP 는 기존 기록("me").
//   OWNER_IPS=쉼표로 구분한 본인 IP(예: 집·폰). 본인 IP 는 접속해서 /api/whoami 로 확인한다. 휴대폰 데이터망처럼 IP가 바뀌는 환경은 계정이 새로 생긴다(한계).
const grading = new GradingService(buildJudge()); // 판정 캐시는 사용자와 무관하므로 공유
const owners = parseOwners(process.env.OWNER_IPS);
// ---- 로그인(선택) ----
// 접속자 식별 순서: ① 로그인 쿠키(소셜·게스트) ② 이 컴퓨터 직접 접속·OWNER_IPS ③ 접속 IP 계정. 로그인하지 않아도 ③으로 쓸 수 있다.
//   PUBLIC_BASE_URL=https://공개주소 (콜백 주소를 이것으로 고정한다. Host 헤더는 쓰지 않는다) / OAUTH_<GOOGLE|KAKAO|NAVER|GITHUB|DISCORD|MICROSOFT|FACEBOOK>_CLIENT_ID, _CLIENT_SECRET
//   OWNER_ACCOUNTS=기존 기록(me)에 연결할 계정 ID(로그인 후 /api/whoami 의 account 값). SESSION_SECRET 이 없으면 data/session-secret 에 무작위 값을 만들어 쓴다.
const publicBase = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
const secureCookies = publicBase.startsWith("https://");
const loginProviders = enabledProviders(process.env);
// 관리자·기존 기록 연결은 이 컴퓨터의 관리자 패널에서만 지정한다(인터넷 쪽에서는 이메일 등 어떤 정보로도 관리자가 될 수 없다).
const ownersFile = root + "data/owners.json";
const ownerAccounts = new Set([...(process.env.OWNER_ACCOUNTS ?? "").split(",").map((x) => x.trim()).filter(Boolean), ...readJsonSafe<string[]>(ownersFile, [])]);
function readJsonSafe<T>(f: string, d: T): T { try { return JSON.parse(readFileSync(f, "utf8")) as T; } catch { return d; } }
function loadSessionSecret(): string {
  if ((process.env.SESSION_SECRET ?? "").length >= 16) return process.env.SESSION_SECRET!;
  const f = root + "data/session-secret";
  if (existsSync(f)) { const v = readFileSync(f, "utf8").trim(); if (v.length >= 32) return v; }
  mkdirSync(root + "data", { recursive: true }); const v = randomBytes(32).toString("hex"); writeFileSync(f, v, { mode: 0o600 }); return v;
}
const sessionSecret = loadSessionSecret();
// 로그인한 계정 목록과 관리자 지정(data/accounts.json, data/admins.json). 소셜 제공사의 이름·이메일은 저장하지 않는다.
const accFile = root + "data/accounts.json", admFile = root + "data/admins.json";
const readJson = <T,>(f: string, d: T): T => { try { return JSON.parse(readFileSync(f, "utf8")) as T; } catch { return d; } };
const accounts: Record<string, { provider: string; firstAt: number; lastAt: number; email?: string }> = readJson(accFile, {});
const savedAdmins = new Set<string>(readJson<string[]>(admFile, []));
const isAdminAccount = (id: string) => ownerAccounts.has(id) || savedAdmins.has(id);
const saveJson = (f: string, v: unknown) => { mkdirSync(root + "data", { recursive: true }); writeFileSync(f, JSON.stringify(v), { mode: 0o600 }); };
const noteLogin = (id: string, provider: string, email?: string) => { const t = Date.now(); accounts[id] = { provider, firstAt: accounts[id]?.firstAt ?? t, lastAt: t, email: email ?? accounts[id]?.email }; saveJson(accFile, accounts); };
const SESSION_DAYS = 30;
// 로그인하지 않은 방문자는 자유훈련만 쓸 수 있다(기록 없음). 나머지 기능은 로그인 후.
const redirect = (res: any, to: string, cookies: string[] = []) => { res.writeHead(302, { location: to, "set-cookie": cookies, "cache-control": "no-store" }); res.end(); };
const startSession = (u: string, p: string) => cookieHeader("epa_s", signSession(sessionSecret, { u, p, exp: Date.now() + SESSION_DAYS * 86400_000 }), { maxAge: SESSION_DAYS * 86400, secure: secureCookies });
const clearCookie = (n: string) => cookieHeader(n, "", { maxAge: 0, secure: secureCookies });

async function handleAuth(req: any, res: any, url: URL): Promise<void> {
  const parts = url.pathname.split("/").filter(Boolean); // ["auth", "<제공사|guest|logout>", "start|callback"]
  const seg = parts[1] ?? "";
  if (req.method === "POST" && seg === "logout") { res.writeHead(200, { "content-type": "application/json", "set-cookie": clearCookie("epa_s") }); res.end('{"ok":true}'); return; }
  const p = loginProviders.find((x) => x.name === seg);
  if (!p || req.method !== "GET") return redirect(res, "/?login=failed");
  if (parts[2] === "start") {
    const st = newState();
    return redirect(res, authorizeUrl(p, process.env, st.state, st.challenge), [cookieHeader("epa_st", st.state, { maxAge: 600, secure: secureCookies }), cookieHeader("epa_cv", st.verifier, { maxAge: 600, secure: secureCookies })]);
  }
  if (parts[2] === "callback") {
    const c = parseCookies(req.headers.cookie); const wipe = [clearCookie("epa_st"), clearCookie("epa_cv")];
    const code = url.searchParams.get("code");
    if (url.searchParams.get("error") || !code || !sameState(c.epa_st, url.searchParams.get("state"))) return redirect(res, "/?login=failed", wipe);
    try {
      const got = await identify(p, process.env, code, c.epa_st!, c.epa_cv ?? "");
      const acc = accountId(p.name, got.id); noteLogin(acc, p.name, got.email);
      return redirect(res, "/", [...wipe, startSession(acc, p.name)]);
    } catch (e) { console.error("로그인 실패:", p.name, e instanceof Error ? e.message : "unknown"); return redirect(res, "/?login=failed", wipe); }
  }
  return redirect(res, "/?login=failed");
}
const MAX_USERS = 300; // 메모리에 올려 두는 계정 수 상한(넘으면 가장 오래 안 쓴 것부터 내린다. 기록은 DB에 남아 있다)
const users = new Map<string, { study: StudyService; opened: boolean; free: boolean; store: SqliteUserStore; admin: boolean }>();
const release = (e: { store: SqliteUserStore }) => { if (e.store !== meStore) e.store.close(); };
// 원본(구매한 Sentence Kit) 문장은 관리자에게만 보인다. 그 외에는 공개용("own") 트랙만 쓴다 — 서버에서 강제한다.
function entryFor(userId: string, admin: boolean) {
  let e = users.get(userId);
  if (e && e.admin !== admin) { release(e); users.delete(userId); e = undefined; } // 권한이 바뀌면 새로 만든다
  if (e) { users.delete(userId); users.set(userId, e); return e; } // 최근 사용 순서로 갱신
  const st = storeFor(userId);
  e = { study: new StudyService({ userId, content, store: st, grading, rng: Math.random, now: Date.now, tracks: admin ? ["original", "own"] : ["own"] }), opened: false, free: false, store: st, admin };
  users.set(userId, e);
  if (users.size > MAX_USERS) { const k = users.keys().next().value!; release(users.get(k)!); users.delete(k); }
  return e;
}
/** 계정 삭제(탈퇴·관리자 삭제): 그 계정의 DB 파일과 로그인 목록·관리자 지정을 모두 지운다. */
function deleteAccount(id: string): boolean {
  if (!validAccount(id)) return false;
  const e = users.get(id); if (e) { release(e); users.delete(id); }
  for (const suf of ["", "-wal", "-shm", "-journal"]) rmSync(userFile(id) + suf, { force: true });
  delete accounts[id]; saveJson(accFile, accounts); if (savedAdmins.delete(id)) saveJson(admFile, [...savedAdmins]);
  return true;
}
const uiDir = root + "apps/ui/dist"; // React 빌드 결과가 있으면 그것을, 없으면 예전 단일 페이지를 쓴다
const legacyPage = readFileSync(root + "apps/web/index.html", "utf8");
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };
function serveStatic(pathname: string, res: any): boolean {
  if (!existsSync(join(uiDir, "index.html"))) return false;
  const rel = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const file = join(uiDir, rel);
  if (!file.startsWith(uiDir) || !existsSync(file)) return false;
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
  res.end(readFileSync(file)); return true;
}

const json = (res: any, code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
const body = (req: any) => new Promise<any>((ok) => { let s = ""; req.on("data", (c: Buffer) => (s += c)); req.on("end", () => ok(s ? JSON.parse(s) : {})); });

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname.startsWith("/auth/")) return await handleAuth(req, res, url);
    if (req.method === "GET" && !url.pathname.startsWith("/api/") && serveStatic(url.pathname, res)) return;
    if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(legacyPage); }
    const who = userIdFor(req.headers, req.socket.remoteAddress, owners);
    const sess = verifySession(sessionSecret, parseCookies(req.headers.cookie).epa_s, Date.now());
    const userId = sess ? (ownerAccounts.has(sess.u) ? "me" : sess.u) : who.userId;
    // 관리자: 이 컴퓨터에서 직접 연 접속, 또는 OWNER_ACCOUNTS 에 적은 로그인 계정. (IP 는 공유될 수 있어 관리자 근거로 쓰지 않는다)
    const authed = !!sess || who.local;
    // 비로그인: 자유훈련에 필요한 것만 허용한다.
    const ANON_OK = ["/api/whoami", "/api/config", "/api/tts", "/api/practice", "/api/practice/exit", "/api/next", "/api/submit", "/api/hint"];
    if (!authed && url.pathname.startsWith("/api/") && !ANON_OK.includes(url.pathname)) return json(res, 401, { error: "login required" });
    const isAdmin = (!sess && who.local) || (!!sess && isAdminAccount(sess.u));
    if (url.pathname === "/api/admin/users") {
      if (!isAdmin) return json(res, 403, { error: "forbidden" });
      const label = (id: string) => (id === "me" ? "기존 기록(me)" : "소셜 로그인");
      const sum = new Map<string, ReturnType<SqliteUserStore["adminSummary"]>[number]>();
      for (const u of meStore.adminSummary()) sum.set(u.userId, u);
      let files: string[] = []; try { files = readdirSync(usersDir).filter((f) => f.endsWith(".sqlite")).map((f) => f.slice(0, -7)).filter(validAccount); } catch { /* 아직 없음 */ }
      for (const id of files) { const e = users.get(id); const st = e?.store ?? new SqliteUserStore(userFile(id)); const r = st.adminSummary()[0]; if (r) sum.set(id, { ...r, userId: id }); if (!e) st.close(); }
      const ids = new Set([...sum.keys(), ...Object.keys(accounts), ...files]);
      const list = [...ids].map((id) => { const u = sum.get(id); const a = accounts[id];
        return { userId: id, kind: label(id) + (a ? ` · ${a.provider}` : ""), attempts: u?.attempts ?? 0, passed: u?.passed ?? 0, completed: u?.completed ?? 0, lastAt: Math.max(u?.lastAt ?? 0, a?.lastAt ?? 0), firstAt: a?.firstAt ?? 0, email: a?.email, admin: isAdminAccount(id), fixedAdmin: !!process.env.OWNER_ACCOUNTS?.split(",").map((x) => x.trim()).includes(id), linkedMe: ownerAccounts.has(id) }; });
      return json(res, 200, { users: list.sort((x, y) => y.lastAt - x.lastAt) });
    }
    if (url.pathname === "/api/admin/promote" && req.method === "POST") {
      if (!(!sess && who.local)) return json(res, 403, { error: "local only" }); // 관리자 지정은 이 컴퓨터에서만
      const q = new URL(req.url ?? "", "http://x").searchParams; const id = q.get("id") ?? "";
      if (!accounts[id]) return json(res, 400, { error: "unknown account" });
      if (q.get("on") === "1") savedAdmins.add(id); else savedAdmins.delete(id);
      saveJson(admFile, [...savedAdmins]); return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/admin/linkme" && req.method === "POST") { // 이 계정을 기존 학습 기록(me)에 연결/해제 — 이 컴퓨터 직접 접속에서만
      if (!(!sess && who.local)) return json(res, 403, { error: "local only" });
      const q = new URL(req.url ?? "", "http://x").searchParams; const id = q.get("id") ?? "";
      if (!validAccount(id) || !accounts[id]) return json(res, 400, { error: "unknown account" });
      if (q.get("on") === "1") ownerAccounts.add(id); else ownerAccounts.delete(id);
      mkdirSync(root + "data", { recursive: true }); writeFileSync(ownersFile, JSON.stringify([...ownerAccounts].filter(validAccount)), { mode: 0o600 });
      const e = users.get(id); if (e) { release(e); users.delete(id); } return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/admin/delete" && req.method === "POST") {
      if (!isAdmin) return json(res, 403, { error: "forbidden" });
      const id = String(new URL(req.url ?? "", "http://x").searchParams.get("id") ?? "");
      if (!id || id === "me") return json(res, 400, { error: "cannot delete" });
      return json(res, deleteAccount(id) ? 200 : 400, { ok: validAccount(id) });
    }
    if (url.pathname === "/api/account/delete" && req.method === "POST") { // 탈퇴: 내 계정의 모든 기록을 삭제하고 로그아웃한다
      if (!sess || !validAccount(sess.u)) return json(res, 400, { error: "no account" });
      deleteAccount(sess.u); res.setHeader("set-cookie", clearCookie("epa_s")); return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/whoami") return json(res, 200, { ip: who.ip, account: userId, owner: userId === "me", admin: isAdmin, authed, loggedIn: !!sess, loginMethod: sess?.p ?? null, sessionAccount: sess?.u ?? null, providers: PROVIDERS.map((x) => ({ name: x.name, label: x.label, enabled: loginProviders.some((y) => y.name === x.name) })) });
    const rmParam = (u: URL) => (isAdmin ? u.searchParams.get("roadmap") ?? undefined : "pattern"); // 비관리자는 패턴 로드맵만(상황별 주제는 own 문장이 없다)
    const ent = entryFor(userId, isAdmin); const study = ent.study;
    if (!ent.opened || url.pathname === "/api/open") { await study.open(url.searchParams.get("chapter") ? Number(url.searchParams.get("chapter")) : undefined, rmParam(url)); ent.opened = true; }
    if (url.pathname === "/api/open") return json(res, 200, { ok: true });
    const anonBlocked = !authed && !ent.free; // 비로그인은 자유훈련을 시작한 뒤에만 카드·제출·힌트를 쓸 수 있다
    if (url.pathname === "/api/next") return json(res, 200, anonBlocked ? { card: null, summary: null } : { card: study.next() ?? null, summary: study.practiceSummary() ?? null });
    if (anonBlocked && (url.pathname === "/api/submit" || url.pathname === "/api/hint")) return json(res, 401, { error: "login required" });
    if (url.pathname === "/api/practice") {
      const k = url.searchParams.get("kind"); const sid = url.searchParams.get("sentence");
      const opts = { level: url.searchParams.get("level") ?? undefined, n: url.searchParams.get("n") ? Number(url.searchParams.get("n")) : undefined, sentenceId: sid ? Number(sid) : undefined, roadmap: rmParam(url) };
      if (!authed && k !== "free") return json(res, 401, { error: "login required" });
      const r = k === "weak" || k === "free" ? await study.startPractice(k, opts) : { ok: false, reason: "알 수 없는 훈련" };
      if (!authed) ent.free = !!(r as { ok?: boolean }).ok;
      if (!isAdmin && (r as { ok?: boolean }).ok === false) return json(res, 200, { ok: false, reason: "공개용 콘텐츠를 준비 중이에요. 곧 열릴 예정이에요." });
      return json(res, 200, r);
    }
    if (url.pathname === "/api/roadmaps") return json(res, 200, isAdmin ? (await content.roadmaps?.()) ?? [] : ((await content.roadmaps?.()) ?? []).filter((r) => r.id === "pattern")); // 상황별(어휘 카드) 주제는 원본 카드라 관리자에게만
    if (url.pathname === "/api/config") return json(res, 200, { tts: (await ttsServerUp()) ? "server" : "browser" });
    if (url.pathname === "/api/tts") {
      const text = (url.searchParams.get("text") ?? "").trim();
      if (!(await ttsServerUp()) || !text || text.length > 300) return json(res, 400, { error: "음성 서버를 쓸 수 없어요" });
      const audio = await ttsAudio(text, url.searchParams.get("role") === "a" ? "a" : "q"); // iOS Safari 는 오디오를 Range(부분) 요청으로 받으므로 206 응답·길이·Accept-Ranges 가 있어야 재생된다.
      const base = { "content-type": "audio/wav", "cache-control": "public, max-age=86400", "accept-ranges": "bytes" };
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
      if (m && (m[1] !== "" || m[2] !== "")) {
        const total = audio.length; let start = m[1] === "" ? Math.max(total - Number(m[2]), 0) : Number(m[1]); let end = m[1] === "" || m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
        if (start > end || start >= total) { res.writeHead(416, { "content-range": `bytes */${total}` }); return res.end(); }
        res.writeHead(206, { ...base, "content-range": `bytes ${start}-${end}/${total}`, "content-length": end - start + 1 }); return res.end(audio.subarray(start, end + 1));
      }
      res.writeHead(200, { ...base, "content-length": audio.length }); return res.end(audio);
    }
    if (url.pathname === "/api/overview") return authed ? json(res, 200, await study.overview(rmParam(url))) : json(res, 403, { error: "login required" });
    if (url.pathname === "/api/uncomplete") { const b = await body(req); return json(res, 200, await study.uncomplete(Number(b.patternId))); }
    if (url.pathname === "/api/practice/exit") { study.exitPractice(); if (!authed) ent.free = false; return json(res, 200, { ok: true }); }
    if (url.pathname === "/api/notes") return json(res, 200, await study.notesView());
    if (url.pathname === "/api/stats") return json(res, 200, await study.statsView());
    if (url.pathname === "/api/hint") { const b = await body(req); return json(res, 200, { hint: study.hint(b.sentenceId) ?? null }); }
    if (url.pathname === "/api/submit") { const b = await body(req); return json(res, 200, await study.submit(b.sentenceId, String(b.input ?? ""), !!b.usedHint, Number(b.elapsedMs ?? 0))); }
    json(res, 404, { error: "not found" });
  } catch (e) { json(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
}).listen(Number(process.env.PORT ?? 5173), "127.0.0.1", () => console.log("http://127.0.0.1:" + (process.env.PORT ?? 5173)));
