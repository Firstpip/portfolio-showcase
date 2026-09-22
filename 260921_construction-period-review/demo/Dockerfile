# 공사기간 산정 콘솔 — 데모 백엔드 + 정적 화면 한 컨테이너
# 빌드: docker build -t period-console .    실행: docker compose up -d   (deploy/OPERATIONS.md 참고)
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8765 \
    DEMO_DB=/data/reviews.db DEMO_CACHE_DIR=/data/cache
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
# 화면(index.html)·데이터(표준품셈·기상·국토부 기준·원문 PDF)·서버 코드. 인증키(.env)·캐시·DB 는 이미지에 넣지 않는다
COPY index.html README.md sample-boq.xlsx sample-boq-road.xlsx ./
COPY data ./data
COPY server/app.py server/vector_index.py server/docx_report.py server/schema.sql server/pumsem_extract.py ./server/
RUN mkdir -p /data/cache && useradd -r -u 10001 app && chown -R app:app /app /data
USER app
VOLUME ["/data"]
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8765/api/health',timeout=4).status==200 else 1)"
WORKDIR /app/server
CMD ["python", "app.py"]
