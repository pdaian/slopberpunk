// Original synthesized score and browser narration. GPL-3.0-or-later.
const voiceKey=voice=>voice?`${voice.voiceURI||voice.name}|${voice.lang}`:'browser-default';
const gestureEvents=['click','touchend','keydown'];

// Short utterances avoid native engines stalling on long paragraphs. Keep the
// complete text in the caption, and split only the spoken rendition.
function speechChunks(text){
  const chunks=[];let rest=text.trim();
  while(rest.length>180){
    const head=rest.slice(0,180),sentences=[...head.matchAll(/[.!?;:](?=\s)/g)];
    let end=sentences.length?sentences.at(-1).index+1:head.lastIndexOf(' ');
    if(end<=0)end=180;
    if(/[\uD800-\uDBFF]/.test(rest[end-1]))end--;
    chunks.push(rest.slice(0,end).trim());rest=rest.slice(end).trim();
  }
  if(rest)chunks.push(rest);return chunks;
}

export class AudioEngine {
  constructor(score){
    this.score=score;this.enabled=false;this._narration=true;this.context=null;this.timer=null;this.step=0;
    this.voices=[];this.line=null;this.utterance=null;this.primer=null;this.primed=false;this.destroyed=false;
    this.captionTimer=null;this.captionDuration=8000;this.voiceTimer=null;this.discoveryTimer=null;this.onCaption=()=>{};this.onVoiceStatus=()=>{};
    this.synthesis=globalThis.speechSynthesis;this.Utterance=globalThis.SpeechSynthesisUtterance;
    this.voiceStatus=this.supported?'ready':'unsupported';
    this.refreshVoices=()=>{
      if(this.destroyed)return;
      try{this.voices=Array.from(this.synthesis?.getVoices?.()||[]).filter(v=>/^en(?:[-_]|$)/i.test(v.lang)).sort((a,b)=>voiceKey(a).localeCompare(voiceKey(b)));}catch{this.voices=[];}
      if(this.line?.waiting==='voices'&&this.voices.some(v=>!this.line.failed.has(voiceKey(v))))this.playChunk(this.line);
      this.onVoiceStatus(this.voiceStatus);
    };
    this.refreshVoices();
    if(typeof this.synthesis?.addEventListener==='function')this.synthesis.addEventListener('voiceschanged',this.refreshVoices);
    else if(this.synthesis){
      this.previousVoicesChanged=this.synthesis.onvoiceschanged;
      this.voicesChanged=event=>{try{this.previousVoicesChanged?.call(this.synthesis,event);}finally{this.refreshVoices();}};
      this.synthesis.onvoiceschanged=this.voicesChanged;
    }
    // Capture real gestures before UI handlers await network requests. Web Audio
    // and native speech have separate autoplay gates; resume alone is insufficient.
    this.document=globalThis.document;
    this.onGesture=event=>{if(event.isTrusted&&!event.repeat&&!this.document.hidden)this.unlock().catch(()=>{});};
    for(const event of gestureEvents)this.document?.addEventListener(event,this.onGesture,true);
    this.onVisibilityChange=()=>{if(this.document.hidden)this.stopVoice();};
    this.document?.addEventListener('visibilitychange',this.onVisibilityChange,true);
  }
  get supported(){return typeof this.synthesis?.speak==='function'&&typeof this.Utterance==='function';}
  get narration(){return this._narration;}
  set narration(value){
    this._narration=Boolean(value);
    if(!this._narration){this.cancelSpeech();this.expireCaption();}
    this.setVoiceStatus(this._narration?(this.supported?'ready':'unsupported'):'muted');
  }
  get voiceMessage(){
    return {
      muted:'Character voices are muted. Captions remain available.',
      unsupported:'This browser does not provide speech playback. Open the game in a browser with speech support; captions remain available.',
      loading:'Waiting for English voices to load…',
      starting:'Starting character voice…',
      speaking:'Playing character voice.',
      blocked:'Speech is blocked. Click TEST VOICE in Settings or a HEAR button to try again.',
      unavailable:'No working English voice was found. Check your device speech settings, then try TEST VOICE.',
      error:'Speech playback failed. Check your sound, speech settings, and connection, then try TEST VOICE.',
      ready:'Local English voices are preferred. Other browser voices may require an internet connection.',
    }[this.voiceStatus];
  }
  get speaking(){return Boolean(this.line&&!this.line.waiting);}
  setVoiceStatus(status){if(this.voiceStatus!==status){this.voiceStatus=status;this.onVoiceStatus(status);}}
  unlockVoice(){
    if(this.destroyed||!this.narration||!this.supported)return;
    this.refreshVoices();
    if(this.line){
      if(this.line.waiting==='gesture'){
        this.line.attempts=0;this.line.failed.clear();this.playChunk(this.line);
      }
      return;
    }
    if(this.primed||this.primer)return;
    try{
      const u=new this.Utterance(' ');u.volume=0;u.lang='en-US';
      const voice=this.voices.find(v=>v.localService)||this.voices[0];if(voice){u.voice=voice;u.lang=voice.lang;}
      this.primer=u;this.primed=true;
      u.onend=()=>{if(this.primer===u)this.primer=null;};
      u.onerror=()=>{if(this.primer===u){this.primer=null;this.primed=false;}};
      if(this.synthesis.paused)this.synthesis.resume?.();
      this.synthesis.speak(u);
    }catch{this.primer=null;this.primed=false;}
  }
  async unlock(){
    if(this.destroyed)return;
    this.unlockVoice();
    const AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext;if(!AudioContext)return;
    this.context ||=new AudioContext();if(this.context.state==='suspended'||this.context.state==='interrupted')await this.context.resume();
  }
  async toggle(){this.enabled=!this.enabled;await this.unlock();if(this.enabled)this.start();else{clearTimeout(this.timer);this.timer=null;}return this.enabled;}
  tone(frequency,duration,volume=.04,type='sine',end=null,delay=0){
    if(!this.context||!frequency)return;
    const ctx=this.context,now=ctx.currentTime+delay,osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(frequency,now);if(end)osc.frequency.exponentialRampToValueAtTime(end,now+duration);
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(volume,now+Math.min(.04,duration/4));gain.gain.exponentialRampToValueAtTime(.0001,now+duration);osc.connect(gain);gain.connect(ctx.destination);osc.start(now);osc.stop(now+duration+.03);osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  start(){
    if(this.timer||!this.enabled)return;
    const beat=60/this.score.bpm;
    const play=()=>{
      if(!this.enabled){this.timer=null;return;}
      if(!document.hidden){const chord=Math.floor(this.step/8)%4;if(this.step%8===0){for(const f of this.score.chords[chord])this.tone(f,beat*7,.015);this.tone(this.score.bass[chord],beat*6,.04,'triangle');}this.tone(this.score.melody[this.step%8],beat*1.8,.018,'sine');}
      this.step++;this.timer=setTimeout(()=>{this.timer=null;play();},beat*1000);
    };play();
  }
  effect(name){if(!this.enabled)return;const e=this.score.effects[name];if(e)this.tone(e[0],e[2],.06,'triangle',e[1]);}
  speak(text,speaker='narrator'){
    if(this.destroyed)return false;
    this.stopVoice();if(!text?.trim())return false;
    const profile=this.score.voices?.[speaker]||this.score.voices?.narrator||{name:'Vesper',slot:0,rate:.93,pitch:.86};
    this.onCaption({text,speaker:profile.name});
    this.captionDuration=Math.max(8000,text.length*100);this.expireCaption();
    if(!this.narration||!this.supported||this.document?.hidden){
      this.setVoiceStatus(!this.narration?'muted':this.supported?'ready':'unsupported');return false;
    }
    this.refreshVoices();
    const line={chunks:speechChunks(text),profile,index:0,attempts:0,failed:new Set(),waiting:null,polls:0};
    this.line=line;this.playChunk(line);return this.line===line;
  }
  playChunk(line){
    if(this.line!==line||!this.narration||this.destroyed)return;
    clearTimeout(this.discoveryTimer);this.discoveryTimer=null;line.waiting=null;
    const available=this.voices.filter(v=>!line.failed.has(voiceKey(v))),local=available.filter(v=>v.localService),remote=available.filter(v=>!v.localService);
    // After a local engine fails, try a different provider when available. Reserve
    // the last attempt for the browser default instead of exhausting installed voices.
    const pool=line.attempts&&remote.length?remote:local.length?local:available;
    let voice=pool[(line.profile.slot||0)%pool.length]||null;
    if(line.voice!==undefined&&!line.failed.has(voiceKey(line.voice)))voice=line.voice;
    if(line.attempts>=2)voice=null;
    if(!voice&&line.failed.has(voiceKey(null))){this.waitForVoices(line);return;}
    let u;
    const fail=error=>{
      if(this.line!==line||(u&&this.utterance!==u))return;
      this.utterance=null;clearTimeout(this.voiceTimer);
      try{this.synthesis.cancel?.();}catch{}
      // Autoplay denial needs another real gesture, not a timer-based retry.
      if(error==='not-allowed'){
        line.waiting='gesture';this.primed=false;this.expireCaption();this.setVoiceStatus('blocked');return;
      }
      line.failed.add(voiceKey(voice));
      if(line.attempts>=3){this.failVoice('error');return;}
      // Let native cancellation settle before trying another voice.
      this.voiceTimer=setTimeout(()=>this.playChunk(line),0);
    };
    try{
      line.attempts++;clearTimeout(this.captionTimer);
      u=new this.Utterance(line.chunks[line.index]);
      if(voice)u.voice=voice;
      u.lang=voice?.lang||'en-US';u.rate=line.profile.rate??.93;u.pitch=line.profile.pitch??.86;u.volume=.85;
      this.utterance=u;
      u.onstart=()=>{
        if(this.line!==line||this.utterance!==u)return;
        line.voice=voice;this.primed=true;clearTimeout(this.captionTimer);clearTimeout(this.voiceTimer);
        // A missing end event must not keep story guidance locked forever.
        this.voiceTimer=setTimeout(()=>fail('timeout'),Math.max(30000,u.text.length*200/u.rate));
        this.setVoiceStatus('speaking');
      };
      u.onend=()=>{
        if(this.line!==line||this.utterance!==u)return;
        line.voice=voice;this.utterance=null;clearTimeout(this.voiceTimer);line.index++;line.attempts=0;
        if(line.index<line.chunks.length)this.playChunk(line);
        else{this.line=null;this.setVoiceStatus('ready');this.expireCaption(1500);}
      };
      u.onerror=event=>fail(event.error);
      this.setVoiceStatus('starting');
      this.voiceTimer=setTimeout(()=>fail('timeout'),5000);
      if(this.synthesis.paused)this.synthesis.resume?.();
      this.synthesis.speak(u);
    }catch{fail('synthesis-failed');}
  }
  waitForVoices(line){
    if(this.voices.length||line.polls>=20){this.failVoice('unavailable');return;}
    line.waiting='voices';this.setVoiceStatus('loading');
    this.discoveryTimer=setTimeout(()=>{
      this.discoveryTimer=null;if(this.line!==line)return;
      line.polls++;this.refreshVoices();
      if(this.line===line&&line.waiting==='voices')this.waitForVoices(line);
    },250);
  }
  failVoice(status){this.cancelSpeech();this.expireCaption();this.setVoiceStatus(status);}
  expireCaption(delay=this.captionDuration){
    clearTimeout(this.captionTimer);
    this.captionTimer=setTimeout(()=>{
      // Expired, queued dialogue must not play when voices arrive much later.
      if(this.line?.waiting)this.cancelSpeech();
      this.onCaption(null);this.captionTimer=null;
    },delay);
  }
  cancelSpeech(){
    const active=this.utterance||this.primer;
    this.line=null;this.utterance=null;this.primer=null;
    clearTimeout(this.voiceTimer);clearTimeout(this.discoveryTimer);this.voiceTimer=null;this.discoveryTimer=null;
    if(active)try{this.synthesis?.cancel?.();}catch{}
  }
  stopVoice(){
    this.cancelSpeech();clearTimeout(this.captionTimer);this.captionTimer=null;this.onCaption(null);
    this.setVoiceStatus(this.narration?(this.supported?'ready':'unsupported'):'muted');
  }
  destroy(){
    if(this.destroyed)return;
    this.destroyed=true;this.enabled=false;clearTimeout(this.timer);this.timer=null;this.stopVoice();
    this.synthesis?.removeEventListener?.('voiceschanged',this.refreshVoices);
    if(this.voicesChanged&&this.synthesis.onvoiceschanged===this.voicesChanged)this.synthesis.onvoiceschanged=this.previousVoicesChanged;
    for(const event of gestureEvents)this.document?.removeEventListener(event,this.onGesture,true);
    this.document?.removeEventListener('visibilitychange',this.onVisibilityChange,true);
    this.context?.close()?.catch?.(()=>{});
  }
}
