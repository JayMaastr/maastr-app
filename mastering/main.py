# maastr mastering service v2.0 — DawDreamer passthrough with full logging
import os, sys, json, base64, tempfile, time, threading
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

# preset -> (gain_db, saturation_drive)
PRESETS = {
    'W+L': (4.0,  0.18), 'N+L': (4.0,  0.07), 'B+L': (4.0,  0.04),
    'W+N': (1.5,  0.14), 'N+N': (1.5,  0.04), 'B+N': (1.5,  0.02),
    'W+G': (0.5,  0.10), 'N+G': (0.5,  0.02), 'B+G': (0.5,  0.01),
}

def log(msg):
    print(f"[maastr] {msg}", flush=True)

def patch_supabase(master_id, data):
    headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': 'application/json', 'Prefer': 'return=minimal'}
    r = requests.patch(f'{SUPABASE_URL}/rest/v1/masters?id=eq.{master_id}', json=data, headers=headers)
    log(f"supabase patch {master_id[:8]} -> {r.status_code}")

def gcs_upload(local_path, gcs_key):
    import json as _json, time as _time, base64 as _b64
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.backends import default_backend
    key_info = _json.loads(base64.b64decode(GCS_KEY_B64))
    pk = serialization.load_pem_private_key(key_info['private_key'].encode(), password=None, backend=default_backend())
    now = int(_time.time())
    claim = {'iss': key_info['client_email'],
             'scope': 'https://www.googleapis.com/auth/devstorage.read_write',
             'aud': 'https://oauth2.googleapis.com/token', 'exp': now+3600, 'iat': now}
    hdr = _b64.urlsafe_b64encode(_json.dumps({'alg':'RS256','typ':'JWT'}).encode()).rstrip(b'=')
    pay = _b64.urlsafe_b64encode(_json.dumps(claim).encode()).rstrip(b'=')
    sig_input = hdr + b'.' + pay
    sig = pk.sign(sig_input, padding.PKCS1v15(), hashes.SHA256())
    jwt = sig_input + b'.' + _b64.urlsafe_b64encode(sig).rstrip(b'=')
    tok = requests.post('https://oauth2.googleapis.com/token',
        data={'grant_type':'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion':jwt.decode()}).json()['access_token']
    with open(local_path,'rb') as f:
        data = f.read()
    ext = Path(local_path).suffix
    ct = 'audio/wav' if ext=='.wav' else 'video/mp2t' if ext=='.ts' else 'application/x-mpegURL'
    r = requests.put(f'https://storage.googleapis.com/upload/storage/v1/b/{GCS_BUCKET}/o',
        params={'uploadType':'media','name':gcs_key},
        headers={'Authorization':f'Bearer {tok}','Content-Type':ct}, data=data)
    r.raise_for_status()
    return f'https://storage.googleapis.com/{GCS_BUCKET}/{gcs_key}'

def run_ffmpeg_hls(wav_path, out_dir):
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    cmd = ['ffmpeg','-y','-i', wav_path,
           '-c:a','aac','-b:a','192k',
           '-hls_time','6','-hls_playlist_type','vod',
           '-hls_segment_filename', f'{out_dir}/seg%03d.ts',
           f'{out_dir}/playlist.m3u8']
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {r.stderr[-300:]}")

