const MAX_BYTES = 3_000_000;
let heicLoader;
function loadHeicConverter() {
  heicLoader ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/heic2any.min.js';
    script.onload = () => resolve(window.heic2any);
    script.onerror = () => { heicLoader = null; script.remove(); reject(new Error('手机照片转换组件加载失败，请检查网络后重试。')); };
    document.head.append(script);
  });
  return heicLoader;
}

async function decodeImage(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally { URL.revokeObjectURL(url); }
  }
}

export async function compressImage(file, onStatus = () => {}) {
  onStatus('图片加载中…');
  const heic = /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
  if (!file.type.startsWith('image/') && !heic && !/\.(jpe?g|png|webp|gif)$/i.test(file.name)) throw new Error('请选择一张商品照片。');
  if (file.size > 80_000_000) throw new Error('这张照片超过 80 MB，请选择体积较小的照片。');
  let source = file, image;
  try { image = await decodeImage(source); }
  catch {
    if (!heic) throw new Error('无法读取这张照片，请选择 JPG、PNG、WebP 或 HEIC 图片。');
    onStatus('正在转换照片…');
    const convert = await loadHeicConverter();
    source = await convert({ blob: file, toType: 'image/jpeg', quality: 0.94 });
    if (Array.isArray(source)) source = source[0];
    image = await decodeImage(source);
  }
  try {
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    if (!width || !height) throw new Error('图片尺寸无效，请选择另一张照片。');
    if (source.size <= MAX_BYTES && Math.max(width, height) <= 3200 && ['image/jpeg', 'image/png', 'image/webp'].includes(source.type)) return new File([source], `product.${source.type.split('/')[1].replace('jpeg', 'jpg')}`, { type: source.type });
    onStatus('正在压缩图片…');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    let scale = Math.min(1, 3200 / Math.max(width, height));
    for (let round = 0; round < 8; round++) {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.78, 0.66, 0.54]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= MAX_BYTES) return new File([blob], 'product.jpg', { type: 'image/jpeg' });
      }
      scale *= 0.75;
    }
    throw new Error('照片压缩失败，请选择另一张照片。');
  } finally { image.close?.(); }
}
