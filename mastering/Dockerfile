FROM python:3.10-slim-bullseye

# Audio deps: libasound2 = ALSA/JUCE init (critical), libsndfile1 = audio I/O,
#             libfftw3-3 = DawDreamer FFT, libgomp1 = OpenMP, ffmpeg = HLS
# Display deps: libx11-6 libxext6 libgl1-mesa-glx xvfb = fake display for JUCE/VST
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

# Copy all app code + future Linux VST3 plugins (.so files)
COPY . .

# Temp dir for audio processing (always cleaned up after each job)
RUN mkdir -p /tmp/mastering_zone

EXPOSE 3002

# xvfb-run creates a fake X11 display — prevents JUCE/VST from crashing
# on headless Railway containers that have no monitor
CMD ["xvfb-run", "-a", "python", "main.py"]
