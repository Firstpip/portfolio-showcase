-- ============================================================================
-- demo_worker_heartbeat — 데모 생성 워커 생존 신호 (T8.12)
-- ----------------------------------------------------------------------------
-- 배경: 데모 생성 파이프라인은 맥북에서 도는 로컬 워커가 처리한다. 워커가 꺼져
--   있거나 맥북이 잠들면 대시보드에서 "🎬 데모 생성" 을 눌러도 행이
--   demo_status='autorun_queued' 에 영원히 멈춘다. 사용자는 이유를 알 방법이 없다.
--   → 워커가 주기적으로 이 테이블을 갱신하고, 대시보드는 마지막 신호 시각을 보고
--     워커가 살아있을 때만 트리거 버튼을 활성화한다.
--   (plan.md §8 의 미결정 사항 "워커 오프라인 시 대시보드 UX" 를 이걸로 확정)
--
-- 설계: 워커는 1대 전제라 단일 행(id='demo-worker')으로 충분하다. 행을 늘리지 않고
--   upsert 로 갱신해 테이블이 자라지 않게 한다.
--
-- 적용 절차(레포 관례): Supabase SQL Editor에서 먼저 수동 실행 → 확인 → 커밋.
-- 안전성: 신규 테이블만 추가. 기존 데이터 무변경. 하단 롤백으로 즉시 원복.
-- ============================================================================

CREATE TABLE IF NOT EXISTS demo_worker_heartbeat (
  id            TEXT PRIMARY KEY DEFAULT 'demo-worker',
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 어느 기계에서 도는지 (여러 대에서 실수로 동시 실행 시 추적용)
  hostname      TEXT,
  pid           INT,
  -- 'starting' | 'idle' | 'working' | 'stopping' — 표시용 힌트일 뿐,
  -- 살아있음 판정은 어디까지나 last_seen_at 의 신선도로 한다.
  status        TEXT,
  -- 현재 처리 중인 프로젝트 수 (in-flight)
  in_flight     INT NOT NULL DEFAULT 0,
  detail        JSONB,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT demo_worker_heartbeat_single_row CHECK (id = 'demo-worker')
);

ALTER TABLE demo_worker_heartbeat ENABLE ROW LEVEL SECURITY;

-- 대시보드(인증 세션)는 읽기만. 쓰기는 워커의 service_role 이 RLS 를 우회해 수행한다.
GRANT SELECT ON public.demo_worker_heartbeat TO authenticated;

DROP POLICY IF EXISTS "dwh_read_authenticated" ON public.demo_worker_heartbeat;
CREATE POLICY "dwh_read_authenticated" ON public.demo_worker_heartbeat
  FOR SELECT TO authenticated USING (true);

-- 초기 행. 아직 한 번도 안 뜬 워커는 오래된 last_seen_at 을 갖게 되어
-- 대시보드에서 자연스럽게 "오프라인" 으로 계산된다.
INSERT INTO demo_worker_heartbeat (id, last_seen_at, status)
VALUES ('demo-worker', 'epoch'::timestamptz, 'never-started')
ON CONFLICT (id) DO NOTHING;

-- ── 롤백 ─────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS demo_worker_heartbeat;
