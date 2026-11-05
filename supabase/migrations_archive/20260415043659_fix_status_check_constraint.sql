-- Schema drift 수정: STATUS_ORDER에는 추가됐으나 DB CHECK 제약에 빠진 상태값들 복구
-- 'contracted' 등으로 전환 시 23514 violation 발생하던 문제 해결
ALTER TABLE wishket_projects DROP CONSTRAINT IF EXISTS wishket_projects_current_status_check;
ALTER TABLE wishket_projects ADD CONSTRAINT wishket_projects_current_status_check
  CHECK (current_status IN (
    'generated','applied','interview','meeting_done',
    'won','contracted','in_progress','delivered','settled','lost'
  ));
