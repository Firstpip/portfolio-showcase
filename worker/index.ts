// 로컬 워커 엔트리포인트.
//
// 역할: `wishket_projects.demo_status` 변경을 감지해 상태에 따라
// fetch / extract / generate+build+deploy 핸들러를 분기 호출한다.
//
// 생존 신호(T8.12): 30초마다 demo_worker_heartbeat 를 갱신한다. 대시보드는 그
// 신선도를 보고 워커가 죽어 있으면 데모 생성 버튼을 막는다 — 맥북이 잠들면
// 큐에 넣어봐야 아무도 처리하지 않기 때문이다.
//
// 감지 경로 2개 (T8.8a):
//   - Realtime 구독: 정상일 때 지연 ~0
//   - 폴링 루프: WORKER_POLL_MS(기본 10s) 마다 대기 상태를 SELECT
// Realtime 이 죽어도 폴링이 받아내므로 1-click 체인이 멈추지 않는다.
// 중복 실행은 핸들러의 atomic claim + 프로세스 내 in-flight Set 으로 막는다
// (자세한 내용은 dispatch.ts 헤더).
//
// 실행 전제:
//   1) Claude Code CLI 설치 + `claude login` (Max 구독)
//   2) worker/.env.local에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / GITHUB_TOKEN 정의
//
// 실행: cd worker && npm install && npm start
// 개발: npm run dev  (tsx watch 자동 재시작)

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";
import { verifyAuth } from "./shared/claude.ts";
import {
  DEFAULT_POLL_MS,
  InFlight,
  dispatch,
  startPolling,
} from "./dispatch.ts";
import { startHeartbeat, writeHeartbeat } from "./shared/heartbeat.ts";

async function main() {
  console.log("[worker] 시작 — 전제 조건 확인 중...");

  // 1) Claude 구독 인증 확인 (짧은 테스트 호출)
  const auth = await verifyAuth();
  if (!auth.ok) {
    console.error("[worker] Claude 인증 실패:", auth.reason);
    process.exit(1);
  }
  console.log("[worker] Claude Max 구독 인증 OK");

  // 2) Supabase 연결 확인 (간단한 head 쿼리)
  const supabase = supabaseClient();
  const { error: pingErr, count } = await supabase
    .from("wishket_projects")
    .select("*", { count: "exact", head: true });
  if (pingErr) {
    console.error("[worker] Supabase 연결 실패:", pingErr.message);
    process.exit(1);
  }
  console.log(`[worker] Supabase 연결 OK (wishket_projects: ${count}건)`);

  const inflight = new InFlight();
  const pollMs = Number(process.env.WORKER_POLL_MS) || DEFAULT_POLL_MS;

  // 2.5) 생존 신호 시작 (T8.12). 대시보드가 이 신선도를 보고 트리거 버튼을
  //      활성화할지 판단한다. 기록 실패는 무시 — 워커를 죽이면 안 된다.
  await writeHeartbeat(supabase, "starting", 0);
  const stopHeartbeat = startHeartbeat(supabase, () => ({
    status: inflight.size > 0 ? "working" : "idle",
    inFlight: inflight.size,
  }));

  // 3) Realtime 구독 — 정상일 때의 빠른 경로.
  //    T7.1 자동 chain: autorun_queued → fetching → extract_queued → extracting
    //   → gen_queued (auto-approve) → generating → building → ready.
  //    각 단계가 다음 상태를 세팅하면 Realtime(또는 폴링)이 다시 깨운다.
  const channel = supabase
    .channel("demo-status-watch")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "wishket_projects",
      },
      (payload) => {
        const newRow = payload.new as {
          id?: string;
          slug?: string;
          demo_status?: string;
        } | null;
        const oldRow = payload.old as { demo_status?: string } | null;
        if (!newRow || newRow.demo_status === oldRow?.demo_status) return;
        console.log(
          `[worker] status 변경: ${newRow.slug ?? newRow.id} ` +
            `${oldRow?.demo_status ?? "?"} → ${newRow.demo_status}`,
        );
        if (!newRow.id) return;
        dispatch(
          supabase,
          { id: newRow.id, slug: newRow.slug, demo_status: newRow.demo_status },
          inflight,
          "realtime",
        );
      },
    )
    .subscribe((status) => {
      console.log(`[worker] Realtime 채널 상태: ${status}`);
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(
          `[worker] Realtime 사용 불가(${status}) — 폴링 폴백으로 계속 진행합니다. ` +
            `지연은 최대 ${pollMs / 1000}s.`,
        );
      }
    });

  // 4) 폴링 폴백 — Realtime 상태와 무관하게 항상 돈다.
  const stopPolling = startPolling(supabase, inflight, pollMs);
  console.log(`[worker] 폴링 폴백 가동 (${pollMs / 1000}s 간격)`);
  console.log("[worker] heartbeat 가동 (30s 간격)");

  console.log("[worker] 대기 중. Ctrl+C로 종료.");

  // 종료 시그널 처리
  const shutdown = async (sig: string) => {
    console.log(`[worker] ${sig} 수신 — 정리 중...`);
    stopPolling();
    stopHeartbeat();
    // 정상 종료는 즉시 표시해 준다 (SIGKILL 이면 못 남기므로 판정은 신선도 기준).
    await writeHeartbeat(supabase, "stopping", 0);
    await channel.unsubscribe();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] 치명 에러:", err);
  process.exit(1);
});
