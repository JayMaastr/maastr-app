'use client';
import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import { sb } from '@/lib/supabase';

const UploadContext = createContext(null);

export function useUpload() {
  return useContext(UploadContext);
}

export function UploadProvider({ children }) {
  const [uploads, setUploads] = useState({});
  const activeRef = useRef({});

  function updateUpload(ncId, progress, total) {
    const pct = total > 0 ? Math.round(progress / total * 100) : 0;
    setUploads(prev => ({ ...prev, [ncId]: { ...prev[ncId], progress: pct } }));
    if (activeRef.current[ncId]) activeRef.current[ncId].pct = pct;
    if (window.nc_updateUpload) window.nc_updateUpload(ncId, pct, 100);
  }

  function finishUpload(ncId) {
    setUploads(prev => ({ ...prev, [ncId]: { ...prev[ncId], progress: 100, done: true } }));
    if (window.nc_finishUpload) window.nc_finishUpload(ncId);
    delete activeRef.current[ncId];
  }


  // Allow newly mounted NC to re-sync active uploads
  useEffect(() => {
    window.nc_requestSync = () => {
      const active = activeRef.current || {};
      Object.entries(active).forEach(([ncId, u]) => {
        if (!u.done) {
          if (window.nc_startUpload) window.nc_startUpload(ncId, u.name, u.projectId, '', 100);
          if (u.pct > 0 && window.nc_updateUpload) window.nc_updateUpload(ncId, u.pct, 100);
        }
      });
    };
    return () => { delete window.nc_requestSync; };
  }, []);
  function xhrUpload(file, url, ncId) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const _e = activeRef.current[ncId] || {};
      Object.assign(_e, { xhr: xhr });
      activeRef.current[ncId] = _e;
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', file.type || 'audio/wav');
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) updateUpload(ncId, e.loaded, e.total);
      };
      xhr.onload = () => {
        try { updateUpload(ncId, 100, 100); resolve(xhr.responseURL || url); }
        catch(e) { resolve(url); }
      };
      xhr.onerror = () => reject(new Error('XHR failed'));
      xhr.send(file);
    });
  }

  const startUploads = useCallback(async (trackList, projectId, ncIds) => {
    const initial = {};
    trackList.forEach((t, i) => {
      initial[ncIds[i]] = { name: t.name || t.file.name, projectId, progress: 0, done: false };
    });
    setUploads(prev => ({ ...prev, ...initial }));

    if (window.nc_startUpload) {
      trackList.forEach((t, i) => window.nc_startUpload(ncIds[i], t.name || t.file.name, projectId, '', 100));
    }

    await Promise.all(trackList.map(async (t, i) => {
      const ncId = ncIds[i];
      try {
        const gcsRes = await fetch('/api/gcs-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: t.file.name, contentType: t.file.type || 'audio/wav', projectId }),
        });
        const gcsData = await gcsRes.json();
        if (!gcsData.uploadUrl) throw new Error('No upload URL');

        await xhrUpload(t.file, gcsData.uploadUrl, ncId);
        const publicUrl = gcsData.publicUrl || gcsData.url;

        const { data: newTrack } = await sb.from('tracks').insert({
          project_id: projectId,
          title: t.name || t.file.name.replace(/\.[^.]+$/, ''),
          audio_url: publicUrl,
          tone_setting: t.tone_setting ?? 4,
          tone_label: t.tone_label ?? 'N+N',
          position: i,
        }).select().single();

        if (newTrack?.id) {
          fetch('/api/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: newTrack.id, audioUrl: publicUrl, projectId }) });
          fetch('/api/trigger-encode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: newTrack.id, projectId, audioUrl: publicUrl }) });
          fetch('/api/init-master', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: newTrack.id, projectId }) })
            .then(r => r.json())
            .then(d => { if (d?.masterId && window.nc_startMaster) window.nc_startMaster(d.masterId, t.name, projectId, t.file?.size || 0, ncId); })
            .catch(() => {});
        }

        finishUpload(ncId);
      } catch(e) {
        console.error('[UploadContext] failed:', t.name, e);
        setUploads(prev => ({ ...prev, [ncId]: { ...prev[ncId], error: true } }));
        if (window.nc_finishUpload) window.nc_finishUpload(ncId);
      }
    }));
  }, []);

  // startRevisionUploads: same as startUploads but handles revision vs new track DB logic
  const startRevisionUploads = useCallback(async (trackList, projectId, ncIds) => {
    const initial = {};
    trackList.forEach((t, i) => {
      initial[ncIds[i]] = { name: t.name || t.file.name, projectId, progress: 0, done: false };
    });
    setUploads(prev => ({ ...prev, ...initial }));

    if (window.nc_startUpload) {
      trackList.forEach((t, i) => window.nc_startUpload(ncIds[i], t.name || t.file.name, projectId, '', 100));
    }

    await Promise.all(trackList.map(async (t, i) => {
      const ncId = ncIds[i];
      try {
        const gcsRes = await fetch('/api/gcs-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: t.file.name, contentType: t.file.type || 'audio/wav', projectId }),
        });
        const gcsData = await gcsRes.json();
        if (!gcsData.uploadUrl) throw new Error('No upload URL');

        await xhrUpload(t.file, gcsData.uploadUrl, ncId);
        const publicUrl = gcsData.publicUrl || gcsData.url;

        // DB writes: revision vs new track
        let trackId = t.matchedTrackId;
        let revisionId = null;

        if (!t.isNew && trackId) {
          // REVISION: deactivate old, insert new version
          const { data: existing } = await sb
            .from('revisions')
            .select('version_number')
            .eq('track_id', trackId)
            .order('version_number', { ascending: false })
            .limit(1);
          const nextVer = (existing?.[0]?.version_number || 1) + 1;

          await sb.from('revisions').update({ is_active: false }).eq('track_id', trackId);
          const { data: newRev } = await sb.from('revisions').insert({
            track_id: trackId,
            project_id: projectId,
            version_number: nextVer,
            label: 'v' + nextVer,
            audio_url: publicUrl,
            tone_setting: t.tone_setting ?? 4,
            tone_label: t.tone_label ?? 'N+N',
            is_active: true,
          }).select('id').single();
          revisionId = newRev?.id;

          await sb.from('tracks').update({
            audio_url: publicUrl,
            peaks: t.peaks ?? [],
            tone_setting: t.tone_setting ?? 4,
            tone_label: t.tone_label ?? 'N+N',
          }).eq('id', trackId);

        } else {
          // NEW TRACK: insert track + v1 revision
          const { data: newTrack } = await sb.from('tracks').insert({
            project_id: projectId,
            title: t.name || t.file.name.replace(/\.[^.]+$/, ''),
            audio_url: publicUrl,
            tone_setting: t.tone_setting ?? 4,
            tone_label: t.tone_label ?? 'N+N',
            peaks: t.peaks ?? [],
            position: t.position ?? i,
          }).select().single();

          if (newTrack?.id) {
            trackId = newTrack.id;
            const { data: newRev } = await sb.from('revisions').insert({
              track_id: trackId,
              project_id: projectId,
              version_number: 1,
              label: 'v1',
              audio_url: publicUrl,
              tone_setting: t.tone_setting ?? 4,
              tone_label: t.tone_label ?? 'N+N',
              is_active: true,
            }).select('id').single();
            revisionId = newRev?.id;
          }
        }

        if (trackId) {
          // Mix HLS encode (fire-and-forget)
          fetch('/api/trigger-encode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackId, projectId, audioUrl: publicUrl }),
          }).catch(() => {});

          // Mastering — call request-master directly with the revisionId we just created
          if (revisionId) {
            fetch('/api/request-master', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ revisionId, projectId, preset: t.tone_label ?? 'N+N' }),
            })
              .then(r => r.json())
              .then(d => {
                if (d?.masterId && window.nc_startMaster) {
                  window.nc_startMaster(d.masterId, t.name, projectId, t.file?.size || 0, ncId);
                }
              })
              .catch(() => {});
          }
        }

        finishUpload(ncId);
      } catch(e) {
        console.error('[UploadContext] revision failed:', t.name, e);
        setUploads(prev => ({ ...prev, [ncId]: { ...prev[ncId], error: true } }));
        if (window.nc_finishUpload) window.nc_finishUpload(ncId);
      }
    }));
  }, []);

  return (
    <UploadContext.Provider value={{ uploads, startUploads, startRevisionUploads }}>
      {children}
    </UploadContext.Provider>
  );
}
