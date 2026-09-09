// T8.3 — 신규 generate-app 모듈 (2-pass).
//
// Opus 4.7 의 출력 한도가 32K tokens 라 단일 호출로 발달센터급(8~10 flows) 데모를
// 한 번에 못 만든다 (~50KB src/ 트리). 그래서 2-pass 분할:
//
//   Pass 1 (foundation, ~15K tokens):
//     - main.tsx, index.css, App.tsx (모든 라우트), Layout.tsx, types.ts,
//       lib/store.ts, lib/seed.ts, tailwind.config.cjs
//     - 각 flow 의 placeholder page (5~10 LOC, "생성 중..." div)
//     - 단일 JSON {"files": [...]}
//
//   Pass 2 (per-flow page, 각 ~3K tokens):
//     - 각 flow 마다 1 호출. Promise.all 로 병렬 (cache_read 적중).
//     - 단일 JSON {"path": "src/pages/Xxx.tsx", "content": "..."} (files 배열 아님 — 한 파일).
//     - placeholder 가 정식 본문으로 덮어씌워짐.
//
// 시스템 프롬프트는 두 개 분리: generate-app-foundation.md / generate-app-page.md.
//
// 호출자: T8.7 orchestrator. 본 task 단위 검증은 test-generate-app.ts.

import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runClaude, OPUS, type RunResult } from "../shared/claude.ts";
import type { StackName, Workspace } from "./build-runtime.ts";
import type { DemoMode } from "./mobile-frame.ts";
import { tokensToTailwindConfig } from "./tokens-to-tailwind.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 타입

export interface GenerateAppInput {
  spec: Record<string, unknown>;
  tokens: {
    primary: string;
    secondary: string;
    surface: string;
    text: string;
    radius: string;
    fontFamily: string;
    [k: string]: unknown;
  };
  portfolio_reference_html: string;
  base_path: string;
  workspace: Workspace;
  /** T8.10: 런타임 스택. 프롬프트 분기에 쓴다 (workspace.stack 과 항상 동일). */
  stack: StackName;
  /** T8.9: demo_mode. standard 가 아니면 모드별 프롬프트 조각이 덧붙는다. */
  demo_mode?: DemoMode;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenerateAppOk {
  ok: true;
  /** Pass 1 + Pass 2 합쳐서 최종 워크스페이스에 작성된 파일 목록 (덮어쓰기 후 최종). */
  written: GeneratedFile[];
  /** Pass 별 사용량. */
  passes: {
    foundation: PassUsage;
    pages: PassUsage[];
  };
  total_duration_ms: number;
}

export interface GenerateAppErr {
  ok: false;
  code:
    | "FOUNDATION_EMPTY"
    | "FOUNDATION_PARSE"
    | "FOUNDATION_INVALID"
    | "FOUNDATION_WRITE"
    | "PAGE_EMPTY"
    | "PAGE_PARSE"
    | "PAGE_INVALID"
    | "PAGE_WRITE"
    | "NO_FLOWS";
  message: string;
  raw_text?: string;
  pass?: "foundation" | "page";
  flow_id?: string;
}

export type GenerateAppResult = GenerateAppOk | GenerateAppErr;

interface PassUsage {
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 프롬프트 로드 (한 번 + 캐시)

/**
 * 스택별 파일 레이아웃 (T8.10).
 *
 * page 경로와 "Pass 2 가 반드시 따라야 할 계약 파일" 이 프레임워크마다 다르다.
 * Vite 계열은 src/ 아래 라우터 페이지, Next App Router 는 app/<flow>/page.tsx.
 */
export const STACK_LAYOUT: Record<
  StackName,
  { pagePath: (flowId: string) => string; contractFiles: string[] }
> = {
  "vite-react-ts": {
    pagePath: (id) => `src/pages/${pascalCase(id)}.tsx`,
    contractFiles: [
      "src/types.ts",
      "src/lib/store.ts",
      "src/lib/store.tsx",
      "src/components/Layout.tsx",
    ],
  },
  "vite-vue": {
    pagePath: (id) => `src/pages/${pascalCase(id)}.vue`,
    contractFiles: ["src/types.ts", "src/lib/store.ts", "src/components/Layout.vue"],
  },
  "next-static": {
    pagePath: (id) => `app/${id}/page.tsx`,
    contractFiles: [
      "types.ts",
      "lib/store.tsx",
      "lib/store.ts",
      "components/Layout.tsx",
    ],
  },
};

const promptCache = new Map<string, string>();

/**
 * 스택별 프롬프트 파일 접미사 (T8.10).
 *
 * React 는 기존 파일명을 그대로 둔다 — 이미 검증된 경로를 건드리지 않기 위해서.
 */
const PROMPT_SUFFIX: Record<StackName, string> = {
  "vite-react-ts": "",
  "vite-vue": "-vue",
  "next-static": "-next",
};

function repoPromptPath(name: string): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), "..", "prompts", name);
}

