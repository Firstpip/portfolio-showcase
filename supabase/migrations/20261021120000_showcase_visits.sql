-- 결과물(쇼케이스) 방문 수집 + 위시켓 '지원서 열람' 상태 (2026-10-21).
--
-- 배경: 위시켓 포트폴리오의 '결과물 확인하기'는 firstpip.github.io/portfolio-showcase/<slug>/portfolio-N/ 로
--       직접 링크된다. GitHub Pages 는 접속 로그를 주지 않으므로, 클라이언트가 지원서를 읽고 결과물까지
--       들어왔는지 알 방법이 없었다. 페이지에 심은 assets/sv.js 가 Edge Function(showcase-view)으로
--       방문을 보내고, 여기 쌓는다. 포트폴리오는 프로젝트마다 따로 만들어지므로 slug = 어느 지원 건인지.
--
-- ⚠️ "그 클라이언트 본인"의 방문이라는 보장은 없다 — 위시켓 프로필은 로그인 사용자 누구나 볼 수 있다.
--    판정은 지원일·열람일·위시켓 referrer·체류/조작으로 하는 '추정'이다 (showcase_visit_summary).
--
-- 개인정보: IP 원문은 저장하지 않는다(서버 비밀 솔트 SHA-256 앞 16자 — 같은 방문자 묶기 전용).
--           쿠키 없음. 세션 id 는 탭 sessionStorage 의 무작위 값.
--
-- 쓰기: Edge Function(service_role) 전용 — anon/authenticated 쓰기 정책 없음.
-- 읽기: authenticated(대시보드)만.

CREATE TABLE IF NOT EXISTS public.showcase_visits (
  id               uuid PRIMARY KEY,                 -- 페이지 로드마다 클라이언트가 만든 값 (start/end 짝)
  slug             text NOT NULL,
  portfolio        int  NOT NULL CHECK (portfolio BETWEEN 1 AND 20),
  session_id       text NOT NULL,                    -- 같은 탭 세션의 P1·P2 묶기
  referrer_origin  text,                             -- 'https://www.wishket.com' 등 (경로는 브라우저가 안 보냄)
  entry_query      text,                             -- ?ref= 등 유입 표식 (최대 200자)
  ua               text,
  ip_hash          text,
  viewport         text,                             -- '1440x900'
  lang             text,
  tz               text,
  is_bot           boolean NOT NULL DEFAULT false,   -- UA 봇 판정
  is_automation    boolean NOT NULL DEFAULT false,   -- navigator.webdriver (우리 검증 스크립트·헤드리스)
  is_internal      boolean NOT NULL DEFAULT false,   -- 팀 브라우저(대시보드가 심은 표식)
  dwell_ms         int  NOT NULL DEFAULT 0,          -- 화면에 보인 시간 합 (숨김 탭 제외)
  max_scroll_pct   int  NOT NULL DEFAULT 0,
  interactions     int  NOT NULL DEFAULT 0,          -- 클릭·키 입력 횟수 (데모 조작)
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS showcase_visits_slug_created_idx ON public.showcase_visits (slug, created_at DESC);
CREATE INDEX IF NOT EXISTS showcase_visits_iphash_created_idx ON public.showcase_visits (ip_hash, created_at DESC);

ALTER TABLE public.showcase_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sv_read_authenticated" ON public.showcase_visits;
CREATE POLICY "sv_read_authenticated" ON public.showcase_visits
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.showcase_visits FROM anon;

-- 위시켓 '지원 중/미팅/종료' 탭의 "지원서 열람 YYYY년 M월 D일 / 열람 전".
-- wishket_projects 에 두지 않는 이유: 그 테이블은 UPDATE 마다 감사 로그에 전체 행을 남긴다 —
-- 주기 확인(checked_at) 갱신이 project_audit_log 를 도배한다. 프로젝트가 삭제돼도 기록은 남긴다(FK 없음).
CREATE TABLE IF NOT EXISTS public.proposal_views (
  slug                 text PRIMARY KEY,
  wishket_project_id   text,
  viewed_on            date,                         -- NULL = 열람 전(또는 미확인)
  viewed_first_seen_at timestamptz,                  -- 우리가 처음 '열람'으로 본 시각
  status_tab           text,
  checked_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.proposal_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pv_read_authenticated" ON public.proposal_views;
CREATE POLICY "pv_read_authenticated" ON public.proposal_views
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.proposal_views FROM anon;

-- 슬러그별 요약 — 대시보드용. 외부(봇·자동화·팀 제외) 방문만 센다.
--   wishket_visits: referrer 가 wishket 인 방문 (클라이언트일 가능성이 가장 높은 경로)
--   first_external_at: 첫 외부 방문 — 지원일/열람일과 나란히 보면 '열람 → 결과물 클릭' 흐름이 보인다.
CREATE OR REPLACE VIEW public.showcase_visit_summary
WITH (security_invoker = true) AS
SELECT
  slug,
  count(*)                                                        AS visits,
  count(DISTINCT session_id)                                      AS sessions,
  count(DISTINCT ip_hash)                                         AS visitors,
  count(*) FILTER (WHERE referrer_origin ILIKE '%wishket.com%')   AS wishket_visits,
  array_agg(DISTINCT portfolio ORDER BY portfolio)                AS portfolios,
  sum(dwell_ms)::bigint                                           AS dwell_ms,
  max(max_scroll_pct)                                             AS max_scroll_pct,
  sum(interactions)::bigint                                       AS interactions,
  min(created_at)                                                 AS first_external_at,
  max(last_seen_at)                                               AS last_external_at
FROM public.showcase_visits
WHERE NOT is_bot AND NOT is_automation AND NOT is_internal
GROUP BY slug;

GRANT SELECT ON public.showcase_visit_summary TO authenticated;
REVOKE ALL ON public.showcase_visit_summary FROM anon;
