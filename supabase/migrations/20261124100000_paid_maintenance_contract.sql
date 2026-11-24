-- 유상 유지보수 계약 (2026-11-24 사용자 요청)
--
-- '유지보수(유상)' 프로젝트는 개발 대금(budget)과 별개인 유지보수 계약으로 관리한다.
--   계약 체결일 + 기간(개월) → 만료일(화면이 dashboard/src/paidmaint.mjs paidUntil 로 계산해 함께 저장),
--   계약대금(만원, 공급가·부가세 별도)과 그 단위(월/연).
-- 모두 NULL 허용 — 다른 상태의 프로젝트와 기존 행에는 영향이 없다. '유지보수(유상)'으로 넘길 때 화면이 필수로 받는다.
-- 저장은 화면이 테이블에 직접 쓴다(무상 만료일 free_maint_until 과 같은 경로, 팀원 RLS 그대로).
ALTER TABLE public.wishket_projects
  ADD COLUMN IF NOT EXISTS paid_maint_start date,
  ADD COLUMN IF NOT EXISTS paid_maint_months smallint,
  ADD COLUMN IF NOT EXISTS paid_maint_until date,
  ADD COLUMN IF NOT EXISTS paid_maint_fee numeric(10,1),
  ADD COLUMN IF NOT EXISTS paid_maint_fee_unit text;

ALTER TABLE public.wishket_projects DROP CONSTRAINT IF EXISTS wishket_projects_paid_maint_check;
ALTER TABLE public.wishket_projects ADD CONSTRAINT wishket_projects_paid_maint_check CHECK (
  (paid_maint_months IS NULL OR paid_maint_months BETWEEN 1 AND 120)
  AND (paid_maint_until IS NULL OR paid_maint_start IS NULL OR paid_maint_until >= paid_maint_start)
  AND (paid_maint_fee IS NULL OR (paid_maint_fee > 0 AND paid_maint_fee <= 100000))
  AND (paid_maint_fee_unit IS NULL OR paid_maint_fee_unit IN ('month', 'year'))
);

COMMENT ON COLUMN public.wishket_projects.paid_maint_start IS '유상 유지보수 계약 체결일(시작일)';
COMMENT ON COLUMN public.wishket_projects.paid_maint_months IS '유상 유지보수 계약 기간(개월) — 12=1년, 24=2년';
COMMENT ON COLUMN public.wishket_projects.paid_maint_until IS '유상 유지보수 계약 만료일 — 체결일 포함 기간의 마지막 날';
COMMENT ON COLUMN public.wishket_projects.paid_maint_fee IS '유상 유지보수 계약대금(만원, 공급가·부가세 별도)';
COMMENT ON COLUMN public.wishket_projects.paid_maint_fee_unit IS '계약대금 단위: month(월) | year(연)';
