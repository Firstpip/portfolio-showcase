// Pass A — 스켈레톤 생성기 (T3.2).
//
// 역할:
//   spec_structured + designTokens + portfolio-1 원문 → 단일 HTML의 **뼈대**.
//   각 core_flow 자리는 `<!-- PASS_B_PLACEHOLDER:{flow_id} -->` 주석으로만 남고,
//   실제 UI/로직은 Pass B(T3.3)가, 시드 주입/최종 조립은 Pass C(T3.4)가 담당.
//
// 프롬프트: worker/prompts/pass-a-skeleton.md (system으로 로드).
// 호출자: T3.4 assemble (직접) 또는 T4.2 재생성 루프 (scope='pass_a').
//
// 이 모듈은 DB 트랜지션을 직접 하지 않는다. 호출자가 demo_status 전이를 관리.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude, OPUS } from "../shared/claude.ts";
import type { DesignTokens } from "../shared/extract-tokens.ts";

// spec_structured에서 스켈레톤 생성에 쓰는 하위 집합.
// T2.2 스키마 전 필드를 넘겨도 되지만, 타입을 좁혀 실수 방지.
export type SkeletonSpec = {
  persona: { role: string; primary_goal: string };
  domain: string;
  core_flows: Array<{
    id: string;
    title: string;
    tier: 1 | 2 | 3;
    steps: string[];
    data_entities: string[];
  }>;
  tier_assignment: {
    tier_1: string[];
    tier_2: string[];
    tier_3: string[];
  };
  out_of_scope: string[];
  design_brief?: { primary_color_hint?: string; reference_portfolio_path?: string };
  data_entities?: Array<{ name: string; fields: Array<{ name: string; type: string }>; sample_count: number }>;
};

export type SkeletonTokens = Pick<
  DesignTokens,
  "primary" | "secondary" | "surface" | "text" | "radius" | "fontFamily" | "spacingScale"
>;

export type SkeletonResult =
  | {
      ok: true;
      html: string;
      reqId: string;
      duration_ms: number;
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
      size_bytes: number;
      // 검증기가 낸 경고 (fatal은 아니지만 사용자가 알아야 할 것).
      warnings: string[];
    }
  | { ok: false; reason: string; reqId?: string; raw?: string; warnings?: string[] };

const __dirname = dirname(fileURLToPath(import.meta.url));
// Pass A 프롬프트는 프로세스 수명 동안 1회만 로드. Agent SDK가 system prompt 자동 캐싱.
const SKELETON_SYSTEM_PROMPT = readFileSync(
  join(__dirname, "..", "prompts", "pass-a-skeleton.md"),
  "utf-8",
);

// 참고용 portfolio-1 원문은 프롬프트에서 "톤·스페이싱 힌트"로만 쓰인다.
// 전체를 넣으면 토큰 폭증 + 스켈레톤이 참고 UI를 복제하려 할 수 있으므로
// 상단 일정 바이트만 잘라 넘긴다 (팔레트·글로벌 스타일·첫 컴포넌트는 보통 상위에 있음).
const REFERENCE_HTML_MAX_BYTES = 14_000;

/**
 * Pass A 스켈레톤 HTML 생성.
 * 모델 호출 실패·빈 응답·구조 검증 실패는 { ok: false } 로 묶어 반환.
 */
