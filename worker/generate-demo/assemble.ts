// Pass C — 단일 HTML 통합 빌드 (T3.4).
//
// 역할:
//   Pass A 스켈레톤 + Pass B 패치(FlowPatch[]) + 시드 데이터(SeedData) → 브라우저에서
//   그대로 열리는 단일 HTML. 외부 파일 의존 0, CDN JS/CSS만 허용.
//
// 파이프라인:
//   1) 시드 주입: `<script>window.__DEMO_SEED__ = {...};</script>` 를 text/babel 블록
//      바로 앞에 삽입. Pass A 의 initDemoStore() 가 이 값을 읽어 LocalStorage 에 seed.
//   2) FlowPlaceholder 디스패처: 스켈레톤의 `function FlowPlaceholder(...)` 본문 첫
//      줄에 `window.__FLOW_COMPONENTS[flowId]` 매칭 시 해당 컴포넌트를 createElement 로
//      렌더하는 가드를 주입. 미매칭 flow 는 원래 placeholder 카드 로직으로 fall-through.
//   3) Pass B 컴포넌트 인라인: 각 patch 의 component_code 를 text/babel 블록 안쪽
//      (ReactDOM.createRoot 직전) 에 이어 붙이고, flow_id → 컴포넌트명 매핑을
//      `window.__FLOW_COMPONENTS` 에 집계.
//   4) 청소: `<!-- PASS_B_PLACEHOLDER:* -->` 주석 제거 (Pass B 가 이미 소비).
//   5) Babel 명시화: `<script type="text/babel">` 태그에 `data-presets="env,react"`
//      없으면 추가 (컴파일 범위 축소).
//
// 이 모듈은 DB 트랜지션을 직접 하지 않는다. 호출자가 demo_status 전이·파일 저장을 관리.

import type { FlowPatch } from "./sections.ts";
import type { SeedData } from "./seed.ts";

export type AssembleResult =
  | {
      ok: true;
      html: string;
      size_bytes: number;
      injected_component_count: number;
      warnings: string[];
    }
  | { ok: false; reason: string; warnings?: string[] };

// 위시켓 연결 미팅에서 네트워크가 느릴 수 있으므로 총 크기 상한을 타이트하게.
const FILE_SIZE_LIMIT_BYTES = 400_000;

/**
 * Pass A 스켈레톤 + Pass B patches + 시드 → 최종 HTML 한 덩어리.
 * 실패(스켈레톤 계약 위반·컴포넌트 충돌·크기 초과 등)는 { ok:false, reason } 로 묶어 반환.
 */
