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
import type { Workspace } from "./build-runtime.ts";

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

let cachedFoundationPrompt: string | null = null;
let cachedPagePrompt: string | null = null;

function repoPromptPath(name: string): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), "..", "prompts", name);
}

function loadFoundationPrompt(): string {
  if (cachedFoundationPrompt !== null) return cachedFoundationPrompt;
  cachedFoundationPrompt = readFileSync(repoPromptPath("generate-app-foundation.md"), "utf8");
  return cachedFoundationPrompt;
}
function loadPagePrompt(): string {
  if (cachedPagePrompt !== null) return cachedPagePrompt;
  cachedPagePrompt = readFileSync(repoPromptPath("generate-app-page.md"), "utf8");
  return cachedPagePrompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// 안전 헬퍼

function stripJsonOuter(raw: string): string {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last < 0 || last < first) return raw.trim();
  return raw.slice(first, last + 1);
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
    systemPrompt: loadFoundationPrompt(),
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
    parsed = JSON.parse(stripJsonOuter(raw));
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
): Promise<PagePassResult> {
  const pagePath = `src/pages/${pascalCase(flow.id)}.tsx`;
  const userPayload = {
    spec: input.spec,
    tokens: input.tokens,
    flow_id: flow.id,
    page_path: pagePath,
    tier: flow.tier,
  };
  const userMessage =
    JSON.stringify(userPayload) +
    `\n\n위 flow ${flow.id} (tier ${flow.tier}) page 를 단일 JSON {"path": "${pagePath}", "content": "..."} 으로 즉시 출력하라. 분석 멘트·인트로 일체 금지. 첫 바이트 \`{\` 마지막 \`}\`.`;
  const runResult = await runClaude(userMessage, {
    model: OPUS,
    systemPrompt: loadPagePrompt(),
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
    parsed = JSON.parse(stripJsonOuter(raw));
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

  // foundation 파일 작성
  for (const f of foundation.files) {
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

  // ─── Pass 2: per-flow pages 병렬 ───
  const pageResults = await Promise.allSettled(flows.map((f) => runPagePass(input, f)));
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

  // 최종 written 목록 — foundation 파일 (단, page placeholder 는 page 결과로 대체) + page 파일
  const pagePaths = new Set(pageOks.map((p) => p.file.path));
  const finalFiles: GeneratedFile[] = [
    ...foundation.files.filter((f) => !pagePaths.has(f.path)),
    ...pageOks.map((p) => p.file),
  ];

  return {
    ok: true,
    written: finalFiles,
    passes: { foundation: foundation.usage, pages: pageUsages },
    total_duration_ms: Date.now() - t0,
  };
}
