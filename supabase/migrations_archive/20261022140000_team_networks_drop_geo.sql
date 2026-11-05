-- 팀 네트워크 위치(시·구) 폐기 (2026-10-22) — IP 위치 조회가 실측으로 틀렸다
-- (패스트파이브 시청역2호점·서울 재택 회선이 '충북 청주시'로 나옴). 틀린 값은 오해만 남기므로 지우고 더 쓰지 않는다.
-- 장소는 사람이 붙이는 label 이 정답. 통신사(isp)는 할당 기록 기반이라 유지.
UPDATE public.team_networks SET region = NULL, district = NULL;
COMMENT ON COLUMN public.team_networks.region   IS '폐기(2026-10-22) — IP 위치 조회 부정확. label 을 쓸 것';
COMMENT ON COLUMN public.team_networks.district IS '폐기(2026-10-22) — IP 위치 조회 부정확. label 을 쓸 것';
