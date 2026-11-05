-- 권한 하드닝 (2026-09-18 전체 검토 1차)
--
-- 배경
-- 1) 대시보드의 관리자 판정이 user_metadata.role 이었음. user_metadata 는 로그인 사용자 본인이
--    supabase.auth.updateUser({ data:{ role:'admin' } }) 로 바꿀 수 있어 권한 판정에 쓸 수 없다.
--    → 클라이언트는 app_metadata.role (서비스 롤/Supabase 대시보드에서만 설정 가능) 로 전환.
--    → 서버도 같은 기준으로 team_members 쓰기를 admin 에게만 허용 (지금까지는 UI 숨김뿐이었음).
-- 2) portfolio_delete_jobs 에 authenticated 가 INSERT/UPDATE 가능했음. 워커는 targets[] 의
--    wishket_portfolio_id / firstpip_slug 를 신뢰하고 삭제하므로, 로그인 사용자가 임의 카드 삭제
--    작업을 적재할 수 있었다. 적재는 엣지함수(service_role)만 하므로 authenticated 는 조회만.
--    claim_delete_job 도 워커(service_role) 전용으로 회수.
--
-- 배포 순서: 직전 마이그레이션(20260918115000_grant_admin_role)이 admin@firstpip.co.kr 에
--    app_metadata.role='admin' 을 먼저 심는다. 이 파일 적용 후 관리자 계정은 재로그인 필요.
--    다른 계정을 관리자로 추가하려면: UPDATE auth.users SET raw_app_meta_data =
--    coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"admin"}' WHERE email = '...';

-- ── 1. 관리자 판정 헬퍼 ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- ── 2. team_members: 읽기는 전원, 쓰기는 admin ──────────────────────────────
DROP POLICY IF EXISTS "tm_all_authenticated" ON public.team_members;
DROP POLICY IF EXISTS "tm_select_authenticated" ON public.team_members;
DROP POLICY IF EXISTS "tm_write_admin" ON public.team_members;
CREATE POLICY "tm_select_authenticated" ON public.team_members
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "tm_write_admin" ON public.team_members
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── 3. portfolio_delete_jobs: authenticated 는 조회만 ────────────────────────
DO $$
BEGIN
  IF to_regclass('public.portfolio_delete_jobs') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "auth_rw_pdj" ON public.portfolio_delete_jobs';
    EXECUTE 'DROP POLICY IF EXISTS "auth_ro_pdj" ON public.portfolio_delete_jobs';
    EXECUTE 'CREATE POLICY "auth_ro_pdj" ON public.portfolio_delete_jobs FOR SELECT TO authenticated USING (true)';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.portfolio_delete_jobs FROM authenticated';
  END IF;
  IF to_regprocedure('public.claim_delete_job(int)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.claim_delete_job(int) FROM authenticated';
  END IF;
END $$;

-- ── 롤백 ────────────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS "tm_write_admin" ON public.team_members;
-- DROP POLICY IF EXISTS "tm_select_authenticated" ON public.team_members;
-- CREATE POLICY "tm_all_authenticated" ON public.team_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS "auth_ro_pdj" ON public.portfolio_delete_jobs;
-- CREATE POLICY "auth_rw_pdj" ON public.portfolio_delete_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- GRANT INSERT, UPDATE, DELETE ON public.portfolio_delete_jobs TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.claim_delete_job(int) TO authenticated;
-- DROP FUNCTION IF EXISTS public.is_admin();
