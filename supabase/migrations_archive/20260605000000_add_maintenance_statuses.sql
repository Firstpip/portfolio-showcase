-- 유지보수(무상)/유지보수(유상) 상태 추가
-- 1) CHECK 제약에 maintenance_free / maintenance_paid 반영
-- 2) 마감일 경과 자동 전환: in_progress → delivered 대신 → maintenance_free

-- 1) current_status CHECK 제약 갱신
ALTER TABLE wishket_projects DROP CONSTRAINT IF EXISTS wishket_projects_current_status_check;
ALTER TABLE wishket_projects ADD CONSTRAINT wishket_projects_current_status_check
  CHECK (current_status IN (
    'generated','applied','interview','meeting_done',
    'won','contracted','in_progress','maintenance_free','maintenance_paid','delivered','settled','lost'
  ));

-- 2) in_progress + deadline 경과 → maintenance_free (기존: delivered)
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
    AND deadline < (now() AT TIME ZONE 'Asia/Seoul')::date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION transition_passed_deadlines() TO authenticated, anon;
