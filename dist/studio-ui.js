export const ratios=['1:1','3:4','4:3','2:3','3:2','16:9','9:16'];
export const scenes=[['两种都要','全部场景'],['纯商品展示场景','静物展示'],['人机交互场景','人物互动']];
export const sceneLabel=value=>scenes.find(item=>item[0]===value)?.[1]||value;
export const icon=name=>`<svg aria-hidden="true"><use href="#${name}"></use></svg>`;
export const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function attachment(state) {
  if(state.processing)return `<div class="attachment-loading" role="status"><span class="spinner"></span>${escape(state.processingDetail||'图片加载中…')}</div>`;
  if(state.photo)return `<div class="attachment-preview"><button class="attachment-picture" data-action="upload" aria-label="替换图片" ${state.busy?'disabled':''}><img src="${escape(state.photo)}" alt="已上传图片"></button><button class="attachment-remove" data-action="remove" aria-label="移除图片" ${state.busy?'disabled':''}>${icon('close')}</button></div>`;
  return `<button class="attachment-add" data-action="upload" ${state.busy?'disabled':''}>${icon('plus')}上传图片</button>`;
}
export function composerMarkup(state,compact=false) {
  const disabled=state.busy||state.processing;
  const speech=state.speech||'idle', listening=speech==='listening', speechBusy=speech!=='idle';
  const dictationLabel=listening?'结束听写':speech==='starting'?'正在连接麦克风':speech==='stopping'?'正在整理听写':'语音听写';
  return `<section class="composer ${compact?'compact':''}" aria-label="创作设置" aria-busy="${disabled}">
    <div class="composer-content">${attachment(state)}<textarea id="scene-prompt" class="scene-prompt" aria-label="画面描述" placeholder="写下你想象的画面…" rows="3" maxlength="1000" ${disabled||speechBusy?'readonly':''}>${escape(state.prompt||'')}</textarea></div>
    <div class="composer-toolbar"><div class="parameters">
      <button class="parameter" data-setting="ratio" aria-label="比例：${state.ratio}" ${disabled?'disabled':''}>${state.ratio}${icon('down')}</button>
      <button class="parameter" data-setting="scene" aria-label="场景：${sceneLabel(state.scene)}" ${disabled?'disabled':''}>${sceneLabel(state.scene)}${icon('down')}</button>
      <button class="parameter" data-setting="count" aria-label="数量：${state.count} 张" ${disabled?'disabled':''}>${state.count} 张${icon('down')}</button>
    </div><div class="composer-actions"><button class="dictation-button ${listening?'is-listening':''}" data-action="dictate" aria-label="${dictationLabel}" title="${dictationLabel}" aria-pressed="${listening}" ${disabled||speech==='starting'||speech==='stopping'?'disabled':''}>${speech==='starting'||speech==='stopping'?'<span class="spinner"></span>':icon(listening?'stop':'mic')}</button>
      <button class="go" data-action="generate" aria-label="${state.busy?'加载中':'生成'}" ${disabled||!state.file||speechBusy?'disabled':''}>${state.busy?'<span class="spinner"></span><span>加载中</span>':`<span class="go-label">生成</span>${icon('send')}`}</button></div></div>
    <div class="dictation-feedback" role="status" aria-live="polite" ${state.speechHint?'':'hidden'}>${listening?'<span class="voice-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>':''}<span>${escape(state.speechHint||'')}</span></div>
  </section>`;
}

function imageGrid(round) {
  const count=round.status==='working'?round.count:round.results.length;
  const items=Array.from({length:count},(_,index)=>{
    const result=round.results[index];
    if(result?.status==='ready')return `<div class="result"><button class="result-image" data-view-image="${index}" data-round="${round.id}" aria-label="查看第 ${index+1} 张图片"><img src="${escape(result.url)}" alt="场景图 ${index+1}"></button><button class="save" data-download="${index}" data-round="${round.id}" aria-label="下载第 ${index+1} 张图片">${icon('save')}</button></div>`;
    if(result?.status==='error')return '<div class="result blank"><div class="result-image result-failed">图片未能载入</div></div>';
    return `<div class="result blank"><div class="result-image loading-image" aria-label="第 ${index+1} 张图片加载中"><span class="loading-image-inner"><span class="waiting-dot" aria-hidden="true"><i></i><i></i><i></i></span><span>${result?.status==='loading'?'图片载入中':round.phase==='upload'?'等待生成':'生成中'}</span></span></div></div>`;
  });
  return count?`<div class="image-grid ${count===1?'single':''}" style="--ratio:${round.ratio.replace(':','/')}">${items.join('')}</div>`:'';
}
export function formatElapsed(startedAt) {
  const seconds=Math.max(0,Math.floor((Date.now()-(startedAt||Date.now()))/1000));
  return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
}
export function roundMarkup(round,{busy=false}={}) {
  const working=round.status==='working';
  return `<div class="request"><span class="thumb"><img src="${escape(round.photo)}" alt="本次上传图片"></span><div class="request-copy">${round.prompt?`<p class="request-prompt">${escape(round.prompt)}</p>`:''}<div class="request-meta"><span>${round.ratio}</span><span>${sceneLabel(round.scene)}</span><span>${round.count} 张</span></div></div></div>
    <div class="response"><div class="agent-mark" aria-label="Agent">✳</div><div class="response-content">
      ${working?`<div class="generation-loading" role="status" aria-live="polite"><div class="loading-title"><span class="spinner" aria-hidden="true"></span><span>加载中</span><time class="loading-elapsed" data-elapsed="${round.startedAt||Date.now()}" aria-live="off">${formatElapsed(round.startedAt)}</time></div><p>${escape(round.detail||'正在生成画面…')}</p><div class="loading-track" aria-hidden="true"><span></span></div></div>`:''}
      ${imageGrid(round)}${round.error?`<div class="partial-status" role="alert"><span class="error-copy">${escape(round.error)}</span><button class="retry" data-retry="${round.id}" ${busy?'disabled':''}>${icon('retry')}重试</button></div>`:''}
      ${round.workId&&round.results.some(item=>item.status==='ready')&&!working?`<button class="round-saved" data-saved-work="${round.workId}">已存入我的作品${icon('right')}</button>`:''}
    </div></div>`;
}
