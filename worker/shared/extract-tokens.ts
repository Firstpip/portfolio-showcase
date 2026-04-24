// portfolio-1 HTML에서 디자인 토큰을 뽑아내는 유틸.
//
// 전략:
//   1) 정규식 휴리스틱으로 먼저 시도 (네트워크 호출 없음, 대부분의 포트폴리오는 여기서 끝남)
//      - `const C = { ... }` JS 팔레트 객체 (단축키 p/s/surf/txt 또는 긴키 primary/accent/text)
//      - `:root { --primary: ...; }` CSS custom properties
//      - inline style의 `font-family:` / `border-radius:` / padding·gap 값 빈도 집계
//   2) 핵심 필드(primary/text/surface) 중 2개 이상 못 찾았을 때만 Claude Sonnet에 위임
//   3) LLM 폴백도 실패/비활성이면 중립 팔레트로 graceful fallback (여기서 throw 하지 않음)
//
// 반환하는 토큰은 Pass A 스켈레톤 프롬프트 + CSS 변수 주입에 그대로 쓰인다.

import { runClaude, SONNET } from "./claude.ts";

export type DesignTokens = {
  primary: string;
  secondary: string;
  surface: string;
  text: string;
  radius: string;
  fontFamily: string;
  spacingScale: number[];
  _source: "heuristic" | "llm" | "fallback";
};

export type ExtractOptions = {
  // 휴리스틱이 핵심 필드를 못 찾았을 때 Sonnet 호출로 보강할지. 기본 true.
  // 테스트/오프라인 환경에서 false로 끄면 heuristic → fallback 순으로만 동작.
  allowLLMFallback?: boolean;
};

const FALLBACK: Omit<DesignTokens, "_source"> = {
  primary: "#4F46E5",
  secondary: "#06B6D4",
  surface: "#FFFFFF",
  text: "#0F172A",
  radius: "12px",
  fontFamily: "'Pretendard', -apple-system, sans-serif",
  spacingScale: [4, 8, 12, 16, 24, 32],
};

const HEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;

// 팔레트 객체 키 → 토큰 역할 매핑. 단축키(p, s, surf, txt)와 긴키(primary, secondary, ...)
// 모두 커버. 먼저 매치되는 키를 우선.
const KEY_ALIASES: Record<keyof Omit<DesignTokens, "_source" | "radius" | "fontFamily" | "spacingScale">, string[]> = {
  primary: ["primary", "brand", "p", "main"],
  secondary: ["secondary", "accent", "s", "a"],
  surface: ["surface", "surf", "card", "bg", "background"],
  text: ["text", "txt", "fg", "foreground"],
};

type KVPair = { key: string; value: string };

/**
 * 메인 엔트리: portfolio-1 HTML 원문 → DesignTokens.
 * 실패해도 throw하지 않는다 (항상 사용 가능한 값을 반환).
 */
export async function extractDesignTokens(
  html: string,
  opts: ExtractOptions = {},
): Promise<DesignTokens> {
  const allowLLM = opts.allowLLMFallback ?? true;

  const pairs = [
    ...collectJsObjectPairs(html),
    ...collectCssVariables(html),
  ];

  const heuristic = buildFromPairs(pairs);
  heuristic.fontFamily = extractFontFamily(html) ?? heuristic.fontFamily;
  heuristic.radius = extractRadius(html) ?? heuristic.radius;
  heuristic.spacingScale = extractSpacingScale(html) ?? heuristic.spacingScale;

  if (isHeuristicSufficient(heuristic, pairs)) {
    return { ...heuristic, _source: "heuristic" };
  }

  if (!allowLLM) {
    return { ...heuristic, _source: "fallback" };
  }

  const llm = await llmFallback(html).catch((err) => {
    console.warn("[extract-tokens] LLM 폴백 실패, 중립 팔레트 사용:", (err as Error).message);
    return null;
  });
  if (llm) {
    return {
      ...heuristic,
      ...llm,
      _source: "llm",
    };
  }

  return { ...heuristic, _source: "fallback" };
}

// ─────────────────────────────────────────────────────────────────────
// 휴리스틱 파서들
// ─────────────────────────────────────────────────────────────────────

