// Movie details test v1.0 — PoiskKino provider adapter
const JSON_HEADERS={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff'
};

const asNumber=value=>Number.isFinite(Number(value))?Number(value):null;
const names=value=>Array.isArray(value)?value.map(item=>String(item?.name||'').trim()).filter(Boolean):[];
const formatDuration=minutes=>{
  const value=asNumber(minutes);
  if(!value||value<=0)return '';
  const hours=Math.floor(value/60),rest=value%60;
  return hours?`${hours} ч${rest?` ${rest} мин`:''}`:`${rest} мин`;
};
const mapType=value=>{
  const type=String(value||'').toLowerCase();
  if(type==='mini-series')return 'mini';
  if(['tv-series','animated-series','anime'].includes(type))return 'series';
  return 'film';
};
function normalizeMovie(source,id){
  const type=mapType(source.type);
  const title=source.name||source.alternativeName||source.enName||`Кинопоиск ${id}`;
  const imdbId=source.externalId?.imdb||'';
  const trailer=Array.isArray(source.videos?.trailers)?source.videos.trailers.find(item=>item?.url)?.url:'';
  return {
    kinopoiskId:String(source.id||id),
    title:String(title),
    originalTitle:String(source.alternativeName||source.enName||''),
    year:asNumber(source.year),
    type,
    genres:names(source.genres),
    countries:names(source.countries),
    desc:String(source.description||source.shortDescription||''),
    time:formatDuration(source.movieLength||source.seriesLength),
    posterUrl:String(source.poster?.url||source.poster?.previewUrl||''),
    backdropUrl:String(source.backdrop?.url||source.backdrop?.previewUrl||''),
    kp:asNumber(source.rating?.kp),
    imdb:asNumber(source.rating?.imdb),
    kpUrl:`https://www.kinopoisk.ru/${type==='series'||type==='mini'?'series':'film'}/${source.id||id}/`,
    imdbUrl:imdbId?`https://www.imdb.com/title/${imdbId}/`:'',
    trailer:String(trailer||`https://www.youtube.com/results?search_query=${encodeURIComponent(title+' трейлер')}`),
    enrichedAt:new Date().toISOString()
  };
}
async function fetchMovie(id,token){
  const response=await fetch(`https://api.poiskkino.dev/v1.4/movie/${encodeURIComponent(id)}`,{
    headers:{'X-API-KEY':token,'accept':'application/json'},
    cf:{cacheTtl:86400,cacheEverything:true}
  });
  if(!response.ok){
    let message=`ПоискКино вернул ошибку ${response.status}`;
    try{const body=await response.json();message=body?.message||body?.error||message}catch{}
    throw new Error(message);
  }
  return normalizeMovie(await response.json(),id);
}
export async function onRequestPost(context){
  try{
    const token=context.env.POISKKINO_API_TOKEN;
    if(!token)throw new Error('В Cloudflare не найден секрет POISKKINO_API_TOKEN.');
    const body=await context.request.json().catch(()=>({}));
    const ids=[...new Set((Array.isArray(body.kinopoiskIds)?body.kinopoiskIds:[]).map(String).filter(id=>/^\d+$/.test(id)))].slice(0,30);
    if(!ids.length)throw new Error('Не переданы ID фильмов для теста.');
    const items=[],errors=[];
    const concurrency=3;
    for(let offset=0;offset<ids.length;offset+=concurrency){
      const batch=ids.slice(offset,offset+concurrency);
      const results=await Promise.allSettled(batch.map(id=>fetchMovie(id,token)));
      results.forEach((result,index)=>{
        if(result.status==='fulfilled')items.push(result.value);
        else errors.push({kinopoiskId:batch[index],error:result.reason?.message||'Ошибка запроса'});
      });
    }
    return new Response(JSON.stringify({provider:'poiskkino',requested:ids.length,received:items.length,items,errors}),{status:200,headers:JSON_HEADERS});
  }catch(error){
    return new Response(JSON.stringify({error:error.message||'Ошибка получения карточек.'}),{status:400,headers:JSON_HEADERS});
  }
}
export function onRequest(){
  return new Response(JSON.stringify({error:'Метод не поддерживается.'}),{status:405,headers:{...JSON_HEADERS,allow:'POST'}});
}
