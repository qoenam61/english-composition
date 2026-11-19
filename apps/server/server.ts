import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SqliteContentRepository } from "@app/adapter-content";
import { SqliteUserStore } from "@app/adapter-userdb";
import { GradingService } from "@app/grading";
import { StudyService } from "@app/app";

// 조립 지점(composition root): 어떤 어댑터를 쓸지는 여기서만 정한다.
const root = fileURLToPath(new URL("../../", import.meta.url));
const content = new SqliteContentRepository(process.env.PACK ?? root + "dist/pack-personal.sqlite");
const store = new SqliteUserStore(process.env.USER_DB ?? root + "data/user.sqlite");
const study = new StudyService({ userId: "me", content, store, grading: new GradingService(), rng: Math.random, now: Date.now, tracks: ["original", "own"] });
const page = readFileSync(root + "apps/web/index.html", "utf8");

const json = (res: any, code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
const body = (req: any) => new Promise<any>((ok) => { let s = ""; req.on("data", (c: Buffer) => (s += c)); req.on("end", () => ok(s ? JSON.parse(s) : {})); });
let opened = false;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(page); }
    if (!opened || url.pathname === "/api/open") { await study.open(url.searchParams.get("chapter") ? Number(url.searchParams.get("chapter")) : undefined); opened = true; }
    if (url.pathname === "/api/open") return json(res, 200, { ok: true });
    if (url.pathname === "/api/next") return json(res, 200, { card: study.next() ?? null });
    if (url.pathname === "/api/notes") return json(res, 200, study.notesView());
    if (url.pathname === "/api/stats") return json(res, 200, await study.statsView());
    if (url.pathname === "/api/hint") { const b = await body(req); return json(res, 200, { hint: study.hint(b.sentenceId) ?? null }); }
    if (url.pathname === "/api/submit") { const b = await body(req); return json(res, 200, await study.submit(b.sentenceId, String(b.input ?? ""), !!b.usedHint, Number(b.elapsedMs ?? 0))); }
    json(res, 404, { error: "not found" });
  } catch (e) { json(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
}).listen(Number(process.env.PORT ?? 5173), "127.0.0.1", () => console.log("http://127.0.0.1:" + (process.env.PORT ?? 5173)));
