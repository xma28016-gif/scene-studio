import { RATIOS, SCENES, config, json, sameOrigin, verify, imageUrl, errorMessage, progressFor, sseEvents, fileImages, answerImages } from '../server/dify.js';
import { requireUser } from '../server/auth.js';
import { WorkError, ownWork, ownImages, saveResult } from '../server/works.js';

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: '不允许跨站提交。' }, 403);
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  if (Number(request.headers.get('content-length')) > 20_000) return json({ error: '请求内容过大。' }, 413);
  let body, upload, upstream, work, existing;
  try {
    body = await request.json();
    if (body.prompt !== undefined && (typeof body.prompt !== 'string' || body.prompt.length > 1000)) return json({ error: '画面描述请保持在 1000 字以内。' },400);
    body.prompt = (body.prompt || '').trim();
    if (!RATIOS.includes(body.ratio) || !SCENES.includes(body.scene) || !Number.isInteger(body.count) || body.count < 1 || body.count > 4) return json({ error: '请选择有效的尺寸、场景和 1–4 张生成数量。' }, 400);
    upload = verify(body.uploadToken, 'upload');
    if (upload.owner !== auth.user.id || upload.user !== `scene-${auth.user.id}`) return json({ error: '这张图片不属于当前账号，请重新上传。' }, 403);
    if (body.prompt !== (upload.prompt || '')) return json({ error: '画面描述已改变，请重新提交。' },409);
    work = await ownWork(auth, upload.workId);
    existing = await ownImages(auth, work.id);
    if (body.ratio !== work.ratio || body.scene !== work.scene || body.count !== work.requested_count - existing.length) return json({ error: '本次创作参数已改变，请刷新作品后重试。' },409);
    const { key, base } = config();
    console.info('Generation requested', JSON.stringify({ userId: auth.user.id, email: auth.user.email, ratio: body.ratio, scene: body.scene, count: body.count }));
    upstream = await fetch(`${base}/chat-messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: { product_image: { type: 'image', transfer_method: 'local_file', upload_file_id: upload.id }, ratio: body.ratio, scene: body.scene, count: body.count },
        query: `请根据上传的商品图，按所选的 ${body.ratio} 比例、${body.scene}，生成 ${body.count} 张商品场景摄影图。${body.prompt ? `\n用户的画面要求：\n${body.prompt}\n请将这些要求用于场景构思与生图提示词，保留上传商品的外观。` : ''}`,
        response_mode: 'streaming', conversation_id: '', user: upload.user, auto_generate_name: false
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(270_000)])
    });
    if (!upstream.ok) {
      console.error('Dify generation rejected', upstream.status);
      return json({ error: errorMessage(upstream.status) }, 502);
    }
  } catch (error) {
    console.error('Generation request failed', error.name);
    return json({ error: error instanceof WorkError ? error.message : error.name === 'TimeoutError' ? '生成服务连接超时，请稍后重试。' : '生成请求失败，请重新上传图片后重试。' }, error.status || 400);
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = value => { if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)); };
      const images = [];
      const seen = new Set();
      let answer = '', workflowDone = false, messageDone = false;
      async function addImage(candidate) {
        const url = imageUrl(candidate);
        if (!url) { try { console.warn('Unsupported result image host:', new URL(candidate).hostname); } catch {} return; }
        if (images.length >= body.count) return;
        const identity = new URL(url).origin + new URL(url).pathname;
        if (seen.has(identity)) return;
        seen.add(identity);
        const position = [1,2,3,4].find(value => !existing.some(item => item.position === value) && !images.some(item => item.position === value));
        send({ event: 'status', step: 4, detail: '正在保存作品…' });
        const image = await saveResult(auth, work, url, position, request.signal);
        images.push(image);
        send({ event: 'image', image, count: images.length, requested: body.count });
      }
      try {
        send({ event: 'status', step: 1, detail: '已收到商品图片，正在启动场景创作' });
        for await (const event of sseEvents(upstream.body)) {
          if (cancelled) break;
          if (event.event === 'error') {
            console.error('Dify stream error', event.code || event.status);
            throw new Error(errorMessage(event.status || 500));
          }
          if (event.event === 'node_started') {
            console.info('Dify stage:', event.data?.node_type, event.data?.title);
            send({ event: 'status', ...progressFor(event.data) });
          }
          if (event.event === 'node_finished') {
            if (event.data?.status === 'failed') console.error('Dify node failed', event.data.node_type);
            if (event.data?.node_type === 'tool') for (const candidate of fileImages(event.data.outputs)) await addImage(candidate);
          }
          if (event.event === 'message_file' && event.type === 'image' && event.belongs_to !== 'user') await addImage(event.url);
          if (event.event === 'message' || event.event === 'agent_message') answer += event.answer || '';
          if (event.event === 'message_replace') answer = event.answer || '';
          if (event.event === 'message_end') { messageDone = true; for (const candidate of answerImages(answer)) await addImage(candidate); }
          if (event.event === 'workflow_finished') {
            workflowDone = true;
            if (event.data?.status !== 'succeeded') {
              console.error('Dify workflow failed', event.data?.status);
              throw new Error('本次图片生成未完成，请稍后重试。');
            }
            for (const candidate of fileImages(event.data.outputs)) await addImage(candidate);
          }
          if (workflowDone && messageDone) break;
          send({ event: 'heartbeat' });
        }
        for (const candidate of answerImages(answer)) await addImage(candidate);
        if (!workflowDone || !messageDone) throw new Error('生成连接提前结束，请检查网络后重新生成。');
        if (!images.length) throw new Error('生成服务未返回可用图片，请稍后重试。');
        send({ event: 'complete', workId: work.id, count: images.length, requested: body.count, partial: images.length < body.count });
      } catch (error) {
        console.error('Generation stream failed', error.name);
        send({ event: 'error', error: error.name === 'TimeoutError' || error.name === 'AbortError' ? '生成等待超时，请稍后重试。' : error.message });
      } finally { if (!cancelled) controller.close(); }
    },
    cancel() { cancelled = true; }
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
}
