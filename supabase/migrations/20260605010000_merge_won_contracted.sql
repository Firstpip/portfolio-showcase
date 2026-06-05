-- '수주 성공'(won) + '계약 완료'(contracted) 상태를 하나로 통합 → won ('계약 논의 중'으로 개명)
-- meeting_done 라벨은 '미팅완료'로 변경 (프론트만, 키 변동 없음)

-- 1) 기존 contracted 프로젝트를 won으로 이전 (history에 통합 기록 남김)
UPDATE wishket_projects
SET current_status = 'won',
    history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'status', 'won',
      'date', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'),
      'note', '상태 통합: 계약 완료 → 계약 논의 중'
    )),
    updated_at = (now() AT TIME ZONE 'Asia/Seoul')::date
WHERE current_status = 'contracted';

-- 2) CHECK 제약에서 contracted 제거
ALTER TABLE wishket_projects DROP CONSTRAINT IF EXISTS wishket_projects_current_status_check;
ALTER TABLE wishket_projects ADD CONSTRAINT wishket_projects_current_status_check
  CHECK (current_status IN (
    'generated','applied','interview','meeting_done',
    'won','in_progress','maintenance_free','maintenance_paid','delivered','settled','lost'
  ));

-- 3) 착수일 경과 자동 전환: contracted 대신 won 기준으로 변경
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
    AND start_date < (now() AT TIME ZONE 'Asia/Seoul')::date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION transition_passed_start_dates() TO authenticated, anon;
