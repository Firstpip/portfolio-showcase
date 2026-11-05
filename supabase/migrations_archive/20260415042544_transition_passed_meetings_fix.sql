-- Fix: updated_at은 DATE 컬럼이라 text를 직접 넣을 수 없음. 명시적 캐스트.
CREATE OR REPLACE FUNCTION transition_passed_meetings()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n int;
BEGIN
  UPDATE wishket_projects
  SET current_status = 'meeting_done',
      history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'status', 'meeting_done',
        'date', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'),
        'note', '미팅 시각 경과 자동 전환',
        'meeting_at', meeting_at,
        'meeting_type', meeting_type
      )),
      updated_at = (now() AT TIME ZONE 'Asia/Seoul')::date
  WHERE current_status = 'interview'
    AND meeting_at IS NOT NULL
    AND meeting_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
