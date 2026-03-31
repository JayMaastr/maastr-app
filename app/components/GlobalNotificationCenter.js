'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';
import NotificationCenter from '@/app/components/NotificationCenter';

export default function GlobalNotificationCenter() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    window._gncMounted = true;
    sb.auth.getSession().then(({ data: { session } }) => {
      window._gncSession = session;
      window._gncUser = session?.user ?? null;
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      window._gncAuthChange = { event: _event, user: session?.user ?? null };
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!user) return null;
  return <NotificationCenter user={user} />;
}
