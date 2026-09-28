#!/usr/bin/env bash
# 문장 임베딩 모델 받기 (multilingual-e5-small 양자화 ONNX, 약 135MB). 저장소에는 넣지 않으므로 설치 시 1회 실행한다.
# 모델이 없어도 서버는 동작한다 — 벡터 검색이 문자 n-gram 방식으로 자동 대체된다.
set -e
cd "$(dirname "$0")"; mkdir -p models/e5-small; cd models/e5-small
BASE=https://huggingface.co/Xenova/multilingual-e5-small/resolve/main
[ -s tokenizer.json ] || curl -L --fail -o tokenizer.json "$BASE/tokenizer.json"
[ -s config.json ] || curl -L --fail -o config.json "$BASE/config.json"
[ -s model_quantized.onnx ] || curl -L --fail -o model_quantized.onnx "$BASE/onnx/model_quantized.onnx"
ls -la; echo "완료 — 서버를 다시 시작하면 /api/health 의 vector 항목에 '문장 임베딩'이 표시됩니다."
