-- 무상 유지보수 만료일을 직접 고칠 수 있게 (2026-11-06).
--
-- 화면(워크룸 프로젝트 목록 '무상 만료일' 칸)은 회사 기준(검수 후 6개월, 계약금액 1,000만 원 미만 3개월)으로
-- 개발완료일에서 계산한다(dashboard/src/maintenance.mjs). 계약마다 기간이 다를 수 있어 사람이 날짜를 넣으면 그것이 우선이다.
-- 비어 있으면(NULL) 자동 계산 — 그래서 계산값을 여기에 저장하지 않는다(금액·완료일이 바뀌면 따라 바뀌어야 함).
-- 권한: 기존 wishket_projects RLS(is_staff)를 그대로 따른다. 감사 기록·백업은 행 전체를 다루므로 따로 손댈 것 없음.
ALTER TABLE public.wishket_projects ADD COLUMN IF NOT EXISTS free_maint_until date;
COMMENT ON COLUMN public.wishket_projects.free_maint_until IS
  '무상 유지보수 만료일(직접 입력). NULL 이면 화면이 회사 기준으로 계산 — dashboard/src/maintenance.mjs';
