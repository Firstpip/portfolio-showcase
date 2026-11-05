-- T8.1 (Phase 8): demo_status 에 'building' 상태 추가
-- 설계 SSOT: docs/demo-generator/plan.md §6 Phase 8
--
-- 기존 'generating' 은 Pass A/B/C LLM 호출 단계였음. Phase 8 부터는
-- generate 가 두 단계로 분리됨:
--   - generating : LLM 이 src/ 트리 생성 (10~15분)
--   - building   : 임시 디렉토리에서 vite build 실행 + dist 추출 (30s~1분)
--
-- 'building' 단계 분리 이유:
--   1. dashboard 라벨에 "🔨 빌드 중" 같이 표시 가능 (사용자 진행 가시성)
--   2. demo_generation_log 의 stage 구분 명확화
--   3. 향후 build 만 재시도 (LLM 결과 캐시 + npm run build 재실행) 같은 분리 동작 가능
--
-- 기존 12 상태 + 'building' = 총 13 상태.

ALTER TABLE wishket_projects DROP CONSTRAINT IF EXISTS wishket_projects_demo_status_check;
ALTER TABLE wishket_projects ADD CONSTRAINT wishket_projects_demo_status_check
  CHECK (demo_status IS NULL OR demo_status IN (
    'none',
    'autorun_queued',
    'fetching',
    'fetch_failed',
    'extract_queued',
    'extracting',
    'extract_ready',
    'extract_failed',
    'gen_queued',
    'generating',
    'building',
    'ready',
    'failed'
  ));
