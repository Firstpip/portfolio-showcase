-- 데모 생성기(demo generator)용 컬럼 추가
-- 공고 원문 → LLM 추출 spec → 3-pass 생성 → 단일 HTML 배포의 전 과정 상태를 wishket_projects에 기록한다.
-- 설계 SSOT: docs/demo-generator/plan.md §2.1

ALTER TABLE wishket_projects
  ADD COLUMN IF NOT EXISTS spec_raw            TEXT,
  ADD COLUMN IF NOT EXISTS spec_structured     JSONB,
  ADD COLUMN IF NOT EXISTS spec_approved_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS demo_status         TEXT,
  ADD COLUMN IF NOT EXISTS demo_generated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS demo_generation_log JSONB;

-- demo_status 허용값: none / generating / ready / failed
-- NULL은 '아직 데모 생성 단계에 들어가지 않은 기존 레코드'를 뜻하며 허용.
-- 기존 제약이 있을 수 있으므로 멱등성 확보를 위해 DROP 후 재생성.
ALTER TABLE wishket_projects DROP CONSTRAINT IF EXISTS wishket_projects_demo_status_check;
ALTER TABLE wishket_projects ADD CONSTRAINT wishket_projects_demo_status_check
  CHECK (demo_status IS NULL OR demo_status IN ('none', 'generating', 'ready', 'failed'));
