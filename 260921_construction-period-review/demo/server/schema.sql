-- 공사기간 산정 콘솔 — 검토 저장소 스키마 (SQLite 데모용 / 실 시스템은 PostgreSQL 동일 구조)
-- reviews         : 검토 건(현장 + 내역서 단위). 최신 요약값을 함께 보관해 목록 조회가 빠르다.
-- review_versions : 검토 건의 저장 이력. payload 는 화면 상태 전체(JSON), summary 는 비교용 핵심 수치.
CREATE TABLE IF NOT EXISTS reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site_name     TEXT NOT NULL,
  region        TEXT,
  station       TEXT,
  file_name     TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',      -- draft | reviewing | approved
  latest_version INTEGER NOT NULL DEFAULT 0,
  summary       TEXT NOT NULL DEFAULT '{}',          -- JSON: 최신 버전 요약
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS review_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id   INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  note        TEXT,
  author      TEXT,
  summary     TEXT NOT NULL DEFAULT '{}',            -- JSON: 총공기·작업일·비작업일·판정·매핑률 등
  payload     TEXT NOT NULL,                         -- JSON: 현장·내역서·매핑·설정·선후행 전체 상태
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(review_id, version)
);
CREATE INDEX IF NOT EXISTS idx_versions_review ON review_versions(review_id, version DESC);
