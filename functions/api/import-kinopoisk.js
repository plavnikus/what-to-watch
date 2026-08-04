// Importer version: 3.0 — Cloudflare Browser Run
const JSON_HEADERS={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff'
};

const decodeHtml=value=>String(value||'')
  .replace(/<[^>]*>/g,' ')
  .replace(/&nbsp;|&#160;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/&quot;/gi,'"')
  .replace(/&#39;|&apos;/gi,"'")
  .replace(/&laquo;/gi,'«')
  .replace(/&raquo;/gi,'»')
  .replace(/&ndash;|&#8211;/gi,'–')
  .replace(/&mdash;|&#8212;/gi,'—')
  .replace(/&#(\d+);/g,(_,code)=>String.fromCharCode(Number(code)))
  .replace(/\s+/g,' ')
  .trim();

function normalizeListUrl(input){
  let url;
  try{url=new URL(input)}catch{throw new Error('Некорректная ссылка.')}
  if(!/(^|\.)kinopoisk\.ru$/i.test(url.hostname))throw new Error('Нужна ссылка на kinopoisk.ru.');
  const match=url.pathname.match(/^\/user\/(\d+)\/movies\/list\/type\/(\d+)/i);
  if(!match)throw new Error('Нужна публичная ссылка на список фильмов пользователя Кинопоиска.');
  return {
    userId:match[1],
    listType:match[2],
    base:`https://www.kinopoisk.ru/user/${match[1]}/movies/list/type/${match[2]}/sort/default/vector/desc/`
  };
}

function parseTotal(html){
  const text=decodeHtml(html);
  const matches=[
    text.match(/всего фильмов\s*(\d+)/i),
    text.match(/(?:1|\d+)\s*[—-]\s*\d+\s+из\s+(\d+)/i),
    text.match(/Буду смотреть\s*\((\d+)\)/i)
  ];
  for(const match of matches)if(match)return Number(match[1]);
  return 0;
}

function parseItems(html){
  const items=[];
  const seen=new Set();
  const linkRegex=/<a\b[^>]*href=["'](?:https?:\/\/www\.kinopoisk\.ru)?\/(film|series)\/(\d+)\/?[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while((match=linkRegex.exec(html))){
    const kind=match[1].toLowerCase();
    const kinopoiskId=match[2];
    if(seen.has(kinopoiskId))continue;
    let title=decodeHtml(match[3]);
    if(!title||/^(трейлеры|кадры|награды|сайты)$/i.test(title))continue;
    const context=decodeHtml(html.slice(match.index+match[0].length,match.index+match[0].length+900));
    const yearMatch=context.match(/^.{0,240}?\((\d{4})(?:\s*[–—-]\s*(\d{4}|\.\.\.))?\)/);
    if(!yearMatch)continue;
    const isSeries=kind==='series'||/\(сериал\)\s*$/i.test(title);
    title=title.replace(/\s*\(сериал\)\s*$/i,'').trim();
    if(!title)continue;
    seen.add(kinopoiskId);
    items.push({
      kinopoiskId,
      title,
      year:Number(yearMatch[1]),
      yearTo:yearMatch[2]&&/^\d{4}$/.test(yearMatch[2])?Number(yearMatch[2]):null,
      type:isSeries?'series':'film'
    });
  }
  return items;
}

async function fetchBrowserHtml(url,env){
  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const token=String(env.CLOUDFLARE_BROWSER_TOKEN||'').trim();
  if(!accountId||!token)throw new Error('В Cloudflare не настроены Browser Run переменные.');

  const endpoint=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/content`;
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{
      'authorization':`Bearer ${token}`,
      'content-type':'application/json'
    },
    body:JSON.stringify({
      url,
      gotoOptions:{waitUntil:'networkidle2',timeout:45000},
      rejectResourceTypes:['image','media','font']
    })
  });

  const raw=await response.text();
  if(!response.ok){
    let message=`Browser Run вернул ошибку ${response.status}.`;
    try{
      const data=JSON.parse(raw);
      message=data?.errors?.[0]?.message||data?.error||message;
    }catch{}
    throw new Error(message);
  }

  // В зависимости от версии API ответ может быть HTML либо JSON-обёрткой.
  try{
    const data=JSON.parse(raw);
    return data?.result?.content||data?.result||data?.content||raw;
  }catch{
    return raw;
  }
}

export async function onRequestPost(context){
  try{
    const body=await context.request.json().catch(()=>({}));
    const list=normalizeListUrl(body.url||'');

    const firstHtml=await fetchBrowserHtml(list.base,context.env);
    const total=parseTotal(firstHtml);
    const firstItems=parseItems(firstHtml);
    if(!firstItems.length){
      throw new Error('Browser Run открыл страницу, но фильмы не распознаны. Возможно, Кинопоиск показал защитную страницу.');
    }

    const totalPages=Math.max(1,Math.ceil((total||firstItems.length)/25));
    if(totalPages>120)throw new Error('Список слишком большой для импорта.');

    const all=[...firstItems];
    const seen=new Set(all.map(item=>item.kinopoiskId));
    const pages=Array.from({length:Math.max(0,totalPages-1)},(_,index)=>index+2);
    const concurrency=2;

    for(let offset=0;offset<pages.length;offset+=concurrency){
      const batch=pages.slice(offset,offset+concurrency);
      const results=await Promise.all(batch.map(async page=>{
        const html=await fetchBrowserHtml(`${list.base}page/${page}/`,context.env);
        return parseItems(html);
      }));
      for(const pageItems of results){
        for(const item of pageItems){
          if(!seen.has(item.kinopoiskId)){
            seen.add(item.kinopoiskId);
            all.push(item);
          }
        }
      }
    }

    return new Response(JSON.stringify({
      source:'kinopoisk-browser-run',
      importerVersion:'3.0',
      userId:list.userId,
      listType:list.listType,
      totalExpected:total||null,
      totalParsed:all.length,
      items:all
    }),{status:200,headers:JSON_HEADERS});
  }catch(error){
    return new Response(JSON.stringify({error:error.message||'Ошибка импорта.'}),{status:400,headers:JSON_HEADERS});
  }
}

export function onRequest(){
  return new Response(JSON.stringify({error:'Метод не поддерживается.'}),{
    status:405,
    headers:{...JSON_HEADERS,allow:'POST'}
  });
}
