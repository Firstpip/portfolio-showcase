// 워커 생존 신호 (T8.12).
//
// 배경:
//   데모 생성은 맥북에서 도는 로컬 워커가 처리한다. 워커가 꺼져 있거나 맥북이
//   잠들면 대시보드에서 버튼을 눌러도 행이 autorun_queued 에 영원히 멈추고,
//   사용자는 이유를 알 방법이 없다. 워커가 주기적으로 신호를 남기고 대시보드가
//   그 신선도를 보고 판단하게 한다.
//
// 판정 기준은 status 문자열이 아니라 **last_seen_at 의 신선도**다. 프로세스가
// SIGKILL 로 죽으면 'stopping' 을 남길 기회조차 없기 때문이다.

import { hostname } from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";

export const HEARTBEAT_ID = "demo-worker";

/** 이 간격보다 오래 신호가 없으면 죽은 것으로 본다. 갱신 주기의 3배 여유. */
export const STALE_AFTER_MS = 90_000;

/** 갱신 주기. 폴링(기본 10s)과 무관하게 독립적으로 돈다. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

export type WorkerStatus = "starting" | "idle" | "working" | "stopping";

export type HeartbeatRow = {
  last_seen_at: string;
  hostname: string | null;
  pid: number | null;
  status: string | null;
  in_flight: number;
};

/**
 * 신호 1회 기록. 실패해도 throw 하지 않는다 — heartbeat 때문에 워커가 죽으면
 * 본말전도다. 실패는 로그로만 남기고 다음 주기에 다시 시도된다.
 */
export async function writeHeartbeat(
  supabase: SupabaseClient,
  status: WorkerStatus,
  inFlight = 0,
): Promise<boolean> {
  const { error } = await supabase.from("demo_worker_heartbeat").upsert(
    {
      id: HEARTBEAT_ID,
      last_seen_at: new Date().toISOString(),
      hostname: hostname(),
      pid: process.pid,
      status,
      in_flight: inFlight,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    console.warn(`[worker:heartbeat] 기록 실패(무시): ${error.message}`);
    return false;
  }
  return true;
}

/**
 * 마지막 신호가 임계 안쪽인지 판정. 대시보드와 같은 규칙을 워커·테스트에서도 쓰기 위해 공유.
 *
 * @param now 판정 기준 시각 (테스트에서 주입)
 */
export function isAlive(
  lastSeenAt: string | null | undefined,
  now: number = Date.now(),
  staleAfterMs: number = STALE_AFTER_MS,
): boolean {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  if (Number.isNaN(t)) return false;
  return now - t <= staleAfterMs;
}

export async function readHeartbeat(
  supabase: SupabaseClient,
): Promise<HeartbeatRow | null> {
  const { data, error } = await supabase
    .from("demo_worker_heartbeat")
    .select("last_seen_at, hostname, pid, status, in_flight")
    .eq("id", HEARTBEAT_ID)
    .maybeSingle();
  if (error || !data) return null;
  return data as HeartbeatRow;
}

/**
 * 주기적 갱신 시작. 반환 함수를 호출하면 멈춘다.
 *
 * `getState` 로 현재 상태를 매 주기 물어본다 — in-flight 건수를 함께 실어야
 * 대시보드가 "살아있지만 다른 작업 중" 을 구분할 수 있다.
 */
export function startHeartbeat(
  supabase: SupabaseClient,
  getState: () => { status: WorkerStatus; inFlight: number },
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const { status, inFlight } = getState();
    await writeHeartbeat(supabase, status, inFlight);
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };
  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
