const enc=new TextEncoder();
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
async function sign(text,secret){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,enc.encode(text)));}
export async function visitor(request,env){
 const id=request.headers.get('oai-authenticated-user-id');if(id)return {owner:id};
 const host=new URL(request.url).hostname;if(['localhost','127.0.0.1'].includes(host))return {owner:'local-preview'};
 if(!env.SESSION_SECRET)return {owner:null};
 const cookie=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('stocklens_session='))?.slice(18);
 if(cookie){const [uuid,expiry,sig]=cookie.split('.');if(/^[a-f0-9-]{36}$/.test(uuid)&&Number(expiry)>Date.now()&&sig===await sign(uuid+'.'+expiry,env.SESSION_SECRET))return {owner:'anon:'+uuid};}
 const uuid=crypto.randomUUID(),expiry=Date.now()+30*86400000;const value=uuid+'.'+expiry+'.'+await sign(uuid+'.'+expiry,env.SESSION_SECRET);
 return {owner:'anon:'+uuid,cookie:'stocklens_session='+value+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000'};
}
export async function cronAuthorized(request,env){
 const header=request.headers.get('Authorization')??'';if(!env.MONITOR_CRON_SECRET||!header.startsWith('Bearer '))return false;
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(header.slice(7))));const b=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(env.MONITOR_CRON_SECRET)));let delta=0;for(let i=0;i<a.length;i++)delta|=a[i]^b[i];return delta===0;
}
export async function consume(db,key,limit){
 const day=new Date().toISOString().slice(0,10);const row=await db.prepare('INSERT INTO api_usage (id, count) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').bind(day+':'+key,limit).first();return Boolean(row);
}
