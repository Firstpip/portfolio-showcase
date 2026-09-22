# 공사기간 산정 콘솔 — 배포·운영 매뉴얼 (초안)

개발자가 없는 발주사 담당자가 그대로 따라 할 수 있도록 쓴 문서입니다. 명령은 서버(리눅스 또는 사내 PC)의 터미널에 한 줄씩 입력합니다. 이 문서는 파일럿 납품 시 확정본으로 갱신되며, 현재는 데모 백엔드(`demo/server`) 기준의 초안입니다.

## 1. 구성 한눈에 보기

| 구성요소 | 역할 | 어디에 있나 |
|---|---|---|
| 화면 (`index.html`) | 내역서 업로드 → 매핑 → 작업일수 → 기상 → 공정표 → 보고서 | 컨테이너 안, 브라우저로 접속 |
| 서버 (`server/app.py`) | 기상청 API 수집·캐시, 벡터 검색, 검토 저장소, Word 출력 | 컨테이너 안 |
| 기준 데이터 (`data/`) | 표준품셈 658항목, 국토부 산정기준, 24개 지점 기상 10년치, 원문 PDF 3종 | 컨테이너 안 (이미지에 포함) |
| 저장 데이터 (`/data`) | 검토 건·버전 이력(`reviews.db`), 기상 캐시(`cache/`) | **볼륨** — 컨테이너를 지워도 남음 |
| 인증키 (`server/.env`) | 공공데이터포털 기상청 API 키 | 서버 파일, 이미지에 넣지 않음 |

한 대의 서버, 컨테이너 하나, 볼륨 하나입니다. 데이터베이스 서버를 따로 두지 않습니다(실 시스템은 PostgreSQL로 전환하며 스키마는 `server/schema.sql` 그대로).

## 2. 처음 설치 (약 10분)

준비물: Docker가 설치된 서버(리눅스 권장, 2 CPU · 2GB RAM · 디스크 5GB면 충분), 공공데이터포털 계정의 「기상청_지상(종관, ASOS) 일자료 조회서비스」 인증키.

```bash
# 1) 소스 받기 (발주사 저장소)
git clone <발주사 저장소 주소> period-console
cd period-console/demo

# 2) 인증키 파일 만들기
cp server/.env.example server/.env
nano server/.env          # KMA_SERVICE_KEY= 뒤에 인증키(Decoding 값)를 붙여 넣고 저장

# 3) 빌드 + 기동
docker compose up -d --build

# 4) 확인
curl http://127.0.0.1:8765/api/health
```

`{"ok":true,"kma":true,...}`가 나오면 정상입니다. 브라우저에서 `http://<서버 주소>:8765` 로 접속합니다. 기본 포트를 바꾸려면 `CONSOLE_PORT=9000 docker compose up -d` 처럼 실행합니다.

인증키가 없어도 기동됩니다. 이때는 내장 24개 지점(대구·구미·서울·부산 등) 실데이터만 쓰고, 그 외 지점은 시뮬레이션으로 표시됩니다(화면에 명시됨).

## 3. 일상 운영

| 하고 싶은 것 | 명령 |
|---|---|
| 상태 보기 | `docker compose ps` · `curl http://127.0.0.1:8765/api/health` |
| 로그 보기 | `docker compose logs -f --tail 200` |
| 재시작 | `docker compose restart` |
| 중지 / 다시 기동 | `docker compose down` / `docker compose up -d` |
| 새 버전 반영 | `git pull && docker compose up -d --build` |

서버가 재부팅되면 컨테이너는 자동으로 다시 뜹니다(`restart: unless-stopped`). 로그는 10MB × 5개로 자동 회전됩니다.

## 4. 백업과 복구

저장 데이터는 볼륨 `console-data` 하나에 있습니다.

```bash
# 백업 (파일 하나로 묶기)
docker run --rm -v period-console_console-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/console-data-$(date +%Y%m%d).tgz -C /data .

# 복구 (컨테이너를 내린 뒤)
docker compose down
docker run --rm -v period-console_console-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/console-data-YYYYMMDD.tgz -C /data"
docker compose up -d
```

