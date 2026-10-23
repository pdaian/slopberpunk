// The visible interface is batched WebGL geometry, pixel glyphs and asset textures.
// The unpainted semantic tree retains browser layout, focus, IME, password managers,
// touch scrolling and screen readers, and dispatches the existing game actions.
// It is never captured as an HTML image. GPL-3.0-or-later.
import { GlyphAtlas } from './pixel-font.js';

const vertex = `attribute vec2 position; attribute vec2 uv; attribute vec4 tint;
uniform vec2 viewport; varying vec2 texcoord; varying vec4 color;
void main(){gl_Position=vec4(position/viewport*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);texcoord=uv;color=tint;}`;
const fragment = `precision mediump float; varying vec2 texcoord; varying vec4 color;
uniform sampler2D image; void main(){gl_FragColor=texture2D(image,texcoord)*color;}`;
const white = [0.5 / 1024, 0.5 / 1024, 0, 0];
const number = value => parseFloat(value) || 0;
const box = r => ({ x:r.x, y:r.y, w:r.width, h:r.height });

export function rgba(value, opacity = 1) {
  if (!value || value === 'transparent') return [0,0,0,0];
  if (value[0] === '#') {
    let hex = value.slice(1);
    if (hex.length < 5) hex = [...hex].map(c => c+c).join('');
    return [0,2,4].map(i => parseInt(hex.slice(i,i+2),16)/255).concat((hex.length===8?parseInt(hex.slice(6),16)/255:1)*opacity);
  }
  const parts = value.match(/[\d.]+%?/g) || [];
  return parts.slice(0,3).map(v => number(v)/(v.endsWith('%')?100:255)).concat((parts[3]===undefined?1:number(parts[3])/(parts[3].endsWith('%')?100:1))*opacity);
}

export function intersection(a,b) {
  const x=Math.max(a.x,b.x), y=Math.max(a.y,b.y);
  return {x,y,w:Math.max(0,Math.min(a.x+a.w,b.x+b.w)-x),h:Math.max(0,Math.min(a.y+a.h,b.y+b.h)-y)};
}

export function clippedQuad(rect, uv, clip) {
  const r=intersection(rect,clip);
  if(!r.w||!r.h||!rect.w||!rect.h)return null;
  return {rect:r,uv:[uv[0]+(r.x-rect.x)/rect.w*uv[2],uv[1]+(r.y-rect.y)/rect.h*uv[3],r.w/rect.w*uv[2],r.h/rect.h*uv[3]]};
}

// UTF-16 offsets match native input selectionStart/End, including surrogate pairs.
export function wrapLines(text, width, measure) {
  const lines=[]; let start=0, cursor=0, line='', lastBreak=-1;
  for(const char of text) {
    if(char==='\n'){lines.push({text:line,start});cursor++;start=cursor;line='';lastBreak=-1;continue;}
    if(line&&measure(line+char)>width) {
      const cut=lastBreak>0?lastBreak:line.length;
      lines.push({text:line.slice(0,cut),start});start+=cut;line=line.slice(cut);lastBreak=-1;
    }
    line+=char;cursor+=char.length;
    if(/\s/.test(char))lastBreak=line.length;
  }
  lines.push({text:line,start});return lines;
}

