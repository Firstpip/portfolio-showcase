-- 시간 기반 자동 전이를 '1회성'으로 가드한다.
-- 배경: transition_passed_start_dates / transition_passed_deadlines 가 대시보드 로드마다 실행되는데,
--       사용자가 의도적으로 이전 상태로 되돌려도(예: in_progress → won) 착수일/마감일이 과거라는 이유로
--       다음 로드에서 자동으로 다시 끌어올려져 수동 되돌리기가 무효화되는 문제가 있었다.
-- 해결: history 에 이미 해당 '자동 전환' 기록이 있으면(= 이미 한 번 자동 전이가 일어난 적이 있으면)
--       재전이를 건너뛴다. 자동 전이는 "처음 1번만 넘겨주는 넛지"가 되고, 이후 수동 제어가 존중된다.
-- 미팅 전이(transition_passed_meetings)는 재예약이 정상 흐름이라 가드하지 않는다(의도적 제외).

-- 1) 착수일 경과: won → in_progress (history에 자동 전환 기록이 없을 때만)
CREATE OR REPLACE FUNCTION transition_passed_start_dates()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n int;
BEGIN
  UPDATE wishket_projects
  SET current_status = 'in_progress',
      history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'status', 'in_progress',
        'date', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'),
        'note', '착수 예정일 경과 자동 전환',
        'start_date', start_date
      )),
      updated_at = (now() AT TIME ZONE 'Asia/Seoul')::date
  WHERE current_status = 'won'
    AND start_date IS NOT NULL
    AND start_date < (now() AT TIME ZONE 'Asia/Seoul')::date
    -- 가드: 이미 착수일 자동 전환이 일어난 적이 있으면(되돌린 케이스) 재전이 금지
    AND NOT (COALESCE(history, '[]'::jsonb) @> '[{"note": "착수 예정일 경과 자동 전환"}]'::jsonb);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION transition_passed_start_dates() TO authenticated, anon;

-- 2) 마감일 경과: in_progress → maintenance_free (history에 자동 전환 기록이 없을 때만)
CREATE OR REPLACE FUNCTION transition_passed_deadlines()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n int;
BEGIN
  UPDATE wishket_projects
  SET current_status = 'maintenance_free',
      history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'status', 'maintenance_free',
        'date', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'),
        'note', '마감일 경과 자동 전환 (무상 유지보수 시작)',
        'deadline', deadline
      )),
      updated_at = (now() AT TIME ZONE 'Asia/Seoul')::date
  WHERE current_status = 'in_progress'
    AND deadline IS NOT NULL
    AND deadline < (now() AT TIME ZONE 'Asia/Seoul')::date
    -- 가드: 이미 마감일 자동 전환이 일어난 적이 있으면(되돌린 케이스) 재전이 금지
    AND NOT (COALESCE(history, '[]'::jsonb) @> '[{"note": "마감일 경과 자동 전환 (무상 유지보수 시작)"}]'::jsonb);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION transition_passed_deadlines() TO authenticated, anon;
