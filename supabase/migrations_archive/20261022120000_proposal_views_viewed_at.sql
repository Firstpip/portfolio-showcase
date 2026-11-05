-- 지원서 열람 '시각' (2026-10-22) — 위시켓 알림 페이지가 분 단위로 준다.
-- 결과물 방문 세션의 시작 시각과 나란히 놓아 "열람 직후 방문 = 클라이언트일 가능성 높음"을 판정한다.
-- viewed_on 은 그대로 둔다(목록 배지·기존 행 호환). 새 행은 viewed_on = viewed_at 의 KST 날짜.
ALTER TABLE public.proposal_views ADD COLUMN IF NOT EXISTS viewed_at timestamptz;   -- NULL = 열람 전 또는 시각 미확보