/**
 * 스택별 프롬프트 + (필요 시) demo_mode 조각을 합쳐 돌려준다.
 *
 * 모드 조각은 스택과 직교하므로 프롬프트 파일을 모드×스택으로 복제하지 않고
 * 뒤에 덧붙인다 (T8.9). standard 는 조각이 없어 기존 프롬프트와 완전히 동일하다.
 */
function loadPrompt(
  kind: "foundation" | "page",
  stack: StackName,
  demoMode: DemoMode = "standard",
): string {
  const key = `${kind}${PROMPT_SUFFIX[stack]}|${demoMode}`;
  const hit = promptCache.get(key);
  if (hit !== undefined) return hit;

  let text = readFileSync(
    repoPromptPath(`generate-app-${kind}${PROMPT_SUFFIX[stack]}.md`),
    "utf8",
  );
  if (demoMode !== "standard") {
    try {
      text += readFileSync(repoPromptPath(`modes/${demoMode}.md`), "utf8");
    } catch {
      // 전용 조각이 없는 모드는 standard 와 동일하게 취급한다 (T8.11 이전의
      // admin-dashboard/workflow-diagram 이 여기 해당) — 파이프라인을 멈추지 않는다.
      console.warn(`[generate-app] demo_mode='${demoMode}' 전용 프롬프트 조각 없음 — standard 로 진행`);
    }
  }
  promptCache.set(key, text);
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1 → Pass 2 타입 계약

/** Pass 2 가 반드시 따라야 하는 foundation 원문 (경로 → 내용). */
export type FoundationContracts = Record<string, string>;

/**
 * Pass 2 에 실어 보낼 foundation 파일을 고른다.
 *
 * page 는 `@/types` 의 엔티티 타입과 `@/lib/store` 의 훅 시그니처를 그대로 써야
 * 하는데, 프롬프트로 "존재한다" 고만 알려주면 각 page 호출이 필드 타입을 제각각
 * 가정한다 (id: string vs number 등) → vite build 의 tsc 가 거부.
 * 그래서 원문을 그대로 넘긴다. 크기가 크면 계약 파악에 필요한 앞부분만 자른다.
 */
export function pickFoundationContracts(
  files: GeneratedFile[],
  wanted: string[] = STACK_LAYOUT["vite-react-ts"].contractFiles,
  maxBytesPerFile = 12000,
): FoundationContracts {
  const out: FoundationContracts = {};
  for (const want of wanted) {
    const hit = files.find((f) => f.path === want);
    if (!hit) continue;
    out[hit.path] =
      hit.content.length > maxBytesPerFile
        ? hit.content.slice(0, maxBytesPerFile) + "\n/* …(길어서 잘림) */"
        : hit.content;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 안전 헬퍼

function stripJsonOuter(raw: string): string {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last < 0 || last < first) return raw.trim();
  return raw.slice(first, last + 1);
}

/**
 * Opus 가 JSON 문자열 리터럴 안에 raw 제어문자(대부분 코드 안의 개행)를 escape
 * 없이 그대로 넣어 보내는 경우가 있다. JSON 스펙상 U+0000~U+001F 는 문자열
 * 리터럴 안에서 반드시 escape 돼야 하므로 JSON.parse 가 "Bad control character"
 * 로 죽는다 (T8.7 E2E 1차 실패: Pass 2 flow_5).
 *
 * 프롬프트를 더 조여도 장문 코드 응답에서는 재발 가능성이 남아, 파서 쪽에서
 * 복구한다: 문자열 리터럴 내부의 제어문자만 escape 시퀀스로 바꿔 재시도.
 * 리터럴 밖(구조 문자 사이)의 개행·들여쓰기는 JSON 이 원래 허용하므로 건드리지 않는다.
 */
function parseLenientJson(raw: string): unknown {
  const sliced = stripJsonOuter(raw);
  try {
    return JSON.parse(sliced);
  } catch (err) {
    const repaired = escapeControlCharsInStrings(sliced);
    if (repaired === sliced) throw err;
    return JSON.parse(repaired);
  }
}

function escapeControlCharsInStrings(s: string): string {
  const MAP: Record<string, string> = {
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
    "\b": "\\b",
    "\f": "\\f",
  };
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      out += c;
      escaped = false;
      continue;
    }
    if (inString && c === "\\") {
      out += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString && c.charCodeAt(0) < 0x20) {
      out += MAP[c] ?? "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
      continue;
    }
    out += c;
  }
  return out;
}