/**
 * `const C = { p: '#FF6B6B', s: '#FF8E53', bg: '#FFF8F5', ... }` 같은
 * 객체 리터럴에서 (key, value) 쌍을 모은다. `const X = { ... }` 형태 전부.
 * 값이 hex 색상 문자열인 항목만 반환.
 */
function collectJsObjectPairs(html: string): KVPair[] {
  const out: KVPair[] = [];
  // `const IDENT = { ... };` 블록을 찾는다. 비탐욕으로 가장 가까운 `}`까지.
  const blockRe = /\bconst\s+[A-Za-z_$][\w$]*\s*=\s*\{([\s\S]*?)\}\s*;?/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const body = m[1];
    // key: 'value' 또는 key: "value" (value는 hex 색상)
    // 짧은 객체가 아닐 수도 있으므로 모든 entry를 스캔.
    const entryRe = /([A-Za-z_$][\w$]*)\s*:\s*['"]([^'"]+)['"]/g;
    let em: RegExpExecArray | null;
    while ((em = entryRe.exec(body)) !== null) {
      const key = em[1];
      const value = em[2].trim();
      if (/^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value)) {
        out.push({ key, value });
      }
    }
  }
  return out;
}

/**
 * `:root { --primary: #1E3A5F; --accent: #06B6D4; }` 같은 CSS 변수를 모은다.
 * --name → name (앞 `--`는 제거).
 */
function collectCssVariables(html: string): KVPair[] {
  const out: KVPair[] = [];
  const rootRe = /:root\s*\{([^}]+)\}/g;
  let rm: RegExpExecArray | null;
  while ((rm = rootRe.exec(html)) !== null) {
    const body = rm[1];
    const varRe = /--([A-Za-z0-9-]+)\s*:\s*([^;]+);/g;
    let vm: RegExpExecArray | null;
    while ((vm = varRe.exec(body)) !== null) {
      const key = vm[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // primary-light → primaryLight
      const value = vm[2].trim();
      if (/^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value)) {
        out.push({ key, value });
      }
    }
  }
  return out;
}

/**
 * 수집한 (key, value) 쌍에서 각 역할에 해당하는 색상을 고른다.
 * 매칭 실패 시 FALLBACK 값 사용.
 */
function buildFromPairs(pairs: KVPair[]): Omit<DesignTokens, "_source"> {
  const lookup = (aliases: string[]): string | null => {
    for (const alias of aliases) {
      const hit = pairs.find((p) => p.key.toLowerCase() === alias.toLowerCase());
      if (hit) return normalizeHex(hit.value);
    }
    return null;
  };

  return {
    primary: lookup(KEY_ALIASES.primary) ?? FALLBACK.primary,
    secondary: lookup(KEY_ALIASES.secondary) ?? FALLBACK.secondary,
    surface: lookup(KEY_ALIASES.surface) ?? FALLBACK.surface,
    text: lookup(KEY_ALIASES.text) ?? FALLBACK.text,
    radius: FALLBACK.radius,
    fontFamily: FALLBACK.fontFamily,
    spacingScale: FALLBACK.spacingScale,
  };
}

function extractFontFamily(html: string): string | null {
  // 첫 번째 `font-family: ...` 선언 (단, inherit 제외)
  const re = /font-family\s*:\s*([^;}]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const val = m[1].trim().replace(/\s+/g, " ");
    if (val.toLowerCase() === "inherit") continue;
    return val;
  }
  return null;
}