export function assembleDemo(
  skeletonHtml: string,
  patches: FlowPatch[],
  seed: SeedData,
): AssembleResult {
  const warnings: string[] = [];

  // ---- 1) text/babel 블록 경계 탐색 ----
  const openRe = /<script[^>]*type=["']text\/babel["'][^>]*>/gi;
  const opens: Array<{ index: number; length: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(skeletonHtml)) !== null) {
    opens.push({ index: m.index, length: m[0].length });
  }
  if (opens.length !== 1) {
    return {
      ok: false,
      reason: `text/babel 블록이 ${opens.length}개 (정확히 1개여야 함)`,
    };
  }
  const babelOpenIdx = opens[0].index;
  const babelOpenEnd = babelOpenIdx + opens[0].length;
  const closeRelative = skeletonHtml.slice(babelOpenEnd).search(/<\/script>/i);
  if (closeRelative === -1) {
    return { ok: false, reason: "text/babel 블록의 </script>를 찾지 못함" };
  }
  const babelCloseIdx = babelOpenEnd + closeRelative;
  const scriptBody = skeletonHtml.slice(babelOpenEnd, babelCloseIdx);

  // ---- 2) 기본 계약 재확인 (Pass A 검증과 중복이지만 assemble 단독 실행 안전망) ----
  if (!/\bfunction\s+FlowPlaceholder\s*\(/.test(scriptBody)) {
    return {
      ok: false,
      reason: "FlowPlaceholder 함수 선언을 스켈레톤 script 에서 찾지 못함",
    };
  }
  const createRootRe = /ReactDOM\.createRoot\s*\(\s*document\.getElementById\(\s*['"]root['"]\s*\)\s*\)/;
  if (!createRootRe.test(scriptBody)) {
    return { ok: false, reason: "ReactDOM.createRoot 마운트 지점을 찾지 못함" };
  }

  // ---- 3) patches 무결성: component_name 중복 + 스켈레톤 식별자 충돌 ----
  const seen = new Set<string>();
  for (const p of patches) {
    if (seen.has(p.component_name)) {
      return {
        ok: false,
        reason: `patches 에 component_name '${p.component_name}' 이 중복됨`,
      };
    }
    seen.add(p.component_name);
  }
  const reservedInSkeleton = collectTopLevelFunctionNames(scriptBody);
  for (const p of patches) {
    if (reservedInSkeleton.has(p.component_name)) {
      return {
        ok: false,
        reason:
          `component_name '${p.component_name}' 이 스켈레톤의 기존 함수와 충돌 ` +
          `(Pass B 에서 피했어야 할 이름)`,
      };
    }
  }

  // ---- 4) FlowPlaceholder 본문 첫줄에 디스패처 주입 ----
  const dispatched = injectFlowDispatcher(scriptBody);
  if (!dispatched.ok) {
    return { ok: false, reason: dispatched.reason };
  }
  let workingScript = dispatched.script;

  // ---- 5) ReactDOM.createRoot 직전에 컴포넌트 + FLOW_COMPONENTS 맵 주입 ----
  const createRootMatch = workingScript.match(createRootRe);
  if (!createRootMatch || createRootMatch.index === undefined) {
    // 디스패처 주입 직후엔 여전히 존재해야 함. 방어적.
    return {
      ok: false,
      reason: "디스패처 주입 후 ReactDOM.createRoot 지점을 재탐색하지 못함",
    };
  }
  // createRoot 가 속한 라인 시작(들여쓰기 보존을 위해)까지 되감기.
  const lineStart =
    workingScript.lastIndexOf("\n", createRootMatch.index) + 1;
  const componentBlock = patches.map((p) => p.component_code).join("\n\n");
  const flowMapEntries = patches
    .map((p) => `  ${JSON.stringify(p.flow_id)}: ${p.component_name}`)
    .join(",\n");
  const flowMapBlock =
    `window.__FLOW_COMPONENTS = {\n${flowMapEntries}\n};\n`;
  const injection =
    `\n// ---- Pass C: injected flow components (T3.4) ----\n` +
    `${componentBlock}\n\n${flowMapBlock}` +
    `// ---- end Pass C injection ----\n\n`;
  workingScript =
    workingScript.slice(0, lineStart) + injection + workingScript.slice(lineStart);

  // ---- 6) 시드 주입용 plain script 태그 구성 ----
  const seedTag =
    `<script>window.__DEMO_SEED__ = ${safeStringifyForScript(seed)};</script>\n`;

  // ---- 7) HTML 재조립 ----
  //    skeleton[0..babelOpenIdx) + seedTag + <script open> + workingScript + </script> + rest
  let assembled =
    skeletonHtml.slice(0, babelOpenIdx) +
    seedTag +
    skeletonHtml.slice(babelOpenIdx, babelOpenEnd) +
    workingScript +
    skeletonHtml.slice(babelCloseIdx);

  // ---- 8) PASS_B_PLACEHOLDER 주석 청소 ----
  assembled = assembled.replace(
    /<!--\s*PASS_B_PLACEHOLDER:[A-Za-z0-9_]+\s*-->\s*/g,
    "",
  );

  // ---- 9) text/babel 태그에 data-presets 명시 ----
  assembled = ensureBabelPresets(assembled);

  // ---- 10) 크기 검증 ----
  const size_bytes = Buffer.byteLength(assembled, "utf-8");
  if (size_bytes >= FILE_SIZE_LIMIT_BYTES) {
    return {
      ok: false,
      reason: `파일 크기 ${size_bytes} bytes ≥ ${FILE_SIZE_LIMIT_BYTES} bytes 상한`,
    };
  }

  return {
    ok: true,
    html: assembled,
    size_bytes,
    injected_component_count: patches.length,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 헬퍼

/**
 * script 본문 최상위의 `function <Name>(` 선언 이름을 집합으로.
 * 문자열 리터럴·주석 안의 false-positive 는 허용 (충돌 판정은 보수적이어도 OK).
 */
function collectTopLevelFunctionNames(script: string): Set<string> {
  const names = new Set<string>();
  const re = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script)) !== null) {
    names.add(m[1]);
  }
  return names;
}

/**
 * `function FlowPlaceholder(...)` 본문의 첫 `{` 뒤에 디스패처 주입.
 * Pass A 프롬프트는 `FlowPlaceholder({ flowId })` 형태를 명시하므로 `flowId` 가
 * 해당 함수 스코프에 바인딩돼 있다고 가정. 파라미터 괄호 매칭은 문자열/주석을
 * 건너뛰며 세서 destructuring 의 `{}` 에 흔들리지 않도록 한다.
 */
function injectFlowDispatcher(
  script: string,
): { ok: true; script: string } | { ok: false; reason: string } {
  const headRe = /\bfunction\s+FlowPlaceholder\s*\(/;
  const head = script.match(headRe);
  if (!head || head.index === undefined) {
    return { ok: false, reason: "FlowPlaceholder 선언을 찾지 못함" };
  }

  // 파라미터 괄호 매칭 시작점: 찾은 '(' 직후.
  let i = head.index + head[0].length;
  let parenDepth = 1;
  const n = script.length;
  while (i < n && parenDepth > 0) {
    const c = script[i];
    // 문자열 리터럴 스킵
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i += 1;
      while (i < n) {
        if (script[i] === "\\") {
          i += 2;
          continue;
        }
        if (script[i] === q) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    // 라인/블록 주석 스킵
    if (c === "/" && script[i + 1] === "/") {
      const nl = script.indexOf("\n", i + 2);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (c === "/" && script[i + 1] === "*") {
      const end = script.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "(") parenDepth += 1;
    else if (c === ")") parenDepth -= 1;
    i += 1;
  }
  if (parenDepth !== 0) {
    return {
      ok: false,
      reason: "FlowPlaceholder 파라미터 괄호 매칭에 실패",
    };
  }

  // `)` 직후 공백 스킵 후 `{` 를 기대.
  while (i < n && /\s/.test(script[i])) i += 1;
  if (script[i] !== "{") {
    return {
      ok: false,
      reason: `FlowPlaceholder 본문 '{' 를 찾지 못함 (대신 '${script[i] ?? "EOF"}')`,
    };
  }
  const bodyStart = i + 1;

  const dispatcher =
    `\n  // --- Pass C 디스패처: FLOW_COMPONENTS 매칭 시 해당 컴포넌트로 분기 ---\n` +
    `  if (typeof window !== 'undefined' && window.__FLOW_COMPONENTS && window.__FLOW_COMPONENTS[flowId]) {\n` +
    `    return React.createElement(window.__FLOW_COMPONENTS[flowId]);\n` +
    `  }\n`;

  return {
    ok: true,
    script: script.slice(0, bodyStart) + dispatcher + script.slice(bodyStart),
  };
}

/**
 * `<script type="text/babel">` 에 `data-presets` 속성이 없으면 `env,react` 를 추가.
 * 이미 있으면 그대로.
 */
function ensureBabelPresets(html: string): string {
  return html.replace(
    /<script\b([^>]*?)type=(["'])text\/babel\2([^>]*)>/i,
    (match, before: string, quote: string, after: string) => {
      const all = `${before} ${after}`;
      if (/\bdata-presets\s*=/.test(all)) return match;
      const trimmedBefore = before.replace(/\s+$/, "");
      const trimmedAfter = after.replace(/^\s+/, "");
      const parts = [
        trimmedBefore,
        `type=${quote}text/babel${quote}`,
        `data-presets=${quote}env,react${quote}`,
        trimmedAfter,
      ].filter((s) => s.length > 0);
      return `<script ${parts.join(" ")}>`.replace(/\s+/g, " ").replace(" >", ">");
    },
  );
}

/**
 * `</script>` 이스케이프해서 시드 JSON 이 스크립트 컨텍스트를 깨지 않게.
 * `<!--` / `-->` 도 HTML 주석 파서가 중간을 잘라먹지 않도록 이스케이프.
 */
function safeStringifyForScript(seed: unknown): string {
  return JSON.stringify(seed)
    .replace(/<\/(script)/gi, "<\\/$1")
    .replace(/<!--/g, "<\\!--")
    .replace(/-->/g, "--\\>")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
