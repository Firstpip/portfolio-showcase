-- 보안 회귀 수정: 20260623120000_guard_auto_transition_once.sql 가 함수를 CREATE OR REPLACE 하면서
-- `GRANT ... TO authenticated, anon` 를 그대로 복사해, 20260607000000_revoke_anon_rpc.sql 의
-- anon 권한 회수를 되돌려 버렸다(공개 anon 키로 대량 상태전이 트리거 가능 상태가 됨).
-- → anon EXECUTE 를 다시 회수한다. 대시보드는 로그인(authenticated) 세션에서만 RPC를 호출하므로 영향 없음.
-- (transition_passed_meetings 는 6/23 가드 대상이 아니어서 회귀하지 않았지만, 멱등하게 함께 회수.)

REVOKE EXECUTE ON FUNCTION transition_passed_meetings()    FROM anon, public;
REVOKE EXECUTE ON FUNCTION transition_passed_start_dates() FROM anon, public;
REVOKE EXECUTE ON FUNCTION transition_passed_deadlines()   FROM anon, public;

GRANT EXECUTE ON FUNCTION transition_passed_meetings()    TO authenticated;
GRANT EXECUTE ON FUNCTION transition_passed_start_dates() TO authenticated;
GRANT EXECUTE ON FUNCTION transition_passed_deadlines()   TO authenticated;