export async function generateSkeleton(
  spec: SkeletonSpec,
  tokens: SkeletonTokens,
  portfolio1Html: string,
): Promise<SkeletonResult> {
  const userPayload = {
    spec,
    tokens,
    portfolio_reference_html: portfolio1Html.slice(0, REFERENCE_HTML_MAX_BYTES),
  };

  let result;
  try {
    result = await runClaude(JSON.stringify(userPayload), {
      model: OPUS,
      systemPrompt: SKELETON_SYSTEM_PROMPT,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Claude 호출 실패: ${msg}` };
  }

  const html = stripHtmlFence(result.text);

  if (!html.startsWith("<!DOCTYPE html>") && !html.startsWith("<!doctype html>")) {
    return {
      ok: false,
      reason: "응답이 <!DOCTYPE html>로 시작하지 않음",
      reqId: result.reqId,
      raw: html.slice(0, 300),
    };
  }
  if (!html.trimEnd().endsWith("</html>")) {
    return {
      ok: false,
      reason: "응답이 </html>로 끝나지 않음",
      reqId: result.reqId,
      raw: html.slice(-300),
    };
  }

  const validation = validateSkeleton(html, spec, tokens);
  if (!validation.ok) {
    return {
      ok: false,
      reason: `스켈레톤 검증 실패 (${validation.errors.length}건): ${validation.errors
        .slice(0, 6)
        .join("; ")}`,
      reqId: result.reqId,
      raw: html.slice(0, 400),
      warnings: validation.warnings,
    };
  }

  return {
    ok: true,
    html,
    reqId: result.reqId,
    duration_ms: result.duration_ms,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    cache_read_input_tokens: result.cache_read_input_tokens,
    size_bytes: Buffer.byteLength(html, "utf-8"),
    warnings: validation.warnings,
  };
}

// ---------------------------------------------------------------------------
// 검증기 — 테스트 스크립트에서도 재사용.

export type SkeletonValidation =
  | { ok: true; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/**
 * 스켈레톤이 Pass A 계약을 충족하는지 확인:
 *   1. React/Babel/Pretendard CDN 포함
 *   2. `:root`에 6개 CSS 변수 전부 + 값이 tokens와 일치
 *   3. `<script type="text/babel">` 블록이 정확히 1개
 *   4. TOKENS/STORAGE_KEY/useHash/DemoStoreContext 등 핵심 식별자 존재
 *   5. 각 core_flow id마다 `<!-- PASS_B_PLACEHOLDER:{id} -->` HTML 주석 1회 이상
 *   6. 각 core_flow id가 라우트 case (문자열 리터럴)로 존재
 *   7. 파일 크기 < 50KB
 *   8. 외부 이미지 URL(https://...jpg|png|gif) 0건
 */
export function validateSkeleton(
  html: string,
  spec: SkeletonSpec,
  tokens: SkeletonTokens,
): SkeletonValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1) CDN
  if (!/react@18/.test(html)) errors.push("React 18 CDN 미포함");
  if (!/@babel\/standalone/.test(html)) errors.push("Babel Standalone CDN 미포함");
  if (!/pretendard/.test(html)) warnings.push("Pretendard CDN 미포함 (권장 — fallback 폰트로 진행 가능)");

  // 2) CSS 변수 6개 + 값 매칭
  const rootMatch = html.match(/:root\s*\{([\s\S]*?)\}/);
  if (!rootMatch) {
    errors.push(":root 블록을 찾지 못함");
  } else {
    const body = rootMatch[1];
    const checks: Array<[string, string]> = [
      ["--primary", tokens.primary],
      ["--secondary", tokens.secondary],
      ["--surface", tokens.surface],
      ["--text", tokens.text],
      ["--radius", tokens.radius],
      ["--font-family", tokens.fontFamily],
    ];
    for (const [name, expected] of checks) {
      const re = new RegExp(`${escapeRe(name)}\\s*:\\s*([^;]+);`);
      const m = body.match(re);
      if (!m) {
        errors.push(`:root에 ${name} 변수 없음`);
        continue;
      }
      const actual = m[1].trim();
      if (!valueMatches(actual, expected)) {
        errors.push(`:root.${name} 값 불일치: 기대=${expected}, 실제=${actual}`);
      }
    }
  }

  // 3) script type="text/babel" 정확히 1개
  const babelBlocks = (html.match(/<script[^>]*type=["']text\/babel["'][^>]*>/gi) ?? []).length;
  if (babelBlocks === 0) {
    errors.push('<script type="text/babel"> 블록이 없음');
  } else if (babelBlocks > 1) {
    errors.push(`<script type="text/babel"> 블록이 ${babelBlocks}개 (정확히 1개여야 함)`);
  }

  // 4) 핵심 식별자
  const mustContain: Array<[string, RegExp]> = [
    ["TOKENS 상수", /\bconst\s+TOKENS\s*=\s*\{/],
    ["STORAGE_KEY 상수", /\bconst\s+STORAGE_KEY\s*=/],
    ["initDemoStore 함수", /\bfunction\s+initDemoStore\b|\binitDemoStore\s*=\s*(?:function|\(|async\s*\()/],
    ["useHash 훅", /\bfunction\s+useHash\b|\buseHash\s*=\s*(?:function|\(|async\s*\()/],
    ["DemoStoreContext", /\bDemoStoreContext\b/],
    ["ReactDOM.createRoot 마운트", /ReactDOM\.createRoot\s*\(\s*document\.getElementById\(['"]root['"]\)\s*\)/],
  ];
  for (const [label, re] of mustContain) {
    if (!re.test(html)) errors.push(`${label} 누락`);
  }

  // 5) 각 flow id의 PASS_B_PLACEHOLDER HTML 주석
  for (const flow of spec.core_flows) {
    const re = new RegExp(`<!--\\s*PASS_B_PLACEHOLDER:${escapeRe(flow.id)}\\s*-->`);
    if (!re.test(html)) {
      errors.push(`'${flow.id}' 의 PASS_B_PLACEHOLDER 주석 없음`);
    }
  }

  // 6) 각 flow id가 코드 내 문자열 리터럴로 등장 (라우트 케이스)
  for (const flow of spec.core_flows) {
    const re = new RegExp(`['"\`]${escapeRe(flow.id)}['"\`]`);
    if (!re.test(html)) {
      errors.push(`'${flow.id}' 의 문자열 리터럴(라우트 케이스) 없음`);
    }
  }

  // 7) 파일 크기 < 50KB
  const sizeBytes = Buffer.byteLength(html, "utf-8");
  if (sizeBytes >= 50_000) {
    errors.push(`파일 크기 ${sizeBytes} bytes ≥ 50KB`);
  }

  // 8) 외부 이미지 URL (프롬프트 금지 사항)
  const imgUrls = html.match(/https?:\/\/[^\s"')]+\.(?:jpg|jpeg|png|gif|webp|svg)/gi) ?? [];
  if (imgUrls.length > 0) {
    errors.push(`외부 이미지 URL ${imgUrls.length}개 발견: ${imgUrls.slice(0, 2).join(", ")}`);
  }

  return errors.length === 0 ? { ok: true, warnings } : { ok: false, errors, warnings };
}

// ---------------------------------------------------------------------------

/**
 * Opus가 prose + ```html ...``` 펜스로 감싸는 경우까지 커버해 순수 HTML만 남긴다.
 *   1) <!DOCTYPE html>(대소문자 무관) 을 찾으면 그 지점부터 슬라이스
 *   2) 찾지 못하면 <html 을 찾아 슬라이스 (doctype 없는 응답 대비)
 *   3) 끝쪽 ```(선택적으로 공백/개행만 따라붙는) 펜스 제거
 *   4) 뒤쪽에 ```` 있거나 `</html>` 뒤에 잡담이 오면 </html>까지로 컷
 */
function stripHtmlFence(text: string): string {
  let t = text;
  // 1) DOCTYPE 시작 지점 탐색 (어느 위치든).
  const doctypeMatch = t.match(/<!doctype\s+html\b/i);
  if (doctypeMatch && doctypeMatch.index !== undefined) {
    t = t.slice(doctypeMatch.index);
  } else {
    const htmlTagMatch = t.match(/<html\b/i);
    if (htmlTagMatch && htmlTagMatch.index !== undefined) {
      t = t.slice(htmlTagMatch.index);
    }
  }
  // 2) </html> 이후 부연(펜스·설명) 제거.
  const endMatch = t.match(/<\/html\s*>/i);
  if (endMatch && endMatch.index !== undefined) {
    t = t.slice(0, endMatch.index + endMatch[0].length);
  }
  return t.trim();
}

function valueMatches(actual: string, expected: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  if (norm(actual) === norm(expected)) return true;
  // hex는 대소문자 무시.
  if (/^#[0-9a-f]{3,6}$/i.test(expected) && /^#[0-9a-f]{3,6}$/i.test(actual)) {
    return actual.toLowerCase() === expected.toLowerCase();
  }
  // fontFamily는 따옴표 스타일 차이('Pretendard' vs "Pretendard") 허용.
  if (expected.includes(",") || expected.includes(" ")) {
    const stripQuotes = (s: string) => s.replace(/["']/g, "");
    return norm(stripQuotes(actual)) === norm(stripQuotes(expected));
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
