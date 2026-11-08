import config from './auth-config.js';

const supabase = window.supabase.createClient(config.url, config.publishableKey);
const dialog = document.querySelector('#auth-dialog');
const form = document.querySelector('#auth-form');
const fields = document.querySelector('#auth-fields');
const email = document.querySelector('#auth-email');
const password = document.querySelector('#auth-password');
const message = document.querySelector('#auth-message');
const submit = document.querySelector('#auth-submit');
const loginTab = document.querySelector('#auth-login-tab');
const signupTab = document.querySelector('#auth-signup-tab');
const openButton = document.querySelector('#open-auth');
const signOutButton = document.querySelector('#sign-out');
const accountEmail = document.querySelector('#account-email');
let currentUser = null, mode = 'login', busy = false;

function showMessage(text, error = false) {
  message.textContent = text;
  message.hidden = !text;
  message.classList.toggle('is-error', error);
}

function authError(error) {
  const messages = {
    invalid_credentials: '邮箱或密码不正确，请重试。',
    email_not_confirmed: '请先打开邮箱中的确认链接，再回来登录。',
    user_already_exists: '这个邮箱已注册，请切换到登录。',
    email_exists: '这个邮箱已注册，请切换到登录。',
    signup_disabled: '网站暂未开放注册，请联系管理员。',
    email_provider_disabled: '邮箱登录暂未开启，请联系管理员。',
    email_address_invalid: '请输入有效的邮箱地址。',
    email_address_not_authorized: '确认邮件暂时无法发送，请联系管理员配置邮件服务。',
    weak_password: '密码强度不足，请增加长度并包含字母和数字。',
    over_email_send_rate_limit: '确认邮件发送过于频繁，请稍后重试。',
    over_request_rate_limit: '操作过于频繁，请稍后重试。',
    same_password: '请使用其他密码。'
  };
  return messages[error.code] || (error.status === 429 ? '操作过于频繁，请稍后重试。' : '账号服务暂时无法完成请求，请检查网络后重试。');
}

function setBusy(value) {
  busy = value;
  fields.disabled = value;
  loginTab.disabled = value;
  signupTab.disabled = value;
  submit.textContent = value ? '请稍候…' : mode === 'signup' ? '注册' : '登录';
}

function setMode(value) {
  if (busy) return;
  mode = value;
  const signup = mode === 'signup';
  document.querySelector('#auth-title').textContent = signup ? '注册 Scene Studio' : '登录 Scene Studio';
  loginTab.setAttribute('aria-pressed', String(!signup));
  signupTab.setAttribute('aria-pressed', String(signup));
  password.autocomplete = signup ? 'new-password' : 'current-password';
  password.minLength = signup ? 8 : 1;
  document.querySelector('#password-hint').hidden = !signup;
  submit.textContent = signup ? '注册' : '登录';
  showMessage('');
}

export function openAuthDialog(value = 'login') {
  setMode(value);
  if (!dialog.open) dialog.showModal();
}

function applySession(session) {
  currentUser = session?.user || null;
  accountEmail.textContent = currentUser?.email || '';
  accountEmail.title = currentUser?.email || '';
  accountEmail.hidden = !currentUser;
  openButton.hidden = !!currentUser;
  openButton.disabled = false;
  openButton.textContent = '登录 / 注册';
  signOutButton.hidden = !currentUser;
  document.dispatchEvent(new CustomEvent('auth-change', { detail: { user: currentUser } }));
}

export function getCurrentUser() { return currentUser; }

export async function authorizedFetch(input, options = {}) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw new Error('登录状态刷新失败，请检查网络后重试。');
  if (!session?.access_token) {
    applySession(null);
    openAuthDialog();
    throw new Error('请先登录。');
  }
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  const response = await fetch(input, { ...options, headers });
  if (response.status === 401) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    applySession(null);
    openAuthDialog();
    throw new Error('登录已失效，请重新登录。');
  }
  return response;
}

export async function uploadOriginal(work, file, signal) {
  const path = work.originalPath.split('/').map(encodeURIComponent).join('/');
  const headers = { apikey: config.publishableKey, 'Content-Type': work.originalMime, 'x-upsert': 'false', 'cache-control': '0' };
  const response = await authorizedFetch(`${config.url}/storage/v1/object/scene-works/${path}`, { method: 'POST', headers, body: file, signal });
  if (response.ok) return;
  // A disconnected upload can have succeeded. Check its size before retrying.
  const existing = await authorizedFetch(`${config.url}/storage/v1/object/info/scene-works/${path}`, { headers: { apikey: config.publishableKey }, signal });
  if (existing.ok && Number((await existing.json()).size) === file.size) return;
  throw new Error('原图保存失败，请检查网络后重试。');
}

openButton.addEventListener('click', () => openAuthDialog());
document.querySelector('#close-auth').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { password.value = ''; });
loginTab.addEventListener('click', () => setMode('login'));
signupTab.addEventListener('click', () => setMode('signup'));

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const credentials = { email: email.value.trim(), password: password.value };
  setBusy(true);
  showMessage('');
  try {
    const { data, error } = mode === 'signup'
      ? await supabase.auth.signUp({ ...credentials, options: { emailRedirectTo: `${location.origin}/` } })
      : await supabase.auth.signInWithPassword(credentials);
    if (error) { showMessage(authError(error), true); return; }
    password.value = '';
    if (data.session) { applySession(data.session); dialog.close(); }
    else showMessage('请查收确认邮件，点击链接后返回本站登录；若已注册，请直接登录。');
  } catch { showMessage('账号服务暂时无法连接，请检查网络后重试。', true); }
  finally { setBusy(false); }
});

signOutButton.addEventListener('click', async () => {
  signOutButton.disabled = true;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    applySession(null);
  } catch {
    openAuthDialog();
    showMessage('退出失败，请检查网络后重试。', true);
  } finally { signOutButton.disabled = false; }
});

supabase.auth.onAuthStateChange((_event, session) => applySession(session));
export const authReady = supabase.auth.getSession().then(({ data, error }) => {
  applySession(error ? null : data.session);
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('error') || params.has('error_description')) {
    history.replaceState(null, '', location.pathname + location.search);
    openAuthDialog();
    showMessage('邮箱确认链接无效或已过期，请重新注册或联系管理员。', true);
  }
}).catch(() => {
  applySession(null);
  openAuthDialog();
  showMessage('无法恢复登录状态，请检查网络后重试。', true);
});
