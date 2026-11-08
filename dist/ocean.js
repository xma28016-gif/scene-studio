const OCEAN_IMAGE='/assets/ocean-sapphire.png';
// One persistent GPU water surface; the prototype's task UI stays unchanged.
export const Ocean = (() => {
  const host=document.querySelector('#preview');
  const canvas=document.querySelector('#ocean-canvas');
  canvas.hidden=true;
  const media=document.createElement('style');
  media.textContent=`#preview,.product{background-image:linear-gradient(#e4f1fb55,#d6eafb47),url("${OCEAN_IMAGE}")}`;
  document.head.append(media);
  const gl=canvas.getContext('webgl',{alpha:false,antialias:false,powerPreference:'low-power'});
  if(!gl)return {setActive(){},resize(){}};
  const vertex=`attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
  const fragment=`precision mediump float;
    uniform sampler2D photo;uniform vec2 size;uniform float imageRatio;uniform float time;
    void main(){
      vec2 uv=vec2(gl_FragCoord.x/size.x,1.-gl_FragCoord.y/size.y);
      float ratio=size.x/size.y;
      vec2 cover=vec2(min(ratio/imageRatio,1.),min(imageRatio/ratio,1.));
      uv=(uv-.5)*cover+.5;
      vec2 p=uv;
      float t=time;
      vec2 flow=vec2(
        sin(p.y*15.+p.x*4.-t*.38)+.45*sin(p.y*29.-p.x*8.-t*.26),
        sin(p.x*13.+p.y*6.-t*.31)+.4*sin(p.x*25.-p.y*5.+t*.22)
      );
      uv=uv*.94+.03+flow*vec2(.012,.008);
      vec3 sea=texture2D(photo,clamp(uv,.001,.999)).rgb;
      float shimmer=sin(p.x*10.+p.y*16.-t*.33)*sin(p.y*22.-t*.2);
      sea*=.86+shimmer*.035;
      sea=mix(sea,vec3(.86,.94,.99),.32);
      gl_FragColor=vec4(sea,1.);
    }`;
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Water shader could not compile');return s}
  let program;
  try{program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Water shader could not link')}
  catch{canvas.hidden=true;return {setActive(){},resize(){}}}
  gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'a');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  const time=gl.getUniformLocation(program,'time');const size=gl.getUniformLocation(program,'size');
  let loaded=false,active=true,frame=0,last=0;
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  function draw(now=0){if(!loaded||!active)return;if(now-last>32||reduce.matches){last=now;gl.uniform1f(time,reduce.matches?0:now/1000);gl.drawArrays(gl.TRIANGLES,0,6);canvas.hidden=false}if(!reduce.matches)frame=requestAnimationFrame(draw)}
  function restart(){cancelAnimationFrame(frame);last=-100;if(loaded&&active)frame=requestAnimationFrame(draw)}
  function resize(){const box=host.getBoundingClientRect();if(!box.width||!box.height)return;const scale=Math.min(devicePixelRatio||1,1.25,1600/box.width,1100/box.height);canvas.width=Math.round(box.width*scale);canvas.height=Math.round(box.height*scale);gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(size,canvas.width,canvas.height);restart()}
  function setActive(value){active=value&&!document.hidden;restart()}
  const photo=new Image();photo.onload=()=>{const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,photo);gl.uniform1i(gl.getUniformLocation(program,'photo'),0);gl.uniform1f(gl.getUniformLocation(program,'imageRatio'),photo.width/photo.height);loaded=true;resize()};photo.src=OCEAN_IMAGE;
  new ResizeObserver(resize).observe(host);
  document.addEventListener('visibilitychange',()=>setActive(true));
  reduce.addEventListener('change',restart);
  return {setActive,resize};
})();
