# maastr mastering service v1.0
import os, sys, json, base64, tempfile, subprocess, threading, time
from pathlib import Path
import numpy as np
import requests
from flask import Flask, request, jsonify
from scipy.io import wavfile

app = Flask(__name__)

SECRET          = os.environ.get('MASTERING_SECRET', '')
GCS_BUCKET      = os.environ.get('GCS_BUCKET_NAME', 'maastr-vibedev-audio')
GCS_KEY_B64     = os.environ.get('GCS_SERVICE_ACCOUNT_KEY', '')
SUPABASE_URL    = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
SUPABASE_KEY    = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
VERCEL_URL      = os.environ.get('VERCEL_URL', 'https://maastr-app.vercel.app')
ENCODE_SECRET   = os.environ.get('ENCODE_SECRET', '')
PORT            = int(os.environ.get('PORT', 3002))

# preset -> (gain_db, saturation_drive)
# Loud=4dB  Normal=1.5dB  Gentle=0.5dB
# Warm=heavy sat, Neutral=light sat, Bright=minimal sat + treble character
PRESETS = {
    'W+L': (4.0,  0.18),
    'N+L': (4.0,  0.07),
    'B+L': (4.0,  0.04),
    'W+N': (1.5,  0.14),
    'N+N': (1.5,  0.04),
    'B+N': (1.5,  0.02),
    'W+G': (0.5,  0.10),
    'N+G': (0.5,  0.02),
    'B+G': (0.5,  0.01),
}

def gcs_upload(local_path, gcs_key):
    """Upload file to GCS using service account JWT auth."""
    import json, time, base64
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.backends import default_backend

    key_info = json.loads(base64.b64decode(GCS_KEY_B64))
    private_key = serialization.load_pem_private_key(
        key_info['private_key'].encode(), password=None, backend=default_backend()
    )
    now = int(time.time())
    claim = {
        'iss': key_info['client_email'],
        'scope': 'https://www.googleapis.com/auth/devstorage.read_write',
        'aud': 'https://oauth2.googleapis.com/token',
        'exp': now + 3600,
        'iat': now,
    }
    import urllib.parse
    header = base64.urlsafe_b64encode(json.dumps({'alg':'RS256','typ':'JWT'}).encode()).rstrip(b'=')
    payload = base64.urlsafe_b64encode(json.dumps(claim).encode()).rstrip(b'=')
    signing_input = header + b'.' + payload
    signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    jwt_token = signing_input + b'.' + base64.urlsafe_b64encode(signature).rstrip(b'=')

    token_resp = requests.post('https://oauth2.googleapis.com/token', data={
        'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion': jwt_token.decode()
    })
    access_token = token_resp.json()['access_token']

    with open(local_path, 'rb') as f:
        data = f.read()
    ext = Path(local_path).suffix
    content_type = 'audio/wav' if ext == '.wav' else 'video/mp2t' if ext == '.ts' else 'application/x-mpegURL'
    resp = requests.put(
        f'https://storage.googleapis.com/upload/storage/v1/b/{GCS_BUCKET}/o',
        params={'uploadType': 'media', 'name': gcs_key},
        headers={'Authorization': f'Bearer {access_token}', 'Content-Type': content_type},
        data=data
    )
    resp.raise_for_status()
    return f'https://storage.googleapis.com/{GCS_BUCKET}/{gcs_key}'

def sb_patch(table, row_id, data):
    """Update a Supabase row via REST API."""
    resp = requests.patch(
        f'{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}',
        headers={
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
        },
        json=data
    )
    return resp.status_code

def apply_preset(audio_float, sample_rate, preset):
    """
    Apply mastering preset using DawDreamer FaustProcessor.
    Falls back to numpy gain+saturation if DawDreamer fails.
    """
    gain_db, sat_drive = PRESETS[preset]
    gain_lin = 10 ** (gain_db / 20.0)

    try:
        import dawdreamer as daw
        engine = daw.RenderEngine(sample_rate, 512)

        # Ensure stereo (channels, samples) for DawDreamer
        if audio_float.ndim == 1:
            audio_2d = np.stack([audio_float, audio_float])
        else:
            audio_2d = audio_float.T.copy()

        playback = engine.make_playback_processor('playback', audio_2d)

        faust_code = f"""
import("stdfaust.lib");
gain_lin = {gain_lin:.6f};
drive    = {sat_drive:.6f};
process  = _,_ : *(gain_lin),*(gain_lin) : ef.cubicnl(drive,0.0),ef.cubicnl(drive,0.0);
"""
        faust = engine.make_faust_processor('faust')
        faust.set_dsp_string(faust_code)

        engine.load_graph([(playback, []), (faust, [('playback', 0), ('playback', 1)])])
        duration = audio_2d.shape[1] / sample_rate
        engine.render(duration)
        out = engine.get_audio()   # (channels, samples)
        print(f'[master] DawDreamer OK: {out.shape}', flush=True)
        return np.clip(out.T, -1.0, 1.0)

    except Exception as e:
        print(f'[master] DawDreamer failed ({e}), using numpy fallback', flush=True)
        # Numpy fallback: gain + cubic soft-clip
        if audio_float.ndim == 1:
            audio_float = np.stack([audio_float, audio_float], axis=1)
        out = audio_float * gain_lin
        out = out - (out ** 3) * sat_drive   # cubic saturation
        return np.clip(out, -1.0, 1.0)

