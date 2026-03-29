FROM python:3.10-slim-bullseye

# Install OS-level audio dependencies
# libasound2 is for JUCE/DawDreamer to initialize the headless audio engine
# libsndfile1 is required for reading/writing standard audio formats
# libfftw3-3 is DawDreamer's FFT backend
# libgomp1 is required by numpy/scipy
# ffmpeg is for HLS encoding
RUN apt-get update && apt-get install -y \
    libasound2 \
    libsndfile1 \
    libfftw3-3 \
    libgomp1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all app code (includes main.py and any future VST plugins)
COPY . .

# Create dedicated temp directory for WAV processing
RUN mkdir -p /tmp/mastering_zone

EXPOSE 3002
CMD ["python", "main.py"]
