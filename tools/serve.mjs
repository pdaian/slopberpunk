// Buildless frontend and same-origin realm proxy. Node built-ins only.
// Sloperberpunk — GPL-3.0-or-later.
import http from 'node:http';
import https from 'node:https';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root=fileURLToPath(new URL('../client/',import.meta.url));
const license=fileURLToPath(new URL('../LICENSE',import.meta.url));
const headers={
  'x-content-type-options':'nosniff','referrer-policy':'same-origin','x-frame-options':'DENY','cache-control':'no-store',
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};

function endToEnd(source) {
  const result={...source};
  const connection=String(source.connection||'').toLowerCase().split(',').map(name=>name.trim());
  for(const name of ['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade',...connection])delete result[name];
  return result;
}

function send(req,res,status,body,extra={}) {
  res.writeHead(status,{...headers,'Content-Type':'text/plain; charset=utf-8','Content-Length':Buffer.byteLength(body),...extra});
  res.end(req.method==='HEAD'?undefined:body);
}

function socketHead(socket,status,responseHeaders) {
  const lines=[`HTTP/1.1 ${status} ${http.STATUS_CODES[status]||'Unknown'}`];
  for(const [name,value]of Object.entries(responseHeaders)){
    for(const item of Array.isArray(value)?value:[value])lines.push(`${name}: ${item}`);
  }
  socket.write(lines.join('\r\n')+'\r\n\r\n');
}

export function createFrontendServer({backend=process.env.SLOPERBERPUNK_BACKEND??'http://127.0.0.1:8080'}={}) {
  let realm;
  try{realm=new URL(backend);}catch{throw new Error('SLOPERBERPUNK_BACKEND must be an HTTP(S) origin, for example http://127.0.0.1:8080.');}
  if(!['http:','https:'].includes(realm.protocol)||realm.username||realm.password||realm.pathname!=='/'||realm.search||realm.hash){
    throw new Error('SLOPERBERPUNK_BACKEND must be an HTTP(S) origin without credentials, a path, a query, or a fragment.');
  }
  const transport=realm.protocol==='https:'?https:http;
  const unavailable=JSON.stringify({error:'The realm server is offline. You can still play a local character.'});

  function requestRealm(req,upgrade=false) {
    const proxy=transport.request(realm,{
      path:req.url,method:req.method,
      headers:{...endToEnd(req.headers),host:realm.host,...(upgrade?{connection:'Upgrade',upgrade:'websocket'}:{})}
    });
    // Bound DNS/connect/TLS/response-header waits as well as stalled HTTP bodies.
    const deadline=setTimeout(()=>proxy.destroy(new Error('Realm connection timed out')),15000);
    deadline.unref();
    const clearDeadline=()=>clearTimeout(deadline);
    proxy.once('response',clearDeadline);proxy.once('upgrade',clearDeadline);proxy.once('close',clearDeadline);
    proxy.setTimeout(15000,()=>proxy.destroy(new Error('Realm request timed out')));
    return proxy;
  }

  const server=http.createServer(async(req,res)=>{
    const path=req.url.split('?')[0];
    if(path==='/api'||path.startsWith('/api/')){
      const proxy=requestRealm(req);
      proxy.on('response',upstream=>{
        upstream.on('error',()=>res.destroy());
        res.writeHead(upstream.statusCode,{...endToEnd(upstream.headers),...headers});
        upstream.pipe(res);
      });
      proxy.on('error',()=>{
        if(res.destroyed||res.writableEnded)return;
        if(res.headersSent){res.destroy();return;}
        send(req,res,503,unavailable,{'Content-Type':'application/json; charset=utf-8'});
      });
      req.on('aborted',()=>proxy.destroy());req.on('error',()=>proxy.destroy());res.on('close',()=>proxy.destroy());req.pipe(proxy);return;
    }
    if(!['GET','HEAD'].includes(req.method)){send(req,res,405,'Method not allowed',{'Allow':'GET, HEAD'});return;}
    let decoded;
    try{decoded=decodeURIComponent(path);}catch{send(req,res,400,'Bad request');return;}
    if(!decoded.startsWith('/')||decoded.startsWith('//')||decoded.includes('\0')||decoded.includes('\\')||decoded.split('/').some(p=>p.startsWith('.'))){send(req,res,404,'Not found');return;}
    try{
      const relative=decoded==='/'?'index.html':decoded.slice(1);
      const actual=await realpath(relative==='LICENSE'?license:resolve(root,relative));
      if(relative==='LICENSE'?actual!==license:!actual.startsWith(root.endsWith(sep)?root:root+sep)){send(req,res,404,'Not found');return;}
      const body=await readFile(actual);
      send(req,res,200,body,{'Content-Type':types[extname(actual)]||'text/plain; charset=utf-8'});
    }catch(error){
      const status=['ENOENT','ENOTDIR','EISDIR','EACCES'].includes(error.code)?404:500;
      if(!res.destroyed)send(req,res,status,status===404?'Not found':'Unable to read file');
    }
  });

  server.on('upgrade',(req,socket,head)=>{
    socket.on('error',()=>socket.destroy());
    if(req.method!=='GET'||req.url.split('?')[0]!=='/api/world'||req.headers.upgrade?.toLowerCase()!=='websocket'){
      socketHead(socket,404,{...headers,connection:'close','content-length':0});socket.end();return;
    }
    const proxy=requestRealm(req,true);
    let responded=false;
    socket.on('close',()=>proxy.destroy());
    proxy.on('error',()=>{
      if(socket.destroyed)return;
      if(responded){socket.destroy();return;}
      responded=true;
      socketHead(socket,503,{...headers,connection:'close','content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(unavailable)});
      socket.end(unavailable);
    });
    // Preserve account/origin errors when the realm refuses an upgrade.
    proxy.on('response',upstream=>{
      responded=true;
      upstream.on('error',()=>socket.destroy());
      socketHead(socket,upstream.statusCode,{...endToEnd(upstream.headers),...headers,connection:'close'});
      upstream.pipe(socket);
    });
    proxy.on('upgrade',(upstream,realmSocket,realmHead)=>{
      responded=true;
      realmSocket.on('error',()=>socket.destroy());realmSocket.on('close',()=>socket.destroy());
      socket.on('close',()=>realmSocket.destroy());
      // A live world connection must not inherit the HTTP handshake timeout.
      proxy.setTimeout(0);realmSocket.setTimeout(0);socket.setTimeout(0);
      if(socket.destroyed){realmSocket.destroy();return;}
      socketHead(socket,upstream.statusCode,{...endToEnd(upstream.headers),...headers,connection:'Upgrade',upgrade:'websocket'});
      if(realmHead.length)socket.write(realmHead);
      if(head.length)realmSocket.write(head);
      realmSocket.pipe(socket);socket.pipe(realmSocket);
    });
    proxy.end();
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return server;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const portIndex=process.argv.indexOf('--port');
    const port=Number(portIndex>=0?process.argv[portIndex+1]:process.env.PORT||3000);
    if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT / --port must be an integer from 0 to 65535.');
    const host=process.env.HOST||'127.0.0.1';
    const server=createFrontendServer(),sockets=new Set();
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    server.on('error',error=>{console.error(`Cannot start Sloperberpunk: ${error.code||error.message}`);process.exitCode=1;});
    server.listen(port,host,()=>console.log(`Sloperberpunk — http://${host.includes(':')?'['+host+']':host}:${server.address().port}`));
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
      server.close();
      for(const socket of sockets)socket.destroy();
    });
  }catch(error){console.error(`Cannot start Sloperberpunk: ${error.message}`);process.exitCode=1;}
}
