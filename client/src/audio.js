// Original synthesized score and device-local narration. GPL-3.0-or-later.
export class AudioEngine {
  constructor(score){this.score=score;this.enabled=false;this.narration=true;this.context=null;this.timer=null;this.step=0;this.voices=[];this.pending=null;this.captionTimer=null;this.onCaption=()=>{};this.refreshVoices=()=>{this.voices=(globalThis.speechSynthesis?.getVoices()||[]).filter(v=>v.localService&&/^en(?:[-_]|$)/i.test(v.lang)).sort((a,b)=>(a.voiceURI||a.name).localeCompare(b.voiceURI||b.name));if(this.pending&&this.voices.length&&this.narration){const pending=this.pending;this.pending=null;this.speak(pending.text,pending.speaker);}};this.refreshVoices();globalThis.speechSynthesis?.addEventListener('voiceschanged',this.refreshVoices);}
  async unlock(){
    const AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext;if(!AudioContext)return;
    this.context ||=new AudioContext();if(this.context.state==='suspended')await this.context.resume();
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
    this.stopVoice();if(!text)return false;
    const profile=this.score.voices?.[speaker]||this.score.voices?.narrator||{name:'Vesper',slot:0,rate:.93,pitch:.86};
    this.onCaption({text,speaker:profile.name});
    this.captionTimer=setTimeout(()=>this.stopVoice(),Math.max(8000,text.length*100));
    if(!this.narration||!globalThis.speechSynthesis||!globalThis.SpeechSynthesisUtterance)return false;
    this.refreshVoices();const voice=this.voices[(profile.slot||0)%this.voices.length];
    if(!voice){this.pending={text,speaker};return false;}
    const u=new globalThis.SpeechSynthesisUtterance(text);u.voice=voice;u.lang=voice.lang;u.rate=profile.rate;u.pitch=profile.pitch;u.volume=.85;
    this.utterance=u;
    u.onend=()=>{if(this.utterance===u){this.utterance=null;clearTimeout(this.captionTimer);this.captionTimer=setTimeout(()=>this.onCaption(null),1500);}};
    u.onerror=()=>{if(this.utterance===u)this.utterance=null;};
    try{globalThis.speechSynthesis.speak(u);return true;}catch{this.utterance=null;return false;}
  }
  stopVoice(){this.utterance=null;this.pending=null;clearTimeout(this.captionTimer);globalThis.speechSynthesis?.cancel();this.onCaption(null);}
  destroy(){clearTimeout(this.timer);this.stopVoice();globalThis.speechSynthesis?.removeEventListener('voiceschanged',this.refreshVoices);this.context?.close();}
}
