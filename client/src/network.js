// Same-origin account and authoritative world transport. GPL-3.0-or-later.
export async function api(path,body,method=body?'POST':'GET') {
  const response=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json','X-Sloperberpunk':'1'}:{'X-Sloperberpunk':'1'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
  const data=await response.json().catch(()=>({error:`Server returned ${response.status}.`}));
  if(!response.ok){const error=new Error(data.error||'The server could not complete this request.');error.status=response.status;throw error;}return data;
}
export class Connection {
  constructor(characterId,onSnapshot,onEvent,onClose){this.socket=null;this.characterId=characterId;this.onSnapshot=onSnapshot;this.onEvent=onEvent;this.onClose=onClose;this.open=false;this.sequence=0;this.accumulator=0;this.pendingJump=false;this.pendingDash=false;this.intentional=false;}
  connect(){return new Promise((resolve,reject)=>{
    const url=new URL('/api/world',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(url);this.socket=ws;let joined=false;
    const timeout=setTimeout(()=>{ws.close();reject(new Error('Connecting took too long. Check your internet connection and try again.'));},12000);
    ws.onopen=()=>{ws.send(JSON.stringify({type:'join',version:2,id:this.characterId}));};
    ws.onmessage=e=>{
      let message;try{message=JSON.parse(e.data);}catch{return;}
      if(message.type==='snapshot'){
        if(message.version!==2){clearTimeout(timeout);ws.close();if(!joined)reject(new Error('The game was updated. Reload the page to reconnect.'));return;}
        this.onSnapshot(message);if(!joined){joined=true;this.open=true;clearTimeout(timeout);resolve();}
      }else if(message.type==='error'){this.onEvent({type:'notice',text:message.error});if(!joined){clearTimeout(timeout);ws.close();reject(new Error(message.error));}}
      else if(message.type==='event')this.onEvent(message.event);
    };
    ws.onerror=()=>{clearTimeout(timeout);if(!joined)reject(new Error('The world server is unavailable.'));};
    ws.onclose=()=>{clearTimeout(timeout);this.open=false;if(!joined)reject(new Error('The world connection was closed.'));else if(!this.intentional)this.onClose();};
  });}
  update(dt,input){
    this.accumulator+=dt;this.pendingJump ||=input.jump;this.pendingDash ||=input.dash;
    if(this.accumulator<.05)return;this.accumulator=0;
    this.send({type:'move',...input,jump:this.pendingJump,dash:this.pendingDash,sequence:++this.sequence});this.pendingJump=false;this.pendingDash=false;
  }
  send(message){if(this.open&&this.socket?.readyState===WebSocket.OPEN&&this.socket.bufferedAmount<32768){this.socket.send(JSON.stringify({...message,version:2}));return true;}return false;}
  close(){this.intentional=true;this.open=false;this.socket?.close();}
}
