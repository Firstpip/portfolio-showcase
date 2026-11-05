-- 사내 캘린더 알림 보강 (2026-11-03)
--   1) 발송 상태: 함수(calendar-push)가 실행마다 push_state 'heartbeat' 에 남기는 마지막 실행 기록을 로그인한 사용자가 읽는다.
--      알림 설정 창이 '알림 서버 n분 전 정상 실행'을 보여 주고, 15분 넘게 멈추면 경고한다 — '평소와 다를 때만' 오는 알림이라
--      멈춰도 아무도 모르던 문제(발송 감시 없음)를 막는다. push_state 자체는 계속 service_role 전용.
--   2) 권한 좁히기: 기기 등록·이전은 register_push_subscription RPC 로만. 클라이언트는 알림 켜기/끄기 두 칸만 고치고 자기 기기를 지울 수 있다.
--      (전에는 자기 행의 member_id·endpoint 를 직접 바꿔 남의 안내를 받거나 임의 주소로 요청을 보내게 할 수 있었다)

CREATE OR REPLACE FUNCTION public.calendar_push_status()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT value FROM public.push_state WHERE name = 'heartbeat'
$$;
REVOKE ALL ON FUNCTION public.calendar_push_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_push_status() TO authenticated;

REVOKE INSERT, UPDATE ON public.push_subscriptions FROM authenticated;
GRANT UPDATE (morning_brief, change_alerts) ON public.push_subscriptions TO authenticated;

-- 되돌리기:
-- DROP FUNCTION IF EXISTS public.calendar_push_status();
-- GRANT INSERT, UPDATE ON public.push_subscriptions TO authenticated;
