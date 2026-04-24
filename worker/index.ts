// 로컬 워커 엔트리포인트.
//
// 역할: `wishket_projects.demo_status` 변경을 Supabase Realtime으로 구독해
// 상태에 따라 extract / generate / deploy 모듈을 분기 호출한다.
//
// T0.2 시점의 이 파일은 스캐폴드 상태 — Realtime 연결 성립과 이벤트 수신
// 로깅만 수행한다. 실제 라우팅 로직은 T2.1 / T3.x에서 추가.
//
// 실행 전제:
//   1) Claude Code CLI 설치 + `claude login` (Max 구독)
//   2) worker/.env.local에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / GITHUB_TOKEN 정의
//
// 실행: cd worker && npm install && npm start
// 개발: npm run dev  (tsx watch 자동 재시작)

import "dotenv/config";
import { supabaseClient } from "./shared/supabase.ts";
import { verifyAuth } from "./shared/claude.ts";

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

  // 3) Realtime 구독 — demo_status 변경 이벤트 수신 로깅 (라우팅은 차후 task)
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
        const newRow = payload.new as { id?: string; slug?: string; demo_status?: string } | null;
        const oldRow = payload.old as { demo_status?: string } | null;
        if (!newRow || newRow.demo_status === oldRow?.demo_status) return;
        console.log(
          `[worker] status 변경: ${newRow.slug ?? newRow.id} ` +
            `${oldRow?.demo_status ?? "?"} → ${newRow.demo_status}`,
        );
        // TODO(T2.1, T3.x, T5.1): 상태별 핸들러 분기
      },
    )
    .subscribe((status) => {
      console.log(`[worker] Realtime 채널 상태: ${status}`);
    });

  console.log("[worker] 대기 중. Ctrl+C로 종료.");

  // 종료 시그널 처리
  const shutdown = async (sig: string) => {
    console.log(`[worker] ${sig} 수신 — 채널 정리 중...`);
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
