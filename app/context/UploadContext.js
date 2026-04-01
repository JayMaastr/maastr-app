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
    if (activeRef.current[ncId]) {
      activeRef.current[ncId].done = true;
      activeRef.current[ncId].pct = 100;
      setTimeout(() => { delete activeRef.current[ncId]; }, 300000);
    }
  }


  // Allow newly mounted NC to re-sync active uploads
  useEffect(() => {
    window.nc_requestSync = () => {
      const active = activeRef.current || {};
      Object.entries(active).forEach(([ncId, u]) => {
        if (window.nc_startUpload) window.nc_startUpload(ncId, u.name, u.projectId, '', 100);
        if (u.done) {
          if (window.nc_updateUpload) window.nc_updateUpload(ncId, 100, 100);
          if (window.nc_finishUpload) window.nc_finishUpload(ncId);
        } else if (u.pct > 0 && window.nc_updateUpload) {
          window.nc_updateUpload(ncId, u.pct, 100);
        }
      });
    };
    return () => { delete window.nc_requestSync; };
  }, []);
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