권장 주기: 검토 건을 서버에 저장해 쓰는 경우 매일 새벽 1회(cron). 기상 캐시는 잃어도 API에서 다시 받으므로 검토 저장소(`reviews.db`)만 중요합니다.

## 5. 기준값을 바꾸고 싶을 때 (개발자 없이)

산정 기준은 코드가 아니라 화면 설정과 데이터 파일에 있습니다.

| 바꿀 것 | 어디서 | 재기동 |
|---|---|---|
| 작업 제한 룰(강수 mm, 체감온도, 풍속…), 적용 공종, 휴일 처리 | 화면 「기상·비작업일수」 탭, 프리셋 버튼(국토부 2024 예시 / 발주사 기준) | 불필요 (브라우저에 저장, JSON 내보내기로 공유) |
| 매핑 임계값, 간접·보정일수, 준비·정리기간, 품 할증 | 화면 「설정」 탭 | 불필요 |
| 표준품셈 항목 추가 | 화면 「표준품셈」 탭에서 엑셀 업로드, 또는 `data/standards.js` 편집 | 파일 편집 시 `docker compose up -d --build` |
| 국토부 산정기준 값(준비기간 표, 산식 상수, 부록 값) | `data/molit_basis.js` | 위와 같음 |
| 기상 지점 목록 | `data/stations.js` | 위와 같음 |

파일을 편집한 경우 저장소에 커밋해 두면 이력이 남습니다. 실 시스템에서는 이 설정을 DB로 옮겨 화면에서 개정 이력을 관리합니다.

## 6. 문제가 생겼을 때

| 증상 | 원인 | 조치 |
|---|---|---|
| 화면은 뜨는데 상단 배지가 「오프라인」 | 서버 미기동 또는 포트 차단 | `docker compose ps`, 방화벽에서 8765 허용 |
| `/api/health`에 `"kma":false` | `.env`에 키가 없거나 공백 | `server/.env` 확인 후 `docker compose restart` |
| 기상 수집이 「기상청 API 오류 30」 등으로 실패 | 인증키 미승인·일일 호출 한도 초과(공공데이터포털 기본 1만 건/일) | 포털에서 활용신청 상태 확인, 다음 날 재시도. 캐시된 지점은 영향 없음 |
| 기상 수집이 느림(지점당 10~15초) | 10년치 10회 호출 | 정상. 첫 조회 뒤에는 캐시 사용 |
| `"llm":false` | 컨테이너에는 LLM CLI가 없음 | 데모 백엔드의 AI 서술·문맥 보정은 `claude` CLI가 설치된 호스트에서만 동작. 실 시스템은 LLM API 키 방식으로 교체(`.env`에 키 추가) |
| Word 출력 실패 | python-docx 미설치(이미지 빌드 실패) | `docker compose logs` 확인 후 재빌드 |
| 디스크 부족 | 로그·이미지 누적 | `docker system prune -f` (볼륨은 지우지 않음) |

## 7. 보안·접근

- 컨테이너는 비root 사용자(`app`)로 실행됩니다.
- 인증키는 `server/.env`에만 있고 이미지·저장소에 들어가지 않습니다(`.gitignore`, `.dockerignore`).
- 사내망 밖에 둘 경우 리버스 프록시(nginx 또는 Caddy)로 HTTPS와 접근 제한을 붙입니다. 예시(Caddy): `console.example.com { reverse_proxy 127.0.0.1:8765 }` 한 줄이면 인증서까지 자동입니다.
- 사용자 로그인·권한은 파일럿 범위 밖이며 실 시스템에서 추가합니다.

## 8. 인수인계 체크리스트

- [ ] 발주사 저장소에 전체 소스 푸시, 담당자 계정에 권한 부여
- [ ] `server/.env` 인증키를 발주사 명의 공공데이터포털 계정으로 교체
- [ ] 이 문서대로 발주사 서버에서 처음부터 설치해 보고 화면 동작 확인(설치 소요 시간 기록)
- [ ] 볼륨 백업 1회 실행하고 복구까지 시험
- [ ] 기준값 변경 절차(5절)를 담당자가 직접 1회 수행
- [ ] `server/schema.sql`(DB 스키마)과 `data/`(표준품셈·매핑 기준 데이터) 위치 안내
