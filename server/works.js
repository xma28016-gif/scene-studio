import { randomUUID } from 'node:crypto';
import { RATIOS, SCENES } from './dify.js';
import { resultImage } from './images.js';

export const BUCKET = 'scene-works';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const extensions = { 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/heic':'heic','image/heif':'heif','image/avif':'avif','image/bmp':'bmp','image/tiff':'tif' };
const previews = ['image/jpeg','image/png','image/webp','image/gif'];
export class WorkError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
export function check(error) {
  if (error) {
    console.error('Work storage request failed', error.code || error.statusCode || error.name);
    throw new WorkError('作品存储暂时无法连接，请稍后重试。');
  }
}
export async function createWork(auth, body) {
  if (!RATIOS.includes(body.ratio) || !SCENES.includes(body.scene) || !Number.isInteger(body.count) || body.count < 1 || body.count > 4 ||
      !extensions[body.originalMime] || !previews.includes(body.previewMime) || !Number.isSafeInteger(body.originalBytes) || body.originalBytes < 1 || body.originalBytes > 80_000_000 ||
      typeof body.originalName !== 'string' || !body.originalName || body.originalName.length > 255) throw new WorkError('图片或创作参数无效，请重新上传。', 400);
  const id = randomUUID(), prefix = `${auth.user.id}/${id}`;
  const row = { id, user_id: auth.user.id, ratio: body.ratio, scene: body.scene, requested_count: body.count,
    original_name: body.originalName, original_mime: body.originalMime, original_bytes: body.originalBytes,
    original_path: `${prefix}/original.${extensions[body.originalMime]}`, preview_mime: body.previewMime, preview_path: `${prefix}/product.${extensions[body.previewMime]}` };
  const { error } = await auth.supabase.from('scene_works').insert(row);
  check(error);
  return { id, originalPath: row.original_path, originalMime: row.original_mime };
}
export async function ownWork(auth, id) {
  if (!UUID.test(id || '')) throw new WorkError('作品不存在或无权查看。', 404);
  const { data, error } = await auth.supabase.from('scene_works').select('*').eq('id',id).eq('user_id',auth.user.id).maybeSingle();
  check(error);
  if (!data) throw new WorkError('作品不存在或无权查看。', 404);
  return data;
}
export async function ownImages(auth, id) {
  const { data, error } = await auth.supabase.from('scene_work_images').select('id,position,storage_path').eq('work_id',id).eq('user_id',auth.user.id).order('position');
  check(error);
  return data;
}
export function imageRecord(image) {
  const url = `/api/works?image=${image.id}`;
  return { id: image.id, position: image.position, url, downloadUrl: `${url}&download=1` };
}
export function workRecord(row, images) {
  return { id: row.id, ratio: row.ratio, scene: row.scene, count: row.requested_count, createdAt: row.created_at,
    originalName: row.original_name, originalUrl: `/api/works?work=${row.id}&asset=preview`,
    originalDownloadUrl: `/api/works?work=${row.id}&asset=original&download=1`, images: images.map(imageRecord) };
}
export async function assertOriginal(auth, work) {
  const { data, error } = await auth.supabase.storage.from(BUCKET).info(work.original_path);
  check(error);
  if (!data || Number(data.size ?? data.metadata?.size) !== Number(work.original_bytes)) throw new WorkError('原图尚未保存完整，请重新上传。',400);
}
export async function savePreview(auth, work, file) {
  if (file.type !== work.preview_mime) throw new WorkError('上传图片与本次创作不一致。',400);
  await assertOriginal(auth,work);
  const { error } = await auth.supabase.storage.from(BUCKET).upload(work.preview_path, await file.arrayBuffer(), { contentType: file.type, upsert: false, cacheControl: '0' });
  // A retry may reuse the immutable preview uploaded by the first attempt.
  if (error) {
    const existing = await auth.supabase.storage.from(BUCKET).info(work.preview_path);
    if (existing.error || Number(existing.data?.size) !== file.size) check(error);
  }
}
export async function saveResult(auth, work, candidate, position, signal) {
  const bytes = await resultImage(candidate, work.ratio, signal);
  const id = randomUUID(), path = `${auth.user.id}/${work.id}/result-${position}-${id}.jpg`;
  const { error: uploadError } = await auth.supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '0' });
  check(uploadError);
  const row = { id, work_id: work.id, user_id: auth.user.id, position, storage_path: path };
  const { error } = await auth.supabase.from('scene_work_images').insert(row);
  check(error);
  return imageRecord(row);
}
