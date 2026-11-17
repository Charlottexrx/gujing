const source=__PUBLIC_SOURCE__;
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function sourceResponse(request){
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Read-only source repository',{status:405});
 const path=new URL(request.url).pathname;
 if(path==='/source'||path==='/source/'){
  const base=new URL(request.url).origin;
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>股镜 · 公开源码仓库</title><style>body{font:16px system-ui;max-width:1000px;margin:48px auto;padding:24px;background:#f4f7f5;color:#203a32}a{color:#13664e}pre{background:white;padding:20px;overflow:auto;white-space:pre-wrap}li{margin:10px 0}</style><h1>股镜 · 公开只读 Git 仓库</h1><p>免登录查看、克隆。此仓库由本站托管；尚未同步到 GitHub。</p><p>已去除金融API原始缓存、密钥、监控记录和私有历史。运行时需要按 README 配置数据接口。</p><pre>git clone '+base+'/source.git stock-lens</pre><p>提交：<code>'+source.commit+'</code></p><p><a href="/source/raw/README.md">README · 启动与环境变量</a> · <a href="/source/raw/EVALUATION.md">AI与测试记录</a> · <a href="/source/raw/BROWSER_ACCEPTANCE.md">真实浏览器验收</a> · <a href="/">打开产品</a></p><h2>源码文件</h2><ul>'+source.files.map(p=>'<li><a href="/source/raw/'+escape(p)+'">'+escape(p)+'</a></li>').join('')+'</ul>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'}});
 }
 const encoded=source.assets[path];if(!encoded)return new Response('Not found',{status:404});const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':path.startsWith('/source/raw/')?'text/plain; charset=utf-8':'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
}
