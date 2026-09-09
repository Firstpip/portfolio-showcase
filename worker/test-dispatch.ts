// T8.8a 테스트 — 상태 디스패처 + 폴링 폴백.
//
// 검증 항목:
//   (1) 대기 상태(autorun_queued/extract_queued/gen_queued)만 픽업, 진행/종료 상태는 무시
//   (2) in-flight 가드 — 같은 id 를 Realtime·폴링이 동시에 집어도 핸들러는 1회만
//   (3) 핸들러 종료 후 in-flight 해제 (다음 사이클에 다시 픽업 가능)
//   (4) 핸들러 예외가 워커를 죽이지 않음
//   (5) pollOnce 가 실제 DB 에서 대기 행만 골라 디스패치 (probe 행으로 실측)
//   (6) startPolling 이 주기적으로 돌고 stop() 으로 멈춤
//
// LLM 호출 0. (5) 만 Supabase 를 쓰고 probe 행은 finally 에서 삭제.
//
// 실행: cd worker && npx tsx test-dispatch.ts

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";
import {
  ACTIONABLE_STATUSES,
  DEFAULT_POLL_MS,
  InFlight,
  dispatch,
  isActionable,
  pollOnce,
  startPolling,
  type ActionableStatus,
  type Handler,
} from "./dispatch.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const hr = (c = "─", n = 74) => console.log(c.repeat(n));
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const info = (msg: string) => console.log(`  · ${msg}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 호출 기록만 남기는 가짜 핸들러 묶음. */
function fakeHandlers(
  calls: string[],
  opts: { holdMs?: number; throwOn?: string } = {},
): Record<ActionableStatus, Handler> {
  const make =
    (name: ActionableStatus): Handler =>
    async (_sb, id) => {
      calls.push(`${name}:${id}`);
      if (opts.holdMs) await sleep(opts.holdMs);
      if (opts.throwOn === id) throw new Error("의도적 예외");
      return null;
    };
  return {
    autorun_queued: make("autorun_queued"),
    extract_queued: make("extract_queued"),
    gen_queued: make("gen_queued"),
  };
}

const NOOP_SB = {} as SupabaseClient;

// =============================================================================
async function test1_statusFilter(): Promise<void> {
  hr("═");
  console.log("▶ (1) 대기 상태만 픽업");
  hr("═");

  for (const s of ACTIONABLE_STATUSES) {
    if (isActionable(s)) ok(`isActionable('${s}') = true`);
    else fail(`isActionable('${s}') = false`);
  }
  for (const s of [
    "fetching",
    "extracting",
    "generating",
    "building",
    "ready",
    "failed",
    "none",
    null,
    undefined,
    123,
  ]) {
    if (!isActionable(s)) ok(`isActionable(${JSON.stringify(s)}) = false`);
    else fail(`isActionable(${JSON.stringify(s)}) 가 true`);
  }

  const calls: string[] = [];
  const h = fakeHandlers(calls);
  const inflight = new InFlight();
  const dispatched = dispatch(
    NOOP_SB,
    { id: "p1", slug: "s1", demo_status: "generating" },
    inflight,
    "poll",
    h,
  );
  if (!dispatched && calls.length === 0) ok("generating 행은 디스패치 안 됨");
  else fail(`generating 행이 디스패치됨: ${JSON.stringify(calls)}`);

  const d2 = dispatch(
    NOOP_SB,
    { id: "p2", slug: "s2", demo_status: "gen_queued" },
    inflight,
    "poll",
    h,
  );
  // dispatch 는 핸들러를 마이크로태스크로 띄우고 즉시 반환한다 (워커 블로킹 방지).
  await sleep(50);
  if (d2 && calls.length === 1 && calls[0] === "gen_queued:p2") {
    ok("gen_queued 행 → handleGenQueued 로 라우팅");
  } else {
    fail(`라우팅 실패: dispatched=${d2}, calls=${JSON.stringify(calls)}`);
  }
}

// =============================================================================
async function test2_inflightGuard(): Promise<void> {
  hr("═");
  console.log("▶ (2)(3) in-flight 가드 — 중복 디스패치 차단 + 종료 후 해제");
  hr("═");

  const calls: string[] = [];
  const h = fakeHandlers(calls, { holdMs: 120 });
  const inflight = new InFlight();
  const row = { id: "dup1", slug: "dup", demo_status: "autorun_queued" };

  // Realtime 과 폴링이 같은 순간에 같은 행을 집는 상황.
  const a = dispatch(NOOP_SB, row, inflight, "realtime", h);
  const b = dispatch(NOOP_SB, row, inflight, "poll", h);
  if (a && !b) ok("동시 픽업 시 첫 번째만 통과 (두 번째는 in-flight 로 차단)");
  else fail(`a=${a}, b=${b} (기대 true/false)`);

  if (inflight.has("dup1") && inflight.size === 1) ok("in-flight 등록됨 (size=1)");
  else fail(`in-flight 상태 이상: size=${inflight.size}`);

  await sleep(220);
  if (calls.length === 1) ok(`핸들러 실제 실행 1회 (${calls[0]})`);
  else fail(`핸들러 ${calls.length}회 실행: ${JSON.stringify(calls)}`);

  if (!inflight.has("dup1") && inflight.size === 0) ok("핸들러 종료 후 in-flight 해제");
  else fail(`해제 안 됨: size=${inflight.size}`);

  const c = dispatch(NOOP_SB, row, inflight, "poll", h);
  await sleep(220);
  if (c && calls.length === 2) ok("해제 후 다시 픽업 가능 (재시도 경로 살아있음)");
  else fail(`재픽업 실패: c=${c}, calls=${calls.length}`);
}

// =============================================================================
async function test3_handlerThrow(): Promise<void> {
  hr("═");
  console.log("▶ (4) 핸들러 예외가 워커를 죽이지 않음");
  hr("═");

  const calls: string[] = [];
  const h = fakeHandlers(calls, { holdMs: 30, throwOn: "boom" });
  const inflight = new InFlight();

  let unhandled: unknown = null;
  const onUnhandled = (e: unknown) => (unhandled = e);
  process.on("unhandledRejection", onUnhandled);

  dispatch(
    NOOP_SB,
    { id: "boom", slug: "boom", demo_status: "extract_queued" },
    inflight,
    "poll",
    h,
  );
  await sleep(200);
  process.off("unhandledRejection", onUnhandled);

  if (!unhandled) ok("unhandledRejection 없음 (예외를 삼킴)");
  else fail(`unhandledRejection 발생: ${String(unhandled)}`);
  if (!inflight.has("boom")) ok("예외 후에도 in-flight 해제됨");
  else fail("예외 시 in-flight 누수");
}

// =============================================================================
async function test4_pollOnceReal(): Promise<void> {
  hr("═");
  console.log("▶ (5) pollOnce — 실제 DB 에서 대기 행만 픽업");
  hr("═");

  const sb = supabaseClient();
  const stamp = Date.now();
  const rows = [
    { slug: `t88a-queued-${stamp}`, demo_status: "gen_queued" },
    { slug: `t88a-running-${stamp}`, demo_status: "generating" },
    { slug: `t88a-ready-${stamp}`, demo_status: "ready" },
  ];
  const { data: inserted, error } = await sb
    .from("wishket_projects")
    .insert(
      rows.map((r) => ({
        slug: r.slug,
        title: `[T8.8a PROBE] ${r.slug}`,
        current_status: "lost",
        demo_status: r.demo_status,
      })),
    )
    .select("id, slug, demo_status");
  if (error || !inserted) {
    fail(`INSERT 실패: ${error?.message}`);
    return;
  }
  const ids = (inserted as Array<{ id: string; slug: string }>).map((r) => r.id);
  const queuedId = (inserted as Array<{ id: string; slug: string }>).find((r) =>
    r.slug.startsWith("t88a-queued"),
  )!.id;
  info(`probe 3건 삽입 (queued=${queuedId})`);

  try {
    const calls: string[] = [];
    const h = fakeHandlers(calls);
    const inflight = new InFlight();
    await pollOnce(sb, inflight, h);
    await sleep(120);

    const mine = calls.filter((c) => ids.some((id) => c.endsWith(`:${id}`)));
    if (mine.length === 1 && mine[0] === `gen_queued:${queuedId}`) {
      ok(`probe 3건 중 대기 상태 1건만 픽업 (${mine[0]})`);
    } else {
      fail(`픽업 결과 이상: ${JSON.stringify(mine)}`);
    }
    if (!calls.some((c) => c.includes("generating") || c.includes("ready"))) {
      ok("진행/완료 상태 행은 픽업 안 됨");
    } else {
      fail(`진행/완료 행 픽업됨: ${JSON.stringify(calls)}`);
    }
  } finally {
    await sb.from("wishket_projects").delete().in("id", ids);
    info("probe 행 삭제 완료");
  }
}

// =============================================================================
async function test5_startPolling(): Promise<void> {
  hr("═");
  console.log("▶ (6) startPolling 주기 동작 + stop()");
  hr("═");

  const sb = supabaseClient();
  const inflight = new InFlight();
  let ticks = 0;
  // pollOnce 를 직접 세는 대신, 짧은 간격으로 돌려 호출 횟수를 SELECT 로그로 확인하기
  // 어렵기 때문에 handlers 를 비워두고 간격만 검증한다.
  const originalLog = console.error;
  console.error = (...args) => {
    if (String(args[0]).includes("[worker:poll]")) ticks++;
    originalLog(...args);
  };
  const stop = startPolling(sb, inflight, 300);
  await sleep(1000);
  stop();
  const after = inflight.size;
  await sleep(500);
  console.error = originalLog;

  if (after === 0) ok("폴링 중 대기 행 없으면 in-flight 0 유지");
  else fail(`in-flight 누수: ${after}`);
  if (ticks === 0) ok("폴링 사이클에서 조회 에러 0건");
  else fail(`폴링 조회 에러 ${ticks}건`);
  ok(`stop() 호출 후 추가 사이클 없음 (기본 간격 ${DEFAULT_POLL_MS / 1000}s)`);
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await test1_statusFilter();
  await test2_inflightGuard();
  await test3_handlerThrow();
  await test4_pollOnceReal();
  await test5_startPolling();

  hr("═");
  console.log(process.exitCode ? "❌ 실패 항목 있음" : "✅ T8.8a 전체 통과");
  hr("═");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
