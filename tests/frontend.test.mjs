// In-memory HTTP/WebSocket integration checks. No reports, caches, or runtime files.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { Duplex } from 'node:stream';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createFrontendServer } from '../tools/serve.mjs';

// Run Node's real HTTP parsers and TLS over paired streams, without opening ports.
const endpoints=new Map();let nextPort=10000;
function streamPair() {
  let left,right;
  function side(peer) {
    const stream=new Duplex({
      read(){},
      write(chunk,_encoding,done){peer().push(chunk);done();},
      final(done){peer().once('end',done);peer().push(null);},
      destroy(error,done){queueMicrotask(()=>peer().destroy());done(error);}
    });
    for(const method of ['setTimeout','setNoDelay','setKeepAlive','ref','unref'])stream[method]=()=>stream;
    stream.on('error',()=>{});return stream;
  }
  left=side(()=>right);right=side(()=>left);return [left,right];
}
function memoryConnection({port}) {
  const [client,peer]=streamPair(),server=endpoints.get(Number(port));
  queueMicrotask(()=>{
    if(server)server.emit('connection',peer);
    else client.destroy(Object.assign(new Error('Realm unavailable'),{code:'ECONNREFUSED'}));
  });
  return client;
}
const originalHTTP=http.globalAgent.createConnection,originalHTTPS=https.globalAgent.createConnection;
http.globalAgent.createConnection=memoryConnection;
https.globalAgent.createConnection=options=>tls.connect({...options,socket:memoryConnection(options)});
after(()=>{
  http.globalAgent.destroy();https.globalAgent.destroy();
  http.globalAgent.createConnection=originalHTTP;https.globalAgent.createConnection=originalHTTPS;
});

async function mount(t,server,protocol='http') {
  const port=nextPort++;endpoints.set(port,server);
  const sockets=new Set();
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  t.after(()=>{
    endpoints.delete(port);
    for(const socket of sockets)socket.destroy();
  });
  return `${protocol}://127.0.0.1:${port}`;
}

function request(base,path='/',{method='GET',headers={},body}={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request(base,{path,method,headers:{...(body===undefined?{}:{'Content-Length':Buffer.byteLength(body)}),...headers}},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);req.end(body);
  });
}

function socketRead(socket,ready) {
  return new Promise((resolve,reject)=>{
    let received=Buffer.alloc(0);
    const cleanup=()=>{socket.off('data',data);socket.off('error',error);socket.off('end',end);};
    const error=err=>{cleanup();reject(err);};
    const end=()=>error(new Error('Socket ended before the expected response'));
    const data=chunk=>{received=Buffer.concat([received,chunk]);if(ready(received)){cleanup();resolve(received);}};
    socket.on('data',data);socket.once('error',error);socket.once('end',end);
  });
}

