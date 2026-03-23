import { createClient } from '@supabase/supabase-js';

export const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const UPLOAD_WORKER_URL = 'https://maastr-upload.jay-288.workers.dev';
