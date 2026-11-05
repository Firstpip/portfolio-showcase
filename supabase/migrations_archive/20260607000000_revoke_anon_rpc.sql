-- 상태 자동 전환 RPC 3종의 anon 실행 권한 회수 (2026-06-07 보안 점검)
--
-- 배경: 과거 마이그레이션들이 GRANT ... TO authenticated, anon으로 선언해
-- 비로그인 상태에서도 미팅/착수일/마감일 자동 전환을 트리거할 수 있었음
-- (실제 anon 키 호출 HTTP 200 확인). 대시보드는 로그인 후에만 RPC를 호출하고
-- 실패 시 console.warn으로 무해 처리되므로 anon 권한이 필요 없음.
--
-- ※ 2026-06-07 `supabase db query`로 원격에 직접 적용 완료 (3종 모두 anon 401 검증).
--    이 파일은 재현성·기록용. REVOKE는 멱등이라 재적용해도 무해.
-- ※ 향후 이 함수들을 재생성하는 마이그레이션을 만들 때 anon GRANT를 복사하지 말 것.

REVOKE EXECUTE ON FUNCTION transition_passed_meetings()    FROM anon, public;
REVOKE EXECUTE ON FUNCTION transition_passed_start_dates() FROM anon, public;
REVOKE EXECUTE ON FUNCTION transition_passed_deadlines()   FROM anon, public;

GRANT EXECUTE ON FUNCTION transition_passed_meetings()    TO authenticated;
GRANT EXECUTE ON FUNCTION transition_passed_start_dates() TO authenticated;
GRANT EXECUTE ON FUNCTION transition_passed_deadlines()   TO authenticated;
