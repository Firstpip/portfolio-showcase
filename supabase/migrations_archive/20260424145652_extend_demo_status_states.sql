-- demo_status 상태 머신 확장 (T2.1 의존)
-- 기존 마이그레이션(20260424112309)은 'none/generating/ready/failed' 4개만 허용했으나,
-- 설계 SSOT(docs/demo-generator/plan.md §1, §6 T2.1/T4.2)는 추출 단계와 생성 단계의
-- queued/in-progress/failed를 분리한 상태 머신을 요구한다.
--
-- 상태 머신:
--   none           : 데모 작업 미시작 (기본값)
--   extract_queued : 사용자가 "추출" 버튼을 누름 → 워커가 픽업 대기
--   extracting     : 워커가 atomic 전이로 선점, Sonnet 호출 중
--   extract_ready  : spec_structured 저장 완료, 사용자 편집/승인 대기
--   extract_failed : 추출 실패 (워커가 demo_generation_log에 사유 기록)
--   gen_queued     : 사용자 승인 → 워커가 3-pass 생성 픽업 대기
--   generating     : 워커가 3-pass 실행 중
--   ready          : 데모 배포 완료
--   failed         : 생성/배포 실패

ALTER TABLE wishket_projects DROP CONSTRAINT IF EXISTS wishket_projects_demo_status_check;
ALTER TABLE wishket_projects ADD CONSTRAINT wishket_projects_demo_status_check
  CHECK (demo_status IS NULL OR demo_status IN (
    'none',
    'extract_queued',
    'extracting',
    'extract_ready',
    'extract_failed',
    'gen_queued',
    'generating',
    'ready',
    'failed'
  ));
