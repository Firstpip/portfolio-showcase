// T8.5 — validate-dist 모듈.
//
// 빌드된 dist/ 디렉토리를 4가지 항목으로 검증한다:
//   A. index.html 에 expected base path 가 정확히 prefix 됐는지
//   B. dist 자산 디렉토리(Vite: assets/, Next: _next/) JS+CSS 합계 < 2MB (영업 데모 한도)
//   C. dist 안에 외부 절대 URL 이 CDN 허용 목록 외 0건
//   D. Playwright headless 로 dist/index.html 을 띄워 콘솔 에러 0건
//
// orchestrator(T8.7) 에서 runBuild → collectDist → validateDist 순서로 호출.
// 검증 실패 시 deploy 전에 BUILD_FAILED 와 동급으로 처리해 사용자에게 노출.
//
// 단위 테스트는 worker/test-validate-dist.ts.

import { promises as fs } from "node:fs";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";

// ─────────────────────────────────────────────────────────────────────────────
// 타입 + 상수

const DEFAULT_MAX_BUNDLE_BYTES = 2 * 1024 * 1024; // 2MB
const DEFAULT_CDN_ALLOWLIST = [
  // Pretendard 웹폰트 (vite-react-ts runtime 의 src/index.css 가 import).
  "https://cdn.jsdelivr.net/",
];

// 외부 URL 검사에서 노이즈로 무시할 패턴.
// 모두 "라이브러리 내부에 inline 된 표준 문자열" — 런타임 네트워크 호출 아님.
const URL_NOISE_PATTERNS: RegExp[] = [
  // W3C XML/SVG/HTML/MathML namespace URI — DOM 표준, 호출 아님.
  /^https?:\/\/(?:www\.)?w3\.org\//,
  // React 의 minified 에러 디코더 URL — 콘솔에 hint 로 찍히는 문자열, 호출 아님.
  /^https?:\/\/(?:react\.dev|reactjs\.org|legacy\.reactjs\.org)\//,
  // Vue 3 의 런타임 에러 레퍼런스 URL — React 와 같은 성격 (T8.10 에서 확인).
  /^https?:\/\/(?:www\.)?vuejs\.org\//,
  // Next.js 가 빌드/런타임 경고에 넣는 문서 링크 문자열.
  /^https?:\/\/nextjs\.org\//,
  // Next 내부 상수 (T8.10 실측). 전부 vendor chunk 안의 문자열이고 호출이 아니다:
  //   - `http://n` : 상대 URL 을 파싱할 때 쓰는 더미 base
  //   - use.typekit.net : next/font 의 Adobe 폰트 경로 상수 (해당 API 미사용 시 죽은 코드)
  //   - `https://тест`, `https://x` : URL/IDN 파서의 테스트 상수
  /^https?:\/\/n$/,
  /^https?:\/\/use\.typekit\.net/,
  /^https?:\/\/(?:тест|x)$/,
  // 데이터 URI 와 blob 은 정규식이 https?:// 만 잡아 자연 제외.
];

const TEXT_ASSET_EXTS = new Set([".html", ".css", ".js", ".mjs", ".cjs", ".json", ".svg", ".txt"]);

