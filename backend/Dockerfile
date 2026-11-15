FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /workspace

# Install minimal system libs needed by rasterio / numpy /pillow wheels and healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    libexpat1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first for layer caching
COPY requirements.txt /workspace/requirements.txt
COPY backend/pyproject.toml /workspace/backend/pyproject.toml

RUN pip install --upgrade pip && \
    pip install -r /workspace/requirements.txt && \
    pip install \
      "fastapi>=0.115" \
      "uvicorn[standard]>=0.30" \
      "pydantic>=2.8" \
      "numpy>=2.0" \
      "pandas>=2.2" \
      "pyarrow>=18.0" \
      "scikit-learn>=1.5" \
      "Pillow>=10.4" \
      "rasterio>=1.3" \
      "boto3>=1.34" \
      "httpx>=0.27"

# Copy repo layout preserving relative paths expected by ecocrop_model.py and point_service.py
COPY ecocrop.parquet /workspace/ecocrop.parquet
COPY scraper /workspace/scraper
COPY pipeline /workspace/pipeline
COPY backend /workspace/backend

RUN mkdir -p /workspace/data/cache /workspace/data/raw /workspace/backend/.cache/live

ENV AGROX_DATA_MODE=live \
    AGROX_DATA_SOURCE=auto \
    AGROX_CORS_ORIGINS=https://agrox.tecnodesarrollo.site,http://127.0.0.1:4000

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "/workspace/backend", "--host", "0.0.0.0", "--port", "8000"]