function makeProgram(gl) {
  const program=gl.createProgram();
  for(const [type,source]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
    const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('Interface shader: '+gl.getShaderInfoLog(shader));
    gl.attachShader(program,shader);gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Interface link: '+gl.getProgramInfoLog(program));
  return program;
}

export class WebGLUI {
  constructor(canvas,source) {
    this.canvas=canvas;this.source=source;
    // A separate full-resolution WebGL surface keeps text sharp at every world quality.
    this.gl=canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:true,depth:false,stencil:false});
    if(!this.gl)throw new Error('The WebGL interface could not start. Reload with hardware acceleration enabled.');
    this.program=makeProgram(this.gl);this.atlas=new GlyphAtlas();
    this.fontTexture=this.texture();this.layers=new Map();this.resources=new Set();this.images=new WeakMap();
    this.fontPages=[{atlas:this.atlas,texture:this.fontTexture}];
    this.range=document.createRange();this.measure=document.createElement('canvas').getContext('2d');
    this.attributes=['position','uv','tint'].map(name=>this.gl.getAttribLocation(this.program,name));
    this.viewport=this.gl.getUniformLocation(this.program,'viewport');
    this.allDirty=true;this.clock=0;this.lost=false;
    this.observer=new MutationObserver(records=>{
      for(const record of records)this.invalidate(record.target);
    });
    this.observer.observe(source,{subtree:true,childList:true,characterData:true,attributes:true});
    for(const event of ['input','change','focusin','focusout','pointerover','pointerout','scroll','toggle']) {
      source.addEventListener(event,e=>this.invalidate(e.target),true);
    }
    document.addEventListener('selectionchange',()=>{
      const selection=document.getSelection();
      for(const node of this.selectionNodes||[])this.invalidate(node);
      this.selectionNodes=[selection?.anchorNode,selection?.focusNode,document.activeElement];
      for(const node of this.selectionNodes)this.invalidate(node);
    });
    window.addEventListener('resize',()=>this.allDirty=true);
    window.visualViewport?.addEventListener('resize',()=>this.allDirty=true);
    canvas.addEventListener('webglcontextlost',e=>{
      e.preventDefault();this.lost=true;
      // A readable, keyboard-accessible recovery surface is essential if the GPU fails.
      document.body.classList.remove('webgl-ui');canvas.hidden=true;
      window.dispatchEvent(new CustomEvent('graphicslost'));
    });
    canvas.addEventListener('webglcontextrestored',()=>location.reload());
    this.bindControls();
    document.body.classList.add('webgl-ui');
  }
  texture() {
    const gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.NEAREST);
    for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
    return t;
  }
  invalidate(node) {
    if(node?.nodeType===3)node=node.parentElement;
    if(node===this.source||node?.id==='hud'){this.allDirty=true;return;}
    while(node&&node.parentElement!==this.source&&node.parentElement?.id!=='hud')node=node.parentElement;
    const layer=this.layers.get(node);if(layer)layer.dirty=true;
  }
  quad(rect,color,uv=white,texture=this.fontTexture) {
    if(!color[3])return;
    const q=clippedQuad(rect,uv,this.clip);if(!q)return;
    const {x,y,w,h}=q.rect,[u,v,uw,vh]=q.uv;
    let batch=this.batches.at(-1);
    if(!batch||batch.texture!==texture){batch={texture,vertices:[]};this.batches.push(batch);}
    for(const [px,py,tx,ty]of [[x,y,u,v],[x+w,y,u+uw,v],[x,y+h,u,v+vh],[x,y+h,u,v+vh],[x+w,y,u+uw,v],[x+w,y+h,u+uw,v+vh]])batch.vertices.push(px,py,tx,ty,...color);
  }
  line(rect,color,width=1) {
    const {x,y,w,h}=rect;
    this.quad({x,y,w,h:width},color);this.quad({x,y:y+h-width,w,h:width},color);
    this.quad({x,y,w:width,h},color);this.quad({x:x+w-width,y,w:width,h},color);
  }
  glyph(char,r,color) {
    const visible=intersection(r,this.clip);if(/\s/.test(char)||!visible.w||!visible.h)return;
    let page=this.fontPages.find(p=>p.atlas.entries.has(char))||this.fontPages.find(p=>p.atlas.entries.size<1023);
    if(!page){page={atlas:new GlyphAtlas(),texture:this.texture()};this.fontPages.push(page);}
    this.quad(r,color,page.atlas.get(char),page.texture);
  }
  text(node,style,opacity) {
    const text=node.textContent;if(!text.trim())return;
    const size=number(style.fontSize),color=rgba(style.color,opacity);
    const selection=this.selectionRange,selected=selection?.intersectsNode(node);
    const start=selected&&selection.startContainer===node?selection.startOffset:0,end=selected&&selection.endContainer===node?selection.endOffset:text.length;
    let offset=0;
    for(const char of text) {
      const begin=offset;this.range.setStart(node,offset);offset+=char.length;this.range.setEnd(node,offset);
      const r=this.range.getBoundingClientRect();
      if(selected&&begin>=start&&begin<end)this.quad(box(r),rgba('#365777',opacity));
      if(r.width&&r.height)this.glyph(style.textTransform==='uppercase'?char.toUpperCase():char,{x:r.x,y:r.y+(r.height-size)/2,w:r.width,h:size},color);
    }
  }
  string(text,x,y,style,color,width=Infinity) {
    this.measure.font=style.font;
    const size=number(style.fontSize),spacing=number(style.letterSpacing);let used=0;
    for(const char of text){const w=this.measure.measureText(char).width+spacing;if(used+w>width)break;this.glyph(char,{x:x+used,y,w,h:size},color);used+=w;}
    return used;
  }
  control(node,style,r,opacity) {
    const ink=rgba(style.color,opacity),accent=rgba('#8ce7d0',opacity),size=number(style.fontSize);
    if(node.type==='checkbox'||node.type==='radio') {
      this.quad(r,rgba('#09131b',opacity));this.line(r,accent);
      if(node.checked)this.string('✓',r.x+3,r.y+1,style,accent);return;
    }
    if(node.type==='range') {
      const value=(number(node.value)-number(node.min))/(number(node.max)-number(node.min)||1);
      this.quad({x:r.x,y:r.y+r.h/2-2,w:r.w,h:4},rgba('#354c5a',opacity));
      this.quad({x:r.x,y:r.y+r.h/2-2,w:r.w*value,h:4},accent);
      this.quad({x:r.x+Math.max(0,(r.w-12)*value),y:r.y+r.h/2-10,w:12,h:20},accent);return;
    }
    const left=number(style.paddingLeft)+number(style.borderLeftWidth),top=number(style.paddingTop)+number(style.borderTopWidth);
    const content={x:r.x+left,y:r.y+top,w:r.w-left-number(style.paddingRight)-number(style.borderRightWidth),h:r.h-top-number(style.paddingBottom)-number(style.borderBottomWidth)};
    const saved=this.clip;this.clip=intersection(saved,content);
    let value=node.tagName==='SELECT'?node.selectedOptions[0]?.textContent||'':node.value;
    if(node.type==='password')value='•'.repeat([...value].length);
    const placeholder=!value;value ||= node.placeholder||'';
    const color=placeholder?rgba('#96aab8',opacity):ink;
    this.measure.font=style.font;
    const lineHeight=number(style.lineHeight)||size*1.5;
    const lines=node.tagName==='TEXTAREA'?wrapLines(value,content.w,t=>this.measure.measureText(t).width):[{text:value,start:0}];
    const focused=node===document.activeElement,selectionStart=node.selectionStart,selectionEnd=node.selectionEnd;
    let y=content.y+(node.tagName==='TEXTAREA'?(lineHeight-size)/2:(content.h-size)/2)-(node.scrollTop||0);
    for(const line of lines) {
      let x=content.x-(node.scrollLeft||0),offset=line.start;
      for(const char of line.text) {
        const w=this.measure.measureText(char).width+number(style.letterSpacing);
        if(focused&&!placeholder&&offset>=selectionStart&&offset<selectionEnd)this.quad({x,y:y-2,w,h:size+4},rgba('#365777',opacity));
        if(focused&&!placeholder&&offset===selectionStart&&selectionStart===selectionEnd)this.quad({x,y:y-1,w:2,h:size+2},accent);
        this.glyph(char,{x,y,w,h:size},color);x+=w;offset+=char.length;
      }
      if(focused&&(placeholder||offset===selectionStart&&selectionStart===selectionEnd))this.quad({x:placeholder?content.x:x,y:y-1,w:2,h:size+2},accent);
      y+=lineHeight;
    }
    this.clip=saved;
    if(node.tagName==='SELECT')this.string('↓',r.x+r.w-22,r.y+(r.h-size)/2,style,accent);
  }
  asset(node,r,style) {
    let resource=this.images.get(node);
    const svg=node.tagName.toLowerCase()==='svg',live=node.tagName==='CANVAS';
    const key=svg?node.outerHTML+style.color:node.currentSrc||node.src||'canvas';
    if(!resource||resource.key!==key) {
      if(resource){this.gl.deleteTexture(resource.texture);this.resources.delete(resource);}
      resource={node,key,texture:this.texture(),ready:false,live,stamp:-1};
      this.images.set(node,resource);this.resources.add(resource);
      const image=svg?new Image():node;
      const load=()=>{
        if(!node.isConnected)return;
        const pixels=document.createElement('canvas');
        // Existing line art is sampled onto a small pixel grid, including heraldry.
        pixels.width=svg?Math.max(24,Math.min(80,Math.round(r.w))):Math.min(480,image.naturalWidth||node.width||64);
        pixels.height=Math.max(1,Math.round(pixels.width*(svg?r.h/r.w:(image.naturalHeight||node.height)/(image.naturalWidth||node.width))));
        pixels.getContext('2d').drawImage(image,0,0,pixels.width,pixels.height);
        const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,resource.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        resource.ready=true;this.invalidate(node);
      };
      if(live)resource.ready=true;
      else if(svg) {
        image.onload=load;
        const clone=node.cloneNode(true);clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',String(r.w));clone.setAttribute('height',String(r.h));
        image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(clone).replaceAll('currentColor',style.color));
      }else if(image.complete&&image.naturalWidth)load();else image.addEventListener('load',load,{once:true});
    }
    if(live&&resource.stamp!==this.clock) {
      const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,resource.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,node);resource.stamp=this.clock;
    }
    return resource.ready?resource.texture:null;
  }
  element(node,parentOpacity=1) {
    if(node.nodeType!==1)return;
    const style=getComputedStyle(node);
    if(style.display==='none'||style.visibility==='hidden'||node.tagName==='DIALOG'&&!node.open)return;
    const opacity=parentOpacity*(node.id==='panel-dialog'?1:number(style.opacity));
    if(!opacity)return;
    const r=box(node.getBoundingClientRect()),savedClip=this.clip;
    if(node.classList.contains('ui-select'))this.clip=this.screen;
    if(!intersection(r,this.clip).h&&style.display!=='contents')return;
    this.quad(r,rgba(style.backgroundColor,opacity));
    const sides=[['Top',{x:r.x,y:r.y,w:r.w,h:number(style.borderTopWidth)}],['Bottom',{x:r.x,y:r.y+r.h-number(style.borderBottomWidth),w:r.w,h:number(style.borderBottomWidth)}],['Left',{x:r.x,y:r.y,w:number(style.borderLeftWidth),h:r.h}],['Right',{x:r.x+r.w-number(style.borderRightWidth),y:r.y,w:number(style.borderRightWidth),h:r.h}]];
    for(const [side,rect]of sides)if(style['border'+side+'Style']!=='none')this.quad(rect,rgba(style['border'+side+'Color'],opacity));
    if(node===document.activeElement&&style.outlineStyle!=='none')this.line({x:r.x-2,y:r.y-2,w:r.w+4,h:r.h+4},rgba(style.outlineColor,opacity),2);
    if(node.tagName==='SUMMARY')this.string(node.parentElement.open?'↓':'→',r.x,r.y+3,style,rgba(style.color,opacity));
    if(node.tagName==='LI'&&style.listStyleType!=='none')this.string(node.parentElement.tagName==='OL'?String([...node.parentElement.children].indexOf(node)+1)+'.':'·',r.x-20,r.y+2,style,rgba(style.color,opacity));
    if(/hidden|auto|scroll|clip/.test(style.overflowX)||/hidden|auto|scroll|clip/.test(style.overflowY)) {
      this.clip=intersection(this.clip,{x:r.x+node.clientLeft,y:r.y+node.clientTop,w:node.clientWidth,h:node.clientHeight});
    }
    if(['INPUT','TEXTAREA','SELECT'].includes(node.tagName))this.control(node,style,r,opacity);
    else if(['IMG','CANVAS','svg'].includes(node.tagName)) {
      const texture=this.asset(node,r,style);if(texture)this.quad(r,[1,1,1,opacity],[0,0,1,1],texture);
    }else for(const child of node.childNodes) {
      if(node.tagName==='DETAILS'&&!node.open&&child.tagName!=='SUMMARY')continue;
      if(child.nodeType===3)this.text(child,style,opacity);else this.element(child,opacity);
    }
    this.clip=savedClip;
    if(/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+1) {
      const h=Math.max(24,r.h*node.clientHeight/node.scrollHeight),y=r.y+(r.h-h)*node.scrollTop/(node.scrollHeight-node.clientHeight);
      this.quad({x:r.x+r.w-7,y:r.y,w:5,h:r.h},rgba('#1d303d',opacity));
      this.quad({x:r.x+r.w-7,y,w:5,h},rgba('#7eabae',opacity));
    }
  }
  roots() {
    const roots=[];
    for(const node of this.source.children) {
      if(node.id==='hud') {
        if(!node.hidden)roots.push(...[...node.children].sort((a,b)=>(b.id==='world-labels')-(a.id==='world-labels')));
      }else if(!node.hidden&&node.tagName!=='NOSCRIPT')roots.push(node);
    }
    // Modal dimming, toast, and tooltips always composite above the HUD.
    return roots.sort((a,b)=>this.order(a)-this.order(b));
  }
  order(node) {return node.id==='panel-dialog'?10:node.id==='toast'?20:node.id==='ui-tooltip'?30:node.id==='live-chat'&&node.dataset.expanded==='true'?5:0;}
  render(timestamp=0) {
    if(this.lost)return;
    // HUD updates run immediately before this pass, before observer microtasks fire.
    for(const record of this.observer?.takeRecords()||[])this.invalidate(record.target);
    const gl=this.gl,w=innerWidth,h=innerHeight,ratio=Math.min(devicePixelRatio||1,2);
    if(this.canvas.width!==Math.round(w*ratio)||this.canvas.height!==Math.round(h*ratio)) {
      this.canvas.width=Math.round(w*ratio);this.canvas.height=Math.round(h*ratio);this.allDirty=true;
    }
    this.screen={x:0,y:0,w,h};this.clock=Math.floor(timestamp/100);
    const selection=document.getSelection?.();this.selectionRange=selection&&!selection.isCollapsed&&selection.rangeCount?selection.getRangeAt(0):null;
    const roots=this.roots();
    for(const [node,layer]of this.layers)if(!roots.includes(node)){for(const batch of layer.batches)gl.deleteBuffer(batch.buffer);this.layers.delete(node);}
    for(const resource of this.resources) {
      if(!resource.node.isConnected){gl.deleteTexture(resource.texture);this.resources.delete(resource);this.images.delete(resource.node);}
      else if(resource.live&&resource.stamp!==this.clock)this.invalidate(resource.node);
    }
    for(const node of roots) {
      let layer=this.layers.get(node);
      if(!layer){layer={dirty:true,batches:[]};this.layers.set(node,layer);}
      // A sibling can move this panel without mutating it (wrapped names, status
      // messages, or a newly visible target). Cached geometry must follow layout.
      const rect=node.getBoundingClientRect(),bounds=[rect.x,rect.y,rect.width,rect.height].join(',');
      if(layer.bounds!==bounds){layer.bounds=bounds;layer.dirty=true;}
      if(!layer.dirty&&!this.allDirty)continue;
      const previous=layer.batches;
      this.batches=[];this.clip=this.screen;
      if(node.tagName==='DIALOG'&&node.open)this.quad(this.screen,rgba('#030910',.78));
      this.element(node);
      layer.batches=this.batches.map((batch,i)=>{
        const buffer=previous[i]?.buffer||gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(batch.vertices),gl.DYNAMIC_DRAW);
        return {buffer,texture:batch.texture,count:batch.vertices.length/8};
      });layer.dirty=false;
      for(const batch of previous.slice(layer.batches.length))gl.deleteBuffer(batch.buffer);
    }
    this.allDirty=false;
    const usedTextures=new Set([...this.layers.values()].flatMap(layer=>layer.batches.map(batch=>batch.texture)));
    this.fontPages=this.fontPages.filter((page,i)=>{
      if(i&& !usedTextures.has(page.texture)){gl.deleteTexture(page.texture);return false;}
      if(page.atlas.dirty){gl.bindTexture(gl.TEXTURE_2D,page.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,page.atlas.canvas);page.atlas.dirty=false;}
      return true;
    });
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);gl.uniform2f(this.viewport,w,h);gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);gl.uniform1i(gl.getUniformLocation(this.program,'image'),0);
    for(const node of roots)for(const batch of this.layers.get(node).batches) {
      gl.bindTexture(gl.TEXTURE_2D,batch.texture);gl.bindBuffer(gl.ARRAY_BUFFER,batch.buffer);
      for(let i=0;i<3;i++){gl.enableVertexAttribArray(this.attributes[i]);gl.vertexAttribPointer(this.attributes[i],i===2?4:2,gl.FLOAT,false,32,i*8);}
      gl.drawArrays(gl.TRIANGLES,0,batch.count);
    }
  }
  closeSelect() {this.selectMenu?.remove();this.selectMenu=null;this.selectOwner?.setAttribute('aria-expanded','false');this.selectOwner=null;}
  openSelect(select) {
    if(select.disabled)return;
    if(this.selectOwner===select&&this.selectMenu?.isConnected){this.closeSelect();return;}
    this.closeSelect();select.focus();this.selectOwner=select;select.setAttribute('aria-expanded','true');
    const menu=document.createElement('div');menu.className='ui-select';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',select.labels?.[0]?.textContent||'Choose an option');
    const r=select.getBoundingClientRect(),height=Math.min(260,select.options.length*42+8);
    Object.assign(menu.style,{left:Math.max(8,Math.min(r.x,innerWidth-r.width-8))+'px',top:Math.max(8,Math.min(r.bottom+4,innerHeight-height-8))+'px',width:r.width+'px',maxHeight:height+'px'});
    for(const option of select.options) {
      const b=document.createElement('button');b.type='button';b.textContent=option.textContent;b.disabled=option.disabled;b.setAttribute('role','option');b.setAttribute('aria-selected',String(option.selected));
      b.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));this.closeSelect();select.focus();};menu.append(b);
    }
    (select.closest('dialog')||this.source).append(menu);this.selectMenu=menu;
    (menu.querySelector('[aria-selected="true"]')||menu.querySelector('button:not(:disabled)'))?.focus();
  }
  bindControls() {
    // Suppress OS select popovers; these choices use the same WebGL painter as panels.
    this.source.addEventListener('pointerdown',e=>{
      if(this.selectMenu&&!this.selectMenu.contains(e.target)&&e.target!==this.selectOwner)this.closeSelect();
      if(e.target.tagName==='SELECT'){e.preventDefault();this.openSelect(e.target);return;}
      let node=e.target;
      while(node&&node!==this.source) {
        const r=node.getBoundingClientRect();
        if(node.scrollHeight>node.clientHeight+1&&/auto|scroll/.test(getComputedStyle(node).overflowY)&&e.clientX>=r.right-10) {
          e.preventDefault();node.setPointerCapture(e.pointerId);
          const move=event=>{node.scrollTop=(event.clientY-r.y)/r.height*node.scrollHeight-node.clientHeight/2;this.invalidate(node);};
          move(e);node.addEventListener('pointermove',move);
          node.addEventListener('lostpointercapture',()=>node.removeEventListener('pointermove',move),{once:true});return;
        }node=node.parentElement;
      }
    },true);
    this.source.addEventListener('click',e=>{if(e.target.tagName==='SELECT'&&e.detail===0){e.preventDefault();this.openSelect(e.target);}},true);
    this.source.addEventListener('keydown',e=>{
      if(this.selectMenu?.isConnected) {
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();const select=this.selectOwner;this.closeSelect();select?.focus();return;}
        const options=[...this.selectMenu.querySelectorAll('button:not(:disabled)')],i=options.indexOf(document.activeElement);
        if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
          e.preventDefault();e.stopPropagation();options[e.key==='Home'?0:e.key==='End'?options.length-1:(i+(e.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus();return;
        }
      }
      if(e.target.tagName==='SELECT'&&[' ','Enter','F4'].includes(e.key)){e.preventDefault();this.openSelect(e.target);}
    },true);
    this.source.addEventListener('invalid',e=>{
      e.preventDefault();const form=e.target.form;if(!form)return;
      let error=form.querySelector('.form-error');
      if(!error){error=document.createElement('p');error.className='form-error';error.setAttribute('role','alert');form.append(error);}
      if(!form.querySelector('[aria-invalid="true"]')){error.textContent=e.target.validationMessage;e.target.focus();}
      e.target.setAttribute('aria-invalid','true');
    },true);
    this.source.addEventListener('input',e=>{e.target.removeAttribute('aria-invalid');});
    // Browser tooltips would be a second visual UI; render ability help in the terminal.
    for(const node of this.source.querySelectorAll('[title]')){node.dataset.tooltip=node.title;node.removeAttribute('title');}
    const tip=document.createElement('div');tip.id='ui-tooltip';tip.hidden=true;tip.setAttribute('role','tooltip');this.source.append(tip);
    let timer;
    const hide=()=>{clearTimeout(timer);tip.hidden=true;};
    this.source.addEventListener('pointerover',e=>{
      const owner=e.target.closest('[data-tooltip]');if(!owner)return;
      hide();timer=setTimeout(()=>{
        if(!owner.isConnected)return;tip.textContent=owner.dataset.tooltip;tip.hidden=false;
        const r=owner.getBoundingClientRect();tip.style.left=Math.max(10,Math.min(r.x,innerWidth-tip.offsetWidth-10))+'px';tip.style.top=Math.max(10,r.y-tip.offsetHeight-10)+'px';
      },400);
    });
    this.source.addEventListener('pointerout',hide);this.source.addEventListener('pointerdown',hide);
  }
}
