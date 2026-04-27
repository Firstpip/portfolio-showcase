-- T7.1: 1-click 자동 파이프라인용 demo_status 상태 3개 추가
-- 설계 SSOT: docs/demo-generator/plan.md §6 Phase 7
--
-- 새 상태:
--   autorun_queued : 사용자가 "🎬 데모 생성" 1-click 트리거 → 워커 픽업 대기
--   fetching       : 워커가 atomic 선점 후 wishket_url 에서 본문 수집 중
--   fetch_failed   : wishket fetch 실패 (login 깨짐 / URL 무효 / 세션 만료 등)
--
-- 기존 상태 11개와 합쳐 총 12개 상태. 자동 chain:
--   none → autorun_queued → fetching → extract_queued → extracting
--        → extract_ready → gen_queued → generating → ready
--   (실패 분기: fetch_failed / extract_failed / failed)

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
    'ready',
    'failed'
  ));
