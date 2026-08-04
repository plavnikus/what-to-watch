// Importer version: 5.0 — sequential Cloudflare Browser Run /content
const JSON_HEADERS={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff'
};

const decodeHtml=value=>String(value||'')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
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

function jsonResponse(data,status=200,extraHeaders={}){
  return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...extraHeaders}});
}

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
  const linkRegex=/<a\b[^>]*href=["'](?:https?:\/\/(?:www\.)?kinopoisk\.ru)?\/(film|series)\/(\d+)\/?[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while((match=linkRegex.exec(html))){
    const kind=match[1].toLowerCase();
    const kinopoiskId=match[2];
    if(seen.has(kinopoiskId))continue;
    let title=decodeHtml(match[3]);
    if(!title||/^(трейлеры|кадры|награды|сайты|афиша)$/i.test(title))continue;
    const context=decodeHtml(html.slice(Math.max(0,match.index-120),match.index+match[0].length+1300));
    const yearMatch=context.match(/(?:^|\s|\()((?:19|20)\d{2})(?:\s*[–—-]\s*((?:19|20)\d{2}|\.\.\.))?/);
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

function browserCredentials(env){
  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const token=String(env.CLOUDFLARE_BROWSER_TOKEN||'').trim();
  if(!accountId||!token)throw new Error('В Cloudflare не настроены Browser Run переменные.');
  return {accountId,token};
}

async function fetchBrowserHtml(url,env){
  const {accountId,token}=browserCredentials(env);
  const endpoint=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/content`;
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
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
    const retryAfter=Math.max(0,Number(response.headers.get('retry-after'))||0);
    const error=new Error(message);
    error.status=response.status;
    error.retryAfter=retryAfter;
    throw error;
  }
  try{
    const data=JSON.parse(raw);
    return String(data?.result?.content||data?.result||data?.content||raw);
  }catch{return raw;}
}

export async function onRequestPost(context){
  try{
    const body=await context.request.json().catch(()=>({}));
    const list=normalizeListUrl(body.url||'');
    const page=Math.max(1,Math.floor(Number(body.page)||1));
    if(page>120)throw new Error('Номер страницы слишком большой.');
    const pageUrl=page===1?list.base:`${list.base}page/${page}/`;
    const html=await fetchBrowserHtml(pageUrl,context.env);
    const items=parseItems(html);
    const totalExpected=parseTotal(html);
    const totalPages=totalExpected?Math.max(1,Math.ceil(totalExpected/25)):null;
    if(!items.length){
      const text=decodeHtml(html);
      const sample=text.slice(0,260);
      throw new Error(page===1
        ?`Страница открылась, но фильмы не распознаны.${sample?` Начало ответа: ${sample}`:''}`
        :`На странице ${page} фильмы не распознаны. Импорт можно продолжить повторно.`);
    }
    return jsonResponse({
      source:'kinopoisk-browser-run-content',
      importerVersion:'5.0',
      userId:list.userId,
      listType:list.listType,
      page,
      pageUrl,
      totalExpected:totalExpected||null,
      totalPages,
      totalParsed:items.length,
      items
    });
  }catch(error){
    if(error?.status===429){
      return jsonResponse({
        error:'Cloudflare временно ограничил частоту запросов.',
        retryAfter:Math.max(10,error.retryAfter||10),
        importerVersion:'5.0'
      },429,{'retry-after':String(Math.max(10,error.retryAfter||10))});
    }
    return jsonResponse({error:error.message||'Ошибка импорта.',importerVersion:'5.0'},400);
  }
}

export function onRequest(){
  return jsonResponse({error:'Метод не поддерживается.'},405,{allow:'POST'});
}
