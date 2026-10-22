-- 팀 네트워크 (2026-10-22) — 결과물 방문에서 팀 기기를 IP(공인) 단위로 빼기 위함.
-- 브라우저 표식(localStorage fp_internal)은 브라우저마다·시크릿 창·Safari 7일 정리로 새기 쉽다.
-- 대시보드에 로그인한 브라우저가 showcase-view 에 {t:'team'} 을 보내면 그 공인 IP 를 여기 등록/갱신한다.
-- 같은 와이파이의 모든 기기는 같은 공인 IP 로 나가므로 한 번 등록으로 그 네트워크 전체가 팀이 된다.
--   - ip 원본은 팀 것만 저장한다 (외부 방문은 여전히 해시만). 위치는 ip-api 조회(시·구 단위, 대략값).
--   - 활성 = pinned 이거나 최근 30일 안에 쓰임 — 한두 번 들른 카페 IP 가 계속 팀으로 남지 않게.
--   - 등록 순간 같은 해시의 과거 방문도 is_internal 로 소급한다 (함수에서).
CREATE TABLE IF NOT EXISTS public.team_networks (
  ip_hash       text PRIMARY KEY,                    -- showcase_visits.ip_hash 와 같은 함수(SV_SALT)
  ip            text NOT NULL,
  region        text,                                -- 예: Seoul
  district      text,                                -- 예: Gwangjin-gu (ip-api city)
  isp           text,
  label         text,                                -- 사람이 붙이는 이름 (예: 성수 사무실)
  pinned        boolean NOT NULL DEFAULT false,      -- 만료 없이 유지
  hits          integer NOT NULL DEFAULT 1,          -- 대시보드 로드 횟수
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.team_networks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tn_read_authenticated" ON public.team_networks;
CREATE POLICY "tn_read_authenticated" ON public.team_networks FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "tn_update_authenticated" ON public.team_networks;
CREATE POLICY "tn_update_authenticated" ON public.team_networks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON public.team_networks FROM anon;
