-- 2026-11-30 '미팅 장소로 바로 출근' 개인 근무지 3건 삭제 (잘못 눌린 기록)
-- 그날 팀 근무지(합정1호점)로 출근하고 15:00 SLR렌트 대면 미팅(calendar_events, 외근 표시)부터 외근으로 보이게 한다.
-- 미팅 일정(calendar_events)은 건드리지 않는다. 삭제는 tg_audit_member_work_overrides 로 audit_log 에 남는다.
DO $$
DECLARE n int;
BEGIN
  DELETE FROM public.member_work_overrides
   WHERE id IN ('b0afff02-a29b-4e56-ac41-807dea402041','6bb0c4d1-af69-4cdd-8e73-1958c0d971f9','5c00cde0-ef05-428a-a868-1725d30db3ea')
     AND work_date = '2026-11-30' AND loc = 'other' AND branch = '마포구 양화로 10길 37, 에스엘알빌딩';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 3 THEN RAISE EXCEPTION '예상 3건, 실제 %건 — 롤백', n; END IF;
END $$;
