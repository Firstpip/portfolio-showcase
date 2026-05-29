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

-- ── [0] 기존 anon/public 허용 정책 제거 (필수 선행) ──────────────────────────
-- 초기 개발 때 생성된 read_all/insert_all/update_all/delete_all 같은 "TO public"
-- 정책이 남아 있으면, RLS 정책은 OR(합집합)이라 아래 authenticated 정책을 추가해도
-- anon이 계속 통과한다(2026-05-29 실측으로 wishket_projects에서 확인됨).
-- 따라서 anon/public 대상 정책을 먼저 전부 제거한다. (authenticated/service_role 정책은 보존)
DO $$
DECLARE t TEXT; r RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['wishket_projects','team_members','project_milestones','meeting_prep_jobs'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      FOR r IN
        SELECT policyname FROM pg_policies
        WHERE schemaname='public' AND tablename=t
          AND ('anon' = ANY(roles) OR 'public' = ANY(roles))
      LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, t);
        RAISE NOTICE 'dropped permissive policy: %.%', t, r.policyname;
      END LOOP;
    END IF;
  END LOOP;
END $$;

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
-- ✅ 활성화됨. 처리 주체 확인 완료: 로컬 맥 데몬
--    (~/wishket-portfolio-system/scripts/meeting-prep-daemon.js)이 SERVICE_ROLE 키로
--    접속 → RLS 우회하므로 영향 없음. 대시보드는 authenticated 라 정책으로 정상 동작.
--    기존 anon 허용 정책("insert job"/"select job" — 원본 supabase-jobs-schema.sql)이
--    구멍이었으며, 위 [0] 블록이 anon/public 정책을 선제거함.
DO $$
BEGIN
  IF to_regclass('public.meeting_prep_jobs') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_prep_jobs TO authenticated';
    EXECUTE 'ALTER TABLE public.meeting_prep_jobs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "mpj_all_authenticated" ON public.meeting_prep_jobs';
    EXECUTE 'CREATE POLICY "mpj_all_authenticated" ON public.meeting_prep_jobs
             FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

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
