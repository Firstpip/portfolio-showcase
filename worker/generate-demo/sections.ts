// Pass B — 섹션/플로우 컴포넌트 생성기 (T3.3).
//
// 역할:
//   spec.core_flows 각각에 대해 Opus 호출 → 티어별 React 컴포넌트 코드(1개 함수 선언)를
//   JSON으로 받는다. 플로우끼리는 독립이므로 기본 병렬(Promise.all) 실행.
//   결과는 per-flow patch 배열이며, Pass C(T3.4)가 Pass A 스켈레톤의
//   <FlowPlaceholder flowId="..." /> 참조를 이 patch 의 component_name 으로 스왑하면서
//   스크립트 블록에 component_code를 인라인한다.
//
// 프롬프트: worker/prompts/pass-b-section.md (system으로 로드, 전체 공통).
// 호출자: T3.4 assemble 또는 T4.2 재생성 루프(scope='pass_b'·특정 flow 만).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude, OPUS } from "../shared/claude.ts";
import type { SeedData } from "./seed.ts";
import type { SkeletonTokens } from "./skeleton.ts";

// Pass B 프롬프트에 실제로 주입하는 토큰 서브셋.
// spacingScale 은 Pass A 스켈레톤이 이미 적용했으므로 여기서 불필요.
type SectionTokens = {
  primary: string;
  secondary: string;
  surface: string;
  text: string;
  radius: string;
  fontFamily: string;
};

// Pass B 입력 중 sections가 필요한 spec 하위 집합.
export type SectionsSpec = {
  domain: string;
  core_flows: Array<{
    id: string;
    title: string;
    tier: 1 | 2 | 3;
    steps: string[];
    data_entities: string[];
  }>;
  data_entities: Array<{
    name: string;
    fields: Array<{ name: string; type: string }>;
    sample_count: number;
  }>;
};

// 플로우 1개에 대한 patch. Pass C 가 이를 모아 스크립트에 합친다.
export type FlowPatch = {
  flow_id: string;
  tier: 1 | 2 | 3;
  component_name: string;
  component_code: string;
  // 모델 호출 메타 (로깅·디버깅용).
  reqId: string;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
};

export type FlowFailure = {
  flow_id: string;
  reason: string;
  reqId?: string;
  raw?: string;
};

export type SectionsResult =
  | {
      ok: true;
      patches: FlowPatch[];
      total_duration_ms: number;
    }
  | {
      ok: false;
      // 실패한 플로우만 반환. 성공분도 함께 돌려줘 호출자가 부분 재시도 가능.
      failures: FlowFailure[];
      patches: FlowPatch[];
      total_duration_ms: number;
    };

const __dirname = dirname(fileURLToPath(import.meta.url));
// Pass B 프롬프트는 전 플로우 공통. 프로세스 수명 동안 1회만 로드 → SDK가 system 캐시.
const SECTIONS_SYSTEM_PROMPT = readFileSync(
  join(__dirname, "..", "prompts", "pass-b-section.md"),
  "utf-8",
);

// sample_ids 에 내려줄 엔티티당 최대 개수. 프롬프트 계약과 동일.
const SAMPLE_IDS_PER_ENTITY = 5;

/**
 * 모든 core_flows에 대해 Pass B를 병렬 실행한다.
 * 한 플로우라도 실패하면 ok:false, 성공분과 실패분을 함께 반환 (호출자가 부분 재시도).
 */
