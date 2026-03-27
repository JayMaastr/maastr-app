# maastr-encoder

HLS encoding microservice for maastr.io. Converts uploaded WAV files to FLAC-HLS segments for instant streaming.

## Setup (5 minutes)

### 1. Install Fly CLI
```bash
curl -L https://fly.io/install.sh | sh
```

### 2. Deploy to Fly.io
```bash
git clone https://github.com/JayMaastr/maastr-encoder
cd maastr-encoder
fly auth login
fly launch --name maastr-encoder --region iad --yes
```

### 3. Set environment variables
```bash
fly secrets set SUPABASE_SERVICE_KEY="<your-service-key>"
fly secrets set ENCODE_SECRET="<a-random-secret-string>"
fly secrets set R2_WORKER_URL="https://maastr-upload.jay-288.workers.dev"
```

### 4. Add the encoder URL to Vercel
In Vercel project settings, add environment variable:
```
ENCODER_URL=https://maastr-encoder.fly.dev
ENCODE_SECRET=<same-random-secret>
```

## How it works
1. User uploads WAV → R2
2. Vercel `/api/process` extracts 800 peaks → saves to DB (fast, pure JS)
3. Vercel `/api/process` calls this service at `/encode`
4. This service downloads WAV, runs `ffmpeg` to create FLAC-HLS segments
5. Uploads all segments to R2 under `hls/<trackId>/`
6. Updates the track's `hls_url` in Supabase
7. Player uses hls.js to stream from the m3u8 URL
