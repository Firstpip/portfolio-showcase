// 사내 캘린더 QA 환경 만들기 — 로그인·운영 DB 없이 모의 데이터로 워크룸 캘린더를 띄운다.
//   node tools/calendar-qa/build.mjs            → tools/calendar-qa/out/ 생성
//   node tools/calendar-qa/build.mjs --serve    → 생성 후 http://127.0.0.1:8791 로 띄움 (Ctrl+C 로 종료)
// dashboard/index.html 을 매번 그대로 읽어 Supabase 스크립트만 모의 클라이언트로 바꾸므로, 대시보드를 고쳐도 QA 환경이 어긋나지 않는다.
// 알림 미리보기(QA 패널)는 운영 함수의 판단 코드 supabase/functions/calendar-push/plan.ts 를 그대로 빌드해 쓴다.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const dash = path.join(root, "dashboard");
const out = path.join(here, "out");
const esbuild = path.join(dash, "node_modules", ".bin", "esbuild");
if (!fs.existsSync(esbuild)) { console.error("dashboard/node_modules 가 없습니다. 먼저 (cd dashboard && npm install)"); process.exit(1); }

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ["vendor", "icons", "prompts", "manifest.webmanifest", "sw.js"]) fs.cpSync(path.join(dash, f), path.join(out, f), { recursive: true });
for (const f of ["mock-supabase.js", "seed.js", "qa-panel.js"]) fs.copyFileSync(path.join(here, f), path.join(out, f));

// index.html: 운영 Supabase 스크립트 → 모의 클라이언트·QA 데이터, crossorigin 제거(로컬 서버에서 CORS 오류 방지), QA 패널 추가
let html = fs.readFileSync(path.join(dash, "index.html"), "utf8").replace(/ crossorigin/g, "");
const sbTag = '<script defer src="vendor/supabase.min.js"></script>', appTag = '<script src="app.js" defer></script>';
if (!html.includes(sbTag) || !html.includes(appTag)) { console.error("dashboard/index.html 의 스크립트 태그가 바뀌었습니다. build.mjs 를 맞춰 주세요."); process.exit(1); }
html = html.replace(sbTag, '<script src="mock-supabase.js"></script><script src="seed.js"></script>')
  .replace(appTag, appTag + '\n<script src="plan.js"></script><script src="qa-panel.js" defer></script>');
fs.writeFileSync(path.join(out, "index.html"), html);

const run = (args) => execFileSync(esbuild, args, { cwd: root, stdio: "inherit" });
run(["dashboard/src/app.jsx", "--bundle", "--format=iife", `--outfile=${path.join(out, "app.js")}`, "--jsx=transform", "--target=es2020", "--log-level=error"]);
run(["supabase/functions/calendar-push/plan.ts", "--bundle", "--format=iife", "--global-name=CalPlan", `--outfile=${path.join(out, "plan.js")}`, "--log-level=error"]);
console.log(`QA 환경 생성: ${path.relative(root, out)}/`);

if (process.argv.includes("--serve")) {
  const port = Number(process.env.QA_PORT || 8791);
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
  http.createServer((req, res) => {
    const p = path.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
    const file = path.join(out, p || "index.html");
    if (!file.startsWith(out) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  }).listen(port, "127.0.0.1", () => console.log(`QA 서버: http://127.0.0.1:${port}/index.html#calendar  (Ctrl+C 로 종료)`));
}