export async function generateSections(
  spec: SectionsSpec,
  tokens: SkeletonTokens,
  seed: SeedData,
): Promise<SectionsResult> {
  const started = Date.now();
  const tokensLite = {
    primary: tokens.primary,
    secondary: tokens.secondary,
    surface: tokens.surface,
    text: tokens.text,
    radius: tokens.radius,
    fontFamily: tokens.fontFamily,
  };

  const settled = await Promise.all(
    spec.core_flows.map((flow) => generateFlow(flow, spec, tokensLite, seed)),
  );

  const patches: FlowPatch[] = [];
  const failures: FlowFailure[] = [];
  for (const r of settled) {
    if (r.ok) patches.push(r.patch);
    else failures.push(r.failure);
  }

  // 컴포넌트 이름 중복 검사 — Pass C가 스크립트에 인라인할 때 충돌 나면 런타임 에러.
  const nameCounts = new Map<string, number>();
  for (const p of patches) {
    nameCounts.set(p.component_name, (nameCounts.get(p.component_name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      // 중복은 실패로 처리하되 어느 flow가 범인인지 전부 기록.
      const offenders = patches
        .filter((p) => p.component_name === name)
        .map((p) => p.flow_id);
      failures.push({
        flow_id: offenders.slice(1).join(","),
        reason: `component_name '${name}' 중복 (충돌 플로우: ${offenders.join(", ")})`,
      });
    }
  }

  const total_duration_ms = Date.now() - started;

  if (failures.length > 0) {
    return { ok: false, patches, failures, total_duration_ms };
  }
  return { ok: true, patches, total_duration_ms };
}

/**
 * 플로우 1개에 대한 Pass B. runClaude → JSON 파싱 → 구조 & 티어 검증 → patch.
 */
async function generateFlow(
  flow: SectionsSpec["core_flows"][number],
  spec: SectionsSpec,
  tokens: SectionTokens,
  seed: SeedData,
): Promise<
  | { ok: true; patch: FlowPatch }
  | { ok: false; failure: FlowFailure }
> {
  // 관련 엔티티 스키마만 발췌해 토큰 절감.
  const entities = spec.data_entities.filter((e) =>
    flow.data_entities.includes(e.name),
  );

  // seed에서 각 엔티티의 샘플 id 추출. 모델은 실제 데이터는 runtime store에서 읽지만,
  // 초기 선택·기본값 힌트 용도로 몇 개 id 리터럴을 참고할 수 있게 한다.
  const sample_ids: Record<string, string[]> = {};
  for (const ent of entities) {
    const records = seed[ent.name];
    if (!Array.isArray(records)) continue;
    const ids: string[] = [];
    for (const rec of records.slice(0, SAMPLE_IDS_PER_ENTITY)) {
      if (typeof rec.id === "string") ids.push(rec.id);
    }
    if (ids.length > 0) sample_ids[ent.name] = ids;
  }

  const userPayload = {
    flow,
    tier: flow.tier,
    domain: spec.domain,
    entities,
    tokens,
    sample_ids,
  };

  let result;
  try {
    result = await runClaude(JSON.stringify(userPayload), {
      model: OPUS,
      systemPrompt: SECTIONS_SYSTEM_PROMPT,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      failure: { flow_id: flow.id, reason: `Claude 호출 실패: ${msg}` },
    };
  }

  // JSON 파싱 (Opus가 펜스·prose를 감쌀 가능성 방어).
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(result.text));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      failure: {
        flow_id: flow.id,
        reason: `JSON 파싱 실패: ${msg}`,
        reqId: result.reqId,
        raw: result.text.slice(0, 400),
      },
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      failure: {
        flow_id: flow.id,
        reason: "응답이 JSON 객체가 아님",
        reqId: result.reqId,
        raw: result.text.slice(0, 400),
      },
    };
  }

  const component_name = parsed["component_name"];
  const component_code = parsed["component_code"];
  const tierRaw = parsed["tier"];

  if (typeof component_name !== "string" || typeof component_code !== "string") {
    return {
      ok: false,
      failure: {
        flow_id: flow.id,
        reason: "component_name/component_code 가 문자열 아님",
        reqId: result.reqId,
        raw: JSON.stringify(parsed).slice(0, 400),
      },
    };
  }

  if (tierRaw !== 1 && tierRaw !== 2 && tierRaw !== 3) {
    return {
      ok: false,
      failure: {
        flow_id: flow.id,
        reason: `tier 값이 1|2|3 아님: ${String(tierRaw)}`,
        reqId: result.reqId,
      },
    };
  }
  if (tierRaw !== flow.tier) {
    return {
      ok: false,
      failure: {
        flow_id: flow.id,
        reason: `tier 불일치: 모델=${tierRaw}, spec=${flow.tier}`,
        reqId: result.reqId,
      },
    };
  }

  const validation = validateFlowComponent(component_name, component_code, flow);
  if (!validation.ok) {
    return {
      ok: false,
      failure: {
        flow_id: flow.id,
        reason: `컴포넌트 검증 실패 (${validation.errors.length}건): ${validation.errors
          .slice(0, 5)
          .join("; ")}`,
        reqId: result.reqId,
        raw: component_code.slice(0, 400),
      },
    };
  }

  return {
    ok: true,
    patch: {
      flow_id: flow.id,
      tier: flow.tier,
      component_name,
      component_code,
      reqId: result.reqId,
      duration_ms: result.duration_ms,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      cache_read_input_tokens: result.cache_read_input_tokens,
    },
  };
}

// ---------------------------------------------------------------------------
// 검증기 — 테스트 스크립트에서도 재사용.

export type FlowValidation =
  | { ok: true }
  | { ok: false; errors: string[] };

