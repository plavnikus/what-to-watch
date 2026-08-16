(() => {
  const moodCores={
    'Лёгкое и смешное':['комедия','семейный','приключения'],
    'Динамичное':['боевик','приключения','триллер','криминал'],
    'Напряжённое':['триллер','ужасы','детектив','криминал'],
    'Душевное':['мелодрама','драма','семейный','биография'],
    'Интересное и необычное':['фантастика','детектив','триллер','биография','фэнтези']
  };

  function currentMoodCore(){
    const labels=[...document.querySelectorAll('#quickChoice .choice-summary .badge')].map(el=>el.textContent.trim());
    const mood=labels.find(label=>moodCores[label]);
    return mood?moodCores[mood]:[];
  }

  function preferredGenres(movie,core){
    const source=Array.isArray(movie?.genres)?movie.genres:[];
    if(!source.length)return[];
    const normalized=source.map(label=>({label,normalized:String(label).trim().toLowerCase()}));
    const matched=[];
    for(const coreGenre of core){
      const item=normalized.find(entry=>entry.normalized===coreGenre&&!matched.includes(entry));
      if(item)matched.push(item);
      if(matched.length===2)break;
    }
    for(const item of normalized){
      if(matched.length===2)break;
      if(!matched.includes(item))matched.push(item);
    }
    return matched.slice(0,2).map(item=>item.label);
  }

  function refreshAlternativeGenres(){
    const root=document.querySelector('#quickChoice');
    if(!root||typeof movies==='undefined')return;
    const core=currentMoodCore();
    root.querySelectorAll('.choice-alt[data-choice-open]').forEach(card=>{
      const movie=movies.find(item=>String(item.id)===String(card.dataset.choiceOpen));
      const line=card.querySelector('.genre-line');
      if(!movie||!line)return;
      const next=preferredGenres(movie,core).join(' · ');
      if(line.textContent!==next)line.textContent=next;
    });
  }

  const observer=new MutationObserver(refreshAlternativeGenres);
  observer.observe(document.body,{childList:true,subtree:true});
  refreshAlternativeGenres();
})();