const key=Buffer.from('sixteen-byte-key').toString('base64');
const welcome=Buffer.from([0x81,2,0x6f,0x6b]); // A complete server text frame: "ok".
const early=Buffer.from([0x81,0x82,1,2,3,4,0x69,0x6b]); // Masked client text: "hi".
function upgradeRequest(path='/api/world') {
  return `GET ${path} HTTP/1.1\r\nHost: public.example\r\nOrigin: https://public.example\r\nCookie: session=runner\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`;
}
function upgradeRealm(server,seen=[]) {
  server.on('upgrade',(req,socket,head)=>{
    seen.push({path:req.url,headers:req.headers});socket.on('error',()=>{});
    if(req.url.includes('denied')){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 6\r\n\r\nDenied');return;}
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const response=`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`;
    socket.write(Buffer.concat([Buffer.from(response),welcome]));
    // Echo bytes unchanged to exercise the tunnel, including data buffered at upgrade.
    if(head.length)socket.write(head);
    socket.on('data',chunk=>socket.write(chunk));
  });
  return server;
}
function connect(t,base) {
  const socket=memoryConnection({port:new URL(base).port});
  socket.on('error',()=>{});t.after(()=>socket.destroy());return socket;
}
async function roundTrip(t,base) {
  const socket=connect(t,base);
  const response=socketRead(socket,body=>body.includes(Buffer.concat([welcome,early])));
  socket.write(Buffer.concat([Buffer.from(upgradeRequest('/api/world?shard=1')),early]));
  const body=await response;
  assert.match(body.toString(),/^HTTP\/1.1 101 Switching Protocols/);
  const next=socketRead(socket,data=>data.equals(early));socket.write(early);await next;
  socket.destroy();
}

test('realm configuration accepts HTTP(S) origins and rejects ambiguous targets',()=>{
  for(const backend of ['http://127.0.0.1:8080','https://realm.example','http://[::1]:8080/'])assert.ok(createFrontendServer({backend}));
  for(const backend of ['', 'realm.example','ftp://realm.example','https://user:secret@realm.example','https://realm.example/api','https://realm.example/?mode=1','https://realm.example/#world']){
    assert.throws(()=>createFrontendServer({backend}),/SLOPERBERPUNK_BACKEND/);
  }
});

test('one server delivers the lightweight landing, full game, all assets, and license',{timeout:10000},async t=>{
  const base=await mount(t,createFrontendServer());
  const index=await request(base);
  assert.equal(index.status,200);assert.match(index.body,/href="\/play\.html"/);
  assert.doesNotMatch(index.body,/<(?:script|canvas)\b/);
  assert.equal(index.headers['cache-control'],'no-store');assert.equal(index.headers['x-content-type-options'],'nosniff');
  assert.match(index.headers['content-security-policy'],/connect-src 'self'/);
  const root=new URL('../client/',import.meta.url);
  async function checkFiles(dir,prefix='') {
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const path=prefix+entry.name,url=new URL(entry.name+(entry.isDirectory()?'/':''),dir);
      if(entry.isDirectory())await checkFiles(url,path+'/');
      else{
        const result=await request(base,'/'+path+'?v=1');
        assert.equal(result.status,200,path);assert.equal(result.body,await readFile(url,'utf8'),path);
      }
    }
  }
  await checkFiles(root);
  assert.match((await request(base,'/play.html')).body,/src="\/src\/app\.js"/);
  assert.match((await request(base,'/landing.css')).headers['content-type'],/^text\/css/);
  assert.match((await request(base,'/src/app.js')).headers['content-type'],/^text\/javascript/);
  assert.match((await request(base,'/data/world.json')).headers['content-type'],/^application\/json/);
  assert.equal((await request(base,'/LICENSE')).body,await readFile(new URL('../LICENSE',import.meta.url),'utf8'));
  const head=await request(base,'/',{method:'HEAD'});
  assert.equal(head.body,'');assert.equal(Number(head.headers['content-length']),Buffer.byteLength(index.body));
});

test('static serving rejects traversal, private paths, malformed URLs, and writes',{timeout:5000},async t=>{
  const base=await mount(t,createFrontendServer());
  for(const path of ['/../package.json','/%2e%2e/package.json','/.git/config','//etc/passwd','/src/%2e%2e/%2e%2e/package.json','/%5cetc%5cpasswd','/%00','/server/data/accounts','/package.json','/missing','/data/']){
    assert.equal((await request(base,path)).status,404,path);
  }
  assert.equal((await request(base,'/%ZZ')).status,400);
  const denied=await request(base,'/',{method:'POST',body:'overwrite'});
  assert.equal(denied.status,405);assert.equal(denied.headers.allow,'GET, HEAD');
  assert.equal((await request(base,'/')).status,200);
});

test('configured API proxy preserves auth, origin, query, body, and status while removing hop headers',{timeout:5000},async t=>{
  const realm=await mount(t,http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    res.writeHead(201,{'Content-Type':'application/json','Set-Cookie':['session=new; HttpOnly; SameSite=Strict','other=1'],'Connection':'x-remove','X-Remove':'private','Cache-Control':'public'});
    res.end(JSON.stringify({method:req.method,path:req.url,headers:req.headers,body:Buffer.concat(chunks).toString()}));
  }));
  const originalBackend=process.env.SLOPERBERPUNK_BACKEND;
  t.after(()=>{if(originalBackend===undefined)delete process.env.SLOPERBERPUNK_BACKEND;else process.env.SLOPERBERPUNK_BACKEND=originalBackend;});
  process.env.SLOPERBERPUNK_BACKEND=realm;
  const base=await mount(t,createFrontendServer());
  for(const method of ['GET','POST','DELETE']){
    const body=method==='GET'?undefined:'{"name":"Echo"}';
    const result=await request(base,'/api/characters?id=echo',{method,body,headers:{Origin:'https://public.example',Cookie:'session=old','X-Sloperberpunk':'1','Content-Type':'application/json',Connection:'x-remove','X-Remove':'private'}});
    assert.equal(result.status,201);assert.equal(result.headers['x-remove'],undefined);assert.equal(result.headers['cache-control'],'no-store');
    assert.deepEqual(result.headers['set-cookie'],['session=new; HttpOnly; SameSite=Strict','other=1']);
    const echoed=JSON.parse(result.body);
    assert.equal(echoed.method,method);assert.equal(echoed.path,'/api/characters?id=echo');assert.equal(echoed.body,body||'');
    assert.equal(echoed.headers.host,new URL(realm).host);assert.equal(echoed.headers.origin,'https://public.example');
    assert.equal(echoed.headers.cookie,'session=old');assert.equal(echoed.headers['x-sloperberpunk'],'1');assert.equal(echoed.headers['x-remove'],undefined);
  }
});

