-- ============================================================================
-- portfolio_delete_jobs — 대시보드발 3-way 캐스케이드 삭제 아웃박스 큐
-- ----------------------------------------------------------------------------
-- 배경: 대시보드 삭제(delete-portfolios 엣지함수)는 showcase 파일 + DB row만 지운다.
--   위시켓 등록 포트폴리오 / 퍼스트핍 홈페이지 카드는 Puppeteer·관리자토큰이 필요해
--   엣지함수(Deno)에서 직접 못 지운다. → 엣지함수는 "삭제 의도"만 이 큐에 적재하고,
--   자격증명을 가진 워커(wishket-portfolio-system)가 폴링·소비해 위시켓/홈페이지를 삭제한다.
--
-- 적용 절차(레포 관례): Supabase SQL Editor에서 먼저 "수동" 실행 → 동작 확인 → 커밋.
-- 안전성: 신규 테이블·함수만 추가. 기존 데이터 무변경. 하단 롤백으로 즉시 원복 가능.
-- 설계: docs/cascade-delete/design.md
-- ============================================================================

CREATE TABLE IF NOT EXISTS portfolio_delete_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL,                       -- YYMMDD_kebab (wishket_projects.slug)
  scope           TEXT NOT NULL DEFAULT 'project'
                    CHECK (scope IN ('project','portfolio')),
  portfolio_path  TEXT,                                -- scope='portfolio' → 'portfolio-N'
  -- 삭제 대상 1건 = 1 portfolio-N. 조인키(wishket_portfolio_id/firstpip_slug)가 비어 있어도
  -- showcase_url(=slug 경로)을 담아두면 워커가 삭제 시점에 위시켓 카드 API 결과물 slug로 재해결.
  -- 형태: [{ portfolio_path, showcase_url, wishket_portfolio_id, firstpip_slug }]
  targets         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','done','partial','skipped','failed','manual_review')),
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  result          JSONB,                               -- 면별(위시켓/홈페이지) 삭제 결과 상세(워커 기록)
  requested_by    UUID,                                -- 삭제 요청 actor (auth.uid)
  requested_email TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdj_status_created ON portfolio_delete_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_pdj_slug           ON portfolio_delete_jobs (slug);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.touch_portfolio_delete_jobs() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS tg_touch_pdj ON portfolio_delete_jobs;
CREATE TRIGGER tg_touch_pdj BEFORE UPDATE ON portfolio_delete_jobs
FOR EACH ROW EXECUTE FUNCTION public.touch_portfolio_delete_jobs();

-- RLS: 로그인 사용자만 적재/조회. 워커(service_role 키)는 RLS 우회.
ALTER TABLE portfolio_delete_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_rw_pdj" ON portfolio_delete_jobs;
CREATE POLICY "auth_rw_pdj" ON portfolio_delete_jobs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 워커용 원자적 작업 선점 — 다중 워커 race-safe (FOR UPDATE SKIP LOCKED).
-- 재시도 상한(max_attempts) 미만인 pending/partial 작업을 1건 집어 processing으로 전이 후 반환.
CREATE OR REPLACE FUNCTION public.claim_delete_job(max_attempts INT DEFAULT 5)
RETURNS SETOF portfolio_delete_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  UPDATE portfolio_delete_jobs j
     SET status = 'processing', attempts = j.attempts + 1, updated_at = now()
   WHERE j.id = (
     SELECT id FROM portfolio_delete_jobs
      WHERE status IN ('pending','partial') AND attempts < max_attempts
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING j.*;
END $$;
-- ⚠️ anon 뿐 아니라 public까지 회수해야 함 — 함수는 기본 PUBLIC에 EXECUTE가 부여되어,
--    FROM anon만 회수하면 anon이 public 경유로 여전히 실행 가능(2026-06-17 실측 HTTP 200).
--    (레포 기존 패턴 20260607000000_revoke_anon_rpc.sql와 동일.)
REVOKE EXECUTE ON FUNCTION public.claim_delete_job(INT) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.claim_delete_job(INT) TO authenticated, service_role;

-- ── 롤백 ────────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.claim_delete_job(INT);
-- DROP TRIGGER  IF EXISTS tg_touch_pdj ON portfolio_delete_jobs;
-- DROP FUNCTION IF EXISTS public.touch_portfolio_delete_jobs();
-- DROP TABLE    IF EXISTS portfolio_delete_jobs;
