# maastr mastering service v4.1
# DawDreamer-native processing:
#   EQ: make_filter_processor high_shelf inside the engine graph
#   Gain: numpy multiply on get_audio() output (scalar â effectively free)
import os, base64, tempfile, subprocess, threading, time
from pathlib import Path
import numpy as np
import requests
import soundfile as sf
from flask import Flask, request, jsonify

app = Flask(__name__)

SECRET       = os.environ.get('MASTERING_SECRET', '')
GCS_BUCKET   = os.environ.get('GCS_BUCKET_NAME', 'maastr-vibedev-audio')
GCS_KEY_B64  = os.environ.get('GCS_SERVICE_ACCOUNT_KEY', '')
SUPABASE_URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
PORT         = int(os.environ.get('PORT', 3002))
VERCEL_URL   = os.environ.get('VERCEL_URL', '')

# (gain_db, shelf_db)
# Loud=+4dB | Normal=+2dB | Gentle=+1dB
# Bright=+5dB high shelf at 8kHz | Warm=-5dB | Neutral=0dB
PRESETS = {
    'W+L': (4.0, -5.0),
    'N+L': (4.0,  0.0),
    'B+L': (4.0,  5.0),
    'W+N': (2.0, -5.0),
    'N+N': (2.0,  0.0),
    'B+N': (2.0,  5.0),
    'W+S': (1.0, -5.0),
    'N+S': (1.0,  0.0),
    'B+S': (1.0,  5.0),
}

def log(msg):
    print(f"[maastr] {msg}", flush=True)

def patch_supabase(master_id, data):
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }
    r = requests.patch(
        f'{SUPABASE_URL}/rest/v1/masters?id=eq.{master_id}',
        json=data, headers=headers
    )
    log(f"supabase patch {master_id[:8]} -> {r.status_code}")

def gcs_upload(local_path, gcs_key):
    import json as _json, time as _time, base64 as _b64
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.backends import default_backend
    key_info = _json.loads(base64.b64decode(GCS_KEY_B64))
    pk = serialization.load_pem_private_key(
        key_info['private_key'].encode(), password=None, backend=default_backend()
    )
    now = int(_time.time())
    claim = {
        'iss': key_info['client_email'],
        'scope': 'https://www.googleapis.com/auth/devstorage.read_write',
        'aud': 'https://oauth2.googleapis.com/token',
        'exp': now + 3600, 'iat': now
    }
    hdr = _b64.urlsafe_b64encode(_json.dumps({'alg':'RS256','typ':'JWT'}).encode()).rstrip(b'=')
    pay = _b64.urlsafe_b64encode(_json.dumps(claim).encode()).rstrip(b'=')
    sig_input = hdr + b'.' + pay
    sig = pk.sign(sig_input, padding.PKCS1v15(), hashes.SHA256())
    jwt = sig_input + b'.' + _b64.urlsafe_b64encode(sig).rstrip(b'=')
    tok = requests.post(
        'https://oauth2.googleapis.com/token',
        data={'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': jwt.decode()}
    ).json()['access_token']
    with open(local_path, 'rb') as f:
        data = f.read()
    ext = Path(local_path).suffix
    ct = 'audio/wav' if ext == '.wav' else 'video/mp2t' if ext == '.ts' else 'application/x-mpegURL'
    r = requests.put(
        f'https://storage.googleapis.com/{GCS_BUCKET}/{gcs_key}',
        headers={'Authorization': f'Bearer {tok}', 'Content-Type': ct},
        data=data
    )
    r.raise_for_status()
    return f'https://storage.googleapis.com/{GCS_BUCKET}/{gcs_key}'