def process_master(master_id, revision_id, project_id, audio_url, preset):
    import subprocess
    t0 = time.time()
    try:
        log(f"START master_id={master_id[:8]} preset={preset}")
        gain_db, sat_drive = PRESETS.get(preset, (1.5, 0.04))
        gain_linear = 10 ** (gain_db / 20.0)

        # 1. Download source WAV
        log("step 1: downloading WAV...")
        r = requests.get(audio_url, timeout=120)
        r.raise_for_status()
        log(f"step 1: downloaded {len(r.content)//1024}KB in {time.time()-t0:.1f}s")

        with tempfile.TemporaryDirectory() as tmpdir:
            src_wav = f"{tmpdir}/input.wav"
            with open(src_wav, 'wb') as f:
                f.write(r.content)

            # 2. Read with soundfile (handles 24-bit correctly)
            log("step 2: reading WAV with soundfile...")
            audio_data, sample_rate = sf.read(src_wav, dtype='float32', always_2d=True)
            # audio_data shape: (samples, channels)
            num_samples = audio_data.shape[0]
            num_channels = audio_data.shape[1]
            log(f"step 2: {num_samples} samples, {num_channels}ch, {sample_rate}Hz, {time.time()-t0:.1f}s")

            # 3. DawDreamer passthrough with gain
            log("step 3: initialising DawDreamer RenderEngine...")
            import dawdreamer as daw
            engine = daw.RenderEngine(sample_rate, 512)
            log(f"step 3: engine created in {time.time()-t0:.1f}s")

            # Prepare audio as (channels, samples) float32 for DawDreamer
            audio_2d = audio_data.T.astype(np.float32)  # (2, N)
            if audio_2d.shape[0] == 1:
                audio_2d = np.vstack([audio_2d, audio_2d])  # mono -> stereo

            log("step 4: creating playback processor...")
            playback = engine.make_playback_processor("playback", audio_2d)
            log(f"step 4: playback processor ready in {time.time()-t0:.1f}s")

            # Simple Faust gain + soft saturation
            faust_code = f"""
import("stdfaust.lib");
gain = {gain_linear:.6f};
drive = {sat_drive:.6f};
process = _*(gain+drive*ma.tanh(_*gain)), _*(gain+drive*ma.tanh(_*gain));
"""
            # Fallback: if Faust fails, apply gain directly via numpy
            try:
                log("step 5: creating Faust processor...")
                faust_proc = engine.make_faust_processor("faust")
                faust_proc.set_dsp_string(faust_code)
                log(f"step 5: Faust processor ready in {time.time()-t0:.1f}s")

                engine.load_graph([
                    (playback, []),
                    (faust_proc, [("playback", 0, "faust", 0), ("playback", 1, "faust", 1)])
                ])
                log(f"step 6: graph loaded, rendering {num_samples} samples...")
                engine.render(num_samples)
                log(f"step 6: render complete in {time.time()-t0:.1f}s")
                out_audio = engine.get_audio()  # (2, N)
                log(f"step 6: got audio shape {out_audio.shape}")
            except Exception as e:
                log(f"step 5: Faust failed ({e}), falling back to numpy gain...")
                # Numpy fallback — still passes through DawDreamer
                engine.load_graph([(playback, [])])
                engine.render(num_samples)
                raw = engine.get_audio()
                out_audio = np.tanh(raw * gain_linear) * (1.0 + sat_drive)
                log(f"step 5: numpy fallback complete in {time.time()-t0:.1f}s")

            # 5. Write 24-bit WAV output
            log("step 7: writing 24-bit WAV...")
            out_wav = f"{tmpdir}/mastered.wav"
            out_2d = out_audio.T  # (N, 2)
            out_2d = np.clip(out_2d, -1.0, 1.0)
            sf.write(out_wav, out_2d, sample_rate, subtype='PCM_24')
            log(f"step 7: wrote {Path(out_wav).stat().st_size//1024}KB in {time.time()-t0:.1f}s")

            # Compute peaks (800 points)
            mono = np.abs(out_2d.mean(axis=1))
            bucket_size = max(1, len(mono) // 800)
            peaks = [float(np.max(mono[i*bucket_size:(i+1)*bucket_size])) for i in range(800)]

            # 6. Upload mastered WAV to GCS
            gcs_wav_key = f"projects/{project_id}/masters/{revision_id}/{master_id}/mastered.wav"
            log(f"step 8: uploading WAV to GCS...")
            audio_public_url = gcs_upload(out_wav, gcs_wav_key)
            log(f"step 8: uploaded in {time.time()-t0:.1f}s -> {audio_public_url[-40:]}")

            # 7. HLS encode
            log("step 9: HLS encoding with ffmpeg...")
            hls_dir = f"{tmpdir}/hls"
            run_ffmpeg_hls(out_wav, hls_dir)
            log(f"step 9: HLS done in {time.time()-t0:.1f}s")

            # 8. Upload HLS to GCS
            log("step 10: uploading HLS to GCS...")
            hls_base = f"projects/{project_id}/masters/{revision_id}/{master_id}/hls"
            m3u8_url = None
            for fname in sorted(os.listdir(hls_dir)):
                url = gcs_upload(f"{hls_dir}/{fname}", f"{hls_base}/{fname}")
                if fname.endswith('.m3u8'):
                    m3u8_url = url
            log(f"step 10: HLS uploaded in {time.time()-t0:.1f}s -> {m3u8_url}")

            # 9. Patch Supabase
            patch_supabase(master_id, {
                'status': 'ready',
                'audio_url': audio_public_url,
                'hls_url': m3u8_url,
                'peaks': peaks,
                'completed_at': 'now()'
            })
            log(f"DONE in {time.time()-t0:.1f}s total")

    except Exception as e:
        log(f"ERROR: {e}")
        import traceback; traceback.print_exc()
        patch_supabase(master_id, {'status': 'failed', 'error': str(e)[:500]})


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'maastr-mastering'})

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
    # Patch to processing immediately
    patch_supabase(master_id, {'status': 'processing', 'requested_at': 'now()'})
    # Run in background thread
    t = threading.Thread(target=process_master,
        args=(master_id, revision_id, project_id, audio_url, preset))
    t.daemon = True
    t.start()
    return jsonify({'status': 'processing', 'masterId': master_id})

if __name__ == '__main__':
    log(f"starting on port {PORT}")
    app.run(host='0.0.0.0', port=PORT, threaded=True)
