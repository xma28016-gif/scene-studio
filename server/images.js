import sharp from 'sharp';
import { imageUrl, RATIOS } from './dify.js';

// Keep the saved image, preview and download on exactly the same centre crop.
export async function resultImage(candidate, ratio, signal) {
  if (!RATIOS.includes(ratio)) throw new Error('图片比例无效。');
  let url = imageUrl(candidate), response;
  if (!url) throw new Error('图片地址不受支持。');
  for (let redirects = 0; redirects < 4; redirects++) {
    response = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        Accept: 'image/png,image/jpeg,image/webp,image/gif,*/*;q=0.8'
      }
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    url = location && imageUrl(new URL(location, url).href);
    if (!url) throw new Error('图片地址不受支持。');
  }
  if (!response.ok || Number(response.headers.get('content-length')) > 25_000_000) throw new Error('生成图片暂时无法保存，请稍后重试。');
  const chunks = [], reader = response.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 25_000_000) throw new Error('生成图片过大，无法保存。');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const source = Buffer.concat(chunks);
  const raster = source.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
    (source[0] === 255 && source[1] === 216) || source.subarray(0,3).toString() === 'GIF' ||
    (source.subarray(0,4).toString() === 'RIFF' && source.subarray(8,12).toString() === 'WEBP');
  if (!raster) throw new Error('生成图片格式不受支持。');
  const pipeline = sharp(source, { limitInputPixels: 40_000_000 });
  const metadata = await pipeline.metadata();
  const rotated = metadata.orientation >= 5 && metadata.orientation <= 8;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  const [rw,rh] = ratio.split(':').map(Number);
  const unit = Math.floor(Math.min(width/rw,height/rh));
  if (unit < 1) throw new Error('图片尺寸无法处理。');
  return pipeline.rotate().resize({ width: unit*rw, height: unit*rh, fit: 'cover', position: 'centre' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}
