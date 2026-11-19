import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteContentRepository } from "@app/adapter-content";
import { SqliteUserStore } from "@app/adapter-userdb";
import { GradingService } from "@app/grading";
import { ClaudeCliJudge } from "@app/adapter-llm";
import { StudyService } from "@app/app";

// 조립 지점(composition root): 어떤 어댑터를 쓸지는 여기서만 정한다.
const root = fileURLToPath(new URL("../../", import.meta.url));
const content = new SqliteContentRepository(process.env.PACK ?? root + "dist/pack-personal.sqlite");
const store = new SqliteUserStore(process.env.USER_DB ?? root + "data/user.sqlite");
const study = new StudyService({ userId: "me", content, store, grading: new GradingService(process.env.JUDGE === "off" ? undefined : new ClaudeCliJudge({ model: process.env.JUDGE_MODEL ?? "sonnet" })), rng: Math.random, now: Date.now, tracks: ["original", "own"] });
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