const SAFE_PATH_RE = /^[a-zA-Z0-9_./-]+$/;
function isSafeRelPath(p: string): boolean {
  if (!p || p.length > 200) return false;
  if (!SAFE_PATH_RE.test(p)) return false;
  if (p.startsWith("/") || p.startsWith("./") || p.startsWith("../")) return false;
  if (p.includes("//")) return false;
  if (p.split("/").some((seg) => seg === "" || seg === "..")) return false;
  return true;
}

async function writeWorkspaceFile(
  ws: Workspace,
  rel: string,
  content: string,
): Promise<void> {
  const abs = path.join(ws.path, rel);
  const wsResolved = path.resolve(ws.path);
  const fileResolved = path.resolve(abs);
  if (!fileResolved.startsWith(wsResolved + path.sep) && fileResolved !== wsResolved) {
    throw new Error(`${rel} 가 workspace escape: ${fileResolved}`);
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

function passUsage(r: RunResult): PassUsage {
  return {
    duration_ms: r.duration_ms,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    cache_creation_input_tokens: r.cache_creation_input_tokens,
    cache_read_input_tokens: r.cache_read_input_tokens,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1 — foundation

interface FoundationPassResult {
  files: GeneratedFile[];
  usage: PassUsage;
  raw_text: string;
}

async function runFoundationPass(input: GenerateAppInput): Promise<FoundationPassResult> {
  const userPayload = {
    spec: input.spec,
    tokens: input.tokens,
    portfolio_reference_html: input.portfolio_reference_html,
    base_path: input.base_path,
  };
  // user 메시지 끝에 출력 가드 — Opus 가 "I'll analyze..." 같은 인트로로 시작 안 하도록.
  const userMessage =
    JSON.stringify(userPayload) +
    `\n\n위 입력으로 foundation 파일들을 단일 JSON {"files": [...]} 으로 즉시 출력하라. 분석 멘트·인트로·설명 일체 금지. 첫 바이트 \`{\` 마지막 \`}\`.`;
  const runResult = await runClaude(userMessage, {
    model: OPUS,
    systemPrompt: loadPrompt("foundation", input.stack, input.demo_mode),
    allowedTools: [],
    // maxTurns=2 — Opus 가 가끔 첫 turn 에 인트로 내고 두 번째 turn 에 JSON 내는 경우 대비.
    // result 메시지는 마지막 turn 응답이라 두 번째 turn 의 JSON 이 잡힘.
    maxTurns: 2,
    // Pass 1 은 ~15K output tokens 안에 안전.
    maxOutputTokens: 32000,
  });

  const raw = runResult.text ?? "";
  if (!raw.trim()) {
    throw makeFail("FOUNDATION_EMPTY", "Pass 1 응답 비어있음", raw, "foundation");
  }
  let parsed: unknown;
  try {
    parsed = parseLenientJson(raw);
  } catch (err) {
    throw makeFail(
      "FOUNDATION_PARSE",
      `Pass 1 JSON.parse 실패: ${(err as Error).message}`,
      raw,
      "foundation",
    );
  }
  if (!parsed || typeof parsed !== "object" || !("files" in parsed)) {
    throw makeFail("FOUNDATION_INVALID", "Pass 1 응답에 files 키 없음", raw, "foundation");
  }
  const filesRaw = (parsed as { files: unknown }).files;
  if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
    throw makeFail(
      "FOUNDATION_INVALID",
      `Pass 1 files 빈 배열 또는 배열 아님 (${typeof filesRaw})`,
      raw,
      "foundation",
    );
  }
  const validated: GeneratedFile[] = [];
  for (let i = 0; i < filesRaw.length; i++) {
    const f = filesRaw[i];
    if (!f || typeof f !== "object") {
      throw makeFail("FOUNDATION_INVALID", `Pass 1 files[${i}] 객체 아님`, raw, "foundation");
    }
    const fpath = (f as Record<string, unknown>)["path"];
    const fcontent = (f as Record<string, unknown>)["content"];
    if (typeof fpath !== "string" || typeof fcontent !== "string") {
      throw makeFail(
        "FOUNDATION_INVALID",
        `Pass 1 files[${i}].path/content 가 string 아님`,
        raw,
        "foundation",
      );
    }
    if (!isSafeRelPath(fpath)) {
      throw makeFail(
        "FOUNDATION_INVALID",
        `Pass 1 files[${i}].path 안전하지 않음: ${JSON.stringify(fpath)}`,
        raw,
        "foundation",
      );
    }
    validated.push({ path: fpath, content: fcontent });
  }
  return { files: validated, usage: passUsage(runResult), raw_text: raw };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2 — single page

interface PagePassResult {
  file: GeneratedFile;
  usage: PassUsage;
  raw_text: string;
  flow_id: string;
}

function pascalCase(id: string): string {
  return id
    .split(/[_-]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join("");
}

async function runPagePass(
  input: GenerateAppInput,
  flow: { id: string; tier: number; title: string },
  contracts: FoundationContracts,
): Promise<PagePassResult> {
  const pagePath = STACK_LAYOUT[input.stack].pagePath(flow.id);
  const userPayload = {
    spec: input.spec,
    tokens: input.tokens,
    flow_id: flow.id,
    page_path: pagePath,
    tier: flow.tier,
    // T8.3b: Pass 1 이 실제로 생성한 타입·스토어 본문. 이게 없으면 page 마다
    // 엔티티 필드 타입을 제각각 가정해 tsc 가 깨진다 (T8.7 E2E 간헐 실패 원인).
    foundation_source: contracts,
  };
  const userMessage =
    JSON.stringify(userPayload) +
    `\n\n위 flow ${flow.id} (tier ${flow.tier}) page 를 단일 JSON {"path": "${pagePath}", "content": "..."} 으로 즉시 출력하라. 분석 멘트·인트로 일체 금지. 첫 바이트 \`{\` 마지막 \`}\`.`;
  const runResult = await runClaude(userMessage, {
    model: OPUS,
    systemPrompt: loadPrompt("page", input.stack, input.demo_mode),
    allowedTools: [],
    maxTurns: 2,
    // 한 페이지 ~3~5K output. 32K 한도 매우 여유.
    maxOutputTokens: 16000,
  });

  const raw = runResult.text ?? "";
  if (!raw.trim()) {
    throw makeFail(
      "PAGE_EMPTY",
      `Pass 2 (${flow.id}) 응답 비어있음`,
      raw,
      "page",
      flow.id,
    );
  }
  let parsed: unknown;
  try {
    parsed = parseLenientJson(raw);
  } catch (err) {
    throw makeFail(
      "PAGE_PARSE",
      `Pass 2 (${flow.id}) JSON.parse 실패: ${(err as Error).message}`,
      raw,
      "page",
      flow.id,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw makeFail("PAGE_INVALID", `Pass 2 (${flow.id}) 객체 아님`, raw, "page", flow.id);
  }
  const obj = parsed as Record<string, unknown>;
  const fpath = obj["path"];
  const fcontent = obj["content"];
  if (typeof fpath !== "string" || typeof fcontent !== "string") {
    throw makeFail(
      "PAGE_INVALID",
      `Pass 2 (${flow.id}) path/content string 아님`,
      raw,
      "page",
      flow.id,
    );
  }
  if (!isSafeRelPath(fpath)) {
    throw makeFail(
      "PAGE_INVALID",
      `Pass 2 (${flow.id}) path 안전하지 않음: ${JSON.stringify(fpath)}`,
      raw,
      "page",
      flow.id,
    );
  }
  if (fpath !== pagePath) {
    // path 가 우리가 지정한 값과 다르면 강제로 우리 값 사용 (LLM 실수 방지).
    console.warn(
      `[generate-app] Pass 2 (${flow.id}): LLM 이 path=${fpath} 줬지만 ${pagePath} 로 강제`,
    );
  }
  return {
    file: { path: pagePath, content: fcontent },
    usage: passUsage(runResult),
    raw_text: raw,
    flow_id: flow.id,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼 — 실패 reject 객체

function makeFail(
  code: GenerateAppErr["code"],
  message: string,
  raw_text: string,
  pass: "foundation" | "page",
  flow_id?: string,
): GenerateAppErr & { __isGenAppFail: true } {
  const err: GenerateAppErr = {
    ok: false,
    code,
    message,
    raw_text,
    pass,
    ...(flow_id ? { flow_id } : {}),
  };
  return Object.assign(err, { __isGenAppFail: true as const });
}

function isGenAppFail(v: unknown): v is GenerateAppErr {
  return Boolean(v && typeof v === "object" && (v as { __isGenAppFail?: true }).__isGenAppFail);
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인

export async function generateApp(input: GenerateAppInput): Promise<GenerateAppResult> {
  const t0 = Date.now();
  const flows = (input.spec.core_flows as Array<{ id: string; tier: number; title: string }>) ?? [];
  if (!Array.isArray(flows) || flows.length === 0) {
    return {
      ok: false,
      code: "NO_FLOWS",
      message: "spec.core_flows 가 비어있음",
    };
  }

  // ─── Pass 1: foundation ───
  let foundation: FoundationPassResult;
  try {
    foundation = await runFoundationPass(input);
  } catch (err) {
    if (isGenAppFail(err)) return err;
    return {
      ok: false,
      code: "FOUNDATION_EMPTY",
      message: `Pass 1 예외: ${(err as Error).message}`,
    };
  }

  // foundation 파일 작성. tailwind.config.cjs 는 결정론적 모듈로 강제 작성/덮어쓰기
  // (T8.4 — LLM 비결정성 제거 + 출력 토큰 절약).
  for (const f of foundation.files) {
    if (f.path === "tailwind.config.cjs") {
      // LLM 응답에 포함됐으면 무시 (모듈이 덮어씀)
      continue;
    }
    try {
      await writeWorkspaceFile(input.workspace, f.path, f.content);
    } catch (err) {
      return {
        ok: false,
        code: "FOUNDATION_WRITE",
        message: `${f.path} 쓰기 실패: ${(err as Error).message}`,
      };
    }
  }
  // tailwind.config.cjs 결정론적 작성
  try {
    await writeWorkspaceFile(
      input.workspace,
      "tailwind.config.cjs",
      tokensToTailwindConfig({
        primary: input.tokens.primary,
        secondary: input.tokens.secondary,
        surface: input.tokens.surface,
        text: input.tokens.text,
        radius: input.tokens.radius,
        fontFamily: input.tokens.fontFamily,
      }),
    );
  } catch (err) {
    return {
      ok: false,
      code: "FOUNDATION_WRITE",
      message: `tailwind.config.cjs 쓰기 실패: ${(err as Error).message}`,
    };
  }

  // ─── Pass 2: per-flow pages 병렬 ───
  const contracts = pickFoundationContracts(
    foundation.files,
    STACK_LAYOUT[input.stack].contractFiles,
  );
  const typesKey = STACK_LAYOUT[input.stack].contractFiles[0];
  if (!contracts[typesKey]) {
    console.warn(
      `[generate-app] foundation 에 ${typesKey} 가 없음 — page 간 타입 불일치 위험`,
    );
  }
  const pageResults = await Promise.allSettled(
    flows.map((f) => runPagePass(input, f, contracts)),
  );
  const pageOks: PagePassResult[] = [];
  const pageUsages: PassUsage[] = [];
  for (const r of pageResults) {
    if (r.status === "fulfilled") {
      pageOks.push(r.value);
      pageUsages.push(r.value.usage);
    } else {
      const reason = r.reason as unknown;
      if (isGenAppFail(reason)) return reason;
      return {
        ok: false,
        code: "PAGE_EMPTY",
        message: `Pass 2 예외: ${(reason as Error)?.message ?? String(reason)}`,
      };
    }
  }

  // page 파일 덮어쓰기 (foundation 의 placeholder 위에)
  for (const p of pageOks) {
    try {
      await writeWorkspaceFile(input.workspace, p.file.path, p.file.content);
    } catch (err) {
      return {
        ok: false,
        code: "PAGE_WRITE",
        message: `${p.file.path} 쓰기 실패: ${(err as Error).message}`,
      };
    }
  }

  // 최종 written 목록 — foundation 파일 (page placeholder 는 page 결과로 대체,
  // tailwind.config.cjs 는 결정론적 모듈 결과로 대체) + page 파일.
  const pagePaths = new Set(pageOks.map((p) => p.file.path));
  const tailwindContent = tokensToTailwindConfig({
    primary: input.tokens.primary,
    secondary: input.tokens.secondary,
    surface: input.tokens.surface,
    text: input.tokens.text,
    radius: input.tokens.radius,
    fontFamily: input.tokens.fontFamily,
  });
  const finalFiles: GeneratedFile[] = [
    ...foundation.files.filter(
      (f) => !pagePaths.has(f.path) && f.path !== "tailwind.config.cjs",
    ),
    { path: "tailwind.config.cjs", content: tailwindContent },
    ...pageOks.map((p) => p.file),
  ];

  return {
    ok: true,
    written: finalFiles,
    passes: { foundation: foundation.usage, pages: pageUsages },
    total_duration_ms: Date.now() - t0,
  };
}
