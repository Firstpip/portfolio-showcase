-- 일회성 데이터 교정: 260526_kiosk-o2o-platform 를 사용자가 의도한 'won'(계약 논의 중)으로 복구.
-- 경위: in_progress → won 수동 되돌리기를 했으나, transition_passed_start_dates(착수일 경과 자동 전환)가
--       대시보드 로드 시 다시 in_progress 로 끌어올려 되돌리기가 무효화됐다.
-- 직전 마이그레이션(20260623120000)에서 자동 전이를 '1회성'으로 가드했으므로, 이제 복구가 유지된다.
-- 안전장치: current_status='in_progress' 일 때만 갱신(이미 won 이면 no-op), 다른 환경에선 해당 slug 없으면 no-op.

UPDATE wishket_projects
SET current_status = 'won',
    history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'status', 'won',
      'date', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'),
      'note', '↩ 이전 상태로 되돌리기 (개발 중 → 계약 논의 중, 자동전환 가드 적용)'
    )),
    updated_at = (now() AT TIME ZONE 'Asia/Seoul')::date
WHERE slug = '260526_kiosk-o2o-platform'
  AND current_status = 'in_progress';
