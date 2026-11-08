// Dictation writes editable text into the composer; it never submits a generation.
export function createDictation({getText,onText,onState,onError}) {
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  let recognition=null, active=false, phase='idle', generation=0, deadline, finishing;
  function state(value,hint='') {phase=value;onState(value,hint);}
  function reset() {clearTimeout(deadline);clearTimeout(finishing);recognition=null;active=false;state('idle');}
  function cancel() {generation++;const current=recognition;reset();try{current?.abort();}catch{}}
  function stop() {
    if(!recognition||phase==='stopping')return;
    state('stopping','正在整理听写…');
    try{recognition.stop();}catch{cancel();return;}
    finishing=setTimeout(()=>{const current=recognition;generation++;reset();try{current?.abort();}catch{}},5000);
  }
  function start() {
    if(active){stop();return;}
    if(typeof Recognition!=='function'){onError('当前浏览器不支持语音听写，请用 Chrome 或 Safari 打开。');return;}
    if(!window.isSecureContext){onError('请在 HTTPS 网站或本地预览中使用语音听写。');return;}
    const base=getText();
    if(base.length>=1000){onError('文字已满，请删减后再听写。');return;}
    const id=++generation;
    let received=false;
    try{recognition=new Recognition();}catch{onError('此浏览器无法开启听写，请用 Chrome 或 Safari 打开。');return;}
    const current=recognition;
    current.lang='zh-CN';current.continuous=true;current.interimResults=true;current.maxAlternatives=1;
    active=true;state('starting','正在连接麦克风…');
    // Some embedded browsers expose the API but never answer the permission request.
    deadline=setTimeout(()=>{if(id!==generation)return;generation++;reset();try{current.abort();}catch{}onError('麦克风未连接，请检查浏览器权限后重试。');},12_000);
    current.onstart=()=>{
      if(id!==generation)return;
      clearTimeout(deadline);state('listening','正在听写，点击结束');
      deadline=setTimeout(stop,60_000);
    };
    current.onresult=event=>{
      if(id!==generation)return;
      const text=Array.from(event.results,result=>result[0]?.transcript||'').join('');
      const joined=base+(base&&!/\s$/.test(base)?'\n':'')+text;
      received=!!text.trim();onText(joined.slice(0,1000));
      if(joined.length>=1000)stop();
    };
    current.onerror=event=>{
      if(id!==generation)return;
      const messages={
        'not-allowed':'麦克风未获授权，请在浏览器设置中允许使用。',
        'service-not-allowed':'此浏览器无法开启听写，请用 Chrome 或 Safari 打开。',
        'audio-capture':'未找到可用麦克风，请检查设备。',
        'no-speech':'没有听清，请再试一次。',
        network:'听写连接失败，请检查网络后重试。',
        'language-not-supported':'当前浏览器不支持中文听写。'
      };
      generation++;reset();try{current.abort();}catch{}
      if(event.error!=='aborted')onError(messages[event.error]||'听写未能完成，请重试。');
    };
    current.onend=()=>{if(id!==generation)return;reset();if(!received)onError('没有听清，请再试一次。');};
    try{current.start();}catch{generation++;reset();onError('听写未能启动，请检查麦克风权限后重试。');}
  }
  return {toggle:start,cancel,stop,get active(){return active;}};
}
