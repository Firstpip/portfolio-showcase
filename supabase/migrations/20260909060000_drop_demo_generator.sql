-- ============================================================================
-- 데모 생성기 제거 (사용자 결정: 기능 미사용 확정, 2026-09-09)
-- ----------------------------------------------------------------------------
-- 데모 생성기 관련 스키마를 전부 되돌린다:
--   1) portfolio_links 에서 'Demo' 항목 제거 + portfolio_count 재계산
--   2) wishket_projects 의 데모 전용 컬럼 8개 + CHECK 제약 2개 삭제
--   3) demo_worker_heartbeat 테이블 삭제
--
-- 이전 데모 마이그레이션 파일들은 **지우지 않는다**. 이미 적용 이력이 남아 있어
-- 파일만 없애면 마이그레이션 히스토리가 어긋난다. 되돌리기는 이 파일로 한다.
--
-- 주의: 컬럼 삭제는 데이터 손실이다. spec_raw/spec_structured/demo_artifacts 에
--   담겨 있던 공고 분석 결과와 빌드 메타가 함께 사라진다. 기능을 쓰지 않기로
--   확정했으므로 의도된 삭제다.
-- ============================================================================

DO $$
DECLARE
  n_links int;
  n_status int;
BEGIN
  SELECT count(*) INTO n_links FROM wishket_projects
   WHERE portfolio_links @> '[{"label":"Demo"}]'::jsonb;
  SELECT count(*) INTO n_status FROM wishket_projects WHERE demo_status IS NOT NULL;
  RAISE NOTICE 'Demo 링크 보유 행: %, demo_status 보유 행: %', n_links, n_status;
END $$;

-- 1) portfolio_links 에서 Demo 항목 제거
UPDATE wishket_projects
SET portfolio_links = COALESCE(
      (SELECT jsonb_agg(elem)
         FROM jsonb_array_elements(portfolio_links) elem
        WHERE elem->>'label' IS DISTINCT FROM 'Demo'),
      '[]'::jsonb)
WHERE portfolio_links IS NOT NULL
  AND portfolio_links @> '[{"label":"Demo"}]'::jsonb;

-- portfolio_count 를 실제 링크 수와 다시 맞춘다
UPDATE wishket_projects
SET portfolio_count = jsonb_array_length(COALESCE(portfolio_links, '[]'::jsonb))
WHERE portfolio_count IS DISTINCT FROM jsonb_array_length(COALESCE(portfolio_links, '[]'::jsonb));

-- 2) CHECK 제약 → 컬럼 순으로 삭제
ALTER TABLE wishket_projects DROP CONSTRAINT IF EXISTS wishket_projects_demo_status_check;
ALTER TABLE wishket_projects DROP CONSTRAINT IF EXISTS wishket_projects_regenerate_scope_check;

ALTER TABLE wishket_projects
  DROP COLUMN IF EXISTS demo_status,
  DROP COLUMN IF EXISTS spec_raw,
  DROP COLUMN IF EXISTS spec_structured,
  DROP COLUMN IF EXISTS spec_approved_at,
  DROP COLUMN IF EXISTS demo_artifacts,
  DROP COLUMN IF EXISTS demo_generated_at,
  DROP COLUMN IF EXISTS demo_generation_log,
  DROP COLUMN IF EXISTS regenerate_scope;

-- 3) 워커 생존 신호 테이블
DROP TABLE IF EXISTS demo_worker_heartbeat;

DO $$
DECLARE
  n_cols int;
BEGIN
  SELECT count(*) INTO n_cols FROM information_schema.columns
   WHERE table_name = 'wishket_projects'
     AND column_name IN ('demo_status','spec_raw','spec_structured','spec_approved_at',
                         'demo_artifacts','demo_generated_at','demo_generation_log','regenerate_scope');
  RAISE NOTICE '삭제 후 남은 데모 컬럼 수: % (0 이어야 정상)', n_cols;
END $$;
