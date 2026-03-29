FROM python:3.10-slim-bullseye

# Install OS-level audio dependencies
# libasound2 = JUCE/DawDreamer ALSA audio init (critical — without this RenderEngine hangs)
# libsndfile1 = audio file I/O
# libfftw3-3 = DawDreamer FFT backend
# libgomp1 = OpenMP (numpy/scipy)
# ffmpeg = HLS encoding
RUN apt-get update && apt-get install -y --no-install-recommends \
    libasound2 \
    libsndfile1 \
    libfftw3-3 \
    libgomp1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all app code + any future Linux VST3 plugins
COPY . .

# Dedicated temp dir for WAV processing (cleaned up after each job)
RUN mkdir -p /tmp/mastering_zone

EXPOSE 3002
CMD ["python", "main.py"]
