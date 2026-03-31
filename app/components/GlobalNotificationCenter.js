'use client';
import { useEffect, useState, Suspense } from 'react';
import { sb } from '@/lib/supabase';
import NotificationCenter from '@/app/components/NotificationCenter';

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

  if (!user) return null;
  return (
    <Suspense fallback={null}>
      <NotificationCenter user={user} />
    </Suspense>
  );
}
