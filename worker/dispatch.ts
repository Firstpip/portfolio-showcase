// 상태 → 핸들러 디스패처 + 폴링 폴백 (T8.8a).
//
// 배경:
//   워커는 원래 Supabase Realtime 구독 하나에만 의존해 demo_status 전이를
//   받았다. 2026-09-08 실측에서 Realtime 웹소켓이 엣지에서 500
//   (`error code: 1101`, Cloudflare Worker 예외) 을 뱉어 구독이 SUBSCRIBED 에
//   도달하지 못했고 — publication·키·클라이언트는 전부 정상이었다 — 그 결과
//   대시보드가 autorun_queued 를 써도 픽업하는 주체가 없어 1-click 이 통째로
//   멈췄다. 맥북에서 도는 1인 워커라 웹소켓 단절은 상시 위험이기도 하다.
//
// 그래서 두 경로를 둔다:
//   - Realtime: 정상일 때 지연 ~0. 이벤트가 오면 즉시 디스패치.
//   - 폴링: N초마다 처리 대상 상태를 SELECT 해 디스패치. Realtime 이 죽어도
//     최대 N초 지연으로 진행된다.
//
// 중복 실행 안전성 2중:
//   1) 각 핸들러가 `UPDATE ... WHERE demo_status = '<이전 상태>'` 로 atomic
//      claim 한다. 두 경로가 동시에 같은 행을 집어도 한쪽만 선점하고 다른
//      쪽은 no-claim 으로 즉시 빠진다.
//   2) claim UPDATE 가 왕복하는 짧은 창을 위해 프로세스 내 in-flight Set 을
//      둬 같은 id 를 동시에 두 번 태우지 않는다.
//   작업 중인 행은 진행 상태(fetching/extracting/generating/building)로 바뀌어
//   폴링 쿼리에 애초에 안 걸린다.

import type { SupabaseClient } from "@supabase/supabase-js";

import { handleAutorunQueued } from "./fetch-spec.ts";
import { handleExtractQueued } from "./extract-spec.ts";
import { handleGenQueued } from "./generate-demo/orchestrator.ts";

/** 워커가 픽업해야 하는 대기 상태. 진행 중 상태는 포함하지 않는다. */
export const ACTIONABLE_STATUSES = [
  "autorun_queued",
  "extract_queued",
  "gen_queued",
] as const;

export type ActionableStatus = (typeof ACTIONABLE_STATUSES)[number];

export type Handler = (
  supabase: SupabaseClient,
  projectId: string,
) => Promise<unknown>;

export const HANDLERS: Record<ActionableStatus, Handler> = {
  autorun_queued: handleAutorunQueued,
  extract_queued: handleExtractQueued,
  gen_queued: handleGenQueued,
};

export function isActionable(status: unknown): status is ActionableStatus {
  return (
    typeof status === "string" &&
    (ACTIONABLE_STATUSES as readonly string[]).includes(status)
  );
}

/**
 * 프로세스 내 중복 실행 가드. 핸들러가 끝나면 자동으로 풀린다.
 *
 * 주의: 프로세스 간 보호가 아니다 (그건 핸들러의 atomic claim 담당).
 */
export class InFlight {
  private readonly ids = new Set<string>();

  get size(): number {
    return this.ids.size;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** 이미 처리 중이면 false. 아니면 등록하고 true. */
  claim(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    return true;
  }

  release(id: string): void {
    this.ids.delete(id);
  }
}

/**
 * 한 행을 상태에 맞는 핸들러로 넘긴다.
 *
 * 핸들러 예외는 여기서 삼킨다 — 한 프로젝트의 실패가 워커를 죽이면 안 된다
 * (핸들러 자체도 실패를 DB 상태로 기록한다).
 */
export function dispatch(
  supabase: SupabaseClient,
  row: { id: string; slug?: string | null; demo_status?: unknown },
  inflight: InFlight,
  source: "realtime" | "poll",
  handlers: Record<ActionableStatus, Handler> = HANDLERS,
): boolean {
  if (!row.id || !isActionable(row.demo_status)) return false;
  if (!inflight.claim(row.id)) return false;

  const label = row.slug ?? row.id;
  console.log(`[worker:${source}] 픽업 ${label} (${row.demo_status})`);

  void Promise.resolve()
    .then(() => handlers[row.demo_status as ActionableStatus](supabase, row.id))
    .catch((err) => {
      console.error(
        `[worker:${source}] ${label} 핸들러 예외:`,
        err instanceof Error ? err.message : err,
      );
    })
    .finally(() => inflight.release(row.id));

  return true;
}

/**
 * 대기 상태 행을 한 번 훑어 디스패치. 디스패치한 건수를 돌려준다.
 *
 * Realtime 이 살아있으면 대부분 0건이다 (이미 진행 상태로 넘어갔으므로).
 */
export async function pollOnce(
  supabase: SupabaseClient,
  inflight: InFlight,
  handlers: Record<ActionableStatus, Handler> = HANDLERS,
): Promise<number> {
  const { data, error } = await supabase
    .from("wishket_projects")
    .select("id, slug, demo_status")
    .in("demo_status", ACTIONABLE_STATUSES as unknown as string[])
    .order("updated_at", { ascending: true })
    .limit(20);

  if (error) {
    console.error("[worker:poll] 조회 실패:", error.message);
    return 0;
  }

  let n = 0;
  for (const row of (data ?? []) as Array<{
    id: string;
    slug: string | null;
    demo_status: string;
  }>) {
    if (dispatch(supabase, row, inflight, "poll", handlers)) n++;
  }
  return n;
}

export const DEFAULT_POLL_MS = 10_000;

/**
 * 폴링 루프 시작. 반환값을 호출하면 멈춘다.
 *
 * setTimeout 재귀로 돌려 한 사이클이 길어져도 겹치지 않게 한다
 * (setInterval 은 이전 사이클이 안 끝나도 다음 틱을 쏜다).
 */
export function startPolling(
  supabase: SupabaseClient,
  inflight: InFlight,
  intervalMs: number = Number(process.env.WORKER_POLL_MS) || DEFAULT_POLL_MS,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await pollOnce(supabase, inflight);
    } catch (err) {
      console.error(
        "[worker:poll] 예외:",
        err instanceof Error ? err.message : err,
      );
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
