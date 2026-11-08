import { json, sameOrigin } from '../server/dify.js';
import { authConfig, requireUser } from '../server/auth.js';
import { BUCKET, UUID, WorkError, check, createWork, ownWork, ownImages, workRecord } from '../server/works.js';

function failure(error) {
  console.error('Works request failed', error.name);
  return json({ error: error instanceof WorkError ? error.message : '作品暂时无法载入，请稍后重试。' }, error.status || 503);
}
export async function POST(request) {
  if (!sameOrigin(request)) return json({ error:'不允许跨站提交。' },403);
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  if (Number(request.headers.get('content-length')) > 20_000) return json({ error:'请求内容过大。' },413);
  try { return json(await createWork(auth,await request.json()),201); }
  catch(error) { return failure(error); }
}

async function serveImage(auth, request, path, mime, filename, attachment) {
  const { url, publishableKey } = authConfig();
  const response = await fetch(`${url}/storage/v1/object/authenticated/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${auth.token}` },
    signal: AbortSignal.any([request.signal,AbortSignal.timeout(60_000)]), cache: 'no-store', redirect: 'error'
  });
  if (!response.ok) { await response.body?.cancel(); throw new WorkError('图片不存在或无权查看。',response.status >= 500 ? 503 : 404); }
  const safeName = filename.replace(/[\r\n\x00-\x1f]/g,'').slice(0,255) || 'scene-studio.jpg';
  return new Response(response.body,{ headers: {
    'Content-Type': mime,
    'Content-Disposition': `${attachment ? 'attachment' : 'inline'}; filename="scene-studio.${mime === 'image/jpeg' ? 'jpg' : 'image'}"; filename*=UTF-8''${encodeURIComponent(safeName).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16)}`)}`,
    'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Vary':'Authorization'
  } });
}

export async function GET(request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  try {
    if (params.has('image')) {
      const id = params.get('image');
      if (!UUID.test(id)) throw new WorkError('图片不存在或无权查看。',404);
      const { data, error } = await auth.supabase.from('scene_work_images').select('storage_path,position').eq('id',id).eq('user_id',auth.user.id).maybeSingle();
      check(error);
      if (!data) throw new WorkError('图片不存在或无权查看。',404);
      return await serveImage(auth,request,data.storage_path,'image/jpeg',`scene-studio-${data.position}.jpg`,params.get('download') === '1');
    }
    if (params.has('work')) {
      const work = await ownWork(auth,params.get('work'));
      const original = params.get('asset') === 'original';
      if (!original && params.get('asset') !== 'preview') throw new WorkError('图片不存在。',404);
      return await serveImage(auth,request,original ? work.original_path : work.preview_path,original ? work.original_mime : work.preview_mime,
        original ? work.original_name : 'product-preview.jpg',params.get('download') === '1');
    }
    if (params.has('id')) {
      const work = await ownWork(auth,params.get('id'));
      const images = await ownImages(auth,work.id);
      // Unfinished attempts are not part of the finished-work gallery.
      if (!images.length) throw new WorkError('作品尚未生成完成。',404);
      return json({ work: workRecord(work,images) });
    }
    const offset = Number(params.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new WorkError('页码无效。',400);
    const { data, error } = await auth.supabase.from('scene_works')
      .select('id,ratio,scene,requested_count,original_name,created_at,scene_work_images!inner(id,position)')
      .eq('user_id',auth.user.id).order('created_at',{ ascending:false }).order('id',{ ascending:false }).range(offset,offset+24);
    check(error);
    return json({ works: data.slice(0,24).map(row=>workRecord(row,row.scene_work_images.sort((a,b)=>a.position-b.position))), hasMore:data.length>24 });
  } catch(error) { return failure(error); }
}
