import { createClient } from '@supabase/supabase-js';
import { json } from './dify.js';

export function authConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error('登录服务尚未配置。');
  return { url, publishableKey };
}

export async function requireUser(request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return { response: json({ error: '请先登录。' }, 401) };
  try {
    const { url, publishableKey } = authConfig();
    const supabase = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        headers: { Authorization: `Bearer ${token}` },
        fetch: (input, options) => fetch(input, { ...options, signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]) })
      }
    });
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error && (!error.status || error.status >= 500)) throw error;
    if (error || !user?.id || !user.email || user.is_anonymous) return { response: json({ error: '登录已失效，请重新登录。' }, 401) };
    return { user, supabase, token };
  } catch (error) {
    console.error('Authentication unavailable', error.name);
    return { response: json({ error: '登录服务暂时无法连接，请稍后重试。' }, 503) };
  }
}
