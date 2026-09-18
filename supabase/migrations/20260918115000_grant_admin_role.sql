-- 관리자 역할 부여 — app_metadata.role = 'admin' (2026-09-18)
--
-- 다음 마이그레이션(20260918120000)이 team_members 쓰기를 public.is_admin() 으로 제한하므로,
-- 그 전에 관리자 계정에 app_metadata.role 을 심어 둔다. (user_metadata.role 은 사용자가 스스로
-- 바꿀 수 있어 권한 판정에 쓰지 않는다 — 기존 값은 그대로 두되 참조하지 않음.)
-- 대상: admin@firstpip.co.kr 하나 (2026-09-18 결정). 적용 후 해당 계정은 재로그인해야 JWT 에 반영.

UPDATE auth.users
   SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
 WHERE email = 'admin@firstpip.co.kr';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM auth.users WHERE email = 'admin@firstpip.co.kr' AND raw_app_meta_data->>'role' = 'admin';
  IF n <> 1 THEN
    RAISE EXCEPTION 'admin@firstpip.co.kr 계정을 찾지 못했거나 role 설정 실패 (matched=%)', n;
  END IF;
  RAISE NOTICE 'admin role granted: admin@firstpip.co.kr';
END $$;

-- 롤백:
-- UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'role' WHERE email = 'admin@firstpip.co.kr';
