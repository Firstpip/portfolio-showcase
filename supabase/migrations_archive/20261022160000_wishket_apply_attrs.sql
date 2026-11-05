-- 지원 건별 속성 (2026-10-22) — 위시켓 수주 저조 원인 분석에서 퍼널(wishket_funnel_events)을 '무엇으로' 나눠 볼지.
-- 워크룸 row·감사 스냅샷에는 공고 원문·금액이 거의 남지 않아(실측 445건 중 공고가 7건) 분석이 안 된다.
-- 원천은 dev-1 의 지원·평가 기록: data/audit.jsonl(apply_submitted) + data/evaluations/<id>.txt(+ .meta.json) + output/<slug>/proposal.md
-- 적재: wishket-portfolio-system scripts/sync-apply-attrs.js (전체 재계산·멱등, monitor 회차 끝에서 best-effort).
-- 퍼널과의 연결: wishket_project_id (열람 알림은 id 를 가짐) 또는 title(= 위시켓 공고 제목).
CREATE TABLE IF NOT EXISTS public.wishket_apply_attrs (
  wishket_project_id text PRIMARY KEY,
  slug               text,
  title              text,
  applied_at         timestamptz,                    -- 마지막 제출 시각 (apply_submitted)
  auto               boolean,                        -- 자동 지원 여부
  bid_won            bigint,                         -- 우리가 낸 지원 금액
  term_days          integer,                        -- 우리가 낸 기간
  posted_won         bigint,                         -- 공고 게시 금액 (협의면 NULL)
  negotiable         boolean,                        -- 협의(금액 미기재) 공고
  offered_days       integer,                        -- 공고 요구 기간
  size               text,                           -- 평가의 규모 추정 (small/medium/large/x-large)
  verdict            text,                           -- 평가 결론 (추천/조건부추천/…)
  effective_days     numeric,                        -- 평가의 실질 소요일
  portfolio_count    integer,
  demo_portfolios    integer,                        -- '[구현 데모]' 포트폴리오 수 (나머지는 실납품)
  proposal_chars     integer,                        -- 지원서(proposal.md) 길이
  source             jsonb,                          -- 어떤 기록에서 왔는지 (디버깅용)
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wishket_apply_attrs_title_idx ON public.wishket_apply_attrs (title);
ALTER TABLE public.wishket_apply_attrs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "waa_read_authenticated" ON public.wishket_apply_attrs;
CREATE POLICY "waa_read_authenticated" ON public.wishket_apply_attrs FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.wishket_apply_attrs FROM anon;