function extractRadius(html: string): string | null {
  // 가장 자주 쓰인 border-radius 값 중 중간값(너무 작거나 큰 건 제외).
  const counts = new Map<string, number>();
  const re = /border-radius\s*:\s*(\d+(?:\.\d+)?)(px|rem|em|%)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const val = `${m[1]}${m[2]}`;
    counts.set(val, (counts.get(val) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  // 4~24px 범위를 우선 (너무 작은 radius는 input, 너무 큰 건 avatar 원형이라 대표값 아님)
  const ranked = [...counts.entries()]
    .filter(([v]) => {
      const num = parseFloat(v);
      const unit = v.replace(/[\d.]/g, "");
      if (unit !== "px") return true;
      return num >= 4 && num <= 24;
    })
    .sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}

function extractSpacingScale(html: string): number[] | null {
  // padding / gap / margin의 숫자 px 값을 수집 → 상위 빈도순 6개.
  const counts = new Map<number, number>();
  const re = /\b(?:padding|gap|margin)(?:-(?:top|right|bottom|left|block|inline))?\s*:\s*([^;}]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const values = m[1].match(/(\d+(?:\.\d+)?)px/g) ?? [];
    for (const v of values) {
      const n = parseFloat(v);
      if (n >= 2 && n <= 64) {
        counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
  }
  if (counts.size === 0) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 8).map(([n]) => n).sort((a, b) => a - b);
  // 중복 제거 후 6개로 트리밍.
  const uniq = [...new Set(top)];
  return uniq.length >= 3 ? uniq.slice(0, 6) : null;
}

/**
 * 수집된 쌍에 primary/surface/text 키 중 최소 2개가 매칭됐으면 휴리스틱 신뢰.
 * 그 미만이면 LLM 보강 필요.
 */
function isHeuristicSufficient(tokens: Omit<DesignTokens, "_source">, pairs: KVPair[]): boolean {
  if (pairs.length === 0) return false;
  let hits = 0;
  for (const role of ["primary", "surface", "text"] as const) {
    const matched = KEY_ALIASES[role].some((alias) =>
      pairs.some((p) => p.key.toLowerCase() === alias.toLowerCase()),
    );
    if (matched) hits++;
  }
  // 최소 2개 (예: primary + surface) 잡혔으면 충분.
  return hits >= 2;
}

function normalizeHex(hex: string): string {
  // 3자리 → 6자리 확장 ( #F53 → #FF5533 ), 대문자 표준화.
  const h = hex.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    return ("#" + h.slice(1).split("").map((c) => c + c).join("")).toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h.toUpperCase();
  return h;
}

// ─────────────────────────────────────────────────────────────────────
// LLM 폴백
// ─────────────────────────────────────────────────────────────────────

type LLMFields = Pick<DesignTokens, "primary" | "secondary" | "surface" | "text">;

async function llmFallback(html: string): Promise<LLMFields | null> {
  // HTML 전체가 아니라 <head>의 style 태그 + 첫 React 컴포넌트 영역만 압축해서 보낸다.
  // 팔레트 정의는 거의 항상 상단 5~10KB 안에 있음.
  const snippet = html.slice(0, 12_000);

  const prompt = [
    "아래는 단일 HTML 포트폴리오의 상단 영역입니다.",
    "이 포트폴리오의 **디자인 토큰**을 추출하세요.",
    "",
    "반드시 JSON 한 줄로만 응답. 설명/마크다운 금지.",
    '형식: {"primary":"#XXXXXX","secondary":"#XXXXXX","surface":"#XXXXXX","text":"#XXXXXX"}',
    "",
    "- primary: 브랜드 메인 색 (버튼·링크·강조)",
    "- secondary: 보조/액센트 색",
    "- surface: 카드·모달 배경 (보통 흰색 또는 매우 밝은 톤)",
    "- text: 본문 텍스트 색 (보통 어두운 네이비/블랙)",
    "",
    "모두 6자리 대문자 hex. 찾지 못한 필드도 합리적 추론값으로 채우세요.",
    "",
    "HTML:",
    "```html",
    snippet,
    "```",
  ].join("\n");

  const result = await runClaude(prompt, {
    model: SONNET,
    systemPrompt: "You return exactly one line of valid JSON. No prose, no fences.",
  });

  const parsed = parseJsonFromLLM(result.text);
  if (!parsed) return null;
  const fields: LLMFields = {
    primary: normalizeHex(parsed.primary),
    secondary: normalizeHex(parsed.secondary),
    surface: normalizeHex(parsed.surface),
    text: normalizeHex(parsed.text),
  };
  // 전부 유효 hex인지 재확인
  for (const v of Object.values(fields)) {
    if (!/^#[0-9A-F]{6}$/.test(v)) return null;
  }
  return fields;
}

function parseJsonFromLLM(text: string): Record<string, string> | null {
  // Agent SDK가 때때로 ```json ... ``` 펜스를 붙이거나 앞뒤 여백이 있을 수 있음.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // 첫 `{` ~ 마지막 `}`만 잘라 시도.
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(first, last + 1));
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}
