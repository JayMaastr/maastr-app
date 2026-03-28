import { createClient } from '@supabase/supabase-js';

export const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ============================================================
// CRITICAL: AUDIO URL RULES — DO NOT CHANGE
// ============================================================
// ALL audio files MUST be served through the Cloudflare Worker.
// NEVER use the R2 public dev URL (pub-*.r2.dev) for audio_url
// or mp3_url — it is RATE-LIMITED and returns 503 errors under
// any real usage, breaking playback on every browser/device.
//
// CORRECT:  https://maastr-upload.jay-288.workers.dev/projects/{id}/{file}
// BROKEN:   https://pub-9cf50a4e67b54a7ab86776b8056cacb5.r2.dev/...
//
// The worker serves from the R2 bucket binding directly —
// no rate limit, full CORS, Range/Accept-Ranges headers.
// ============================================================
// CRITICAL: AUDIO ELEMENT PATTERN — DO NOT CHANGE
// ============================================================
// The <audio> element MUST always be mounted unconditionally.
// NEVER do: {audioUrl && <audio src={audioUrl} />}
// iOS Safari won't fire onDurationChange if created with src
// already set — duration stays 0:00 forever.
//
// CORRECT pattern:
//   <audio ref={audioRef} preload="metadata" onDurationChange={...} />
//   useEffect(() => { el.src = audioUrl; el.load(); }, [audioUrl])
// ============================================================

export const GCS_BUCKET_URL = 'https://storage.googleapis.com/maastr-vibedev-audio';
export const UPLOAD_WORKER_URL = 'https://maastr-upload.jay-288.workers.dev';
export const R2_PUBLIC_URL_DO_NOT_USE = 'https://pub-9cf50a4e67b54a7ab86776b8056cacb5.r2.dev';

// Sanitize any audio URL before saving to DB — prevents rate-limit issues.
// Use this on every audio_url / mp3_url write.
export function safeAudioUrl(url) {
  if (!url) return url;
  if (url.includes('pub-9cf50a4e67b54a7ab86776b8056cacb5.r2.dev')) {
    console.error('[maastr] BLOCKED: R2 rate-limited URL intercepted:', url);
    return url.replace(
      'https://pub-9cf50a4e67b54a7ab86776b8056cacb5.r2.dev/',
      UPLOAD_WORKER_URL + '/'
    );
  }
  return url;
}
