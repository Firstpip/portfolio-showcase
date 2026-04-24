// extract-spec 워커 모듈.
//
// 역할:
//   1) Realtime 라우터(worker/index.ts)가 demo_status='extract_queued' 전이를 감지하면
//      handleExtractQueued(projectId)를 호출.
//   2) 이 핸들러는 atomic 전이로 'extracting'을 선점(중복 처리 방지) → spec_raw 조회
//      → Claude Sonnet 4.6 호출 → JSON 파싱 + 스키마 검증 → spec_structured JSONB 저장
//      → 'extract_ready'.
//   3) 어떤 단계든 실패하면 'extract_failed'로 전이하고 demo_generation_log에 사유 기록.
//      예외는 호출자로 전파하지 않음 (Realtime 핸들러가 죽지 않도록).
//
// 프롬프트: worker/prompts/extract-spec.md (system prompt로 로드).
// 스키마 검증: worker/shared/validate-spec.ts.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runClaude, SONNET } from "./shared/claude.ts";
import { validateSpecStructured } from "./shared/validate-spec.ts";

type ExtractOutcome =
  | { ok: true; status: "extract_ready"; reqId: string; duration_ms: number }
  | { ok: false; status: "extract_failed"; reason: string; reqId?: string };

const __dirname = dirname(fileURLToPath(import.meta.url));
// 프롬프트는 워커 프로세스 수명 동안 1회만 읽어 캐시. Agent SDK의 system prompt 자동 캐싱과 결합.
const EXTRACT_SYSTEM_PROMPT = readFileSync(
  join(__dirname, "prompts", "extract-spec.md"),
  "utf-8",
);

/**
 * extract_queued 전이를 처리한다.
 *
 * 단계:
 *   1) UPDATE wishket_projects SET demo_status='extracting'
 *      WHERE id=$1 AND demo_status='extract_queued'
 *      → 영향받은 행이 0이면 다른 워커가 선점한 것 (또는 상태가 바뀜). 조용히 종료.
 *   2) spec_raw 조회. NULL/빈 문자열이면 extract_failed.
 *   3) Sonnet 호출 → JSON.parse → spec_structured 저장 + extract_ready.
 *   4) 어떤 단계 실패라도 extract_failed로 마무리, demo_generation_log에 기록.
 *
 * 호출자(Realtime 핸들러)가 죽지 않도록 throw 하지 않는다.
 */