def hls_encode(wav_path, hls_dir):
    """Encode WAV to HLS using ffmpeg."""
    os.makedirs(hls_dir, exist_ok=True)
    playlist = os.path.join(hls_dir, 'playlist.m3u8')
    cmd = [
        'ffmpeg', '-y', '-i', wav_path,
        '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
        '-hls_time', '10', '-hls_list_size', '0',
        '-hls_segment_filename', os.path.join(hls_dir, 'segment_%04d.ts'),
        playlist
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return playlist

def process_master(master_id, revision_id, project_id, audio_url, preset):
    print(f'[master] START masterId={master_id} preset={preset}', flush=True)
    sb_patch('masters', master_id, {'status': 'processing'})

    with tempfile.TemporaryDirectory() as tmp:
        # 1. Download source WAV
        wav_in = os.path.join(tmp, 'source.wav')
        print(f'[master] Downloading {audio_url}', flush=True)
        r = requests.get(audio_url, stream=True, timeout=120)
        r.raise_for_status()
        with open(wav_in, 'wb') as f:
            for chunk in r.iter_content(65536):
                f.write(chunk)
        print(f'[master] Downloaded {os.path.getsize(wav_in)} bytes', flush=True)

        # 2. Load audio
        sample_rate, raw = wavfile.read(wav_in)
        if raw.dtype == np.int16:
            audio_f = raw.astype(np.float32) / 32768.0
        elif raw.dtype == np.int32:
            audio_f = raw.astype(np.float32) / 2147483648.0
        else:
            audio_f = raw.astype(np.float32)

        # 3. Apply preset
        print(f'[master] Applying preset {preset}', flush=True)
        processed = apply_preset(audio_f, sample_rate, preset)

        # 4. Write processed WAV
        wav_out = os.path.join(tmp, 'master.wav')
        out_int16 = (processed * 32767).astype(np.int16)
        wavfile.write(wav_out, sample_rate, out_int16)
        print(f'[master] Written {os.path.getsize(wav_out)} bytes', flush=True)

        # 5. Upload WAV to GCS
        preset_slug = preset.replace('+', '_')
        wav_gcs_key = f'projects/{project_id}/masters/{revision_id}/{preset_slug}.wav'
        audio_url_out = gcs_upload(wav_out, wav_gcs_key)
        print(f'[master] WAV uploaded: {audio_url_out}', flush=True)

        # 6. HLS encode
        hls_dir = os.path.join(tmp, 'hls')
        hls_encode(wav_out, hls_dir)

        # 7. Upload HLS files to GCS
        hls_base = f'projects/{project_id}/masters/{revision_id}/{preset_slug}/hls'
        hls_url_out = None
        for fname in sorted(os.listdir(hls_dir)):
            fpath = os.path.join(hls_dir, fname)
            gcs_k = f'{hls_base}/{fname}'
            url = gcs_upload(fpath, gcs_k)
            if fname == 'playlist.m3u8':
                hls_url_out = url
            print(f'[master] HLS uploaded: {fname}', flush=True)

        # 8. Update masters row to ready
        sb_patch('masters', master_id, {
            'status': 'ready',
            'audio_url': audio_url_out,
            'hls_url': hls_url_out,
            'completed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        })
        print(f'[master] DONE masterId={master_id} hls={hls_url_out}', flush=True)

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'service': 'maastr-mastering'})

@app.route('/master', methods=['POST'])
def master():
    data = request.get_json() or {}
    if data.get('secret') != SECRET:
        return jsonify({'error': 'unauthorized'}), 401
    required = ['masterId', 'revisionId', 'projectId', 'audioUrl', 'preset']
    for f in required:
        if not data.get(f):
            return jsonify({'error': f'{f} required'}), 400
    if data['preset'] not in PRESETS:
        return jsonify({'error': 'invalid preset'}), 400

    t = threading.Thread(target=process_master, args=(
        data['masterId'], data['revisionId'], data['projectId'],
        data['audioUrl'], data['preset']
    ), daemon=True)
    t.start()
    return jsonify({'status': 'processing', 'masterId': data['masterId']})

if __name__ == '__main__':
    print(f'[master] maastr-mastering listening on {PORT}', flush=True)
    app.run(host='0.0.0.0', port=PORT)
