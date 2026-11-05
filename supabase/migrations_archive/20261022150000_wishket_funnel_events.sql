-- 위시켓 지원 퍼널 이벤트 (2026-10-22) — 수주 저조 원인 분석용 원천.
-- 왜 별도 테이블인가: wishket_projects 는 지원종료·계약실패 건을 자동 정리(삭제)하고 감사 로그도 2026-04-27 부터라
-- '지원 → 열람 → 미팅 → 계약' 의 분모가 남지 않는다. 위시켓 알림 페이지(~2023-05 부터 보존)의 이벤트를 지우지 않고 쌓는다.
-- 원천: wishket-portfolio-system scripts/sync-proposal-viewed.js (monitor 매시 30분, 보통 1페이지) + --backfill.
--   kind: apply(프로젝트에 지원하였습니다) · view(지원서를 열람하였습니다) · meeting(미팅 제안/미팅 일정 안내)
--         · meeting_failed(미팅이 성사되지 않았습니다) · contract(계약이 체결되었습니다)
--   project_title 로 같은 공고의 이벤트를 잇는다 — 'apply' 알림엔 공고 id 가 없다(destination 이 지원 관리 탭 URL).
--   wishket_project_id 는 destination 에 /project/<id>/ 가 있을 때만 (view 는 항상 있음).
CREATE TABLE IF NOT EXISTS public.wishket_funnel_events (
  event_key          text PRIMARY KEY,               -- 알림 id(mark/<id>) — 없으면 'h:'||kind||제목||시각
  kind               text NOT NULL CHECK (kind IN ('apply','view','meeting','meeting_failed','contract')),
  project_title      text NOT NULL,
  wishket_project_id text,
  occurred_at        timestamptz NOT NULL,           -- 알림 시각 (분 단위, KST 로 해석)
  destination        text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wishket_funnel_events_title_idx ON public.wishket_funnel_events (project_title, occurred_at);
CREATE INDEX IF NOT EXISTS wishket_funnel_events_kind_at_idx ON public.wishket_funnel_events (kind, occurred_at DESC);

ALTER TABLE public.wishket_funnel_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wfe_read_authenticated" ON public.wishket_funnel_events;
CREATE POLICY "wfe_read_authenticated" ON public.wishket_funnel_events FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.wishket_funnel_events FROM anon;
