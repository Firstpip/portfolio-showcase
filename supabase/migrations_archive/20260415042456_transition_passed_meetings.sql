-- 미팅 시각 경과 시 interview → meeting_done 자동 전환 (Atomic, race-safe)
-- 클라이언트가 loadData에서 supabase.rpc('transition_passed_meetings')로 호출.
-- 단일 SQL UPDATE라 history append race / 시계 불일치 / 중복 실행 모두 안전.
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

GRANT EXECUTE ON FUNCTION transition_passed_meetings() TO authenticated, anon;
