// Importer version: 2.1 — direct Kinopoisk HTML + Jina Reader fallback
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

function parseTotal(text){
  const clean=decodeHtml(text);
  const matches=[
    clean.match(/всего фильмов\s*(\d+)/i),
    clean.match(/(?:1|\d+)\s*[—-]\s*\d+\s+из\s+(\d+)/i),
    clean.match(/Буду смотреть\s*\((\d+)\)/i)
  ];
  for(const match of matches)if(match)return Number(match[1]);
  return 0;
}

function pushItem(items,seen,kind,id,rawTitle,context){
  if(seen.has(id))return;
  let title=decodeHtml(rawTitle).replace(/^\d+\s+/,'').trim();
  if(!title||/^(трейлеры|кадры|награды|сайты)$/i.test(title))return;
  const yearMatch=decodeHtml(context).match(/\((\d{4})(?:\s*[–—-]\s*(\d{4}|\.\.\.))?\)/);
  if(!yearMatch)return;
  const isSeries=kind.toLowerCase()==='series'||/\(сериал\)\s*$/i.test(title);
  title=title.replace(/\s*\(сериал\)\s*$/i,'').trim();
  if(!title)return;
  seen.add(id);
  items.push({
    kinopoiskId:id,
    title,
    year:Number(yearMatch[1]),
    yearTo:yearMatch[2]&&/^\d{4}$/.test(yearMatch[2])?Number(yearMatch[2]):null,
    type:isSeries?'series':'film'
  });
}

function parseHtmlItems(html){
  const items=[];
  const seen=new Set();
  const linkRegex=/<a\b[^>]*href=["'](?:https?:\/\/www\.kinopoisk\.ru)?\/(film|series)\/(\d+)\/?[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while((match=linkRegex.exec(html))){
    const context=html.slice(match.index+match[0].length,match.index+match[0].length+900);
    pushItem(items,seen,match[1],match[2],match[3],context);
  }
  return items;
}

function parseMarkdownItems(markdown){
  const items=[];
  const seen=new Set();
  const linkRegex=/\[([^\]]+)\]\(https?:\/\/(?:www\.)?kinopoisk\.ru\/(film|series)\/(\d+)\/?[^)]*\)/gi;
  let match;
  while((match=linkRegex.exec(markdown))){
    const context=markdown.slice(match.index+match[0].length,match.index+match[0].length+500);
    pushItem(items,seen,match[2],match[3],match[1],context);
  }
  return items;
}

async function fetchDirect(url){
  const response=await fetch(url,{
    headers:{
      'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language':'ru-RU,ru;q=0.9,en;q=0.7'
    },
    redirect:'follow'
  });
  if(!response.ok)throw new Error(`Кинопоиск вернул ошибку ${response.status}.`);
  return response.text();
}

async function fetchViaReader(url){
  const readerUrl=`https://r.jina.ai/http://${url.replace(/^https?:\/\//,'')}`;
  const response=await fetch(readerUrl,{
    headers:{
      'accept':'text/plain; charset=utf-8',
      'x-no-cache':'true'
    },
    redirect:'follow'
  });
  if(!response.ok)throw new Error(`Резервный сервис чтения вернул ошибку ${response.status}.`);
  return response.text();
}

async function fetchAndParse(url,preferReader=false){
  if(!preferReader){
    try{
      const html=await fetchDirect(url);
      const items=parseHtmlItems(html);
      if(items.length)return {text:html,items,source:'direct'};
    }catch(error){
      // Переходим к резервному способу ниже.
    }
  }
  const markdown=await fetchViaReader(url);
  return {text:markdown,items:parseMarkdownItems(markdown),source:'reader'};
}

export async function onRequestPost(context){
  try{
    const body=await context.request.json().catch(()=>({}));
    const list=normalizeListUrl(body.url||'');

    const first=await fetchAndParse(list.base);
    const total=parseTotal(first.text);
    const totalPages=Math.max(1,Math.ceil((total||25)/25));
    if(totalPages>120)throw new Error('Список слишком большой для импорта.');

    const all=[...first.items];
    const seen=new Set(all.map(item=>item.kinopoiskId));
    const pages=Array.from({length:Math.max(0,totalPages-1)},(_,index)=>index+2);
    const concurrency=3;

    for(let offset=0;offset<pages.length;offset+=concurrency){
      const batch=pages.slice(offset,offset+concurrency);
      const results=await Promise.all(batch.map(async page=>{
        const result=await fetchAndParse(`${list.base}page/${page}/`,first.source==='reader');
        return result.items;
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

    if(!all.length)throw new Error('Не удалось распознать фильмы. Кинопоиск не отдал публичный список серверу.');

    return new Response(JSON.stringify({
      source:'kinopoisk-public-list',
      parser:first.source,
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
  return new Response(JSON.stringify({error:'Метод не поддерживается.'}),{status:405,headers:{...JSON_HEADERS,allow:'POST'}});
}