// JS 예약어 + Pass A 예약 식별자. 컴포넌트 이름으로 사용 금지.
const RESERVED_NAMES = new Set<string>([
  // Pass A 예약 (skeleton 프롬프트 §4~§8 참조).
  "App",
  "HomePage",
  "FlowPlaceholder",
  "DemoStoreContext",
  "TOKENS",
  "STORAGE_KEY",
  "initDemoStore",
  "saveDemoStore",
  "useHash",
  "ReactDOM",
  "React",
  // 흔한 JS 전역/예약어.
  "function",
  "class",
  "const",
  "let",
  "var",
  "return",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "true",
  "false",
  "null",
  "undefined",
  "default",
  "new",
  "this",
  "typeof",
]);

/**
 * 컴포넌트 patch 의 형식·티어 규칙을 정적 검증.
 *   이름:  /^Flow[A-Za-z0-9_]+$/, 예약어 아님
 *   코드:  `function <name>() {` 로 시작, 매칭 `}`로 끝
 *   steps: flow.steps 의 각 항목이 코드 내 문자열 리터럴로 등장 (유저 가시 텍스트)
 *   tier1: `setStore(` 호출 ≥ 1
 *   tier2: `setStore(`·`saveDemoStore(`·`localStorage.` 0건, 그러나 toast 류 state 이름 ≥ 1
 *   tier3: 리터럴 "본 계약 시 구현 예정" 포함, 버튼 요소 0건
 *   금지:  `DemoStoreContext`·`TOKENS` 재선언, `import`·`export`
 */
