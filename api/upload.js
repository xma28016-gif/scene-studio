import { MAX_IMAGE_BYTES, config, json, sameOrigin, sign, errorMessage } from '../server/dify.js';
import { requireUser } from '../server/auth.js';
import { WorkError, ownWork, savePreview } from '../server/works.js';

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: '不允许跨站提交。' }, 403);
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const user = `scene-${auth.user.id}`;
  if (Number(request.headers.get('content-length')) > MAX_IMAGE_BYTES + 20_000) return json({ error: '图片必须小于 3 MB。' }, 413);
  try {
    const { key, base } = config();
    const form = await request.formData();
    const file = form.get('file');
    const prompt = form.get('prompt') || '';
    if (typeof prompt !== 'string' || prompt.length > 1000) return json({ error: '画面描述请保持在 1000 字以内。' },400);
    if (!(file instanceof File) || !file.size || file.size > MAX_IMAGE_BYTES) return json({ error: '请上传 3 MB 以内的商品图片。' }, 400);
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) return json({ error: '请选择 JPG、PNG 或 WebP 图片。' }, 400);
    const work = await ownWork(auth, form.get('workId'));
    await savePreview(auth, work, file);
    const upstreamForm = new FormData();
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
    upstreamForm.append('file', file, `product.${extension}`);
    upstreamForm.append('user', user);
    const response = await fetch(`${base}/files/upload`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: upstreamForm, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      console.error('Dify upload failed', response.status);
      return json({ error: errorMessage(response.status) }, 502);
    }
    const uploaded = await response.json();
    if (!uploaded.id) throw new Error('图片上传未成功，请重试。');
    return json({ uploadToken: sign({ purpose: 'upload', id: uploaded.id, user, owner: auth.user.id, workId: work.id, prompt: prompt.trim() }) });
  } catch (error) {
    console.error('Upload failed', error.name);
    return json({ error: error instanceof WorkError ? error.message : error.name === 'TimeoutError' ? '图片上传超时，请检查网络后重试。' : '图片上传失败，请稍后重试。' }, error.status || 502);
  }
}
