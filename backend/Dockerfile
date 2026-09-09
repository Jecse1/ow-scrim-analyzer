FROM python:3.9-slim

WORKDIR /app

# 시스템 의존성 설치 (최신 패키지명 반영)
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]