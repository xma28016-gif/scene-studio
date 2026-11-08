import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_IMAGE_BYTES = 3_000_000;
export const RATIOS = ['1:1', '3:4', '4:3', '2:3', '3:2', '16:9', '9:16'];
export const SCENES = ['两种都要', '纯商品展示场景', '人机交互场景'];
const IMAGE_HOSTS = new Set(['api.dify.ai', 'cloud.dify.ai', 'upload.dify.ai', 'udify.app']);

export function config() {
  const key = process.env.DIFY_API_KEY;
  if (!key) throw new Error('生成服务尚未配置，请联系网站管理员。');
  return { key, base: (process.env.DIFY_API_BASE_URL || 'https://api.dify.ai/v1').replace(/\/$/, '') };
}

export function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export function sign(payload) {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = createHmac('sha256', config().key).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export function verify(token, purpose) {
  if (typeof token !== 'string' || token.length > 12000) throw new Error('请求已失效，请重新上传商品图片。');
  const [data, signature] = token.split('.');
  const expected = createHmac('sha256', config().key).update(data || '').digest();
  const actual = Buffer.from(signature || '', 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('请求已失效，请重新上传商品图片。');
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  if (payload.purpose !== purpose || payload.exp < Date.now()) throw new Error('请求已过期，请重新生成图片。');
  return payload;
}

export function imageUrl(value) {
  try {
    const url = new URL(value, config().base);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!IMAGE_HOSTS.has(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function errorMessage(status) {
  if (status === 401 || status === 403) return '生成服务授权失败，请联系网站管理员。';
  if (status === 429) return '生成服务当前繁忙或额度不足，请稍后再试。';
  if (status === 413) return '图片过大，请选择另一张商品图片。';
  if (status >= 500) return '图片生成服务暂时不可用，请稍后再试。';
  return '生成服务未能处理本次请求，请稍后重试。';
}

export function progressFor(node = {}) {
  const title = node.title || '';
  const type = node.node_type || '';
  if (/answer|end/.test(type)) return { step: 3, detail: '图片已生成，正在整理结果' };
  if (/tool|iteration|loop/.test(type) || /生图|生成图|绘图|画图|图片生成/.test(title)) return { step: 2, detail: '正在生成商品场景摄影图' };
  return { step: 1, detail: /场景|提示词|方案/.test(title) ? '正在构思拍摄场景与画面' : '正在分析商品特征与拍摄需求' };
}

export async function* sseEvents(body) {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    if (pending.length > 4_000_000) throw new Error('生成服务返回内容过大，请重试。');
    let match;
    while ((match = /\r?\n\r?\n/.exec(pending))) {
      const frame = pending.slice(0, match.index);
      pending = pending.slice(match.index + match[0].length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
      else if (/^event:\s*ping/m.test(frame)) yield { event: 'ping' };
    }
  }
  pending += decoder.decode();
  const data = pending.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  if (data && data !== '[DONE]') yield JSON.parse(data);
}

export function fileImages(value) {
  if (!value || typeof value !== 'object') return [];
  const images = [];
  if (value.type === 'image' && typeof value.url === 'string') images.push(value.url);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') images.push(...fileImages(child));
  }
  return images;
}

export function answerImages(answer) {
  const values = [];
  for (const match of answer.matchAll(/!\[[^\]]*\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g)) values.push(match[1]);
  for (const match of answer.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of answer.matchAll(/https?:\/\/[^\s<>"'\)\]\\]+/g)) {
    if (/\.(?:png|jpe?g|webp|gif)(?:\?|$)|\/files\//i.test(match[0])) values.push(match[0]);
  }
  return values.map(value => value.replace(/&amp;/g, '&'));
}
