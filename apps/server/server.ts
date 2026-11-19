import { createServer } from "node:http";

// 프로젝트 루트의 .env 를 읽는다(이미 설정된 환경변수가 우선, 파일이 없으면 무시). .env 는 git 에서 제외돼 있다.
try { process.loadEnvFile(new URL("../../.env", import.meta.url)); } catch { /* .env 없음 */ }
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteContentRepository } from "@app/adapter-content";
import { SqliteUserStore } from "@app/adapter-userdb";
import { GradingService } from "@app/grading";
import { ChainJudge, ClaudeCliJudge, OpenAiCompatJudge } from "@app/adapter-llm";
import type { LlmJudge } from "@app/contracts";
import { StudyService } from "@app/app";

// 조립 지점(composition root): 어떤 어댑터를 쓸지는 여기서만 정한다.
const root = fileURLToPath(new URL("../../", import.meta.url));
const content = new SqliteContentRepository(process.env.PACK ?? root + "dist/pack-personal.sqlite");
const store = new SqliteUserStore(process.env.USER_DB ?? root + "data/user.sqlite");
// 판정·정정·코멘트 설정(환경변수). JUDGE_CHAIN=앞에서부터 시도할 판정기, 기본 "groq,claude" = 1순위 Groq(무료), 2순위 claude haiku.
//   groq: GROQ_API_KEY(없으면 건너뜀), GROQ_MODEL(기본 openai/gpt-oss-120b) / claude: JUDGE_MODEL(기본 haiku)
//   openai(그 밖의 OpenAI 호환): JUDGE_BASE_URL, JUDGE_API_KEY, JUDGE_API_MODEL / JUDGE=off 면 LLM 판정 없음
function buildJudge(): LlmJudge | undefined {
  if (process.env.JUDGE === "off") return undefined;
  const list: LlmJudge[] = [];
  for (const name of (process.env.JUDGE_CHAIN ?? "groq,claude").split(",").map((x) => x.trim()).filter(Boolean)) {
    if (name === "groq" && process.env.GROQ_API_KEY) list.push(new OpenAiCompatJudge({ baseUrl: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b" }));
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
  const voice = role === "a" ? process.env.TTS_VOICE_A ?? "am_adam" : process.env.TTS_VOICE_Q ?? process.env.TTS_VOICE ?? "af_heart";
  const key = voice + "|" + text;
  const hit = ttsCache.get(key); if (hit) return hit;
  const r = await fetch((process.env.TTS_URL ?? "http://127.0.0.1:8880/v1").replace(/\/$/, "") + "/audio/speech", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.TTS_MODEL ?? "kokoro", voice, input: text, response_format: "mp3" }), signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`음성 서버 오류 (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (ttsCache.size >= 300) ttsCache.delete(ttsCache.keys().next().value!);
  ttsCache.set(key, buf); return buf;
}
const study = new StudyService({ userId: "me", content, store, grading: new GradingService(buildJudge()), rng: Math.random, now: Date.now, tracks: ["original", "own"] });
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
let opened = false;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && !url.pathname.startsWith("/api/") && serveStatic(url.pathname, res)) return;
    if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(legacyPage); }
    if (!opened || url.pathname === "/api/open") { await study.open(url.searchParams.get("chapter") ? Number(url.searchParams.get("chapter")) : undefined); opened = true; }
    if (url.pathname === "/api/open") return json(res, 200, { ok: true });
    if (url.pathname === "/api/next") return json(res, 200, { card: study.next() ?? null, summary: study.practiceSummary() ?? null });
    if (url.pathname === "/api/practice") {
      const k = url.searchParams.get("kind"); const sid = url.searchParams.get("sentence");
      const opts = { level: url.searchParams.get("level") ?? undefined, n: url.searchParams.get("n") ? Number(url.searchParams.get("n")) : undefined, sentenceId: sid ? Number(sid) : undefined };
      return json(res, 200, k === "weak" || k === "free" ? await study.startPractice(k, opts) : { ok: false, reason: "알 수 없는 훈련" });
    }
    if (url.pathname === "/api/config") return json(res, 200, { tts: (await ttsServerUp()) ? "server" : "browser" });
    if (url.pathname === "/api/tts") {
      const text = (url.searchParams.get("text") ?? "").trim();
      if (!(await ttsServerUp()) || !text || text.length > 300) return json(res, 400, { error: "음성 서버를 쓸 수 없어요" });
      const audio = await ttsAudio(text, url.searchParams.get("role") === "a" ? "a" : "q"); res.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "public, max-age=86400" }); return res.end(audio);
    }
    if (url.pathname === "/api/overview") return json(res, 200, await study.overview());
    if (url.pathname === "/api/uncomplete") { const b = await body(req); return json(res, 200, await study.uncomplete(Number(b.patternId))); }
    if (url.pathname === "/api/practice/exit") { study.exitPractice(); return json(res, 200, { ok: true }); }
    if (url.pathname === "/api/notes") return json(res, 200, await study.notesView());
    if (url.pathname === "/api/stats") return json(res, 200, await study.statsView());
    if (url.pathname === "/api/hint") { const b = await body(req); return json(res, 200, { hint: study.hint(b.sentenceId) ?? null }); }
    if (url.pathname === "/api/submit") { const b = await body(req); return json(res, 200, await study.submit(b.sentenceId, String(b.input ?? ""), !!b.usedHint, Number(b.elapsedMs ?? 0))); }
    json(res, 404, { error: "not found" });
  } catch (e) { json(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
}).listen(Number(process.env.PORT ?? 5173), "127.0.0.1", () => console.log("http://127.0.0.1:" + (process.env.PORT ?? 5173)));