const URL_REGEX = /\bhttps?:\/\/[^\s"'`<>)]+/g;

export interface ValidateDistOptions {
  /**
   * dist 기준 정적 자산 디렉토리. Vite 계열은 "assets", Next static export 는 "_next".
   * build-runtime 의 ASSET_DIR 에서 스택별 값을 받아 넘긴다. 기본값은 Vite 계열.
   */
  assetDir?: string;
  maxBundleBytes?: number;
  /** 외부 URL 허용 prefix 목록. 기본: cdn.jsdelivr.net (Pretendard). */
  cdnAllowlist?: string[];
  /** Playwright 검사를 건너뜀. CI 환경/오프라인에서 사용. */
  skipBrowser?: boolean;
  /** Playwright goto 후 #root 마운트 대기 timeout. 기본 8000ms. */
  mountTimeoutMs?: number;
}

export interface ValidationFinding {
  key: "dist_present" | "base_path" | "bundle_size" | "external_urls" | "console_errors";
  ok: boolean;
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  findings: ValidationFinding[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점

export async function validateDist(
  distRoot: string,
  basePath: string,
  options: ValidateDistOptions = {},
): Promise<ValidationResult> {
  const findings: ValidationFinding[] = [];

  // 0. dist 존재 + index.html 존재 사전 검사.
  const present = await checkDistPresent(distRoot);
  findings.push(present);
  if (!present.ok) {
    return { ok: false, findings };
  }

  const assetDir = options.assetDir ?? "assets";

  // 1. base path 검증 (index.html 에 prefix 주입 확인).
  findings.push(await checkBasePath(distRoot, basePath, assetDir));

  // 2. 번들 크기.
  findings.push(
    await checkBundleSize(distRoot, options.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES, assetDir),
  );

  const allowlist = options.cdnAllowlist ?? DEFAULT_CDN_ALLOWLIST;

  // 3+4. 콘솔 에러 + 외부 리소스 요청 (Playwright 한 번에).
  //   external_urls 는 "번들에 URL 문자열이 있는가" 가 아니라 "실제로 외부를 가져오는가" 로
  //   본다 (T8.10). 오프라인/CI 로 브라우저를 못 띄우는 경우에만 정적 스캔으로 폴백한다.
  if (options.skipBrowser) {
    findings.push({
      key: "console_errors",
      ok: true,
      detail: "skipBrowser=true — Playwright 검사 건너뜀",
    });
    findings.push(await checkExternalUrls(distRoot, allowlist));
  } else {
    findings.push(
      ...(await checkHeadless(distRoot, basePath, {
        mountTimeoutMs: options.mountTimeoutMs ?? 8000,
        cdnAllowlist: allowlist,
      })),
    );
  }

  return {
    ok: findings.every((f) => f.ok),
    findings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. dist 존재

async function checkDistPresent(distRoot: string): Promise<ValidationFinding> {
  try {
    const stat = await fs.stat(distRoot);
    if (!stat.isDirectory()) {
      return { key: "dist_present", ok: false, detail: `${distRoot} 가 디렉토리가 아님` };
    }
  } catch (err) {
    return {
      key: "dist_present",
      ok: false,
      detail: `dist 디렉토리 접근 실패: ${(err as Error).message}`,
    };
  }
  const indexPath = path.join(distRoot, "index.html");
  try {
    await fs.access(indexPath);
  } catch {
    return {
      key: "dist_present",
      ok: false,
      detail: `dist/index.html 없음 — vite build 산출물이 비정상`,
    };
  }
  return { key: "dist_present", ok: true, detail: `dist + index.html 존재` };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. base path

async function checkBasePath(
  distRoot: string,
  basePath: string,
  assetDir: string,
): Promise<ValidationFinding> {
  const indexHtml = await fs.readFile(path.join(distRoot, "index.html"), "utf8");
  // basePath 는 슬래시로 시작하고 끝나는 형식: "/portfolio-showcase/{slug}/portfolio-demo/".
  // vite 가 script src/CSS link 에 그대로 prefix 한다.
  // assets/ 까지 붙은 형태로 등장해야 진짜 prefix 가 된 것 — base 가 "/" 일 때도 동일하게
  // "/assets/" 로 등장하므로 정확한 매칭에는 ${base}assets/ 를 본다.
  const expectedAssetsPrefix = `${basePath}${assetDir}/`;
  if (!indexHtml.includes(expectedAssetsPrefix)) {
    return {
      key: "base_path",
      ok: false,
      detail:
        `index.html 에 expected base prefix '${expectedAssetsPrefix}' 미발견. ` +
        `head:\n${indexHtml.slice(0, 600)}`,
    };
  }
  return {
    key: "base_path",
    ok: true,
    detail: `index.html 의 모든 asset 참조에 '${expectedAssetsPrefix}' prefix 주입됨`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 번들 크기

async function checkBundleSize(
  distRoot: string,
  maxBytes: number,
  assetDir: string,
): Promise<ValidationFinding> {
  const assetsDir = path.join(distRoot, assetDir);
  let total = 0;
  let jsBytes = 0;
  let cssBytes = 0;
  let count = 0;
  try {
    await walkBytes(assetsDir, (rel, bytes) => {
      total += bytes;
      count += 1;
      if (rel.endsWith(".js") || rel.endsWith(".mjs")) jsBytes += bytes;
      else if (rel.endsWith(".css")) cssBytes += bytes;
    });
  } catch (err) {
    return {
      key: "bundle_size",
      ok: false,
      detail: `dist/${assetDir}/ 접근 실패: ${(err as Error).message}`,
    };
  }
  const totalKb = (total / 1024).toFixed(1);
  const jsKb = (jsBytes / 1024).toFixed(1);
  const cssKb = (cssBytes / 1024).toFixed(1);
  if (total > maxBytes) {
    return {
      key: "bundle_size",
      ok: false,
      detail:
        `dist/${assetDir} 합계 ${totalKb}KB (JS ${jsKb}KB + CSS ${cssKb}KB, 파일 ${count}개) ` +
        `> 한도 ${(maxBytes / 1024).toFixed(0)}KB`,
    };
  }
  return {
    key: "bundle_size",
    ok: true,
    detail:
      `dist/${assetDir} ${totalKb}KB (JS ${jsKb}KB + CSS ${cssKb}KB, 파일 ${count}개) ≤ ` +
      `한도 ${(maxBytes / 1024).toFixed(0)}KB`,
  };
}

async function walkBytes(
  dir: string,
  visit: (relPath: string, bytes: number) => void,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkBytes(abs, visit);
    } else if (entry.isFile()) {
      const stat = await fs.stat(abs);
      visit(entry.name, stat.size);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 외부 URL

async function checkExternalUrls(
  distRoot: string,
  allowlist: string[],
): Promise<ValidationFinding> {
  const offenders: Array<{ file: string; url: string }> = [];
  let scannedFiles = 0;

  await walkText(distRoot, distRoot, async (rel, abs) => {
    const ext = path.extname(rel).toLowerCase();
    if (!TEXT_ASSET_EXTS.has(ext)) return;
    let body = "";
    try {
      body = await fs.readFile(abs, "utf8");
    } catch {
      return;
    }
    scannedFiles += 1;
    const matches = body.match(URL_REGEX);
    if (!matches) return;
    for (const url of matches) {
      const cleanUrl = url.replace(/[),.;]+$/, ""); // 트레일링 구두점 제거
      if (URL_NOISE_PATTERNS.some((p) => p.test(cleanUrl))) continue;
      if (allowlist.some((prefix) => cleanUrl.startsWith(prefix))) continue;
      offenders.push({ file: rel, url: cleanUrl });
    }
  });

  if (offenders.length > 0) {
    const sample = offenders.slice(0, 6).map((o) => `${o.file}: ${o.url}`).join("\n  ");
    return {
      key: "external_urls",
      ok: false,
      detail:
        `허용 목록 외 외부 URL ${offenders.length}건 발견 (스캔 ${scannedFiles}파일):\n  ${sample}` +
        (offenders.length > 6 ? `\n  ... +${offenders.length - 6}건` : ""),
    };
  }
  return {
    key: "external_urls",
    ok: true,
    detail:
      `외부 URL 0건 (CDN 허용: ${allowlist.join(", ")}; 스캔 ${scannedFiles}파일)`,
  };
}

async function walkText(
  dir: string,
  base: string,
  visit: (relPath: string, abs: string) => Promise<void>,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkText(abs, base, visit);
    } else if (entry.isFile()) {
      const rel = path.relative(base, abs).split(path.sep).join("/");
      await visit(rel, abs);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 콘솔 에러 (Playwright)

interface ConsoleCheckOpts {
  mountTimeoutMs: number;
  /** 로컬 서버 외에 허용할 외부 출처 prefix (Pretendard CDN 등). */
  cdnAllowlist: string[];
}

/**
 * 페이지가 실제로 보낸 요청만으로 self-contained 여부를 판정한다 (T8.10).
 *
 * 원래는 dist 텍스트를 스캔해 절대 URL 문자열을 찾았는데, 프레임워크 벤더 청크에는
 * 호출되지 않는 URL 상수가 잔뜩 들어있다 (Next 의 `http://n` 더미 base, next/font 의
 * fonts.googleapis.com·use.typekit.net, URL 파서 테스트 문자열 등). 그걸 노이즈 목록으로
 * 걸러내려 하면 "진짜로 외부 폰트를 쓰는 경우" 까지 못 잡게 된다.
 *
 * 우리가 보장하려는 성질은 "런타임에 외부 리소스를 가져오지 않는다" 이므로 그걸 직접
 * 측정한다. 앱 소스 단계의 정적 방어는 sanitize-urls(T8.8b)가 이미 맡고 있어 이중이다.
 */
function buildExternalRequestFinding(
  requested: string[],
  origin: string,
  allowlist: string[],
): ValidationFinding {
  const external = [...new Set(requested)].filter((u) => {
    if (u.startsWith(origin)) return false;
    if (u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("about:")) return false;
    return !allowlist.some((prefix) => u.startsWith(prefix));
  });
  if (external.length > 0) {
    return {
      key: "external_urls",
      ok: false,
      detail:
        `외부 리소스 요청 ${external.length}건 (허용: ${allowlist.join(", ")}):\n  ` +
        external.slice(0, 8).join("\n  ") +
        (external.length > 8 ? `\n  ... +${external.length - 8}건` : ""),
    };
  }
  const allowed = [...new Set(requested)].filter((u) => !u.startsWith(origin)).length;
  return {
    key: "external_urls",
    ok: true,
    detail:
      `실제 네트워크 요청 ${new Set(requested).size}건 중 외부 위반 0건 ` +
      `(허용 CDN ${allowed}건: ${allowlist.join(", ")})`,
  };
}

async function checkHeadless(
  distRoot: string,
  basePath: string,
  opts: ConsoleCheckOpts,
): Promise<ValidationFinding[]> {
  // 1. 작은 정적 HTTP 서버 띄우기 — basePath 가 "/portfolio-showcase/.../portfolio-demo/" 라
  //    file:// 로는 asset 해상이 안 됨. 임의 포트로 listen.
  let server: http.Server | null = null;
  let browser: Browser | null = null;
  const out: ValidationFinding[] = [];
  const requested: string[] = [];
  const allowlist = opts.cdnAllowlist;
  try {
    server = await startStaticServer(distRoot, basePath);
    const port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    const url = `${origin}${basePath}index.html`;

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const errors: string[] = [];
    page.on("request", (req) => requested.push(req.url()));
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });
    page.on("requestfailed", (req) => {
      const failure = req.failure();
      // favicon 실패 등 운영상 무시 가능한 케이스도 있으나, demo dist 에는 그런 자동 요청이
      // 거의 없다. 일단 모두 잡아 노이즈가 보이면 케이스별로 무시한다.
      errors.push(
        `requestfailed: ${req.method()} ${req.url()} — ${failure?.errorText ?? "unknown"}`,
      );
    });

    await page.goto(url, { waitUntil: "load", timeout: opts.mountTimeoutMs });
    // 앱 마운트 대기. Vite 런타임은 #root 에 마운트하지만 Next App Router 는
    // body 에 직접 렌더하므로(고정 id 없음) "화면에 실제 내용이 그려졌는가" 로 본다.
    await page.waitForFunction(
      () => {
        const root = document.getElementById("root");
        if (root) return root.children.length > 0;
        const body = document.body;
        if (!body) return false;
        const hasElement = body.querySelector("div, main, section, header, nav, ul, table");
        return !!hasElement && (body.innerText ?? "").trim().length > 0;
      },
      undefined,
      { timeout: opts.mountTimeoutMs },
    );
    // 짧게 더 대기 — 비동기 effect/이미지 등에서 늦게 터지는 에러 포착.
    await new Promise((r) => setTimeout(r, 500));

    if (errors.length > 0) {
      out.push({
        key: "console_errors",
        ok: false,
        detail:
          `콘솔/페이지 에러 ${errors.length}건 — ${url}\n  ` +
          errors.slice(0, 5).join("\n  ") +
          (errors.length > 5 ? `\n  ... +${errors.length - 5}건` : ""),
      });
    } else {
      out.push({
        key: "console_errors",
        ok: true,
        detail: `Playwright 헤드리스 로드 OK, 콘솔 에러 0건 (${url})`,
      });
    }
    out.push(buildExternalRequestFinding(requested, origin, allowlist));
    return out;
  } catch (err) {
    return [
      {
        key: "console_errors",
        ok: false,
        detail: `Playwright 검사 중 예외: ${(err as Error).message}`,
      },
      {
        key: "external_urls",
        ok: false,
        detail: "브라우저 검사가 실패해 실제 요청을 확인하지 못함",
      },
    ];
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  }
}

/**
 * 빈 포트에 정적 서버를 올린다. 요청 url 이 basePath 로 시작하면 dist 의 해당 파일을 서빙,
 * 그 외엔 404. basePath 자체(끝 슬래시 포함) 요청은 index.html 로 매핑.
 */
function startStaticServer(distRoot: string, basePath: string): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void serveRequest(req, res, distRoot, basePath).catch((err) => {
        res.statusCode = 500;
        res.end(`server error: ${(err as Error).message}`);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function serveRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  distRoot: string,
  basePath: string,
): Promise<void> {
  const reqUrl = req.url ?? "/";
  if (!reqUrl.startsWith(basePath)) {
    res.statusCode = 404;
    res.end(`Not under base: ${reqUrl}`);
    return;
  }
  // basePath 길이 - 1 (마지막 슬래시 유지) 만큼 잘라 dist 기준 상대 경로 확보.
  let rel = reqUrl.slice(basePath.length);
  if (rel === "" || rel === "/") rel = "index.html";
  // 쿼리스트링 제거.
  const qIdx = rel.indexOf("?");
  if (qIdx >= 0) rel = rel.slice(0, qIdx);
  // 디렉토리 트래버설 차단.
  if (rel.includes("..")) {
    res.statusCode = 400;
    res.end("bad path");
    return;
  }
  const filePath = path.join(distRoot, rel);
  try {
    const data = await fs.readFile(filePath);
    res.statusCode = 200;
    res.setHeader("content-type", contentTypeFor(filePath));
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end(`Not found: ${rel}`);
  }
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}
