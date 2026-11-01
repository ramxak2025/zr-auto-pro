FROM debian:bookworm-slim
RUN apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=1 -o Acquire::http::Timeout=25 update \
 && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=1 -o Acquire::http::Timeout=25 install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-rus tesseract-ocr-eng tesseract-ocr-osd python3 python3-opencv python3-pil fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV OMP_THREAD_LIMIT=1 OPENBLAS_NUM_THREADS=1 OPENCV_FOR_THREADS_NUM=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY ocr_core.py worker.py benchmark.py test_core.py smoke.py /app/
RUN chmod -R a=rX /app
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["python3", "/app/worker.py"]
