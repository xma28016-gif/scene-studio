import { authReady, authorizedFetch, getCurrentUser, openAuthDialog, uploadOriginal } from './auth.js';
import { compressImage } from './image-processing.js';
import { Ocean } from './ocean.js';
import { createDictation } from './dictation.js';
import { ratios, scenes, sceneLabel, icon, escape, composerMarkup, roundMarkup, formatElapsed } from './studio-ui.js';
import { configureWorks, openWorks, closeWorks, worksActive } from './works.js';

const stage=document.querySelector('#stage');
const product=document.querySelector('#studio-product');
const upload=document.querySelector('#upload');
const settingsDialog=document.querySelector('#settings-dialog');
const viewerDialog=document.querySelector('#image-overlay');
const newButton=document.querySelector('#new-task');
const state={prompt:'',speech:'idle',speechHint:'',processingDetail:'',file:null,originalFile:null,originalMime:null,photo:null,ratio:'1:1',scene:'两种都要',count:2,rounds:[],busy:false,processing:false,error:'',viewer:null};
const urls=new Set();
let sequence=0,selection=0,controller=null,accountId=null;

const dictation=createDictation({getText:()=>state.prompt,onText:text=>{state.prompt=text;render()},onState:(speech,speechHint)=>{state.speech=speech;state.speechHint=speechHint;render()},onError:notice});
stage.addEventListener('input',event=>{if(event.target.id==='scene-prompt')state.prompt=event.target.value});
setInterval(()=>{for(const clock of stage.querySelectorAll('[data-elapsed]'))clock.textContent=formatElapsed(Number(clock.dataset.elapsed));},1000);
document.addEventListener('visibilitychange',()=>{if(document.hidden)dictation.cancel()});
window.addEventListener('pagehide',()=>dictation.cancel());

function objectUrl(blob){const url=URL.createObjectURL(blob);urls.add(url);return url}
function clearTask(){dictation.cancel();controller?.abort();selection++;for(const url of urls)URL.revokeObjectURL(url);urls.clear();Object.assign(state,{prompt:'',speech:'idle',speechHint:'',processingDetail:'',file:null,originalFile:null,originalMime:null,photo:null,ratio:'1:1',scene:'两种都要',count:2,rounds:[],busy:false,processing:false,error:'',viewer:null});settingsDialog.close();viewerDialog.close();upload.value='';render()}
function syncAccount(){const next=getCurrentUser()?.id||null;if(accountId&&accountId!==next)clearTask();accountId=next;render()}
document.addEventListener('auth-change',syncAccount);
authReady.then(syncAccount);

function composer(compact=false){return composerMarkup(state,compact)}
function roundHtml(round){return roundMarkup(round,{busy:state.busy})}
function render(forceBottom=false){const focused=document.activeElement?.id==='scene-prompt';const selectionRange=focused?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;const old=stage.querySelector('.chat-body');const scrollTop=old?.scrollTop||0;const nearBottom=!old||old.scrollHeight-old.scrollTop-old.clientHeight<100;const chat=state.rounds.length>0;product.classList.toggle('chat',chat&&!worksActive());newButton.hidden=!chat&&!worksActive();newButton.disabled=state.busy||state.processing;document.querySelector('#my-works').disabled=state.busy||state.processing;stage.innerHTML=chat?`<div class="chat-body">${state.rounds.map((round,index)=>`${index?'<div class="round-gap"></div>':''}${roundHtml(round)}`).join('')}</div><div class="chat-bottom">${composer(true)}</div>`:`<div class="home"><h1>好物，自有风景</h1>${composer()}${state.error?`<p class="form-error" role="alert">${escape(state.error)}</p>`:''}</div>`;const body=stage.querySelector('.chat-body');if(body)body.scrollTop=forceBottom||nearBottom?body.scrollHeight:scrollTop;if(focused&&!state.busy&&!state.processing){const input=stage.querySelector('#scene-prompt');if(input){input.focus({preventScroll:true});input.setSelectionRange(...selectionRange)}}}

function picker(kind){const values=kind==='ratio'?ratios:kind==='count'?[1,2,3,4]:scenes.map(item=>item[0]);const title={ratio:'比例',scene:'场景',count:'数量'}[kind];settingsDialog.innerHTML=`<h3 id="settings-title">${title}</h3><div class="${kind==='scene'?'scene-list':'choices'}">${values.map(value=>`<button class="${kind==='scene'?'scene-option':'choice'}" data-pick="${kind}" data-value="${value}" aria-pressed="${state[kind]===value}">${kind==='scene'?sceneLabel(value):value}${kind==='scene'&&state[kind]===value?icon('check'):''}</button>`).join('')}</div>`;settingsDialog.showModal()}
settingsDialog.addEventListener('click',event=>{const pick=event.target.closest('[data-pick]');if(pick){state[pick.dataset.pick]=pick.dataset.pick==='count'?Number(pick.dataset.value):pick.dataset.value;settingsDialog.close();render();return}if(event.target===settingsDialog){const box=settingsDialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)settingsDialog.close()}});

