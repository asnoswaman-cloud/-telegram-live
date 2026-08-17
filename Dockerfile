FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir aiogram==3.20.0 && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "main.py"]
