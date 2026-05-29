-- ============================================================================
-- RLS 활성화: 핵심 테이블의 외부(anon) 무단 접근 차단
-- ----------------------------------------------------------------------------
-- 배경(2026-05-29 확인): wishket_projects 등 핵심 테이블이 RLS 미설정 상태라,
--   공개 HTML(dashboard/index.html)에 박힌 anon 키만으로 로그인 없이
--   전체 행 SELECT / UPDATE / DELETE 가 가능함이 실측으로 확인됨.
--   (실제 행 무변경 UPDATE 시도 → HTTP 200, 적용 1행)
--
-- 조치: 각 테이블에 RLS 활성화 + "authenticated 전체 허용" 정책 부여.
--   - 로그인한 대시보드(authenticated JWT)  : 정책으로 기존과 100% 동일 동작
--   - 워커/엣지함수(service_role 키)        : RLS를 우회 → 영향 없음
--   - anon(로그아웃·외부 직접 호출)         : 허용 정책 없음 → 전면 차단(= 목표)
--   - realtime 구독                          : authenticated 가 전체 허용이므로 계속 수신
--
-- 안전성: 데이터는 1건도 변경하지 않음(정책 추가뿐). 하단 롤백 SQL로 즉시 원복 가능.
--
-- 권장 적용 절차:
--   1) Supabase SQL Editor에서 이 파일을 먼저 "수동" 실행
--   2) 대시보드 로그인 → 조회/수정/삭제/실시간 반영이 정상인지 확인
--   3) 이상 없으면 이 파일을 마이그레이션으로 커밋(버전관리 편입)
--   4) 문제 발생 시 하단 "롤백" 블록만 실행하면 원복
-- ============================================================================

-- ── wishket_projects ────────────────────────────────────────────────────────
-- authenticated 역할에 테이블 권한 보장(Supabase 기본 부여분 재확인용, 멱등).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wishket_projects TO authenticated;
ALTER TABLE public.wishket_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wp_all_authenticated" ON public.wishket_projects;
CREATE POLICY "wp_all_authenticated" ON public.wishket_projects
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── team_members ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tm_all_authenticated" ON public.team_members;
CREATE POLICY "tm_all_authenticated" ON public.team_members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── project_milestones ───────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_milestones TO authenticated;
ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pm_all_authenticated" ON public.project_milestones;
CREATE POLICY "pm_all_authenticated" ON public.project_milestones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── meeting_prep_jobs ─────────────────────────────────────────────────────────
-- 🟡 의도적으로 "비활성"(주석 처리) 상태로 둠.
--    이유: 이 테이블은 마이그레이션에 정의가 없는 드리프트 테이블이며, 잡 처리
--    주체(데모 준비 파일 생성 — 30~45분, Claude sonnet 사용)가 이 레포 어디에도
--    없음. 즉 외부/별도 인프라가 처리하며, 그 접속 키(role)를 코드로 확인 불가.
--    → 처리기가 anon 키를 쓴다면 RLS 활성화 즉시 데모 생성이 멈춤(운영 장애).
--
--    [활성화 조건] 처리기가 service_role 키를 쓰는 것을 확인하면(백엔드 잡은
--    거의 항상 service_role, 본 레포 worker/도 service_role) 아래 블록의 주석을
--    해제하고 재적용. 대시보드(authenticated)는 어느 경우든 정상 동작.
--
-- DO $$
-- BEGIN
--   IF to_regclass('public.meeting_prep_jobs') IS NOT NULL THEN
--     EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_prep_jobs TO authenticated';
--     EXECUTE 'ALTER TABLE public.meeting_prep_jobs ENABLE ROW LEVEL SECURITY';
--     EXECUTE 'DROP POLICY IF EXISTS "mpj_all_authenticated" ON public.meeting_prep_jobs';
--     EXECUTE 'CREATE POLICY "mpj_all_authenticated" ON public.meeting_prep_jobs
--              FOR ALL TO authenticated USING (true) WITH CHECK (true)';
--   END IF;
-- END $$;

-- ── (선택) 방어 심화: anon 테이블 권한 자체 회수 ──────────────────────────────
-- RLS만으로도 anon은 차단되지만, 권한 자체를 회수하면 belt-and-suspenders.
-- authenticated/service_role 권한은 건드리지 않음. 필요 시 주석 해제 후 실행.
-- REVOKE ALL ON public.wishket_projects   FROM anon;
-- REVOKE ALL ON public.team_members       FROM anon;
-- REVOKE ALL ON public.project_milestones FROM anon;
-- DO $$ BEGIN
--   IF to_regclass('public.meeting_prep_jobs') IS NOT NULL THEN
--     EXECUTE 'REVOKE ALL ON public.meeting_prep_jobs FROM anon';
--   END IF;
-- END $$;

-- ============================================================================
-- 검증 쿼리 (적용 후 SQL Editor에서 실행 — 모든 행이 rowsecurity = true 여야 함)
-- ----------------------------------------------------------------------------
--   SELECT relname, relrowsecurity
--   FROM pg_class
--   WHERE relname IN ('wishket_projects','team_members','project_milestones','meeting_prep_jobs');
--
--   SELECT tablename, policyname, roles, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('wishket_projects','team_members','project_milestones','meeting_prep_jobs');
-- ============================================================================

-- ============================================================================
-- 롤백 (문제 발생 시 아래 블록만 실행하면 즉시 원복)
-- ----------------------------------------------------------------------------
--   DROP POLICY IF EXISTS "wp_all_authenticated"  ON public.wishket_projects;
--   DROP POLICY IF EXISTS "tm_all_authenticated"  ON public.team_members;
--   DROP POLICY IF EXISTS "pm_all_authenticated"  ON public.project_milestones;
--   DROP POLICY IF EXISTS "mpj_all_authenticated" ON public.meeting_prep_jobs;
--   ALTER TABLE public.wishket_projects   DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.team_members       DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.project_milestones DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.meeting_prep_jobs  DISABLE ROW LEVEL SECURITY;
-- ============================================================================
