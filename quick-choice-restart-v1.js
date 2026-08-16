(() => {
  function ensureRestartButton(){
    const actions=document.querySelector('#quickChoice .choice-result-actions');
    if(!actions||actions.querySelector('#choiceRestart'))return;
    const button=document.createElement('button');
    button.id='choiceRestart';
    button.className='btn secondary full';
    button.type='button';
    button.textContent='↻ Новый выбор';
    button.style.marginTop='4px';
    actions.appendChild(button);
  }

  document.addEventListener('click',event=>{
    if(!event.target.closest('#choiceRestart'))return;
    event.preventDefault();
    event.stopPropagation();
    const start=document.querySelector('#quickChoiceBtn');
    if(start)start.click();
  },true);

  const observer=new MutationObserver(ensureRestartButton);
  observer.observe(document.body,{childList:true,subtree:true});
  ensureRestartButton();
})();
