# 공사기간 산정 콘솔 — 데모 백엔드 + 정적 화면 한 컨테이너
# 빌드: docker build -t period-console .    실행: docker compose up -d   (deploy/OPERATIONS.md 참고)
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8765 \
    DEMO_DB=/data/reviews.db DEMO_CACHE_DIR=/data/cache DEMO_VECTOR_DB=/data/vectors.db
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt \
 && useradd -r -u 10001 app && mkdir -p /data/cache && chown -R app:app /data /app
# 화면(index.html)·데이터(표준품셈·기상·국토부 기준·원문 PDF)·서버 코드. 인증키(.env)·캐시·DB 는 이미지에 넣지 않는다
COPY --chown=app:app index.html README.md sample-boq.xlsx sample-boq-road.xlsx sample-boq-format2.xlsx sample-boq-format3.xlsx sample-std-add.xlsx ./
COPY --chown=app:app vendor ./vendor
COPY --chown=app:app data ./data
COPY --chown=app:app server/app.py server/vector_index.py server/docx_report.py server/schema.sql server/pumsem_extract.py ./server/
# 문장 임베딩 모델(multilingual-e5-small 양자화 ONNX, 약 118MB). 없으면 문자 n-gram 방식으로 동작한다
COPY --chown=app:app server/models ./server/models
USER app
VOLUME ["/data"]
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8765/api/health',timeout=4).status==200 else 1)"
WORKDIR /app/server
CMD ["python", "app.py"]
