// Original synthesized score and device-local narration. GPL-3.0-or-later.
export class AudioEngine {
  constructor(score){this.score=score;this.enabled=false;this.narration=false;this.context=null;this.timer=null;this.step=0;this.voices=[];this.refreshVoices=()=>{this.voices=globalThis.speechSynthesis?.getVoices().filter(v=>v.localService)||[];};this.refreshVoices();globalThis.speechSynthesis?.addEventListener('voiceschanged',this.refreshVoices);}
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
  speak(text){
    if(!this.narration||!globalThis.speechSynthesis)return false;
    this.refreshVoices();const voice=this.voices.find(v=>v.lang.startsWith('en'))||this.voices[0];if(!voice)return false;
    speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.voice=voice;u.lang=voice.lang;u.rate=.93;u.pitch=.86;u.volume=.85;speechSynthesis.speak(u);return true;
  }
  stopVoice(){globalThis.speechSynthesis?.cancel();}
  destroy(){clearTimeout(this.timer);this.stopVoice();globalThis.speechSynthesis?.removeEventListener('voiceschanged',this.refreshVoices);this.context?.close();}
}
