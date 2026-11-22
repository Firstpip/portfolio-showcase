-- 경쟁 강도 표에 '지원자 비공개' 공고도 남긴다 (2026-11-23)
--
-- 위시켓 목록 카드 중 클라이언트가 지원자 수를 숨긴 공고('지원자 비공개')는 숫자가 없어 기록에서 통째로 빠졌다
--   (실제 지원한 #159701·#159706·#159684·#159677 도 기록 없음). 모니터(wishket-portfolio-system recordCompetition,
--   커밋 32c73be)가 이제 그 카드를 applicants=NULL 행으로 보낸다. NULL = 비공개, 숫자 = 그날 본 지원자 수.
-- 기존 행은 전부 숫자라 바뀌지 않는다. 되돌리기: 비공개 행(applicants IS NULL)을 지운 뒤 SET NOT NULL.
ALTER TABLE public.wishket_competition ALTER COLUMN applicants DROP NOT NULL;