export function validateFlowComponent(
  component_name: string,
  component_code: string,
  flow: SectionsSpec["core_flows"][number],
): FlowValidation {
  const errors: string[] = [];

  // --- 이름 ---
  if (!/^Flow[A-Za-z0-9_]+$/.test(component_name)) {
    errors.push(`component_name '${component_name}' 이 /^Flow[A-Za-z0-9_]+$/ 에 맞지 않음`);
  }
  if (RESERVED_NAMES.has(component_name)) {
    errors.push(`component_name '${component_name}' 이 예약 식별자`);
  }

  // --- 코드 형식 ---
  const startRe = new RegExp(`^\\s*function\\s+${escapeRe(component_name)}\\s*\\(\\s*\\)\\s*\\{`);
  if (!startRe.test(component_code)) {
    errors.push(`component_code가 'function ${component_name}() {' 로 시작하지 않음`);
  }
  if (!/\}\s*$/.test(component_code)) {
    errors.push("component_code가 '}' 로 끝나지 않음");
  }
  // 대괄호 균형 검사 (문자열/주석 내부는 무시).
  const braceBalance = balanceCheck(component_code);
  if (braceBalance !== 0) {
    errors.push(`중괄호 균형 이상: net=${braceBalance}`);
  }

  // --- 금지 패턴 ---
  if (/\bimport\s/.test(component_code)) errors.push("import 구문 금지");
  if (/\bexport\s/.test(component_code)) errors.push("export 구문 금지");
  if (/\bconst\s+DemoStoreContext\b/.test(component_code)) {
    errors.push("DemoStoreContext 재선언 금지");
  }
  if (/\bconst\s+TOKENS\b/.test(component_code)) errors.push("TOKENS 재선언 금지");
  if (/\bconst\s+STORAGE_KEY\b/.test(component_code)) errors.push("STORAGE_KEY 재선언 금지");

  // --- flow.steps 가 user-visible 텍스트로 등장 ---
  // 단계 텍스트 자체가 JSX/문자열 리터럴 어디든 존재하면 OK.
  for (const step of flow.steps) {
    if (!containsVisibleText(component_code, step)) {
      errors.push(`step '${step}' 이 사용자 가시 텍스트로 등장하지 않음`);
    }
  }

  // --- 티어별 규칙 ---
  const hasSetStore = /\bsetStore\s*\(/.test(component_code);
  const hasSaveDemoStore = /\bsaveDemoStore\s*\(/.test(component_code);
  const hasLocalStorage = /\blocalStorage\s*\./.test(component_code);

  if (flow.tier === 1) {
    if (!hasSetStore) {
      errors.push("tier 1: setStore( 호출이 0건 (CRUD 저장 없음)");
    }
  } else if (flow.tier === 2) {
    if (hasSetStore) errors.push("tier 2: setStore( 호출 금지 (페이크 저장)");
    if (hasSaveDemoStore) errors.push("tier 2: saveDemoStore( 호출 금지");
    if (hasLocalStorage) errors.push("tier 2: localStorage.* 직접 접근 금지");
    // 토스트·배너 state가 있어야 저장 페이크 메시지가 동작.
    const hasToastish =
      /\bsetToast\s*\(/.test(component_code) ||
      /\bsetMessage\s*\(/.test(component_code) ||
      /\bsetBanner\s*\(/.test(component_code) ||
      /\bsetFeedback\s*\(/.test(component_code) ||
      /\bsetNotice\s*\(/.test(component_code) ||
      /\bsetAlertText\s*\(/.test(component_code);
    if (!hasToastish) {
      errors.push("tier 2: 토스트/메시지 state setter (setToast/setMessage 등) 없음");
    }
  } else {
    // tier 3
    if (!component_code.includes("본 계약 시 구현 예정")) {
      errors.push("tier 3: '본 계약 시 구현 예정' 문구 누락");
    }
    if (/<button\b/i.test(component_code)) {
      errors.push("tier 3: <button> 요소 금지 (placeholder 카드만)");
    }
    if (hasSetStore || hasSaveDemoStore || hasLocalStorage) {
      errors.push("tier 3: 상태 저장 호출 금지");
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------

/**
 * 문자열 `needle` 이 코드 내 "사용자 가시 텍스트"로 등장하는지 판단.
 *
 * 검증 단계 (relaxation 순서):
 *   1) 전체 substring 또는 공백 정규화 후 substring (가장 엄격)
 *   2) needle 안에 따옴표(' " `) 로 묶인 부분문자열이 있으면 그것을 권위 있는 UI 라벨로 보고
 *      모두 코드 안에 등장하는지 확인 (예: "센터 상세에서 '후기 전체 보기' 선택" → '후기 전체 보기' 만 검사).
 *   3) 토큰 분할 fallback: 공백/괄호/구두점으로 나눈 의미 토큰(한글 2자+ / 영문 3자+) 중 50% 이상이
 *      코드 안에 등장하면 통과. step 표현이 자연어 narration("탭"·"확인"·"…에서") 인 경우 풀어준다.
 *
 * 의도: validator 가 React 컴포넌트의 자연스러운 라벨링을 거부하지 않도록.
 *   엄격한 substring 만으로는 "검색창 탭"·"…에서 '...' 선택" 같은 메타-언어 step 이 모두 fail.
 *   tier 별 동작 검증(setStore/toast/placeholder 문구)은 별도라, step 매칭은 "최소한 flow 의
 *   주요 텍스트 요소가 코드에 흔적으로 남아있는지" 정도면 충분.
 */
function containsVisibleText(code: string, needle: string): boolean {
  const n = needle.trim();
  if (n.length === 0) return true;

  // 1) 직접 substring (공백 정규화 포함).
  if (code.includes(n)) return true;
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();
  if (squash(code).includes(squash(n))) return true;

  // 2) 따옴표로 묶인 UI 라벨 추출. 있으면 그것을 권위 있는 needle 로 사용.
  const quoteRegex = /['"`]([^'"`]+)['"`]/g;
  const quoted: string[] = [];
  for (const m of n.matchAll(quoteRegex)) {
    const q = m[1].trim();
    if (q.length >= 2) quoted.push(q);
  }
  if (quoted.length > 0) {
    return quoted.every((q) => code.includes(q) || squash(code).includes(squash(q)));
  }

  // 3) 토큰 fallback. 공백·괄호·구두점으로 분할 후, 한글 2자+ 또는 영문 3자+ 만 의미 토큰으로 간주.
  const rawTokens = n.split(/[\s()\[\]{}「」『』\-,/·:;~!?·]+/).filter((t) => t.length >= 2);
  const meaningful = rawTokens.filter((t) =>
    /[가-힣]/.test(t) ? t.length >= 2 : t.length >= 3,
  );
  if (meaningful.length === 0) return false;
  const matched = meaningful.filter((t) => code.includes(t)).length;
  return matched / meaningful.length >= 0.5;
}

/**
 * `{` - `}` 균형 검사. 문자열 리터럴(single/double/backtick)과 라인/블록 주석은 스킵.
 * 템플릿 리터럴 ${...} 중첩은 단순히 문자열로 간주 (정밀도 희생, false positive 회피 목적).
 */
function balanceCheck(src: string): number {
  let depth = 0;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    // 라인 주석
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i + 2);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    // 블록 주석
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    // 문자열 리터럴
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i += 1;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    i += 1;
  }
  return depth;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * ```json ... ``` 또는 ``` ... ``` 펜스 제거. seed.ts와 동일 로직.
 */
function stripJsonFence(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json|JSON)?\s*\n?/, "");
  t = t.replace(/\n?\s*```\s*$/, "");
  t = t.trim();
  if (!t.startsWith("{")) {
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first !== -1 && last > first) {
      t = t.slice(first, last + 1);
    }
  }
  return t;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
