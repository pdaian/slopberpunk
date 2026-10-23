// Frame Forge uses the same semantic controls and WebGL painter as every game panel.
// GPL-3.0-or-later.
import { escapeHtml as esc } from './icons.js';
import { appearanceKey, appearanceProblem, collection, defaultAppearance, forgeRank, partUnlocked, showcaseEntries } from './forge.js';
import { FramePreview } from './frame-preview.js';

const button=(label,action,id='',extra='')=>`<button type="button" data-forge="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
const meter=(value,max)=>`<div class="forge-meter" role="progressbar" aria-label="Milestone progress" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.min(value,max)}"><span style="width:${Math.min(100,value/max*100)}%"></span></div>`;
export function partCard(item,catalog,progress,selected) {
  const rarity=catalog.rarities.find(r=>r.id===item.rarity),owned=partUnlocked(item,progress),u=item.unlock;
  return button(`<span class="forge-item-top"><span style="color:${rarity.color}">${esc(rarity.name.toUpperCase())} / ${esc(item.set)}</span><span>${selected?'FITTED':owned?'OWNED':'LOCKED'}</span></span><strong>${esc(item.name)}</strong><span class="forge-item-description">${esc(item.description)}</span>${u?`<span class="forge-requirement">${owned?'EARNED':`${Math.min(progress[u.stat]||0,u.target)} / ${u.target}`} · ${esc(u.label)}</span>`:'<span class="forge-requirement">STARTER PART · freely available</span>'}${!owned?meter(progress[u.stat]||0,u.target):''}`,'part',item.id,`class="forge-item ${selected?'selected':''}" aria-pressed="${selected}" aria-label="${esc(item.name)}. ${esc(owned?'Owned':'Locked. Try on only. '+u.label)}"`);
}
export function showcasePanel(c,players,catalog) {
  const entries=showcaseEntries(c,players,catalog);
  return `<h3>Nearby showcase</h3><p class="muted">Compare earned collections with runners currently visible in your shard. Equal prestige shares a place. Refresh to see arrivals.</p><p class="forge-note">Prestige comes from unlocked parts, regardless of what you wear. Repeating a loadout or wearing a full set adds no points.</p>${button('REFRESH NEARBY','refresh','','class="small-button"')}<div class="forge-standings">${entries.map(p=>`<article class="forge-standing"><span class="forge-place">${String(p.place).padStart(2,'0')}</span><div><strong>${esc(p.name)}${p.self?' · YOU':''}</strong><small>${esc(p.rank.name)} · ${p.score} PRESTIGE</small></div>${button('INSPECT','inspect',p.id,'class="small-button"')}</article>`).join('')}</div>${entries.length===1?'<p class="muted">No other runners are nearby. Your collection is ready to show when someone joins you.</p>':''}`;
}

