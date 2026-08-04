// Importer version: 4.0 — Cloudflare Browser Run /crawl
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

function jsonResponse(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});
}

function normalizeListUrl(input){
  let url;
  try{url=new URL(input)}catch{throw new Error('Некорректная ссылка.')}
  if(!/(^|\.)kinopoisk\.ru$/i.test(url.hostname))throw new Error('Нужна ссылка на kinopoisk.ru.');
  const match=url.pathname.match(/^\/user\/(\d+)\/movies\/list\/type\/(\d+)/i);
  if(!match)throw new Error('Нужна публичная ссылка на список фильмов пользователя Кинопоиска.');
  const base=`https://www.kinopoisk.ru/user/${match[1]}/movies/list/type/${match[2]}/sort/default/vector/desc/`;
  return {userId:match[1],listType:match[2],base};
}

function browserCredentials(env){
  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const token=String(env.CLOUDFLARE_BROWSER_TOKEN||'').trim();
  if(!accountId||!token)throw new Error('В Cloudflare не настроены Browser Run переменные.');
  return {accountId,token};
}

async function cloudflareRequest(url,token,options={}){
  const response=await fetch(url,{
    ...options,
    headers:{
      authorization:`Bearer ${token}`,
      ...(options.body?{'content-type':'application/json'}:{}),
      ...(options.headers||{})
    }
  });
  const raw=await response.text();
  let data={};
  try{data=JSON.parse(raw)}catch{}
  if(!response.ok||data.success===false){
    const message=data?.errors?.[0]?.message||data?.error||`Cloudflare Browser Run вернул ошибку ${response.status}.`;
    throw new Error(message);
  }
  return data;
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
    const context=decodeHtml(html.slice(match.index+match[0].length,match.index+match[0].length+1000));
    const yearMatch=context.match(/^.{0,280}?\((\d{4})(?:\s*[–—-]\s*(\d{4}|\.\.\.))?\)/);
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

async function startCrawl(list,env){
  const {accountId,token}=browserCredentials(env);
  const endpoint=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/crawl`;
  const data=await cloudflareRequest(endpoint,token,{
    method:'POST',
    body:JSON.stringify({
      url:list.base,
      limit:60,
      depth:10,
      source:'links',
      formats:['html'],
      render:true,
      crawlPurposes:['search'],
      maxAge:0,
      options:{
        includeExternalLinks:false,
        includeSubdomains:false,
        includePatterns:[`${list.base}**`]
      },
      rejectResourceTypes:['image','media','font','stylesheet']
    })
  });
  const jobId=typeof data.result==='string'?data.result:data?.result?.id;
  if(!jobId)throw new Error('Cloudflare не вернул идентификатор задачи импорта.');
  return jobId;
}

async function getCrawlPage(jobId,env,params='limit=1'){
  const {accountId,token}=browserCredentials(env);
  const endpoint=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/crawl/${encodeURIComponent(jobId)}${params?`?${params}`:''}`;
  return cloudflareRequest(endpoint,token);
}

async function getAllCompletedRecords(jobId,env){
  const records=[];
  let cursor='';
  for(let page=0;page<10;page++){
    const params=new URLSearchParams({limit:'100',status:'completed'});
    if(cursor)params.set('cursor',cursor);
    const data=await getCrawlPage(jobId,env,params.toString());
    const result=data.result||{};
    if(Array.isArray(result.records))records.push(...result.records);
    cursor=result.cursor||'';
    if(!cursor)break;
  }
  return records;
}

export async function onRequestPost(context){
  try{
    const body=await context.request.json().catch(()=>({}));
    const list=normalizeListUrl(body.url||'');
    const jobId=await startCrawl(list,context.env);
    return jsonResponse({
      status:'running',
      jobId,
      importerVersion:'4.0',
      userId:list.userId,
      listType:list.listType
    },202);
  }catch(error){
    return jsonResponse({error:error.message||'Не удалось запустить импорт.'},400);
  }
}

export async function onRequestGet(context){
  try{
    const requestUrl=new URL(context.request.url);
    const jobId=String(requestUrl.searchParams.get('jobId')||'').trim();
    if(!/^[a-z0-9-]{12,}$/i.test(jobId))throw new Error('Некорректный идентификатор задачи импорта.');

    const statusData=await getCrawlPage(jobId,context.env,'limit=1');
    const crawl=statusData.result||{};
    const status=String(crawl.status||'running');

    if(status==='running'){
      return jsonResponse({
        status,
        jobId,
        totalPages:Number(crawl.total)||null,
        finishedPages:Number(crawl.finished)||0
      },202);
    }

    if(status!=='completed'){
      const statusMessages={
        cancelled_due_to_timeout:'Импорт превысил допустимое время.',
        cancelled_due_to_limits:'Cloudflare остановил импорт из-за лимитов тарифа.',
        cancelled_by_user:'Импорт был отменён.',
        errored:'Cloudflare не смог обработать страницы списка.'
      };
      throw new Error(statusMessages[status]||`Импорт завершился со статусом: ${status}.`);
    }

    const records=await getAllCompletedRecords(jobId,context.env);
    const all=[];
    const seen=new Set();
    let totalExpected=0;
    let blockedPages=0;

    for(const record of records){
      const html=String(record?.html||record?.content||'');
      if(!html){
        if(record?.status&&record.status!=='completed')blockedPages++;
        continue;
      }
      totalExpected=Math.max(totalExpected,parseTotal(html));
      for(const item of parseItems(html)){
        if(!seen.has(item.kinopoiskId)){
          seen.add(item.kinopoiskId);
          all.push(item);
        }
      }
    }

    if(!all.length){
      throw new Error('Обход завершился, но фильмы не распознаны. Возможно, Кинопоиск заблокировал автоматический просмотр страниц.');
    }

    return jsonResponse({
      status:'completed',
      source:'kinopoisk-browser-run-crawl',
      importerVersion:'4.0',
      jobId,
      totalExpected:totalExpected||null,
      totalParsed:all.length,
      crawledPages:records.length,
      blockedPages,
      items:all
    });
  }catch(error){
    return jsonResponse({error:error.message||'Ошибка проверки импорта.'},400);
  }
}

export function onRequest(){
  return jsonResponse({error:'Метод не поддерживается.'},405);
}
