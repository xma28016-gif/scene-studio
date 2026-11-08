import { authReady, authorizedFetch, getCurrentUser, openAuthDialog } from './auth.js';

const panel = document.querySelector('#works-panel');
const stage = document.querySelector('#stage');
const product = document.querySelector('#studio-product');
const dialog = document.querySelector('#work-viewer');
const icon = name => `<svg aria-hidden="true"><use href="#${name}"></use></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scene = value => ({'两种都要':'全部场景','纯商品展示场景':'静物展示','人机交互场景':'人物互动'}[value] || value);
const date = value => new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const cache = new Map(), urls = new Set();
let owner = null, version = 0, abort = new AbortController(), onChange = () => {}, isBusy = () => false;
let active = false, pending = false, current = null, records = [], hasMore = false, loading = false, viewerIndex = 0;

async function json(url) {
  const response = await authorizedFetch(url,{signal:abort.signal});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '作品暂时无法载入。');
  return data;
}
async function imageBlob(url) {
  if (cache.has(url)) return cache.get(url);
  const account = owner, signal = abort.signal;
  const job = (async () => {
    const response = await authorizedFetch(url,{signal});
    if (!response.ok) throw new Error('图片暂时无法载入。');
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || account !== getCurrentUser()?.id || signal.aborted) throw new Error('图片无法载入。');
    const local = URL.createObjectURL(blob); urls.add(local); return local;
  })();
  cache.set(url,job);
  job.catch(()=>cache.delete(url));
  return job;
}
function fillImages(root, stamp) {
  for (const img of root.querySelectorAll('[data-private-image]')) {
    imageBlob(img.dataset.privateImage).then(url=>{if (stamp===version && img.isConnected) { img.src=url; img.classList.add('loaded'); }}).catch(()=>{
      if (stamp===version && img.isConnected) { img.alt='图片暂时无法载入'; img.closest('.work-cover,.work-photo')?.classList.add('image-unavailable'); }
    });
  }
}
function navigate(id, replace = false) {
  const url = new URL(location.href); url.searchParams.delete('work'); url.searchParams.delete('works');
  if (id) url.searchParams.set('work',id); else url.searchParams.set('works','1');
  history[replace ? 'replaceState' : 'pushState'](null,'',url);
}
function setActive(value) {
  active=value; stage.hidden=value; panel.hidden=!value;
  product.classList.toggle('works-view',value);
  if (value) product.classList.remove('chat');
  onChange(value);
}
function heading(title, back = false) {
  return `<div class="works-heading">${back ? `<button class="works-back" data-works="list">${icon('left')}我的作品</button>` : '<span></span>'}<h1>${title}</h1><span></span></div>`;
}
function showError(message, id) {
  panel.innerHTML=`${heading(id ? '作品' : '我的作品',!!id)}<div class="works-empty" role="alert"><p>${esc(message)}</p><button class="works-text-button" data-works="reload" data-id="${esc(id || '')}">重新载入</button></div>`;
}
function listMarkup() {
  if (!records.length) return `${heading('我的作品')}<div class="works-empty"><p>风景，待你创作。</p><button class="works-text-button" data-works="create">去创作${icon('right')}</button></div>`;
  return `${heading('我的作品')}<div class="works-grid">${records.map(work=>`<button class="work-card" data-work-id="${work.id}"><span class="work-cover" style="--ratio:${work.ratio.replace(':','/')}"><img data-private-image="${esc(work.images[0].url)}" alt="${esc(scene(work.scene))}" loading="lazy"></span><span class="work-card-meta"><time datetime="${work.createdAt}">${date(work.createdAt)}</time><span>${work.ratio} · ${work.images.length} 张</span></span></button>`).join('')}</div>${hasMore ? `<button class="works-more" data-works="more" ${loading?'disabled':''}>${loading?'载入中…':'更多作品'}</button>` : ''}`;
}
async function list(append = false) {
  const stamp=++version; current=null; loading=true;
  if (!append) { records=[]; panel.innerHTML=`${heading('我的作品')}<div class="works-empty" role="status">载入中…</div>`; }
  try {
    const data=await json(`/api/works?offset=${append ? records.length : 0}`);
    if (stamp!==version || !active) return;
    records=append ? records.concat(data.works) : data.works; hasMore=data.hasMore; loading=false;
    panel.innerHTML=listMarkup(); fillImages(panel,stamp);
  } catch(error) { if(stamp===version && !abort.signal.aborted) { loading=false; showError(error.message); } }
}
async function detail(id) {
  const stamp=++version; current=null;
  panel.innerHTML=`${heading('作品',true)}<div class="works-empty" role="status">载入中…</div>`;
  try {
    const {work}=await json(`/api/works?id=${encodeURIComponent(id)}`);
    if(stamp!==version || !active) return;
    current=work;
    panel.innerHTML=`${heading('作品',true)}<div class="work-detail-meta"><time datetime="${work.createdAt}">${date(work.createdAt)}</time><span>${work.ratio} · ${esc(scene(work.scene))} · ${work.count} 张</span></div><div class="work-original"><button class="work-original-picture" data-work-view="-1" aria-label="查看原图"><img data-private-image="${esc(work.originalUrl)}" alt="原图"></button><span>原图</span><button class="works-text-button" data-work-download="-1">${icon('save')}下载</button></div><div class="work-detail-grid" style="--ratio:${work.ratio.replace(':','/')}">${work.images.map((image,index)=>`<div class="work-photo"><button data-work-view="${index}" aria-label="查看第 ${index+1} 张作品"><img data-private-image="${esc(image.url)}" alt="场景图 ${index+1}"></button><button class="work-image-save" data-work-download="${index}" aria-label="下载第 ${index+1} 张作品">${icon('save')}</button></div>`).join('')}</div>`;
    fillImages(panel,stamp);
  } catch(error) { if(stamp===version && !abort.signal.aborted) showError(error.message,id); }
}
export function configureWorks(options) {
  onChange=options.onChange; isBusy=options.isBusy;
  authReady.then(restore);
}
export function worksActive() { return active; }
export async function openWorks(id = null, push = true) {
  if (isBusy()) return;
  await authReady;
  if (!getCurrentUser()) { pending=id || true; openAuthDialog(); return; }
  if (push) navigate(id);
  setActive(true);
  if (id) await detail(id); else await list();
}
export function closeWorks() {
  version++; dialog.close(); setActive(false);
  const url=new URL(location.href); url.searchParams.delete('work'); url.searchParams.delete('works'); history.pushState(null,'',url);
}
function restore() {
  const params=new URLSearchParams(location.search);
  if (params.has('work') || params.has('works')) openWorks(params.get('work'),false);
  else if(active) { version++; dialog.close(); setActive(false); }
}
window.addEventListener('popstate',restore);
function syncOwner() {
  const next=getCurrentUser()?.id || null;
  if (owner===next) return;
  version++; abort.abort(); abort=new AbortController();
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear(); cache.clear(); records=[]; current=null; loading=false; owner=next;
  dialog.close(); panel.innerHTML='';
  if (!next && active) { pending=false; closeWorks(); }
  if(next && pending) { const id=typeof pending==='string' ? pending : null; pending=false; queueMicrotask(()=>openWorks(id)); }
  else if(next && active) restore();
}
document.addEventListener('auth-change',syncOwner);
authReady.then(syncOwner);

async function download(index) {
  if (!current) return;
  const work=current, account=owner;
  try {
    let url, name;
    if (index === -1) {
      const response=await authorizedFetch(work.originalDownloadUrl,{signal:abort.signal});
      if (!response.ok) throw new Error('原图暂时无法下载。');
      const blob=await response.blob();
      if(account!==getCurrentUser()?.id) return;
      url=URL.createObjectURL(blob); urls.add(url); name=work.originalName;
      setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},60_000);
    } else { url=await imageBlob(work.images[index].url); name=`scene-studio-${work.id}-${index+1}.jpg`; }
    if(account!==getCurrentUser()?.id) return;
    const a=document.createElement('a');a.href=url;a.download=name;a.click();
  } catch(error) { if(!abort.signal.aborted) notify(error.message); }
}
function notify(text) {
  const box=document.querySelector('#studio-notice');box.textContent=text;box.hidden=false;
  clearTimeout(notify.timer);notify.timer=setTimeout(()=>box.hidden=true,5000);
}
async function view(index) {
  if(!current) return;
  const stamp=version, work=current; viewerIndex=index;
  const original=index===-1;
  dialog.innerHTML=`<div class="viewer-header"><span>${original?'原图':`${index+1} / ${work.images.length}`}</span><button class="close" data-work-viewer="close" aria-label="关闭图片">${icon('close')}</button></div><div class="viewer-main"><button class="viewer-arrow" data-work-viewer="previous" aria-label="上一张" ${index<=0?'disabled':''}>${icon('left')}</button><img class="viewer-picture" alt="载入中…"><button class="viewer-arrow" data-work-viewer="next" aria-label="下一张" ${original || index>=work.images.length-1?'disabled':''}>${icon('right')}</button></div><button class="viewer-save" data-work-viewer="download">${icon('save')}下载</button>`;
  if(!dialog.open) dialog.showModal();
  try {
    const url=await imageBlob(original ? work.originalUrl : work.images[index].url);
    if(stamp===version && viewerIndex===index && dialog.open) { const img=dialog.querySelector('img');img.src=url;img.alt=original?'原图':`场景图 ${index+1}`; }
  } catch(error) { if(stamp===version && dialog.open) notify(error.message); }
}
panel.addEventListener('click',event=>{
  const card=event.target.closest('[data-work-id]'); if(card) { openWorks(card.dataset.workId);return; }
  const picture=event.target.closest('[data-work-view]'); if(picture) { view(Number(picture.dataset.workView));return; }
  const save=event.target.closest('[data-work-download]'); if(save) { download(Number(save.dataset.workDownload));return; }
  const button=event.target.closest('[data-works]');if(!button)return;
  if(button.dataset.works==='list')openWorks();
  if(button.dataset.works==='create')closeWorks();
  if(button.dataset.works==='reload')openWorks(button.dataset.id || null,false);
  if(button.dataset.works==='more' && !loading)list(true);
});
dialog.addEventListener('click',event=>{
  const action=event.target.closest('[data-work-viewer]')?.dataset.workViewer;
  if(action==='close')dialog.close();
  if(action==='download')download(viewerIndex);
  if(action==='previous' && viewerIndex>0)view(viewerIndex-1);
  if(action==='next' && viewerIndex>=0 && viewerIndex<current.images.length-1)view(viewerIndex+1);
});