async function chooseFile(file){if(!file||state.busy||state.processing)return;const version=++selection;dictation.cancel();state.processing=true;state.processingDetail='';state.error='';render();try{const mime=originalMime(file);if(!mime)throw new Error('请选择 JPG、PNG、WebP、HEIC 等照片文件。');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const compressed=await compressImage(file,detail=>{if(version===selection){state.processingDetail=detail;render()}});if(version!==selection)return;state.file=compressed;state.originalFile=file;state.originalMime=mime;state.photo=objectUrl(compressed)}catch(error){if(version!==selection)return;state.error=error.message;notice(error.message)}finally{if(version===selection){state.processing=false;render()}}}
upload.addEventListener('change',()=>{chooseFile(upload.files[0]);upload.value=''});
stage.addEventListener('dragover',event=>{if(!event.target.closest('.composer'))return;event.preventDefault();if(!state.busy)event.target.closest('.composer').classList.add('drag-active')});
stage.addEventListener('dragleave',event=>event.target.closest('.composer')?.classList.remove('drag-active'));
stage.addEventListener('drop',event=>{if(!event.target.closest('.composer'))return;event.preventDefault();event.target.closest('.composer').classList.remove('drag-active');chooseFile(event.dataTransfer.files[0])});

async function apiJson(response){const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'服务暂时无法连接，请稍后重试。');return data}
async function readStream(response,onEvent){if(!response.ok)return apiJson(response);if(!response.body)throw new Error('生成连接未建立，请重试。');const reader=response.body.getReader();const decoder=new TextDecoder();let pending='';try{for(;;){const{value,done}=await reader.read();pending+=done?decoder.decode():decoder.decode(value,{stream:true});let match;while((match=/\r?\n\r?\n/.exec(pending))){const frame=pending.slice(0,match.index);pending=pending.slice(match.index+match[0].length);const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(data)onEvent(JSON.parse(data))}if(done)break}}finally{await reader.cancel().catch(()=>{})}}
async function loadResult(round,image,signal,owner){if(round.results.some(item=>item.id===image.id))return;const result={id:image.id,position:image.position,status:'loading',url:null};round.results.push(result);render();try{const response=await authorizedFetch(image.url,{signal});if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'图片未能载入，请重试。')}const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error('图片格式无效，请重试。');if(getCurrentUser()?.id!==owner)return;const url=objectUrl(blob);const preview=new Image();preview.src=url;await preview.decode();if(getCurrentUser()?.id!==owner)return;result.url=url;result.status='ready'}catch(error){result.status='error';result.error=error.message}finally{if(getCurrentUser()?.id===owner)render()}}

function originalMime(file) {
  const allowed=['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','image/avif','image/bmp','image/tiff'];
  if(allowed.includes(file.type))return file.type;
  if(file.type && !['application/octet-stream','image/jpg','image/x-ms-bmp'].includes(file.type))return null;
  return {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',heic:'image/heic',heif:'image/heif',avif:'image/avif',bmp:'image/bmp',tif:'image/tiff',tiff:'image/tiff'}[file.name.split('.').pop().toLowerCase()]||null;
}
async function generate(retryId=null) {
  if(state.busy||state.processing||dictation.active)return;
  state.busy=true;render();
  await authReady;
  state.busy=false;
  const user=getCurrentUser();if(!user){render();openAuthDialog();return;}
  let round;
  if(retryId!==null){
    round=state.rounds.find(item=>item.id===retryId);if(!round)return;
    round.results=round.results.filter(item=>item.status==='ready');round.error='';round.status='working';
  }else{
    if(!state.file||!state.originalFile){render();return;}
    round={id:++sequence,prompt:state.prompt.trim(),file:state.file,originalFile:state.originalFile,originalMime:state.originalMime,photo:state.photo,ratio:state.ratio,scene:state.scene,count:state.count,status:'working',results:[],detail:'正在保存原图…',error:''};
    state.rounds.push(round);
  }
  const owner=user.id, abort=new AbortController();controller=abort;
  const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(290_000)]);
  state.busy=true;round.phase='upload';round.startedAt=Date.now();round.detail='正在保存原图…';state.error='';render(true);
  let completed=false;const imageJobs=[];
  try {
    if(!round.workId){
      const work=await apiJson(await authorizedFetch('/api/works',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ratio:round.ratio,scene:round.scene,count:round.count,originalName:round.originalFile.name,originalMime:round.originalMime,originalBytes:round.originalFile.size,previewMime:round.file.type}),signal}));
      round.workId=work.id;round.storage=work;
    }
    if(!round.originalSaved){await uploadOriginal(round.storage,round.originalFile,signal);round.originalSaved=true;}
    // Recover images already committed before a disconnected stream or preview failure.
    if(retryId!==null){
      const saved=await authorizedFetch(`/api/works?id=${round.workId}`,{signal});
      if(saved.ok){const{work}=await saved.json();await Promise.all(work.images.map(image=>loadResult(round,image,signal,owner)));}
      else if(saved.status!==404)await apiJson(saved);
    }
    if(getCurrentUser()?.id!==owner)return;
    const requested=round.count-round.results.length;
    if(requested>0){
      round.detail='正在上传图片…';render();
      const uploadForm=new FormData();uploadForm.append('file',round.file);uploadForm.append('workId',round.workId);uploadForm.append('prompt',round.prompt||'');
      const{uploadToken}=await apiJson(await authorizedFetch('/api/upload',{method:'POST',body:uploadForm,signal}));
      round.phase='generate';round.detail='正在分析商品与场景…';render();
      const response=await authorizedFetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadToken,ratio:round.ratio,scene:round.scene,count:requested,prompt:round.prompt||''}),signal});
      await readStream(response,event=>{
        if(event.event==='status'){round.detail=event.detail;render();}
        if(event.event==='image')imageJobs.push(loadResult(round,event.image,signal,owner));
        if(event.event==='error')throw new Error(event.error);
        if(event.event==='complete'){completed=true;round.detail='正在整理图片…';render();}
      });
      if(!completed)throw new Error('生成连接提前结束，请稍后重试。');
      await Promise.all(imageJobs);
    }
    if(getCurrentUser()?.id!==owner)return;
    const ready=round.results.filter(item=>item.status==='ready').length;
    if(ready<round.count)throw new Error(`已完成 ${ready} / ${round.count} 张，剩余图片可重试。`);
    round.status='done';
  } catch(error) {
    await Promise.allSettled(imageJobs);if(getCurrentUser()?.id!==owner)return;
    round.status='error';round.error=error.name==='TimeoutError'||error.name==='AbortError'?'等待超时；已完成的图片可在我的作品查看。':error.message;
  } finally {if(controller===abort){controller=null;state.busy=false;render();}}
}

