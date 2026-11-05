-- 로그인 없이(anon 키만으로) 실행되던 SECURITY DEFINER 함수 차단 (2026-11-05 플랫폼 검토)
--
-- 원인: Postgres 는 새 함수에 EXECUTE 를 PUBLIC 으로 준다. 마이그레이션 밖(app.jsx 의 붙여넣기용 SQL,
--   지운 데모 생성기)에서 만든 함수는 이를 회수하지 않아, 공개 anon 키로 /rest/v1/rpc/… 호출이 됐다.
--   실측: anon 으로 list_deleted_projects() → 삭제된 프로젝트 100건(제목·상태·지운 사람 이메일).
--   restore_deleted_project(slug) 도 anon 실행 가능(삭제 건 되살리기).
-- 이 마이그레이션은 권한만 바꾼다(데이터·함수 본문 변경 없음). 대시보드는 로그인 세션(authenticated)으로 부르므로 영향 없음.

-- 1) 삭제 기록 목록·복구: 로그인한 사람만. 경로도 고정(검색 경로 바꿔치기 방지)
REVOKE EXECUTE ON FUNCTION public.list_deleted_projects() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_deleted_project(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_deleted_projects() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.restore_deleted_project(text) TO authenticated;
ALTER FUNCTION public.list_deleted_projects() SET search_path = public, pg_temp;
ALTER FUNCTION public.restore_deleted_project(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.snapshot_deleted_project() SET search_path = public, pg_temp;

-- 2) 지운 데모 생성기(2026-09-09)가 남긴 함수: 쓰는 곳 없음 → 누구도 못 부르게 (삭제는 별도 정리 때)
REVOKE EXECUTE ON FUNCTION public.check_and_increment_usage(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_daily_usage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_daily_usage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_or_set_stripe_customer(uuid, text) FROM PUBLIC, anon, authenticated;

-- 3) 데모 생성기 테이블에 남은 '누구나 INSERT' 정책 제거 (anon 이 행을 넣을 수 있었다). 테이블·데이터는 그대로
DROP POLICY IF EXISTS "Service can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Service can insert subscriptions" ON public.subscriptions;

-- 4) 재발 방지는 규칙으로: 새 함수 마이그레이션마다 `REVOKE EXECUTE … FROM PUBLIC, anon` 후 필요한 역할에만 GRANT.
--    (전역 ALTER DEFAULT PRIVILEGES … FROM PUBLIC 은 모든 스키마에 걸려 이후 설치하는 확장 함수의 기본 실행 권한까지
--     빼므로 쓰지 않는다 — 2026-11-05 검토.) 규칙: supabase/CLAUDE.md, 점검: 아래 5) 와 같은 질의.

-- 5) 확인: 남은 anon 실행 가능 SECURITY DEFINER 함수가 있으면 실패 (트리거 함수는 RPC 로 못 부르므로 제외)
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
    AND p.proname <> 'rls_auto_enable'   -- event trigger 용(Supabase 기본 제공)
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'anon 이 실행할 수 있는 SECURITY DEFINER 함수가 남음: %', bad; END IF;
END $$;
