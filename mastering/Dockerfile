FROM python:3.10-slim-bullseye

# Audio: libasound2 (JUCE/ALSA), libsndfile1, libfftw3-3 (DawDreamer FFT), libgomp1, ffmpeg
# Display: libx11-6 libxext6 libgl1-mesa-glx xvfb xauth (fake display for JUCE headless)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libasound2 \
    libsndfile1 \
    libfftw3-3 \
    libgomp1 \
    ffmpeg \
    libx11-6 \
    libxext6 \
    libgl1-mesa-glx \
    xvfb \
    xauth \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /tmp/mastering_zone

EXPOSE 8080

# Cloud Run sets PORT env var — Gunicorn binds to it
# 1 worker + threads: Cloud Run handles parallelism by spawning new container instances
CMD exec gunicorn --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 1 --timeout 300 main:app