def run_ffmpeg_hls(wav_path, out_dir):
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    cmd = [
        'ffmpeg', '-y', '-i', wav_path,
        '-c:a', 'aac', '-b:a', '192k',
        '-hls_time', '6', '-hls_playlist_type', 'vod',
        '-hls_segment_filename', f'{out_dir}/seg%03d.ts',
        f'{out_dir}/playlist.m3u8'
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {r.stderr[-300:]}")

def process_master(master_id, revision_id, project_id, audio_url, preset):
    t0 = time.time()
    try:
        log(f"START master_id={master_id[:8]} preset={preset}")
        gain_db, shelf_db = PRESETS.get(preset, (2.0, 0.0))

        # Step 1: download
        log("step 1: downloading WAV...")
        r = requests.get(audio_url, timeout=120)
        r.raise_for_status()
        log(f"step 1: downloaded {len(r.content)//1024}KB in {time.time()-t0:.1f}s")

        with tempfile.TemporaryDirectory() as tmpdir:
            src_wav = f"{tmpdir}/input.wav"
            with open(src_wav, 'wb') as f:
                f.write(r.content)
            del r

            # Step 2: read WAV
            # sf.read always_2d=True -> (frames, channels)
            log("step 2: reading WAV...")
            audio_data, sample_rate = sf.read(src_wav, always_2d=True, dtype='float32')
            num_frames   = audio_data.shape[0]
            num_channels = audio_data.shape[1]
            duration_sec = num_frames / sample_rate
            log(f"step 2: {num_frames} frames, {num_channels}ch, {sample_rate}Hz, {duration_sec:.1f}s")

            # Step 3: DawDreamer processing
            # Per docs: make_playback_processor expects (channels, frames)
            log(f"step 3: DawDreamer â gain={gain_db}dB shelf={shelf_db}dB@8kHz (100% inside engine)...")
            import dawdreamer as daw

            engine = daw.RenderEngine(sample_rate, 512)
            audio_chf = np.ascontiguousarray(audio_data.T, dtype=np.float32)  # (channels, frames)
            playback = engine.make_playback_processor("playback", audio_chf)

            # Gain node â Faust processor inside DawDreamer engine
            gain_proc = engine.make_faust_processor("gain")
            gain_proc.set_dsp_string(
                f"import(\"stdfaust.lib\"); "
                f"gain = {float(10 ** (gain_db / 20.0)):.6f}; "
                f"process = _*gain, _*gain;"
            )

            # Build graph: playback [â shelf if EQ] â gain â output
            if shelf_db != 0.0:
                shelf = engine.make_filter_processor("shelf", "high_shelf", 8000.0, 0.707, shelf_db)
                engine.load_graph([
                    (playback, []),
                    (shelf,    [playback.get_name()]),
                    (gain_proc, [shelf.get_name()])
                ])
            else:
                engine.load_graph([
                    (playback, []),
                    (gain_proc, [playback.get_name()])
                ])

            # engine.render() takes SECONDS as a float
            engine.render(duration_sec)
            out = engine.get_audio()  # (channels, frames) â already processed by DawDreamer

            log(f"step 3: done in {time.time()-t0:.1f}s | "
                f"in_peak={float(np.max(np.abs(audio_chf))):.4f} "
                f"out_peak={float(np.max(np.abs(out))):.4f} shape={out.shape}")

            # Step 4: write 24-bit WAV â no post-processing, DawDreamer output direct to disk
            out_gained = np.clip(out.T, -1.0, 1.0).astype(np.float32)  # clip only, no gain
            out_wav = f"{tmpdir}/mastered.wav"
            sf.write(out_wav, out_gained, sample_rate, subtype='PCM_24')
            log(f"step 4: wrote {Path(out_wav).stat().st_size//1024}KB in {time.time()-t0:.1f}s | "
                f"final_peak={float(np.max(np.abs(out_gained))):.4f}")

            mono = np.abs(out_gained.mean(axis=1))
            bucket = max(1, len(mono) // 800)
            peaks = [float(np.max(mono[i*bucket:(i+1)*bucket])) for i in range(800)]

            # Step 5: upload WAV
            gcs_wav_key = f"projects/{project_id}/masters/{revision_id}/{master_id}/mastered.wav"
            log("step 5: uploading WAV to GCS...")
            audio_public_url = gcs_upload(out_wav, gcs_wav_key)
            log(f"step 5: uploaded in {time.time()-t0:.1f}s")

            # Step 6: trigger fast HLS encode via encoder service
            log("step 6: sending to encoder service for HLS...")
            patch_supabase(master_id, {
                'audio_url': audio_public_url,
                'peaks': peaks,
            })
            if VERCEL_URL:
                try:
                    requests.post(
                        f"{VERCEL_URL}/api/encode-master",
                        json={
                            'masterId': master_id,
                            'projectId': project_id,
                            'audioUrl': audio_public_url,
                            'secret': SECRET
                        },
                        timeout=10
                    )
                    log(f"step 6: encode-master triggered in {time.time()-t0:.1f}s")
                except Exception as enc_err:
                    log(f"step 6: encode-master call failed: {enc_err}")
                    patch_supabase(master_id, {'status': 'failed', 'error': f'encoder: {str(enc_err)[:200]}'})
            else:
                log("step 6: VERCEL_URL not set, skipping HLS")
            log(f"DONE in {time.time()-t0:.1f}s")

    except Exception as e:
        log(f"ERROR: {e}")
        import traceback; traceback.print_exc()
        patch_supabase(master_id, {'status': 'failed', 'error': str(e)[:500]})


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'maastr-mastering', 'version': '4.1'})


@app.route('/master', methods=['POST'])
def master():
    data = request.get_json()
    if data.get('secret') != SECRET:
        return jsonify({'error': 'unauthorized'}), 401
    master_id   = data['masterId']
    revision_id = data['revisionId']
    project_id  = data['projectId']
    audio_url   = data['audioUrl']
    preset      = data['preset']
    log(f"received /master request: {preset} master_id={master_id[:8]}")
    patch_supabase(master_id, {'status': 'processing'})
    t = threading.Thread(
        target=process_master,
        args=(master_id, revision_id, project_id, audio_url, preset),
        daemon=False
    )
    t.start()
    return jsonify({'status': 'processing', 'masterId': master_id})


if __name__ == '__main__':
    log(f"starting on port {PORT}")
    app.run(host='0.0.0.0', port=PORT, threaded=True)
