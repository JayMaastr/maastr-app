'use client';
import { createContext, useContext, useRef, useState, useCallback } from 'react';
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
    if (window.nc_updateUpload) window.nc_updateUpload(ncId, progress, total);
  }

  function finishUpload(ncId) {
    setUploads(prev => ({ ...prev, [ncId]: { ...prev[ncId], progress: 100, done: true } }));
    if (window.nc_finishUpload) window.nc_finishUpload(ncId);
    delete activeRef.current[ncId];
  }

  function xhrUpload(file, url, ncId) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeRef.current[ncId] = xhr;
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
      initial[ncIds[i]] = { name: t.name || t.file.name, progress: 0, done: false };
    });
    setUploads(prev => ({ ...prev, ...initial }));

    if (window.nc_startUpload) {
      trackList.forEach((t, i) => window.nc_startUpload(ncIds[i], t.name || t.file.name, projectId));
    }

    await Promise.all(trackList.map(async (t, i) => {
      const ncId = ncIds[i];
      try {
        const gcsRes = await fetch('/api/gcs-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: t.file.name, contentType: t.file.type || 'audio/wav', projectId }),
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
          fetch('/api/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: newTrack.id }) }).catch(() => {});
          fetch('/api/trigger-encode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: newTrack.id, projectId }) }).catch(() => {});
          fetch('/api/init-master', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: newTrack.id, projectId }) }).catch(() => {});
        }

        finishUpload(ncId);
      } catch(e) {
        console.error('[UploadContext] failed:', t.name, e);
        setUploads(prev => ({ ...prev, [ncId]: { ...prev[ncId], error: true } }));
        if (window.nc_finishUpload) window.nc_finishUpload(ncId);
      }
    }));
  }, []);

  return (
    <UploadContext.Provider value={{ uploads, startUploads }}>
      {children}
    </UploadContext.Provider>
  );
}
