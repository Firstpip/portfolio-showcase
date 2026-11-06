-- is_staff() 가 서버용 키(service_role)를 '팀원 아님'으로 판단하던 것을 고친다 (2026-11-06).
--
-- 왜: 20261105140000 에서 권한 상승 함수에 `IF NOT is_staff()` 를 붙였는데, is_staff() 는 로그인 사용자(auth.uid())만 본다.
--   서버용 키로 부르면 auth.uid() 가 없어 false → delete_project_force 가 42501 로 막힌다.
--   이 경로를 쓰는 곳: 생성기(wishket-portfolio-system scripts/lib/supabase.js 의 force 삭제 대체 경로),
--   delete-portfolios 함수가 서버용 키로 불렸을 때(생성기 정리 자동화). 11-05 반영 뒤 강제 삭제가 없어 아직 실패는 없었다.
-- 서버용 키는 원래 RLS 를 거치지 않는 최고 권한이라 여기서 허용해도 권한이 넓어지지 않는다(anon·일반 로그인은 그대로).
CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.role() = 'service_role'
      OR public.is_admin()
      OR EXISTS (SELECT 1 FROM public.team_members WHERE user_id = auth.uid() AND is_active IS NOT FALSE);
$$;
REVOKE EXECUTE ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;
