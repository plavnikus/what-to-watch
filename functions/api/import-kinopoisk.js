// Importer version: 5.4 — profile URL + rate-safe Cloudflare Browser Run /content
const JSON_HEADERS={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff'
};

const WATCHLIST_TYPE='3575';
const RETRY_DELAY_MS=11000;

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

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function jsonResponse(data,status=200,extraHeaders={}){
  return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...extraHeaders}});
}

function normalizeListUrl(input){
  let url;
  try{url=new URL(input)}catch{throw new Error('Некорректная ссылка.')}
  if(!/(^|\.)kinopoisk\.ru$/i.test(url.hostname))throw new Error('Нужна ссылка на профиль Кинопоиска.');

  const listMatch=url.pathname.match(/^\/user\/(\d+)\/movies\/list\/type\/(\d+)/i);
  const profileMatch=url.pathname.match(/^\/user\/(\d+)\/?$/i);
  const userId=listMatch?.[1]||profileMatch?.[1];
  const listType=listMatch?.[2]||WATCHLIST_TYPE;

  if(!userId)throw new Error('Нужна ссылка на ваш профиль Кинопоиска вида kinopoisk.ru/user/1234567/.');

  return {
    userId,
    listType,
    sourceType:listMatch?'list':'profile',
    base:`https://www.kinopoisk.ru/user/${userId}/movies/list/type/${listType}/sort/default/vector/desc/`
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

function isDailyBrowserLimit(message){
  return /browser\s*time\s*limit\s*exceeded|time\s*limit\s*exceeded\s*for\s*today|browser\s*hours?.*limit/i.test(String(message||''));
}

async function fetchBrowserHtml(url,env,{waitForTimeout=0,waitUntil='networkidle2'}={}){
  const {accountId,token}=browserCredentials(env);
  const endpoint=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/content`;
  const payload={
    url,
    gotoOptions:{waitUntil,timeout:45000},
    rejectResourceTypes:['image','media','font']
  };
  if(waitForTimeout>0)payload.waitForTimeout=waitForTimeout;
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    body:JSON.stringify(payload)
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
    error.dailyLimit=isDailyBrowserLimit(message);
    throw error;
  }
  try{
    const data=JSON.parse(raw);
    return String(data?.result?.content||data?.result||data?.content||raw);
  }catch{return raw;}
}

async function fetchParsedPage(pageUrl,env){
  let html=await fetchBrowserHtml(pageUrl,env,{waitForTimeout:0,waitUntil:'networkidle2'});
  let items=parseItems(html);
  if(items.length)return {html,items,attempt:1};

  await wait(RETRY_DELAY_MS);
  html=await fetchBrowserHtml(pageUrl,env,{waitForTimeout:2000,waitUntil:'networkidle2'});
  items=parseItems(html);
  return {html,items,attempt:2};
}

export async function onRequestPost(context){
  try{
    const body=await context.request.json().catch(()=>({}));
    const list=normalizeListUrl(body.url||'');
    const page=Math.max(1,Math.floor(Number(body.page)||1));
    if(page>120)throw new Error('Номер страницы слишком большой.');
    const pageUrl=page===1?list.base:`${list.base}page/${page}/`;
    const rendered=await fetchParsedPage(pageUrl,context.env);
    const html=rendered.html;
    const items=rendered.items;
    const totalExpected=parseTotal(html);
    const totalPages=totalExpected?Math.max(1,Math.ceil(totalExpected/25)):null;
    if(!items.length){
      const text=decodeHtml(html);
      const sample=text.slice(0,260);
      throw new Error(page===1
        ?`Страница открылась, но фильмы из «Буду смотреть» не распознаны.${sample?` Начало ответа: ${sample}`:''}`
        :`Страница ${page} дважды загрузилась без фильмов. Прогресс сохранён — попробуйте продолжить позже.`);
    }
    return jsonResponse({
      source:'kinopoisk-browser-run-content',
      importerVersion:'5.4',
      userId:list.userId,
      listType:list.listType,
      sourceType:list.sourceType,
      page,
      pageUrl,
      totalExpected:totalExpected||null,
      totalPages,
      totalParsed:items.length,
      renderAttempt:rendered.attempt,
      items
    });
  }catch(error){
    if(error?.dailyLimit){
      return jsonResponse({
        error:'Лимит Browser Run на сегодня исчерпан. Прогресс импорта сохранён — продолжите позже, и приложение начнёт с той же страницы.',
        retryable:false,
        importerVersion:'5.4'
      },503);
    }
    if(error?.status===429){
      return jsonResponse({
        error:'Cloudflare временно ограничил частоту запросов.',
        retryAfter:Math.max(11,error.retryAfter||11),
        retryable:true,
        importerVersion:'5.4'
      },429,{'retry-after':String(Math.max(11,error.retryAfter||11))});
    }
    return jsonResponse({error:error.message||'Ошибка импорта.',importerVersion:'5.4'},400);
  }
}

export function onRequest(){
  return jsonResponse({error:'Метод не поддерживается.'},405,{allow:'POST'});
}
