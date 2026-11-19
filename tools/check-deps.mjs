// 의존 규칙 린트: domain 은 아무것도 import 하지 않고, contracts 는 @app/domain 만 import 한다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const ALLOWED = { domain: [], contracts: ["@app/domain"], session: ["@app/domain", "@app/contracts"], grading: ["@app/domain", "@app/contracts"], "adapter-content": ["@app/contracts", "node:sqlite", "node:module"], notes: ["@app/contracts"], app: ["@app/contracts", "@app/domain", "@app/grading", "@app/session", "@app/notes"], "adapter-userdb": ["@app/contracts", "@app/domain", "node:sqlite", "node:module"] };
let bad = 0;
function walk(d) { return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; }); }
for (const [pkg, allow] of Object.entries(ALLOWED)) {
  for (const f of walk(join("packages", pkg, "src"))) {
    for (const m of readFileSync(f, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) {
      const spec = m[1];
      if (spec.startsWith(".") || allow.includes(spec)) continue;
      console.error(`위반: ${f} -> ${spec}`); bad++;
    }
  }
}
console.log(bad ? `의존 규칙 위반 ${bad}건` : "의존 규칙 통과");
process.exit(bad ? 1 : 0);