export class FrameForge {
  constructor({catalog,models,character,players,creationCharacter,showPanel,isOpen,community,toast,reducedMotion=false}) {
    Object.assign(this,{catalog,models,character,players,creationCharacter,showPanel,isOpen,community,toast,reducedMotion});
    this.creationDraft=defaultAppearance(catalog);this.slot='head';this.view='assembly';this.filter='all';this.angle=.4;this.pose='idle';this.rotate=false;this.busy=false;
    document.querySelector('#interface-source').addEventListener('click',e=>{
      const target=e.target.closest('[data-forge]');if(target)this.click(target).catch(error=>{this.toast(error.message);});
    });
    document.querySelector('#interface-source').addEventListener('change',e=>{
      const key=e.target.dataset.forgeField;if(!key||this.busy)return;
      if(['finish','pattern'].includes(key)&&this.catalog[key==='finish'?'finishes':'patterns'].some(o=>o.id===e.target.value)){this.draft[key]=e.target.value;this.inspect=null;this.render();}
    });
  }
  get draft(){return this.mode==='creation'?this.creationDraft:this.gameDraft;}
  get runner(){return this.mode==='creation'?this.creationCharacter():this.character();}
  mountCreation(){this.mode='creation';this.view='assembly';this.inspect=null;this.render();}
  creationAppearance(){
    const problem=appearanceProblem(this.creationDraft,this.catalog,{});if(problem)throw new Error(problem);
    return structuredClone(this.creationDraft);
  }
  open(){
    const c=this.character();if(!c)return;
    if(this.owner!==c.id){this.owner=c.id;this.gameDraft=structuredClone(c.forge?.appearance||this.catalog.default);this.view='assembly';this.slot='head';}
    this.mode='game';this.inspect=null;this.render();document.querySelector('#panel-dialog').scrollTop=0;
  }
  html(){
    const catalog=this.catalog,c=this.runner,a=this.draft,earned=collection(c,catalog),problem=appearanceProblem(a,catalog,c);
    const selected=catalog.items.filter(i=>a.parts[i.slot]===i.id),sets=[...new Set(selected.map(i=>i.set))].map(name=>({name,count:selected.filter(i=>i.set===name).length})).sort((a,b)=>b.count-a.count);
    const inspect=this.inspect,preview=inspect?inspect.forge?.appearance:a;
    const tabs=this.mode==='creation'?[['assembly','ASSEMBLY'],['paint','PAINT']]:[['assembly','ASSEMBLY'],['paint','PAINT'],['collection','COLLECTION'],['showcase','SHOWCASE']];
    const status=inspect?`INSPECTING ${inspect.name}`:problem?'TRY-ON ONLY · LOCKED PART':appearanceKey(a)===appearanceKey(c.forge?.appearance)?'EQUIPPED FRAME':'UNSAVED FRAME';
    let work='';
    if(this.view==='assembly') {
      work=`<h3>Choose your chassis</h3><div class="forge-frames">${catalog.frames.map(f=>button(`<strong>${esc(f.name)}</strong><small>${esc(f.description)}</small>`,'frame',f.id,`aria-pressed="${a.frame===f.id}" class="${a.frame===f.id?'selected':''}"`)).join('')}</div><nav class="forge-slots" aria-label="Armor slots">${catalog.slots.map((s,i)=>button(`${String(i+1).padStart(2,'0')} ${esc(s.name)}`,'slot',s.id,`aria-pressed="${this.slot===s.id}" class="${this.slot===s.id?'selected':''}"`)).join('')}</nav><p class="forge-note">Select a part to try it on. Locked parts show the milestone needed to wear them.</p><div class="forge-parts">${catalog.items.filter(i=>i.slot===this.slot&&(this.mode!=='creation'||!i.unlock)).map(i=>partCard(i,catalog,earned.progress,a.parts[i.slot]===i.id)).join('')}</div>`;
    }else if(this.view==='paint') {
      work=`<h3>Make it unmistakable</h3><p class="forge-note">Paint is free. Rare pieces retain their signature trim.</p>${[['primary','ARMOR'],['secondary','TRIM'],['energy','ENERGY & OPTICS']].map(([key,label])=>`<fieldset class="forge-palette"><legend>${label} · ${esc(catalog.colors.find(c=>c.id===a[key]).name)}</legend><div class="forge-swatches">${catalog.colors.map(color=>button(`<span style="background:${color.hex}"></span>${esc(color.name)}`,'paint',color.id,`data-channel="${key}" class="forge-swatch" aria-label="${label}: ${esc(color.name)}" aria-pressed="${a[key]===color.id}"`)).join('')}</div></fieldset>`).join('')}<div class="forge-materials">${[['finish','FINISH',catalog.finishes],['pattern','MARKINGS',catalog.patterns]].map(([key,label,choices])=>`<label>${label}<select data-forge-field="${key}">${choices.map(o=>`<option value="${o.id}" ${a[key]===o.id?'selected':''}>${esc(o.name)}</option>`).join('')}</select></label>`).join('')}</div>`;
    }else if(this.view==='collection') {
      work=`<h3>Earn a silhouette</h3><p class="forge-note">18 milestone rewards. Each is earned once, permanently, on this character. Rare +10 · Epic +30 · Relic +70 prestige.</p><nav class="forge-slots" aria-label="Collection filter">${[['all','ALL PARTS'],['earned','OWNED'],['chase','TO EARN']].map(([id,label])=>button(label,'filter',id,`aria-pressed="${this.filter===id}" class="${this.filter===id?'selected':''}"`)).join('')}</nav><div class="forge-parts">${catalog.items.filter(i=>this.filter==='all'||partUnlocked(i,earned.progress)===(this.filter==='earned')).map(i=>partCard(i,catalog,earned.progress,a.parts[i.slot]===i.id)).join('')||'<p>Every part earned. Your collection is complete.</p>'}</div>`;
    }else work=showcasePanel(c,this.players(),catalog);
    const fitted=appearance=>appearance?`<div class="forge-fitted">${catalog.slots.map(slot=>{
      const item=catalog.items.find(i=>i.id===appearance.parts[slot.id]);
      return `<div><small>${esc(slot.name)}</small><span style="color:${catalog.rarities.find(r=>r.id===item.rarity).color}">${esc(item.name)}</span></div>`;
    }).join('')}</div>`:'<p class="forge-note">Original street rig.</p>';
    return `<section class="forge-shell" aria-label="Frame Forge">
      <div class="forge-strip"><div><span class="eyebrow">FRAME FORGE / ${this.mode==='creation'?'STARTER ASSEMBLY':'COLLECTION PRESTIGE'}</span><strong>${esc(earned.rank.name.toUpperCase())}</strong></div><div><strong>${earned.score}<small> PRESTIGE</small></strong><small>${earned.earned.length} / ${catalog.items.length} PARTS OWNED</small></div></div>
      ${earned.next?`<div class="forge-rank-progress">${meter(earned.score,earned.next.score)}<small>${earned.next.score-earned.score} prestige to ${esc(earned.next.name)}</small></div>`:'<p class="forge-note">Highest collection rank reached.</p>'}
      <nav class="tabs forge-tabs" aria-label="Frame Forge sections">${tabs.map(([id,label])=>button(label,'tab',id,`class="${id===this.view?'selected':''}" aria-current="${id===this.view?'page':'false'}"`)).join('')}${this.mode==='game'?'<button type="button" data-do="inventory">GEAR & BONUSES</button>':''}</nav>
      <div class="forge-workspace"><aside class="forge-fitting">
        <div class="forge-preview-label"><span>${inspect?'INSPECT / ':''}${esc(catalog.frames.find(f=>f.id===preview?.frame)?.name||'Street rig')}</span><span>LIVE 3D</span></div>
        <div data-forge-preview class="forge-preview"></div>
        <div class="forge-preview-controls" role="group" aria-label="Preview controls">${button('↶','turn','left','aria-label="Rotate frame left"')}${button('↷','turn','right','aria-label="Rotate frame right"')}${button(this.rotate?'STOP':'ROTATE','rotate','',`aria-pressed="${this.rotate}" ${this.reducedMotion?'disabled':''}`)}${button(this.pose.toUpperCase(),'pose','','aria-label="Change preview pose: idle, stride or salute"')}</div>
        <p class="forge-preview-status" role="status">${esc(status)}</p>${fitted(preview)}
        ${inspect?`<p class="forge-note">${esc(forgeRank(inspect.forge?.score||0,catalog).name)} · ${inspect.forge?.score||0} prestige</p>${button('TRY THIS LOOK','try-look','',`class="small-button" ${preview?'':'disabled'}`)} ${button('BACK TO MY FRAME','mine','','class="small-button"')}`:`<p class="forge-note">${esc(sets[0].name)} · ${sets[0].count} / 6 matching parts${sets[0].count===6?' · FULL SET':''}<br>Cosmetic only. Your combat stats stay the same.</p>`}
        ${this.mode==='game'&&!inspect?`<div class="forge-apply">${button(this.busy?'SAVING…':'APPLY FRAME','apply','',`class="button primary" ${this.busy||problem?'disabled':''}`)}${button('RESET DRAFT','reset','','class="small-button"'+(this.busy?' disabled':''))}<p class="forge-note">${problem?esc(problem):'Apply to wear this frame in the world.'}</p></div>`:this.mode==='creation'?'<p class="forge-note">18 rare, epic and relic parts await in GEAR → FRAME FORGE after you enter Vesper.</p>':''}
      </aside><div class="forge-work">${work}</div></div>
      ${this.mode==='game'&&!inspect?this.loadouts(c,problem):''}
    </section>`;
  }
  loadouts(c,problem){
    return `<section class="forge-loadouts" aria-label="Saved loadouts"><h3>Three looks. One collection.</h3><p class="forge-note">Save your draft into a slot. LOAD equips that saved look. Saving into a filled slot replaces it.</p><div>${[0,1,2].map(i=>{const a=c.forge?.loadouts?.[i];return `<article><strong>LOADOUT ${i+1}</strong><small>${a?esc(this.catalog.frames.find(f=>f.id===a.frame)?.name||a.frame)+' / '+esc(a.primary):'EMPTY SLOT'}</small>${button(a?'OVERWRITE':'SAVE DRAFT','save',String(i),`class="small-button" ${this.busy||problem?'disabled':''}`)}${button('LOAD','load',String(i),`class="small-button" ${this.busy||!a?'disabled':''}`)}</article>`;}).join('')}</div>${this.community.pending?`<p role="status">An action is awaiting a response. Retry it before making another change.</p>${button('RETRY PENDING ACTION','retry','','class="small-button"')}`:''}</section>`;
  }
  render(){
    const active=document.activeElement,focus=active?.dataset,field=focus?.forgeField;
    const scroller=this.mode==='creation'?document.querySelector('#creation'):document.querySelector('#panel-dialog'),scroll=scroller.scrollTop;
    if(this.mode==='creation')document.querySelector('#creation-forge').innerHTML=this.html();
    else this.showPanel('Frame Forge',this.html(),'BUILD YOUR SIGNATURE / COSMETIC ARMORY','forge');
    const root=document.querySelector(this.mode==='creation'?'#creation-forge':'#dialog-content');
    try {this.preview ||= new FramePreview(this.models,this.catalog);root.querySelector('[data-forge-preview]').append(this.preview.canvas);}
    catch(error){root.querySelector('[data-forge-preview]').textContent=error.message;}
    if(focus?.forge)[...root.querySelectorAll('[data-forge]')].find(b=>b.dataset.forge===focus.forge&&b.dataset.id===focus.id&&b.dataset.channel===focus.channel&&!b.disabled)?.focus({preventScroll:true});
    else if(field)root.querySelector(`[data-forge-field="${field}"]`)?.focus({preventScroll:true});
    scroller.scrollTop=scroll;
  }
  async click(b){
    const action=b.dataset.forge,id=b.dataset.id;if(this.busy&&!['turn','rotate','pose'].includes(action))return;
    if(action==='turn'){this.angle+=id==='left'?-.45:.45;this.rotate=false;}
    else if(action==='rotate')this.rotate=!this.rotate;
    else if(action==='pose')this.pose=['idle','stride','salute'][(['idle','stride','salute'].indexOf(this.pose)+1)%3];
    else if(action==='tab'){if(!['assembly','paint','collection','showcase'].includes(id))return;this.view=id;this.inspect=null;}
    else if(action==='slot'){if(!this.catalog.slots.some(s=>s.id===id))return;this.slot=id;}
    else if(action==='frame'){if(!this.catalog.frames.some(f=>f.id===id))return;this.draft.frame=id;this.inspect=null;}
    else if(action==='part'){const item=this.catalog.items.find(i=>i.id===id);if(!item)return;this.draft.parts[item.slot]=id;this.slot=item.slot;this.inspect=null;}
    else if(action==='paint'){if(!['primary','secondary','energy'].includes(b.dataset.channel)||!this.catalog.colors.some(c=>c.id===id))return;this.draft[b.dataset.channel]=id;this.inspect=null;}
    else if(action==='filter'){if(!['all','earned','chase'].includes(id))return;this.filter=id;}
    else if(action==='reset'){this.gameDraft=structuredClone(this.character().forge?.appearance||this.catalog.default);this.inspect=null;}
    else if(action==='inspect'){
      const c=this.character(),p=id===c.id?{...c,forge:{...c.forge,score:collection(c,this.catalog).score}}:this.players().find(p=>p.id===id);
      if(!p)return this.toast('That runner has left the nearby showcase. Refresh to see who is here.');
      this.inspect=structuredClone(p);
    }else if(action==='try-look'){
      if(!this.inspect?.forge?.appearance)return;
      this.gameDraft=structuredClone(this.inspect.forge.appearance);this.inspect=null;this.view='assembly';
    }else if(action==='mine')this.inspect=null;
    else if(['apply','save','load','retry'].includes(action))return this.commit(action,id);
    this.render();
  }
  async commit(operation,id){
    if(this.mode!=='game'||this.community.busy)return;
    const owner=this.character().id;
    if(['apply','save'].includes(operation)){const problem=appearanceProblem(this.draft,this.catalog,this.character());if(problem)throw new Error(problem);}
    const request=operation==='retry'?this.community.pending:{action:'forge',operation,...(operation==='apply'||operation==='save'?{appearance:structuredClone(this.draft)}:{}),...(['save','load'].includes(operation)?{slot:Number(id)}:{})};
    if(!request)return;
    this.busy=true;this.render();
    try {
      const response=await this.community.mutate(request,false);
      if(this.character()?.id!==owner)return;
      if(response?.result?.forge){
        this.character().forge=response.result.forge;
        if(request.operation==='load')this.gameDraft=structuredClone(response.result.forge.appearance);
      }
      this.toast(request.action==='forge'?(request.operation==='save'?'Loadout saved.':'Frame equipped. Other runners can see your new look.'):'Pending action completed.');
    }finally{this.busy=false;if(this.character()?.id===owner&&this.isOpen())this.render();}
  }
  draw(timestamp){
    if(!this.preview?.canvas.isConnected||!this.preview.canvas.getClientRects().length||this.mode==='game'&&!this.isOpen())return;
    this.preview.render(this.inspect||this.runner,this.inspect?this.inspect.forge?.appearance:this.draft,{angle:this.angle,pose:this.pose,rotate:this.rotate,reducedMotion:this.reducedMotion},timestamp);
  }
}