export async function handleExtractQueued(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ExtractOutcome> {
  // 1) atomic 선점 — extract_queued인 동안만 extracting으로 전환.
  const { data: claimed, error: claimErr } = await supabase
    .from("wishket_projects")
    .update({ demo_status: "extracting" })
    .eq("id", projectId)
    .eq("demo_status", "extract_queued")
    .select("id, slug, spec_raw");

  if (claimErr) {
    return { ok: false, status: "extract_failed", reason: `claim 실패: ${claimErr.message}` };
  }
  if (!claimed || claimed.length === 0) {
    // 다른 워커가 가져갔거나, 이미 다른 상태로 전이됨. 정상.
    console.log(`[extract:${projectId}] 선점 실패(이미 다른 상태) — skip`);
    return { ok: false, status: "extract_failed", reason: "no-claim (이미 처리 중이거나 상태 변경됨)" };
  }
  const row = claimed[0] as { id: string; slug: string | null; spec_raw: string | null };
  console.log(`[extract:${projectId}] 선점 OK (slug=${row.slug ?? "?"})`);

  // 2) spec_raw 검증.
  if (!row.spec_raw || row.spec_raw.trim().length === 0) {
    return await markFailed(supabase, projectId, "spec_raw가 비어있음");
  }

  // 3) Claude 호출.
  let claudeResult;
  try {
    claudeResult = await runClaude(row.spec_raw, {
      model: SONNET,
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return await markFailed(supabase, projectId, `Claude 호출 실패: ${msg}`);
  }

  // 4) JSON 파싱.
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(claudeResult.text));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return await markFailed(
      supabase,
      projectId,
      `JSON 파싱 실패: ${msg}. 응답 앞부분: ${claudeResult.text.slice(0, 200)}`,
      claudeResult.reqId,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return await markFailed(
      supabase,
      projectId,
      "응답이 JSON 객체가 아님",
      claudeResult.reqId,
    );
  }

  // 4.5) 스키마 검증. 실패 시 extract_failed (재시도는 사용자 판단).
  const validation = validateSpecStructured(parsed);
  if (!validation.ok) {
    const summary = validation.errors.slice(0, 8).join("; ");
    return await markFailed(
      supabase,
      projectId,
      `스키마 검증 실패 (${validation.errors.length}건): ${summary}`,
      claudeResult.reqId,
    );
  }

  // 4.6) reference_portfolio_path는 워커가 slug 기반으로 채움(프롬프트는 빈 문자열 반환).
  if (row.slug) {
    const specObj = parsed as Record<string, unknown>;
    const brief = specObj["design_brief"];
    if (brief && typeof brief === "object" && !Array.isArray(brief)) {
      (brief as Record<string, unknown>)["reference_portfolio_path"] =
        `${row.slug}/portfolio-1/index.html`;
    }
  }

  // 5) 저장 + 상태 전이. demo_generation_log에 이번 호출 사용량 append.
  const logEntry = {
    stage: "extract",
    ts: new Date().toISOString(),
    req_id: claudeResult.reqId,
    model: claudeResult.model,
    duration_ms: claudeResult.duration_ms,
    input_tokens: claudeResult.input_tokens,
    output_tokens: claudeResult.output_tokens,
    cache_read_input_tokens: claudeResult.cache_read_input_tokens,
  };
  const newLog = await appendLog(supabase, projectId, logEntry);
  const { error: saveErr } = await supabase
    .from("wishket_projects")
    .update({
      spec_structured: parsed,
      demo_status: "extract_ready",
      demo_generation_log: newLog,
    })
    .eq("id", projectId);
  if (saveErr) {
    return await markFailed(
      supabase,
      projectId,
      `spec_structured 저장 실패: ${saveErr.message}`,
      claudeResult.reqId,
    );
  }

  console.log(
    `[extract:${projectId}] DONE (${claudeResult.duration_ms}ms, ` +
      `out=${claudeResult.output_tokens} tokens)`,
  );
  return {
    ok: true,
    status: "extract_ready",
    reqId: claudeResult.reqId,
    duration_ms: claudeResult.duration_ms,
  };
}

async function markFailed(
  supabase: SupabaseClient,
  projectId: string,
  reason: string,
  reqId?: string,
): Promise<ExtractOutcome> {
  console.error(`[extract:${projectId}] FAILED: ${reason}`);
  const logEntry = {
    stage: "extract",
    ts: new Date().toISOString(),
    error: reason,
    ...(reqId ? { req_id: reqId } : {}),
  };
  const newLog = await appendLog(supabase, projectId, logEntry);
  const { error } = await supabase
    .from("wishket_projects")
    .update({
      demo_status: "extract_failed",
      demo_generation_log: newLog,
    })
    .eq("id", projectId);
  if (error) {
    // 상태 갱신마저 실패한 경우 — 로그만 남기고 결과는 그대로 반환.
    console.error(`[extract:${projectId}] 상태 갱신 실패: ${error.message}`);
  }
  return { ok: false, status: "extract_failed", reason, ...(reqId ? { reqId } : {}) };
}

/**
 * demo_generation_log는 JSONB. 기존 값에 새 entry를 append한 배열로 만든다.
 * 기존 값이 NULL이면 새 배열로 시작. 객체였으면 해당 객체를 한 항목으로 감싼다.
 */
async function appendLog(
  supabase: SupabaseClient,
  projectId: string,
  entry: Record<string, unknown>,
): Promise<unknown[]> {
  const { data, error } = await supabase
    .from("wishket_projects")
    .select("demo_generation_log")
    .eq("id", projectId)
    .single();
  if (error || !data) return [entry];
  const existing = data.demo_generation_log;
  if (Array.isArray(existing)) return [...existing, entry];
  if (existing && typeof existing === "object") return [existing, entry];
  return [entry];
}

/**
 * 모델이 ```json ... ``` 펜스로 감싸 응답하는 경우 대비.
 * 양쪽을 독립적으로 벗긴다 — 한쪽만 있는 불완전한 경우도 복구.
 * 그래도 실패하면 첫 `{`부터 마지막 `}`까지 slice해 최후 구제.
 */
function stripJsonFence(text: string): string {
  let t = text.trim();
  // 시작 펜스 제거 (언어 태그 선택적).
  t = t.replace(/^```(?:json|JSON)?\s*\n?/, "");
  // 끝 펜스 제거.
  t = t.replace(/\n?\s*```\s*$/, "");
  t = t.trim();
  // `{`로 시작하지 않으면 "JSON 객체 구간"만 잘라낸다.
  if (!t.startsWith("{")) {
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first !== -1 && last > first) {
      t = t.slice(first, last + 1);
    }
  }
  return t;
}
