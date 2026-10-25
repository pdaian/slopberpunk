// Original articulated machine armor. Every collectible has a distinct silhouette.
// GPL-3.0-or-later.
export function frameParts(catalog, appearance) {
  const parts=[],width=catalog.frames.find(f=>f.id===appearance.frame).width;
  const add=(joint,center,size,color='primary',extra={})=>parts.push({joint,center,size,color,shape:'bevel',...extra});
  const light=(joint,center,size,color='energy',extra={})=>add(joint,center,size,color,{emissive:.85,...extra});
  const ring=(joint,center,radius,n,color='secondary',glow=0,thickness=.045)=>{
    for(let i=0;i<n;i++){const a=i/n*Math.PI*2;add(joint,[center[0]+Math.sin(a)*radius,center[1]+Math.cos(a)*radius,center[2]],[thickness,radius*5/n,thickness],color,{roll:-a+Math.PI/2,emissive:glow});}
  };
  add('body',[0,.3,0],[.64*width,.62,.4],'#192532',{taper:.78});
  for(const s of [-1,1]) {
    add('body',[s*.2*width,.47,.19],[.37*width,.32,.17],'primary',{roll:s*-.12,taper:.8});
    for(let i=0;i<3;i++)add('body',[0,.08+i*.08,.17],[.4*width,.055,.14],i%2?'secondary':'#273442');
    add('body',[s*.19,0,0],[.29,.18,.35],'secondary');
    const side=s<0?'left':'right';
    add(`${side}Thigh`,[0,-.23,0],[.26,.44,.29],'#263441');
    add(`${side}Thigh`,[0,-.2,.15],[.29,.32,.1],'primary',{taper:.75});
    add(`${side}Shin`,[0,-.23,0],[.22,.43,.24],'#263441');
    add(`${side}Foot`,[0,.015,.12],[.29,.16,.46],'#192532');
    add(`${side}Arm`,[0,-.18,0],[.23,.36,.25],'#263441');
    add(`${side}Arm`,[0,-.18,.13],[.2,.24,.07],'secondary');
    add(`${side}Forearm`,[0,-.15,0],[.23,.29,.26],'#263441');
    add(`${side}Forearm`,[0,-.34,.015],[.24,.15,.25],'secondary');
  }
  add('head',[0,.09,0],[.36,.38,.32],'#17232e');
  add('body',[0,.64,0],[.24,.13,.24],'secondary');
  for(const slot of catalog.slots) {
    const item=catalog.items.find(i=>i.id===appearance.parts[slot.id]);
    const d=item.design, signature={'Signal Ghost':'#8df5ef','Iron Witness':'#f3ad6a'}[item.set]||{rare:'#71c9f1',epic:'#c19afa',relic:'#efbd7d'}[item.rarity]||'secondary';
    if(slot.id==='head') {
      add('head',[0,.14,-.015],[.44,.42,.39],'primary',{taper:d==='mask'?.85:1});
      add('head',[0,.09,.2],[.36,.24,.045],'#101b26');
      if(d==='visor') {
        light('head',[0,.17,.235],[.36,.045,.04]);
        for(const s of [-1,1])add('head',[s*.23,.31,-.06],[.055,.28,.17],'secondary',{roll:s*-.14});
      }else if(d==='mask') {
        for(const s of [-1,1]){light('head',[s*.105,.17,.24],[.095,.055,.045]);add('head',[s*.26,.13,0],[.11,.22,.27],'secondary');}
        for(let i=0;i<3;i++)add('head',[(i-1)*.065,.015,.25],[.025,.09,.035],'secondary');
      }else if(d==='cyclops') {
        ring('head',[0,.13,.24],.155,8,signature,0,.055);
        light('head',[0,.13,.26],[.18,.18,.09],'energy',{shape:'round'});
        add('head',[.24,.28,-.02],[.08,.25,.16],'secondary');
      }else if(d==='antlers') {
        light('head',[0,.1,.23],[.045,.27,.035]);
        for(const s of [-1,1])for(let i=0;i<3;i++) {
          add('head',[s*(.22+i*.065),.36+i*.13,-.04],[.055,.23,.07],signature,{roll:s*-.35});
          light('head',[s*(.29+i*.06),.39+i*.13,-.04],[.12,.035,.04],signature);
        }
      }else if(d==='crown') {
        for(let i=-2;i<=2;i++)add('head',[i*.1,.39+(2-Math.abs(i))*.035,-.03],[.065,.28+(2-Math.abs(i))*.07,.12],signature,{roll:-i*.16,taper:.35});
        for(let i=-1;i<=1;i++)light('head',[i*.115,.15+(i===0?.07:0),.24],[.065,.06,.04]);
        add('head',[0,-.015,.23],[.18,.13,.07],signature,{taper:.5});
      }else if(d==='prism') {
        for(const s of [-1,1]) {
          add('head',[s*.18,.18,.29],[.12,.39,.08],signature,{roll:-s*.3,taper:.25});
          light('head',[s*.19,.21,.34],[.035,.25,.025],signature,{roll:-s*.3});
          add('head',[s*.29,.32,-.02],[.045,.44,.08],'primary',{roll:-s*.45});
        }
        light('head',[0,.31,.31],[.13,.13,.06],signature,{roll:Math.PI/4});
      }
    }else if(slot.id==='shoulders')for(const s of [-1,1]) {
      const joint=s<0?'leftArm':'rightArm';
      if(d==='plates') {
        add(joint,[s*.045,.01,0],[.46,.28,.47],'primary',{taper:.8});
        add(joint,[s*.11,-.13,.05],[.39,.09,.43],'secondary');light(joint,[0,.055,.25],[.27,.045,.035]);
      }else if(d==='fenders') {
        add(joint,[s*.08,.04,-.05],[.37,.19,.65],'primary',{pitch:.2,taper:.55});
        add(joint,[s*.17,-.06,.14],[.25,.25,.15],'#18232c',{shape:'round'});
        light(joint,[s*.17,-.06,.23],[.095,.095,.035]);
      }else if(d==='turbines') {
        add(joint,[s*.08,.01,0],[.48,.41,.45],'primary');
        ring(joint,[s*.08,.02,.26],.18,10,signature,0,.055);light(joint,[s*.08,.02,.26],[.18,.18,.04],'energy',{shape:'round'});
      }else if(d==='spires') {
        for(let i=0;i<3;i++){add(joint,[s*(.01+i*.1),.08+i*.055,0],[.14,.33+(s<0?.12:0),.41-i*.06],'primary');light(joint,[s*(.01+i*.1),.32+i*.08,0],[.025,.22,.025],signature);}
      }else if(d==='bastions') {
        add(joint,[s*.09,.03,0],[.55,.39,.52],'primary',{taper:.75});
        add(joint,[s*.09,.26,0],[.5,.09,.45],signature);
        for(let i=0;i<3;i++)add(joint,[s*(.18+i*.105),.08-i*.07,0],[.09,.3,.48],signature,{roll:-s*.3});
        light(joint,[s*.08,.07,.28],[.13,.16,.035]);
      }else if(d==='ramparts') {
        add(joint,[s*.13,.04,0],[.4,.57,.49],'primary',{taper:.8});
        for(const z of [-.21,.21])add(joint,[s*.2,.19,z],[.37,.17,.12],signature);
        add(joint,[s*.32,-.03,0],[.1,.6,.57],'secondary');
        for(let i=0;i<3;i++)light(joint,[s*.13,-.12+i*.12,.27],[.19,.04,.035],signature);
      }
    }else if(slot.id==='core') {
      add('body',[0,.34,.28],[.48,.37,.11],'#15222c');
      if(d==='split')for(const s of [-1,1])light('body',[s*.12,.38,.35],[.15,.22,.055]);
      else if(d==='grille')for(let i=0;i<5;i++)add('body',[0,.2+i*.065,.35],[.44,.03,.07],i===2?'energy':'secondary',{emissive:i===2?.8:0});
      else if(d==='iris') {
        ring('body',[0,.35,.37],.17,12,signature,0,.055);light('body',[0,.35,.38],[.21,.21,.05],'energy',{shape:'round'});
        for(const s of [-1,1])for(const y of [.21,.49])add('body',[s*.17,y,.4],[.12,.065,.07],'secondary');
      }else if(d==='shards')for(let i=-1;i<=1;i++)light('body',[i*.14,.34+i*.04,.39],[.08,.28,.1],i?'energy':signature,{roll:i*.22,taper:.25});
      else if(d==='sun') {
        ring('body',[0,.34,.39],.16,8,signature,.35,.05);light('body',[0,.34,.4],[.19,.19,.08],'energy',{shape:'round'});
        for(let i=0;i<8;i++){const a=i*Math.PI/4;add('body',[Math.sin(a)*.24,.34+Math.cos(a)*.24,.36],[.045,.14,.04],signature,{roll:-a});}
      }else if(d==='lattice') {
        for(const s of [-1,1])for(const y of [-1,1])add('body',[s*.12,.35+y*.13,.4],[.045,.36,.055],signature,{roll:s*y*.75});
        light('body',[0,.35,.43],[.16,.16,.11],signature,{roll:Math.PI/4});
        for(const s of [-1,1])light('body',[s*.24,.35,.4],[.045,.14,.035]);
      }
    }else if(slot.id==='arms')for(const s of [-1,1]) {
      const joint=s<0?'leftForearm':'rightForearm';
      add(joint,[0,-.13,.035],[d==='hammers'?.39:.3,.3,.32],'primary',{taper:.78});
      if(d==='pistons')for(const x of [-.12,.12]){add(joint,[x,-.14,.22],[.045,.35,.045],'secondary');light(joint,[x,-.02,.25],[.045,.08,.025]);}
      else if(d==='cuffs'){add(joint,[s*.19,-.1,0],[.08,.43,.24],'secondary',{taper:.3});light(joint,[0,-.11,.21],[.045,.21,.03]);}
      else if(d==='coils')for(let i=0;i<3;i++){add(joint,[0,-.025-i*.105,.03],[.34,.05,.35],signature);light(joint,[0,-.025-i*.105,.22],[.3,.025,.035]);}
      else if(d==='talons')for(let i=-1;i<=1;i++)add(joint,[i*.105,-.42,.19],[.055,.4,.075],signature,{pitch:-.25,taper:.3});
      else if(d==='hammers') {
        add(joint,[0,-.23,.07],[.43,.18,.4],signature);for(const x of [-.12,0,.12])light(joint,[x,-.08,.23],[.055,.13,.04]);
        add(joint,[s*.23,-.06,.03],[.11,.26,.34],'secondary');
      }else if(d==='clamps') {
        for(const x of [-1,1]) {
          add(joint,[x*.22,-.25,.08],[.09,.5,.16],'secondary',{roll:x*.12});
          add(joint,[x*.16,-.47,.15],[.18,.09,.2],signature,{roll:-x*.2});
          light(joint,[x*.18,-.1,.22],[.055,.19,.04],signature);
        }
        ring(joint,[0,-.1,.24],.09,6,signature,.4,.035);
      }
    }else if(slot.id==='legs')for(const s of [-1,1]) {
      const side=s<0?'left':'right',joint=side+'Shin';
      add(joint,[0,-.17,.13],[.28,.38,.16],'primary',{taper:.7});
      if(d==='runners') {
        for(const x of [-.08,.08])add(joint,[x,-.2,.23],[.075,.33,.07],'secondary');light(joint,[0,.015,.22],[.16,.055,.04]);
        add(side+'Foot',[0,.045,.19],[.28,.12,.46],'primary',{taper:.7});
      }else if(d==='treads') {
        add(joint,[s*.15,-.23,-.04],[.17,.44,.33],'#17232e');
        for(let i=0;i<5;i++)add(joint,[s*.24,-.06-i*.083,-.04],[.055,.045,.34],'secondary');
      }else if(d==='jets') {
        add(joint,[s*.16,-.22,-.1],[.2,.34,.27],'secondary');light(joint,[s*.16,-.4,-.1],[.15,.07,.2],signature);
        for(const x of [-.1,.1])add(joint,[x,.06,.14],[.065,.24,.16],'primary',{taper:.4});
      }else if(d==='stilts') {
        add(joint,[s*.2,-.15,0],[.07,.64,.12],signature,{roll:-s*.12});
        for(let i=0;i<3;i++)add(joint,[0,.07-i*.065,.21+i*.02],[.3-i*.055,.08,.12],'secondary');
        light(joint,[0,-.21,.24],[.055,.24,.025]);
      }else if(d==='sabatons') {
        for(let i=0;i<4;i++){add(joint,[0,-.01-i*.105,.17],[.34-i*.025,.13,.16],'primary',{taper:.8});add(joint,[0,-.04-i*.105,.26],[.32-i*.025,.025,.035],signature);}
        add(side+'Foot',[0,.035,.12],[.37,.15,.61],signature);add(side+'Foot',[s*.16,.06,-.2],[.14,.12,.3],'primary');
      }else if(d==='anchors') {
        for(const x of [-1,1])add(joint,[x*.1,-.07,.22],[.16,.43,.13],'primary',{roll:-x*.15,taper:.5});
        add(side+'Foot',[s*.22,.07,-.08],[.23,.2,.59],'secondary');
        add(joint,[s*.23,-.25,-.12],[.08,.51,.1],signature,{roll:s*.2});
        light(joint,[0,.07,.29],[.14,.08,.035],signature);
        light(side+'Foot',[s*.25,.09,.23],[.17,.045,.03],signature);
      }
    }else if(slot.id==='back') {
      add('body',[0,.36,-.28],[.24,.57,.18],'#18232e');
      if(d==='fins')for(const s of [-1,1])add('body',[s*.27,.48,-.3],[.17,.68,.15],'secondary',{roll:-s*.35,taper:.4});
      else if(d==='stacks') {
        add('body',[0,.25,-.38],[.38,.39,.25],'primary');
        for(const s of [-1,1]){add('body',[s*.3,.54,-.3],[.13,.86,.16],'secondary');for(let i=0;i<3;i++)add('body',[s*.3,.62+i*.09,-.3],[.18,.035,.21],'#263441');light('body',[s*.3,.98,-.3],[.1,.035,.13]);}
      }else if(d==='wings')for(const s of [-1,1])for(let i=0;i<2;i++){
        const center=[s*(.47+i*.1),.53-i*.35,-.34];
        add('body',center,[.29,.91-i*.12,.12],'primary',{roll:-s*(.9+i*.35),taper:.3});
        light('body',[center[0],center[1],-.42],[.06,.77-i*.12,.025],signature,{roll:-s*(.9+i*.35)});
      }else if(d==='array')for(const s of [-1,1])for(let i=0;i<3;i++){
        add('body',[s*(.24+i*.19),.65-i*.12,-.37],[.11,1-i*.1,.1],signature,{roll:-s*(.25+i*.23),taper:.4});
        light('body',[s*(.24+i*.19),.65-i*.12,-.44],[.03,.75-i*.1,.025]);
      }else if(d==='eclipse') {
        ring('body',[0,.46,-.42],.87,16,signature,.2,.085);
        ring('body',[0,.46,-.45],.77,16,'energy',.8,.025);
        for(let i=0;i<4;i++){const a=i*Math.PI/2;add('body',[Math.sin(a)*1,.46+Math.cos(a)*1,-.42],[.15,.31,.12],'primary',{roll:-a,taper:.25});}
      }else if(d==='orbit') {
        ring('body',[0,.5,-.44],.73,4,'secondary',0,.06);
        for(let i=0;i<4;i++) {
          const a=i*Math.PI/2,x=Math.sin(a)*.9,y=.5+Math.cos(a)*.9;
          add('body',[x,y,-.46],[.23,.23,.13],'primary',{roll:Math.PI/4});
          light('body',[x,y,-.54],[.13,.13,.04],signature,{roll:Math.PI/4});
          for(const side of [-1,1])add('body',[x+side*.13,y,-.46],[.035,.36,.1],signature,{roll:side*.3});
        }
        light('body',[0,.5,-.5],[.1,.43,.04],signature);
      }
    }
  }
  // Paint markings are actual raised meshes, shared by the world and fitting bay.
  if(appearance.pattern==='stripe')for(const s of [-1,1])add('body',[s*.25*width,.46,.285],[.045,.24,.025],'secondary');
  else if(appearance.pattern==='chevron')for(const s of [-1,1])for(let i=0;i<2;i++)add('body',[s*.24*width,.48-i*.1,.29],[.045,.16,.025],'secondary',{roll:s*.7});
  else if(appearance.pattern==='circuit')for(const s of [-1,1]) {
    light('body',[s*.28*width,.4,.29],[.025,.26,.025]);light('body',[s*.23*width,.52,.29],[.12,.025,.025]);
    add('body',[s*.29*width,.28,.3],[.065,.065,.025],'secondary');
  }
  if(appearance.finish==='alloy')for(const s of [-1,1])for(let i=0;i<3;i++)add('body',[s*.22*width,.43+i*.05,.3],[.16,.012,.012],'#b5c6d1');
  if(appearance.finish==='carbon')for(const s of [-1,1])for(let i=0;i<4;i++)add('body',[s*.24*width,.38+i*.05,.3],[.19,.025,.025],'#17232e',{roll:s*.35});
  return parts;
}
