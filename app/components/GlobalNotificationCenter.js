'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';

// Headless component — lives in layout, never unmounts.
// When user navigates to a page with an NC, calls nc_requestSync so
// UploadContext re-announces any active uploads to the newly mounted NC.
export default function GlobalNotificationCenter() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    // Give the page's NC time to mount and register its handlers, then sync
    const t = setTimeout(() => {
      if (window.nc_requestSync) window.nc_requestSync();
    }, 150);
    return () => clearTimeout(t);
  }, [user]);

  return null;
}
