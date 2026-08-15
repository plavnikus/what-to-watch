(() => {
  const moodOptions = [
    ['light','😂','Лёгкое и смешное'],
    ['dynamic','🔥','Динамичное'],
    ['tense','😱','Напряжённое'],
    ['soulful','❤️','Душевное'],
    ['unusual','🧠','Интересное и необычное'],
    ['surprise','🎲','Удиви меня']
  ];
  const durationOptions = [
    ['short','⚡','До 1,5 часа'],
    ['twoHours','🍿','До 2 часов'],
    ['long','🛋','Можно длиннее'],
    ['any','','Не важно']
  ];
  const attentionOptions = [
    ['relax','🛋','Хочу просто расслабиться'],
    ['focus','👀','Готов внимательно смотреть'],
    ['complex','🤯','Можно что-то сложное'],
    ['any','','Не важно']
  ];
  const typeOptions = [
    ['film','🎬','Фильм'],
    ['series','📺','Сериал'],
    ['any','','Не важно']
  ];
  const exclusionOptions = [
    ['ужасы','😱','Ужасы'],
    ['драма','😢','Драма'],
    ['мелодрама','💕','Мелодрама'],
    ['боевик','🔫','Боевик'],
    ['animation','🧒','Анимация'],
    ['series','📺','Сериалы']
  ];

  let choiceState = createChoiceState();

  function createChoiceState(){
    return {step:0,mood:null,duration:null,attention:null,type:null,excluded:[],shownIds:[],resultIds:[]};
  }

  const style = document.createElement('style');
  style.textContent = `
    #quickChoice{padding-bottom:8px}
    .choice-flow-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 22px}
    .choice-back{width:44px;height:44px;border:1px solid var(--line);border-radius:14px;background:var(--panel2);color:var(--text);font-size:23px;line-height:1;padding:0;display:grid;place-items:center}
    .choice-progress{font-size:13px;font-weight:750;color:var(--muted);padding-right:4px}
    .choice-step-title{font-size:27px;line-height:1.15;margin:0 0 8px}
    .choice-step-note{margin:0 0 18px;color:var(--muted);line-height:1.4}
    .choice-options{display:grid;gap:10px}
    .choice-option{width:100%;min-height:60px;border:1px solid var(--line);border-radius:17px;background:var(--panel);color:var(--text);padding:14px 15px;text-align:left;display:flex;align-items:center;gap:12px;font-weight:750;font-size:16px;-webkit-tap-highlight-color:transparent}
    .choice-option:active{transform:scale(.985)}
    .choice-option.selected{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--panel))}
    .choice-option-icon{width:28px;flex:0 0 28px;text-align:center;font-size:21px}
    .choice-submit{margin-top:16px}
    .choice-primary{padding:14px}
    .choice-primary-inner{display:grid;grid-template-columns:112px minmax(0,1fr);gap:14px;align-items:start}
    .choice-primary .poster{width:112px}
    .choice-primary h2{font-size:23px;line-height:1.16;margin:0 0 8px}
    .choice-reason{font-size:14px;line-height:1.45;color:var(--muted);margin:10px 0 0}
    .choice-summary{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 16px}
    .choice-summary .badge{font-weight:650}
    .choice-alternatives{display:flex;gap:10px;overflow-x:auto;margin:0 -16px;padding:0 16px 6px;scrollbar-width:none}
    .choice-alternatives::-webkit-scrollbar{display:none}
    .choice-alt{flex:0 0 142px;border:1px solid var(--line);border-radius:17px;background:var(--panel);color:var(--text);padding:9px;text-align:left}
    .choice-alt .poster{width:100%;margin-bottom:9px}
    .choice-alt h4{font-size:14px;line-height:1.25;margin:0 0 6px}
    .choice-alt-meta{font-size:12px;color:var(--muted);line-height:1.35}
    .choice-result-actions{display:grid;gap:9px;margin-top:16px}
    .choice-empty{padding:28px 16px;text-align:center}
    @media(max-width:360px){.choice-primary-inner{grid-template-columns:94px minmax(0,1fr)}.choice-primary .poster{width:94px}}
  `;
  document.head.appendChild(style);

  const quickChoiceSection = document.createElement('section');
  quickChoiceSection.id = 'quickChoice';
  quickChoiceSection.className = 'screen';
  quickChoiceSection.innerHTML = `
    <div class="choice-flow-head">
      <button id="choiceBackBtn" class="choice-back" aria-label="Назад">←</button>
      <div id="choiceProgress" class="choice-progress"></div>
    </div>
    <div id="choiceContent"></div>
  `;
  const libraryScreen = document.querySelector('#library');
  libraryScreen.parentNode.insertBefore(quickChoiceSection,libraryScreen);

  const originalCaptureDetailOrigin = captureDetailOrigin;
  captureDetailOrigin = function(){
    if(activeScreenId()==='quickChoice'){
      detailOrigin={screen:'quickChoice',scrollY:window.scrollY,catalogQuery:$('#catalogSearchInput')?.value||'',libraryQuery:$('#searchInput')?.value||''};
      return;
    }
    return originalCaptureDetailOrigin();
  };

  const originalDetailReturnLabel = detailReturnLabel;
  detailReturnLabel = function(screen){
    if(screen==='quickChoice')return 'Вернуться к подбору';
    return originalDetailReturnLabel(screen);
  };

  function startChoice(){
    choiceState=createChoiceState();
    renderChoice();
    go('quickChoice',{behavior:'auto'});
    $$('.nav button[data-screen]').forEach(b=>b.classList.toggle('active',b.dataset.screen==='home'));
  }

  function renderChoice(){
    const progress=$('#choiceProgress');
    const box=$('#choiceContent');
    if(!progress||!box)return;
    if(choiceState.step==='result'){
      progress.textContent='Готово';
      renderChoiceResult();
      return;
    }
    progress.textContent=`${choiceState.step+1} из 5`;
    if(choiceState.step===0)renderSingleStep('Что хочется сегодня?','Выберите настроение — это главный сигнал для подбора.',moodOptions,'mood');
    if(choiceState.step===1)renderSingleStep('Сколько времени есть?','Не будем отбрасывать хороший вариант из-за пары минут.',durationOptions,'duration');
    if(choiceState.step===2)renderSingleStep('Как хочется смотреть?','Это поможет отличить лёгкий вечер от фильма, которому хочется уделить внимание.',attentionOptions,'attention');
    if(choiceState.step===3)renderSingleStep('Что смотрим?','Можно выбрать фильм, сериал или оставить оба варианта.',typeOptions,'type');
    if(choiceState.step===4)renderExclusions();
  }

  function renderSingleStep(title,note,options,key){
    $('#choiceContent').innerHTML=`
      <h1 class="choice-step-title">${title}</h1>
      <p class="choice-step-note">${note}</p>
      <div class="choice-options">
        ${options.map(([value,icon,label])=>`<button class="choice-option" data-choice-value="${value}" data-choice-key="${key}"><span class="choice-option-icon">${icon}</span><span>${label}</span></button>`).join('')}
      </div>`;
  }

  function renderExclusions(){
    const selected=new Set(choiceState.excluded);
    $('#choiceContent').innerHTML=`
      <h1 class="choice-step-title">Чего сегодня точно не хочется?</h1>
      <p class="choice-step-note">Можно выбрать несколько. Если всё подходит — ничего не отмечайте.</p>
      <div class="choice-options">
        ${exclusionOptions.map(([value,icon,label])=>`<button class="choice-option ${selected.has(value)?'selected':''}" data-choice-exclude="${value}"><span class="choice-option-icon">${icon}</span><span>${label}</span><span style="margin-left:auto;color:var(--accent);font-weight:900">${selected.has(value)?'✓':''}</span></button>`).join('')}
      </div>
      <button id="choiceSubmit" class="btn primary full choice-submit">Подобрать</button>`;
  }

  function normalizedGenres(movie){
    return new Set((movie.genres||[]).map(g=>String(g).trim().toLowerCase()));
  }
  function hasGenre(genres,name){return genres.has(name)}
  function hasAnimation(genres){return genres.has('мультфильм')||genres.has('аниме')||genres.has('анимация')}
  function movieMinutes(movie){
    const text=String(movie.time||'').toLowerCase();
    const hours=text.match(/(\d+)\s*ч/);
    const mins=text.match(/(\d+)\s*мин/);
    if(!hours&&!mins)return null;
    return (hours?Number(hours[1])*60:0)+(mins?Number(mins[1]):0);
  }
  function formatMinutes(minutes){
    if(!minutes)return '';
    const h=Math.floor(minutes/60),m=minutes%60;
    return h?`${h} ч${m?` ${m} мин`:''}`:`${m} мин`;
  }
  function addGenreWeights(genres,weights){
    let score=0;
    for(const [genre,weight] of Object.entries(weights))if(hasGenre(genres,genre))score+=weight;
    return score;
  }
  function ratingScore(movie){
    const kp=Number(movie.kp);
    if(!Number.isFinite(kp)||kp<=0)return 0;
    if(kp>=8)return 10;
    if(kp>=7.5)return 8;
    if(kp>=7)return 6;
    if(kp>=6.5)return 3;
    return 0;
  }
  function moodScore(movie,genres){
    if(choiceState.mood==='light')return Math.min(40,addGenreWeights(genres,{комедия:28,семейный:18,приключения:12})+(hasAnimation(genres)?10:0)-(hasGenre(genres,'ужасы')?22:0)-(hasGenre(genres,'драма')?10:0));
    if(choiceState.mood==='dynamic')return Math.min(40,addGenreWeights(genres,{боевик:28,приключения:22,триллер:18,фантастика:12,криминал:10})-(hasGenre(genres,'драма')&&genres.size===1?8:0));
    if(choiceState.mood==='tense')return Math.min(40,addGenreWeights(genres,{триллер:28,ужасы:26,детектив:18,криминал:14,драма:8}));
    if(choiceState.mood==='soulful')return Math.min(40,addGenreWeights(genres,{драма:22,мелодрама:24,семейный:18,биография:12,комедия:8})-(hasGenre(genres,'ужасы')?14:0)-(hasGenre(genres,'боевик')?6:0));
    if(choiceState.mood==='unusual')return Math.min(40,addGenreWeights(genres,{фантастика:16,детектив:14,триллер:10,биография:10})+(genres.size>=3?8:0)+Math.min(6,ratingScore(movie)));
    if(choiceState.mood==='surprise')return ratingScore(movie)*1.5+(genres.size>=3?5:0);
    return 0;
  }
  function attentionScore(movie,genres,minutes){
    if(choiceState.attention==='relax')return Math.min(25,addGenreWeights(genres,{комедия:15,семейный:12,приключения:9})+(hasAnimation(genres)?9:0)-(hasGenre(genres,'драма')?7:0)-(hasGenre(genres,'ужасы')?9:0)-(minutes&&minutes>140?8:0));
    if(choiceState.attention==='focus')return Math.min(25,addGenreWeights(genres,{детектив:9,триллер:8,драма:7,фантастика:7,криминал:6}));
    if(choiceState.attention==='complex')return Math.min(25,addGenreWeights(genres,{детектив:10,драма:9,фантастика:9,биография:7,триллер:6})+Math.min(7,ratingScore(movie)));
    return 0;
  }
  function durationScore(minutes){
    if(!minutes||choiceState.duration==='any'||choiceState.duration==='long')return 0;
    if(choiceState.duration==='short'){
      if(minutes<=90)return 15;
      if(minutes<=100)return 8;
      if(minutes<=110)return 0;
      return -Math.min(18,Math.ceil((minutes-110)/5)*2);
    }
    if(choiceState.duration==='twoHours'){
      if(minutes<=120)return 15;
      if(minutes<=130)return 7;
      return -Math.min(15,Math.ceil((minutes-130)/10)*2);
    }
    return 0;
  }
  function isHardMatch(movie){
    const st=states[movie.id];
    if(!st||st.status!=='watchlist')return false;
    if(choiceState.type==='film'&&movie.type!=='film')return false;
    if(choiceState.type==='series'&&!['series','mini'].includes(movie.type))return false;
    const genres=normalizedGenres(movie);
    for(const excluded of choiceState.excluded){
      if(excluded==='series'&&['series','mini'].includes(movie.type))return false;
      if(excluded==='animation'&&hasAnimation(genres))return false;
      if(excluded!=='series'&&excluded!=='animation'&&genres.has(excluded))return false;
    }
    return true;
  }
  function scoreMovie(movie){
    const genres=normalizedGenres(movie);
    const minutes=movieMinutes(movie);
    return moodScore(movie,genres)+attentionScore(movie,genres,minutes)+durationScore(minutes)+ratingScore(movie)+(states[movie.id]?.forTonight?8:0);
  }
  function genreOverlap(a,b){
    const ag=normalizedGenres(a),bg=normalizedGenres(b);
    let common=0;
    for(const g of ag)if(bg.has(g))common++;
    return common;
  }
  function chooseRecommendations(){
    let ranked=movies.filter(isHardMatch).filter(m=>!choiceState.shownIds.includes(m.id)).map(movie=>({movie,score:scoreMovie(movie)})).sort((a,b)=>b.score-a.score||(b.movie.kp||0)-(a.movie.kp||0));
    if(!ranked.length&&choiceState.shownIds.length){
      const previousPrimary=choiceState.resultIds[0];
      choiceState.shownIds=[];
      ranked=movies.filter(isHardMatch).filter(m=>m.id!==previousPrimary).map(movie=>({movie,score:scoreMovie(movie)})).sort((a,b)=>b.score-a.score||(b.movie.kp||0)-(a.movie.kp||0));
    }
    if(!ranked.length){choiceState.resultIds=[];return []}
    const picked=[ranked[0].movie];
    const rest=ranked.slice(1);
    while(picked.length<4&&rest.length){
      let bestIndex=0,bestAdjusted=-Infinity;
      for(let i=0;i<Math.min(rest.length,20);i++){
        const overlap=Math.max(...picked.map(p=>genreOverlap(p,rest[i].movie)));
        const adjusted=rest[i].score-overlap*4;
        if(adjusted>bestAdjusted){bestAdjusted=adjusted;bestIndex=i}
      }
      picked.push(rest.splice(bestIndex,1)[0].movie);
    }
    choiceState.resultIds=picked.map(m=>m.id);
    choiceState.shownIds=[...new Set([...choiceState.shownIds,...choiceState.resultIds])];
    return picked;
  }
  function choiceLabel(options,value){return options.find(([key])=>key===value)?.[2]||'Не важно'}
  function summaryLabels(){
    return [
      choiceLabel(moodOptions,choiceState.mood),
      choiceLabel(durationOptions,choiceState.duration),
      choiceLabel(attentionOptions,choiceState.attention),
      choiceLabel(typeOptions,choiceState.type)
    ];
  }
  function recommendationReason(movie){
    const parts=[];
    if(choiceState.mood&&choiceState.mood!=='surprise')parts.push(choiceLabel(moodOptions,choiceState.mood).toLowerCase());
    else if(choiceState.mood==='surprise')parts.push('неочевидный вариант из вашей кинотеки');
    const minutes=movieMinutes(movie);
    if(minutes)parts.push(formatMinutes(minutes));
    if(choiceState.attention==='relax')parts.push('для спокойного просмотра');
    if(choiceState.attention==='focus')parts.push('под внимательный просмотр');
    if(choiceState.attention==='complex')parts.push('под ваш выбор «Можно что-то сложное»');
    const text=parts.filter(Boolean).join(' · ');
    return text?text.charAt(0).toUpperCase()+text.slice(1)+'.':'Хорошо совпадает с выбранными условиями.';
  }

  function renderChoiceResult(){
    const picked=choiceState.resultIds.map(id=>movies.find(m=>m.id===id)).filter(Boolean);
    if(!picked.length)chooseRecommendations();
    const selected=choiceState.resultIds.map(id=>movies.find(m=>m.id===id)).filter(Boolean);
    const primary=selected[0];
    if(!primary){
      $('#choiceContent').innerHTML=`<div class="card choice-empty"><h2>Подходящих вариантов не нашлось</h2><p class="muted">Жёсткие исключения или тип слишком сузили выбор. Вернитесь на шаг назад и измените одно условие.</p><button class="btn secondary full" data-choice-edit="4">Изменить исключения</button></div>`;
      return;
    }
    const alternatives=selected.slice(1);
    $('#choiceContent').innerHTML=`
      <h1 class="choice-step-title">Сегодня я бы выбрал</h1>
      <div class="choice-summary">${summaryLabels().map(x=>`<span class="badge">${escapeHtml(x)}</span>`).join('')}</div>
      <article class="card choice-primary">
        <div class="choice-primary-inner">
          ${posterMarkup(primary)}
          <div>
            <h2>${escapeHtml(primary.title)}</h2>
            <div class="meta"><span class="badge kp">КП ${ratingText(primary.kp)}</span>${Number.isFinite(primary.imdb)?`<span class="badge imdb">IMDb ${ratingText(primary.imdb)}</span>`:''}</div>
            <div class="meta"><span>${yearText(primary.year)}</span><span>${typeLabel(primary.type)}</span><span>${escapeHtml(primary.time||'')}</span></div>
            <div class="genre-line">${(primary.genres||[]).slice(0,3).map(escapeHtml).join(' · ')}</div>
            <p class="choice-reason">${escapeHtml(recommendationReason(primary))}</p>
          </div>
        </div>
        <button class="btn primary full" data-choice-open="${primary.id}" style="margin-top:14px">Открыть ${primary.type==='film'?'фильм':'сериал'}</button>
      </article>
      ${alternatives.length?`<h3 style="margin:20px 0 10px">Ещё подойдут</h3><div class="choice-alternatives">${alternatives.map(m=>`<button class="choice-alt" data-choice-open="${m.id}">${posterMarkup(m)}<h4>${escapeHtml(m.title)}</h4><div class="choice-alt-meta">КП ${ratingText(m.kp)} · ${yearText(m.year)}</div><div class="genre-line">${(m.genres||[]).slice(0,2).map(escapeHtml).join(' · ')}</div></button>`).join('')}</div>`:''}
      <div class="choice-result-actions">
        <button class="btn secondary full" id="choiceMore">🎲 Другие варианты</button>
        <button class="btn secondary full" data-choice-edit="0">Изменить ответы</button>
      </div>`;
  }

  function showResult(){
    chooseRecommendations();
    choiceState.step='result';
    renderChoice();
    window.scrollTo({top:0,behavior:'smooth'});
  }

  $('#choiceContent').addEventListener('click',event=>{
    const option=event.target.closest('[data-choice-value]');
    if(option){
      choiceState[option.dataset.choiceKey]=option.dataset.choiceValue;
      choiceState.step++;
      renderChoice();
      window.scrollTo({top:0,behavior:'smooth'});
      return;
    }
    const exclude=event.target.closest('[data-choice-exclude]');
    if(exclude){
      const value=exclude.dataset.choiceExclude;
      choiceState.excluded=choiceState.excluded.includes(value)?choiceState.excluded.filter(x=>x!==value):[...choiceState.excluded,value];
      renderChoice();
      return;
    }
    if(event.target.closest('#choiceSubmit')){showResult();return}
    const open=event.target.closest('[data-choice-open]');
    if(open){openMovie(open.dataset.choiceOpen);return}
    if(event.target.closest('#choiceMore')){
      chooseRecommendations();
      renderChoiceResult();
      window.scrollTo({top:0,behavior:'smooth'});
      return;
    }
    const edit=event.target.closest('[data-choice-edit]');
    if(edit){choiceState.step=Number(edit.dataset.choiceEdit)||0;renderChoice();window.scrollTo({top:0,behavior:'smooth'});}
  });

  $('#choiceBackBtn').addEventListener('click',()=>{
    if(choiceState.step==='result'){choiceState.step=4;renderChoice();return}
    if(choiceState.step>0){choiceState.step--;renderChoice();return}
    go('home',{behavior:'auto'});
  });

  $('#quickChoiceBtn').addEventListener('click',event=>{
    event.preventDefault();
    event.stopImmediatePropagation();
    startChoice();
  },true);
})();
