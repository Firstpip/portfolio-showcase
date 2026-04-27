// fetch-spec 워커 모듈 (T7.1).
//
// 역할:
//   1) Realtime 라우터(worker/index.ts)가 demo_status='autorun_queued' 전이를 감지하면
//      handleAutorunQueued(projectId)를 호출.
//   2) atomic 전이로 'fetching'을 선점 → wishket_url 조회 → wishket-fetch 호출
//      → spec_raw 저장 → demo_status='extract_queued' 자동 전이 (extract 단계로 chain).
//   3) 어떤 단계든 실패하면 'fetch_failed'로 전이하고 demo_generation_log에 사유 기록.
//      예외는 호출자로 전파하지 않음 (Realtime 핸들러가 죽지 않도록).
//
// 자동 chain: 이 단계가 'extract_queued'를 세팅하면 Realtime 핸들러가 다시 깨어
// handleExtractQueued 를 호출. 그 단계 끝나면 'gen_queued' 자동 전이 (extract-spec.ts 참조).

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWishketContent, WishketFetchError } from "./shared/wishket-fetch.ts";

type FetchOutcome =
  | { ok: true; status: "extract_queued"; content_length: number; duration_ms: number }
  | { ok: false; status: "fetch_failed"; reason: string; code?: string };

export async function handleAutorunQueued(
  supabase: SupabaseClient,
  projectId: string,
): Promise<FetchOutcome> {
  const started = Date.now();

  // 1) atomic 선점 — autorun_queued 인 동안만 fetching 으로 전환.
  const { data: claimed, error: claimErr } = await supabase
    .from("wishket_projects")
    .update({ demo_status: "fetching" })
    .eq("id", projectId)
    .eq("demo_status", "autorun_queued")
    .select("id, slug, wishket_url");

  if (claimErr) {
    return { ok: false, status: "fetch_failed", reason: `claim 실패: ${claimErr.message}` };
  }
  if (!claimed || claimed.length === 0) {
    console.log(`[fetch:${projectId}] 선점 실패(이미 다른 상태) — skip`);
    return {
      ok: false,
      status: "fetch_failed",
      reason: "no-claim (이미 처리 중이거나 상태 변경됨)",
    };
  }
  const row = claimed[0] as { id: string; slug: string | null; wishket_url: string | null };
  console.log(`[fetch:${projectId}] 선점 OK (slug=${row.slug ?? "?"})`);

  // 2) wishket_url 검증.
  if (!row.wishket_url || row.wishket_url.trim().length === 0) {
    return await markFetchFailed(supabase, projectId, "wishket_url 이 비어있음", "URL_MISSING");
  }

  // 3) child process 로 fetch 호출.
  let content: { title: string; content: string };
  try {
    const result = await fetchWishketContent(row.wishket_url);
    content = { title: result.title, content: result.content };
  } catch (err) {
    if (err instanceof WishketFetchError) {
      return await markFetchFailed(
        supabase,
        projectId,
        `wishket fetch 실패 [${err.code}]: ${err.message}`,
        err.code,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return await markFetchFailed(supabase, projectId, `예외: ${msg}`, "EXCEPTION");
  }

  // 4) spec_raw 저장 + extract_queued 자동 전이 (auto chain).
  const duration_ms = Date.now() - started;
  const logEntry = {
    stage: "fetch",
    ts: new Date().toISOString(),
    duration_ms,
    content_length: content.content.length,
    title: content.title,
  };
  const newLog = await appendLog(supabase, projectId, logEntry);
  const { error: saveErr } = await supabase
    .from("wishket_projects")
    .update({
      spec_raw: content.content,
      demo_status: "extract_queued",
      demo_generation_log: newLog,
    })
    .eq("id", projectId);

  if (saveErr) {
    return await markFetchFailed(supabase, projectId, `spec_raw 저장 실패: ${saveErr.message}`);
  }

  console.log(
    `[fetch:${projectId}] DONE (${duration_ms}ms, ${content.content.length}자) → extract_queued`,
  );
  return {
    ok: true,
    status: "extract_queued",
    content_length: content.content.length,
    duration_ms,
  };
}

async function markFetchFailed(
  supabase: SupabaseClient,
  projectId: string,
  reason: string,
  code?: string,
): Promise<FetchOutcome> {
  console.error(`[fetch:${projectId}] FAILED: ${reason}`);
  const logEntry = {
    stage: "fetch",
    ts: new Date().toISOString(),
    error: reason,
    ...(code ? { code } : {}),
  };
  const newLog = await appendLog(supabase, projectId, logEntry);
  const { error } = await supabase
    .from("wishket_projects")
    .update({
      demo_status: "fetch_failed",
      demo_generation_log: newLog,
    })
    .eq("id", projectId);
  if (error) {
    console.error(`[fetch:${projectId}] 상태 갱신 실패: ${error.message}`);
  }
  return { ok: false, status: "fetch_failed", reason, ...(code ? { code } : {}) };
}

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
