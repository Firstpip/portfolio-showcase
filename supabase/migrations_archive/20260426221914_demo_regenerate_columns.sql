-- T4.2: 데모 재생성 (전체/부분) 지원 컬럼 추가.
--
-- regenerate_scope:
--   NULL          → 최초 생성 (T2.4의 handleStartDemoGen). 워커는 'all'과 동일하게 처리.
--   'all'         → 사용자가 "전체 재생성" 클릭. 3-pass 전체 재실행.
--   'flow:<id>'   → 사용자가 특정 플로우만 재생성 클릭. Pass B를 해당 flow_id에 대해서만
--                   재호출하고 캐시된 skeleton/seed/타 flow patches는 재사용.
--
-- demo_artifacts:
--   3-pass 산출물(skeleton HTML, patches, seed, design tokens)을 보관. 부분 재생성 시
--   캐시처럼 읽어 변경되지 않은 단계를 건너뛴다. 최초 생성 성공 시 채워지고, 이후 매
--   재생성마다 갱신된다.
--   스키마 (느슨하게 — 워커 코드가 고정):
--     {
--       "skeleton": "<!DOCTYPE html>...",
--       "patches": [{ "flow_id": "...", "tier": 1, "component_name": "...", "component_code": "...", ... }],
--       "seed": { "<entity>": [...records...] },
--       "tokens": { "primary": "...", "secondary": "...", ... },
--       "generated_at": "2026-04-27T..."
--     }

ALTER TABLE wishket_projects ADD COLUMN IF NOT EXISTS regenerate_scope TEXT;
ALTER TABLE wishket_projects ADD COLUMN IF NOT EXISTS demo_artifacts JSONB;

-- regenerate_scope의 형식을 가볍게 강제 (NULL/'all'/'flow:[a-zA-Z0-9_-]+').
-- 잘못된 값이 들어가면 워커가 'all'로 폴백하므로 런타임 안전성은 OK지만
-- 대시보드 버그를 빨리 발견하려고 CHECK를 둔다.
ALTER TABLE wishket_projects DROP CONSTRAINT IF EXISTS wishket_projects_regenerate_scope_check;
ALTER TABLE wishket_projects ADD CONSTRAINT wishket_projects_regenerate_scope_check
  CHECK (regenerate_scope IS NULL OR regenerate_scope = 'all' OR regenerate_scope ~ '^flow:[A-Za-z0-9_-]+$');
