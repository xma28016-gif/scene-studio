import sharp from 'sharp';
import { imageUrl, json, verify, RATIOS } from '../server/dify.js';
import { requireUser } from '../server/auth.js';

export async function GET(request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    const { url: signedUrl, index, ratio, owner } = verify(params.get('token'), 'image');
    if (owner !== auth.user.id) return json({ error: '这张图片不属于当前账号。' }, 403);
    if (!RATIOS.includes(ratio)) return json({ error: '图片尺寸参数无效，请重新生成。' }, 400);
    let url = imageUrl(signedUrl);
    if (!url) return json({ error: '图片地址无效。' }, 400);
    let response;
    for (let redirects = 0; redirects < 4; redirects++) {
      response = await fetch(url, {
        redirect: 'manual', signal: AbortSignal.timeout(30_000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          Accept: 'image/png,image/jpeg,image/webp,image/gif,*/*;q=0.8'
        }
      });
      if (response.status >= 300 && response.status < 400) {
        const next = imageUrl(new URL(response.headers.get('location'), url).href);
        await response.body?.cancel();
        if (!next) return json({ error: '图片地址不受支持。' }, 400);
        url = next;
      } else break;
    }
    const type = response.headers.get('content-type') || '';
    if (!response.ok) {
      console.error('Result image upstream rejected', response.status, type);
      return json({ error: '图片暂时无法下载，请重新生成后重试。' }, 502);
    }
    if (Number(response.headers.get('content-length')) > 25_000_000) return json({ error: '图片文件过大，暂时无法处理。' }, 502);
    const source = Buffer.from(await response.arrayBuffer());
    if (source.length > 25_000_000) return json({ error: '图片文件过大，暂时无法处理。' }, 502);
    const raster = source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || (source[0] === 255 && source[1] === 216) || source.subarray(0, 3).toString() === 'GIF' || (source.subarray(0, 4).toString() === 'RIFF' && source.subarray(8, 12).toString() === 'WEBP');
    if (!raster) {
      console.error('Result image is not a supported raster', response.status, type);
      return json({ error: '图片暂时无法下载，请重新生成后重试。' }, 502);
    }
    const pipeline = sharp(source, { limitInputPixels: 40_000_000 });
    const metadata = await pipeline.metadata();
    const rotated = metadata.orientation >= 5 && metadata.orientation <= 8;
    const sourceWidth = rotated ? metadata.height : metadata.width;
    const sourceHeight = rotated ? metadata.width : metadata.height;
    const [rw, rh] = ratio.split(':').map(Number);
    const unit = Math.floor(Math.min(sourceWidth / rw, sourceHeight / rh));
    if (unit < 1) return json({ error: '图片尺寸无法处理。' }, 502);
    const cropped = await pipeline.rotate().resize({ width: unit * rw, height: unit * rh, fit: 'cover', position: 'centre' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    const disposition = params.get('inline') === '1' ? 'inline' : 'attachment';
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(cropped); controller.close(); } }), { headers: { 'Content-Type': 'image/jpeg', 'Content-Disposition': `${disposition}; filename="scene-studio-${index}.jpg"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    console.error('Image download failed', error.name);
    return json({ error: '图片下载失败或链接已过期，请重新生成。' }, 400);
  }
}
