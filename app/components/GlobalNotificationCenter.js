'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { sb } from '@/lib/supabase';

// Headless — never unmounts. Fires nc_requestSync on every navigation so the
// newly mounted page NC gets a fresh copy of any active uploads from UploadContext.
export default function GlobalNotificationCenter() {
  const [user, setUser] = useState(null);
  const pathname = usePathname();

  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Re-sync on every route change so the newly mounted NC shows active uploads
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      if (window.nc_requestSync) window.nc_requestSync();
    }, 150);
    return () => clearTimeout(t);
  }, [user, pathname]);

  return null;
}
