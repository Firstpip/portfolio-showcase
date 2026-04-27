-- 착수일/마감일 경과 시 status 자동 전환 (Atomic, race-safe).
-- 클라이언트가 loadData에서 supabase.rpc(...)로 호출.
-- 단일 SQL UPDATE라 history append race / 시계 불일치 / 중복 실행 모두 안전.
-- 안전장치: start_date / deadline 이 NULL이면 자동 전환 대상에서 제외.

-- 1) contracted + start_date 경과 → in_progress
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
  WHERE current_status = 'contracted'
    AND start_date IS NOT NULL
    AND start_date < (now() AT TIME ZONE 'Asia/Seoul')::date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION transition_passed_start_dates() TO authenticated, anon;

-- 2) in_progress + deadline 경과 → delivered
CREATE OR REPLACE FUNCTION transition_passed_deadlines()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n int;
BEGIN
  UPDATE wishket_projects
  SET current_status = 'delivered',
      history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'status', 'delivered',
        'date', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'),
        'note', '마감일 경과 자동 전환',
        'deadline', deadline
      )),
      updated_at = (now() AT TIME ZONE 'Asia/Seoul')::date
  WHERE current_status = 'in_progress'
    AND deadline IS NOT NULL
    AND deadline < (now() AT TIME ZONE 'Asia/Seoul')::date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION transition_passed_deadlines() TO authenticated, anon;
