-- 일회성 데이터 교정: 260622_gacha-platform 를 'applied'(지원 완료)로 복구.
-- 경위: RPC 검증 테스트 중 상태 탭에서 applied→interview 로 변경됨. interview는 상태머신상
--       applied 에서만 올 수 있고, history에 interview 단일 항목뿐이라 원래 상태는 applied 였다.
-- 안전장치: 현재 interview 일 때만 갱신(이미 다르면 no-op). 누적 기록으로 원복 사실을 남긴다.
UPDATE wishket_projects
SET current_status = 'applied',
    history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'status', 'applied',
      'date', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'),
      'note', '↩ 상태 원복 (테스트 중 미팅예정 변경 되돌림)'
    )),
    updated_at = (now() AT TIME ZONE 'Asia/Seoul')::date
WHERE slug = '260622_gacha-platform'
  AND current_status = 'interview';