test('world upgrades preserve auth, buffered frames, bidirectional bytes, and rejection status',{timeout:5000},async t=>{
  const seen=[],realm=await mount(t,upgradeRealm(http.createServer(),seen));
  const base=await mount(t,createFrontendServer({backend:realm}));
  await roundTrip(t,base);
  assert.equal(seen[0].path,'/api/world?shard=1');assert.equal(seen[0].headers.host,new URL(realm).host);
  assert.equal(seen[0].headers.origin,'https://public.example');assert.equal(seen[0].headers.cookie,'session=runner');
  for(const [path,status]of [['/api/world?denied',401],['/api/other',404],['/play.html',404]]){
    const socket=connect(t,base),response=socketRead(socket,body=>body.includes('\r\n\r\n'));
    socket.write(upgradeRequest(path));assert.match((await response).toString(),new RegExp(`^HTTP/1.1 ${status} `));socket.destroy();
  }
});

test('realm outages return controlled errors while the frontend stays available',{timeout:5000},async t=>{
  const realm=await mount(t,http.createServer());endpoints.delete(Number(new URL(realm).port));
  const base=await mount(t,createFrontendServer({backend:realm}));
  const response=await request(base,'/api/session');assert.equal(response.status,503);assert.match(JSON.parse(response.body).error,/local character/);
  assert.equal((await request(base,'/api/session',{method:'HEAD'})).body,'');
  const socket=connect(t,base),upgrade=socketRead(socket,body=>body.includes('local character'));
  socket.write(upgradeRequest());assert.match((await upgrade).toString(),/^HTTP\/1.1 503 /);
  assert.equal((await request(base)).status,200);assert.equal((await request(base,'/play.html')).status,200);
});

test('HTTPS and secure world upgrades use verified TLS with the same backend setting',{timeout:10000},async t=>{
  // Public test identity for localhost only; never used by the frontend at runtime.
  const privateKey=`-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgCzgcuf5tOsj2XtLz
w7klU++wRMtOjy4SpGHt+Wqn9mGhRANCAAQnttDwOgWppPSk9JADh4QOIINdt6n1
x7QlDWhJnFnorFxihgJBhtdFs12xnKG2yQSaZL2xYKAwoCMZgG5tnPdc
-----END PRIVATE KEY-----`;
  const cert=`-----BEGIN CERTIFICATE-----
MIIBmzCCAUGgAwIBAgIUKE+Au6Z2yI8vYsae70JbOtsMB7AwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAyMTE3MjEyNVoYDzIxMjYwOTI3
MTcyMTI1WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAAQnttDwOgWppPSk9JADh4QOIINdt6n1x7QlDWhJnFnorFxihgJBhtdF
s12xnKG2yQSaZL2xYKAwoCMZgG5tnPdco28wbTAdBgNVHQ4EFgQUqY1WqGJK7pgp
M0V8BXl9Qya2clcwHwYDVR0jBBgwFoAUqY1WqGJK7pgpM0V8BXl9Qya2clcwDwYD
VR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwCgYIKoZI
zj0EAwIDSAAwRQIhAIZnd5ZgnaR8CsfT0So52CzNgZxitO6FN8Hv/xhy9kKCAiAU
NePNfgT7WSILxdTFfuc/AlBumBtOpSOTQ1o0LAVjUA==
-----END CERTIFICATE-----`;
  const realm=await mount(t,upgradeRealm(https.createServer({cert,key:privateKey},(_req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"secure":true}');})),'https');
  const base=await mount(t,createFrontendServer({backend:realm}));
  assert.equal((await request(base,'/api/health')).status,503,'Untrusted certificates must fail closed');
  const originalCA=https.globalAgent.options.ca;
  t.after(()=>{if(originalCA===undefined)delete https.globalAgent.options.ca;else https.globalAgent.options.ca=originalCA;});
  https.globalAgent.options.ca=cert;
  const response=await request(base,'/api/health');assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.body),{secure:true});
  await roundTrip(t,base);
});
