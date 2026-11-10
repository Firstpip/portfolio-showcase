-- 마감일 경과 → 유지보수(무상) 자동 전환 중지 (2026-11-10).
--
-- 지금까지 워크룸 화면이 열릴 때 이 함수를 불러, 마감일이 지난 '개발 중' 프로젝트를 유지보수(무상)로 넘겼다.
-- 개발이 예정보다 늦어지는 일이 많아, 본인도 모르게 넘어간 건은 예정 마감일이 그대로 개발완료일로 남고
-- 무상 유지보수 기간이 실제와 달라졌다. 이제 개발 완료는 사람이 '상태 변경'에서 실제 완료일을 넣어 확정한다
-- (dashboard/src/app.jsx DevDoneModal). 새 화면은 이 함수를 부르지 않는다.
--
-- 함수를 지우지 않고 0 만 돌려주게 둔다 — 배포 전에 열어 둔 예전 화면이 불러도 오류 없이 아무 일도 하지 않게.
-- 아무것도 읽거나 쓰지 않으므로 SECURITY DEFINER 를 뗀다. 실행 권한(authenticated·service_role, PUBLIC·anon 없음)은
-- CREATE OR REPLACE 가 그대로 유지한다.
-- 되돌리기: 20261105130000_baseline.sql 의 transition_passed_deadlines 정의를 다시 적용.
CREATE OR REPLACE FUNCTION public.transition_passed_deadlines() RETURNS integer
    LANGUAGE sql
    SECURITY INVOKER
    SET search_path = public, pg_temp
    AS $$ SELECT 0 $$;

COMMENT ON FUNCTION public.transition_passed_deadlines() IS
  '중지됨(2026-11-10): 마감일 경과 자동 무상 전환 없음. 개발 완료는 워크룸 상태 변경(실제 완료일 입력)으로만. 예전 화면 호환용으로 0 반환';

REVOKE ALL ON FUNCTION public.transition_passed_deadlines() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_passed_deadlines() TO authenticated, service_role;