function download(round,index){const result=round.results[index];if(result?.status!=='ready')return;const anchor=document.createElement('a');anchor.href=result.url;anchor.download=`scene-studio-${round.id}-${index+1}.jpg`;anchor.click()}
function showViewer(){if(!state.viewer)return;const round=state.rounds.find(item=>item.id===state.viewer.round);if(!round)return;const ready=round.results.map((result,index)=>({result,index})).filter(item=>item.result.status==='ready');const position=ready.findIndex(item=>item.index===state.viewer.index);if(position<0)return;viewerDialog.innerHTML=`<div class="viewer-header"><span>${position+1} / ${ready.length}</span><button class="close" data-viewer="close" aria-label="关闭图片">${icon('close')}</button></div><div class="viewer-main"><button class="viewer-arrow" data-viewer="previous" aria-label="上一张" ${position===0?'disabled':''}>${icon('left')}</button><img class="viewer-picture" src="${escape(ready[position].result.url)}" alt="场景图 ${position+1}"><button class="viewer-arrow" data-viewer="next" aria-label="下一张" ${position===ready.length-1?'disabled':''}>${icon('right')}</button></div><button class="viewer-save" data-viewer="download">${icon('save')}下载</button>`;if(!viewerDialog.open)viewerDialog.showModal()}
viewerDialog.addEventListener('click',event=>{const button=event.target.closest('[data-viewer]');if(!button||!state.viewer)return;const round=state.rounds.find(item=>item.id===state.viewer.round);const ready=round.results.map((result,index)=>({result,index})).filter(item=>item.result.status==='ready');const position=ready.findIndex(item=>item.index===state.viewer.index);const action=button.dataset.viewer;if(action==='close'){viewerDialog.close();return}if(action==='download'){download(round,state.viewer.index);return}const next=ready[position+(action==='next'?1:-1)];if(next){state.viewer.index=next.index;showViewer()}});
viewerDialog.addEventListener('close',()=>{state.viewer=null});

stage.addEventListener('click',event=>{const saved=event.target.closest('[data-saved-work]');if(saved){openWorks(saved.dataset.savedWork);return}const setting=event.target.closest('[data-setting]');if(setting){picker(setting.dataset.setting);return}const image=event.target.closest('[data-view-image]');if(image){state.viewer={round:Number(image.dataset.round),index:Number(image.dataset.viewImage)};showViewer();return}const save=event.target.closest('[data-download]');if(save){const round=state.rounds.find(item=>item.id===Number(save.dataset.round));if(round)download(round,Number(save.dataset.download));return}const retry=event.target.closest('[data-retry]');if(retry){generate(Number(retry.dataset.retry));return}const action=event.target.closest('[data-action]')?.dataset.action;if(action==='dictate'){if(!state.busy&&!state.processing)dictation.toggle();return}if(action==='upload'){upload.click();return}if(action==='generate'){generate();return}if(action==='remove'&&!state.busy){selection++;state.file=null;state.originalFile=null;state.originalMime=null;state.photo=null;state.error='';render()}});
newButton.addEventListener('click',()=>{if(state.busy||state.processing)return;if(worksActive())closeWorks();clearTask()});
document.querySelector('#my-works').addEventListener('click',()=>openWorks());
configureWorks({isBusy:()=>state.busy||state.processing||dictation.active,onChange:()=>render()});
function notice(text){const box=document.querySelector('#studio-notice');box.textContent=text;box.hidden=false;clearTimeout(notice.timer);notice.timer=setTimeout(()=>box.hidden=true,7000)}
render();
Ocean.resize();
