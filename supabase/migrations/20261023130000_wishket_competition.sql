-- 위시켓 공고 경쟁 강도 (2026-10-23) — 공고 목록 카드의 '지원자 N명'을 공고·날짜별로 남긴다.
-- 왜: 수주 저조 분석에서 9월엔 큰 공고가 돌아왔는데도 열람→미팅 전환이 회복되지 않았다(공고 금액과 무관한 하락).
--   남은 후보 중 '공고당 지원자 수 증가(경쟁 심화)'를 데이터로 확인하려면 지원자 수가 쌓여야 한다.
-- 적재: wishket-portfolio-system monitor-wishket.js 가 매 회차 목록을 읽을 때 (추가 페이지 로드 0).
--   하루 한 행(같은 날 여러 번 보면 큰 값) — 목록에서 사라지기 전까지의 증가 추이가 남는다.
CREATE TABLE IF NOT EXISTS public.wishket_competition (
  wishket_project_id text NOT NULL,
  observed_on        date NOT NULL,                  -- KST 날짜
  applicants         integer NOT NULL,               -- '지원자 없음' = 0
  title              text,
  budget_won         bigint,                         -- 카드 표시 금액 (협의·미표시는 NULL)
  is_private         boolean,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wishket_project_id, observed_on)
);
CREATE INDEX IF NOT EXISTS wishket_competition_day_idx ON public.wishket_competition (observed_on DESC);
ALTER TABLE public.wishket_competition ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wc_read_authenticated" ON public.wishket_competition;
CREATE POLICY "wc_read_authenticated" ON public.wishket_competition FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.wishket_competition FROM anon;
