  function updateQuickUi(){
    const labelMap={'\u0434':'labelIncome','\u0440':'labelExpense','\u0440 \u0441\u0435\u0439\u0444':'labelSafe','\u0441':'labelS'};
    Object.keys(labelMap).forEach(function(v){const el=document.getElementById(labelMap[v]);el.classList.toggle('active',state.label===v);el.setAttribute('aria-pressed',state.label===v?'true':'false');});
    const labelIsCustom=!!state.label&&QUICK_LABELS.indexOf(state.label)===-1;
    document.getElementById('labelMore').classList.toggle('active',labelIsCustom);
    setCustomValue('labelCustomValue',labelIsCustom?state.label:'');

    const expenseMap={'QR-\u043a\u043e\u0434':'expenseQr','\u041b\u0438\u0447\u043d\u043e\u0435':'expensePersonal','\u0422\u0430\u043a\u0441\u0438':'expenseTaxi','\u0422\u041a':'expenseTk'};
    Object.keys(expenseMap).forEach(function(v){const el=document.getElementById(expenseMap[v]);el.classList.toggle('active',state.expenseType===v);el.setAttribute('aria-pressed',state.expenseType===v?'true':'false');});
    const expenseIsCustom=!!state.expenseType&&QUICK_EXPENSES.indexOf(state.expenseType)===-1;
    document.getElementById('expenseMore').classList.toggle('active',expenseIsCustom);
    setCustomValue('expenseCustomValue',expenseIsCustom?state.expenseType:'');
  }

  function setCustomValue(id,value){
    const el=document.getElementById(id);
    if(!value){el.classList.add('hidden');el.textContent='';return;}
    el.textContent='\u0412\u044b\u0431\u0440\u0430\u043d\u043e: '+value; el.classList.remove('hidden');
  }

  function openPicker(kind){
    state.pickerKind=kind;
    const isLabel=kind==='label';
    document.getElementById('pickerTitle').textContent=isLabel?'\u041c\u0435\u0442\u043a\u0430':'\u0422\u0438\u043f \u0440\u0430\u0441\u0445\u043e\u0434\u0430';
    const values=uniqueValues(isLabel?state.options.labels:state.options.expenseTypes);
    const selected=isLabel?state.label:state.expenseType;
    const list=document.getElementById('pickerList'); list.innerHTML='';
    values.forEach(function(value){
      const btn=document.createElement('button');btn.type='button';btn.className='picker-option'+(value===selected?' selected':'');btn.textContent=value;
      btn.onclick=function(){if(isLabel)setLabel(value);else setExpenseType(value);closePicker();};list.appendChild(btn);
    });
    document.getElementById('pickerOverlay').classList.remove('hidden');
    document.body.style.overflow='hidden';
  }
  function closePicker(){document.getElementById('pickerOverlay').classList.add('hidden');document.body.style.overflow='';state.pickerKind='';}
  function pickerBackdrop(event){if(event.target===document.getElementById('pickerOverlay'))closePicker();}
  function uniqueValues(values){const seen=Object.create(null),out=[];(values||[]).forEach(function(v){const s=String(v||'').trim();if(!s||seen[s])return;seen[s]=true;out.push(s);});return out;}

  function renderMethods(methods){
    const wrap=document.getElementById('methodButtons');wrap.innerHTML='';methods=methods&&methods.length?methods:STATIC_OPTIONS.methods;
    if(state.method&&methods.indexOf(state.method)===-1)state.method='';
    methods.forEach(function(method){const btn=document.createElement('button');btn.type='button';btn.className='method-btn'+(method===state.method?' active':'');btn.textContent=method;btn.setAttribute('aria-pressed',method===state.method?'true':'false');btn.onclick=function(){state.method=(state.method===method?'':method);renderMethods(methods);clearStatus();};wrap.appendChild(btn);});
    wrap.style.gridTemplateColumns='repeat('+Math.min(methods.length,3)+',1fr)';
  }

  function savePayment(){
    const payload={company:state.company,dateIso:state.selectedDateIso,label:state.label,description:document.getElementById('descriptionInput').value,amount:document.getElementById('amountInput').value,method:state.method,expenseType:state.expenseType,comment:document.getElementById('commentInput').value};
    if(!payload.label)return showError('\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043c\u0435\u0442\u043a\u0443.');
    if(!String(payload.amount||'').trim())return showError('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0441\u0443\u043c\u043c\u0443.');
    const item={id:createRequestId(),payload:payload,attempts:0,enqueuedAt:Date.now()};
    state.saveQueue.push(item);
    resetPaymentFields();
    showQueuePending();
    processSaveQueue();
  }

  function processSaveQueue(){
    if(state.saveInFlight||state.queuePaused||!state.saveQueue.length)return;
    const item=state.saveQueue[0];
    state.saveInFlight=true;
    item.attempts=(item.attempts||0)+1;
    apiCall('savePayment',{payload:Object.assign({},item.payload,{requestId:item.id})})
      .then(function(result){
        state.saveInFlight=false;
        state.saveQueue.shift();
        handleSaveSuccess(item,result||{});
        if(state.saveQueue.length){showQueuePending();setTimeout(processSaveQueue,0);}
      })
      .catch(function(error){
        state.saveInFlight=false;
        if(item.attempts<2){showQueuePending('\u041f\u043e\u0432\u0442\u043e\u0440\u044f\u044e \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0443\u2026');setTimeout(processSaveQueue,900);return;}
        state.saveQueue.shift();state.queuePaused=true;state.lastFailedSave={item:item,error:error};showQueuedSaveError(item,error);
      });
  }

  function handleSaveSuccess(item,result){
    const payload=item.payload;
    const saved=result.saved||{row:result.row||'',day:isoToLocalDate(payload.dateIso).getDate(),label:payload.label,description:payload.description,method:payload.method,amount:payload.amount,expenseType:payload.expenseType,comment:payload.comment};
    state.lastSuccessfulSave={item:item,result:result};
    const mk=monthKey(payload.dateIso);
    if(!state.monthCache[mk])state.monthCache[mk]={companies:{}};
    if(!state.monthCache[mk].companies)state.monthCache[mk].companies={};
    const ck=companyKey(payload.company);
    const existing=state.monthCache[mk].companies[ck]||{ok:true,company:payload.company,sheetName:result.sheetName||predictedSheetName(payload.company,payload.dateIso),labels:STATIC_OPTIONS.labels.slice(),methods:STATIC_OPTIONS.methods.slice(),expenseTypes:STATIC_OPTIONS.expenseTypes.slice(),recent:[]};
    existing.ok=true;existing.company=payload.company;existing.sheetName=result.sheetName||existing.sheetName||predictedSheetName(payload.company,payload.dateIso);
    existing.labels=existing.labels&&existing.labels.length?existing.labels:STATIC_OPTIONS.labels.slice();
    existing.methods=existing.methods&&existing.methods.length?existing.methods:STATIC_OPTIONS.methods.slice();
    existing.expenseTypes=existing.expenseTypes&&existing.expenseTypes.length?existing.expenseTypes:STATIC_OPTIONS.expenseTypes.slice();
    existing.recent=prependRecentEntry(existing.recent||[],saved);
    state.monthCache[mk].companies[ck]=existing;persistCache();
    if(payload.company===state.company&&mk===monthKey(state.selectedDateIso)){document.getElementById('sheetBadge').textContent=existing.sheetName;renderRecent(existing.recent||[]);}
    const details=[saved.day,saved.label,saved.method,saved.amount?saved.amount+' \u20bd':'',saved.expenseType].filter(Boolean).join(' \u2022 ');
    showSuccess('\u0417\u0430\u043f\u0438\u0441\u0430\u043d\u043e: '+payload.company+' \u2022 '+existing.sheetName+', \u0441\u0442\u0440\u043e\u043a\u0430 '+(result.row||saved.row||'\u2014'),details);
  }

  function prependRecentEntry(entries,entry){
    const row=Number(entry&&entry.row)||0,result=[];
    if(entry)result.push(entry);
    (entries||[]).forEach(function(existing){if(result.length>=5)return;if(row&&Number(existing&&existing.row)===row)return;result.push(existing);});
    return result.slice(0,5);
  }

  function resetPaymentFields(){
    state.label='';state.method='';state.expenseType='';updateQuickUi();renderMethods(state.options.methods);
    document.getElementById('descriptionInput').value='';document.getElementById('amountInput').value='';document.getElementById('commentInput').value='';
  }

  function createRequestId(){
    const time=Date.now().toString(36);let random='';
    try{const bytes=new Uint32Array(2);crypto.getRandomValues(bytes);random=bytes[0].toString(36)+bytes[1].toString(36);}catch(e){random=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);}
    return 'p_'+time+'_'+random.slice(0,28);
  }

  function showQueuePending(prefix){
    const waiting=Math.max(0,state.saveQueue.length-1);
    const title=prefix||'\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u044e \u0432 \u0444\u043e\u043d\u0435\u2026';
    let detail='\u041c\u043e\u0436\u043d\u043e \u0441\u0440\u0430\u0437\u0443 \u0432\u0432\u043e\u0434\u0438\u0442\u044c \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0443\u044e \u043e\u043f\u043b\u0430\u0442\u0443.';if(waiting>0)detail+=' \u0412 \u043e\u0447\u0435\u0440\u0435\u0434\u0438: '+waiting+'.';
    const s=document.getElementById('status');s.className='status show pending';s.innerHTML='<strong>'+escapeHtml(title)+'</strong>'+escapeHtml(detail);
  }

  function showQueuedSaveError(item,error){
    const p=item.payload||{},message=error&&error.message?error.message:String(error||'\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430.');
    const summary=[p.company,p.label,p.amount?p.amount+' \u20bd':''].filter(Boolean).join(' \u2022 '),s=document.getElementById('status');
    s.className='status show error';s.innerHTML='<strong>\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0438\u0441\u0430\u0442\u044c: '+escapeHtml(summary)+'</strong>'+escapeHtml(message)+'<div class="status-actions"><button type="button" onclick="retryFailedSave()">\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c</button><button type="button" onclick="restoreFailedSave()">\u0412\u0435\u0440\u043d\u0443\u0442\u044c \u0432 \u0444\u043e\u0440\u043c\u0443</button></div>';
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function retryFailedSave(){if(!state.lastFailedSave)return;const item=state.lastFailedSave.item;item.attempts=0;state.lastFailedSave=null;state.queuePaused=false;state.saveQueue.unshift(item);showQueuePending();processSaveQueue();}

  function restoreFailedSave(){
    if(!state.lastFailedSave)return;const p=state.lastFailedSave.item.payload||{};
    state.company=p.company||state.company;state.selectedDateIso=p.dateIso||state.selectedDateIso;state.label=p.label||'';state.method=p.method||'';state.expenseType=p.expenseType||'';
    document.getElementById('descriptionInput').value=p.description||'';document.getElementById('amountInput').value=p.amount||'';document.getElementById('commentInput').value=p.comment||'';
    state.lastFailedSave=null;state.queuePaused=false;localStorage.setItem(STORAGE_COMPANY_KEY,state.company);updateCompanyUi();updateDateSummary();updateQuickUi();renderMethods(state.options.methods);clearStatus();if(state.saveQueue.length)processSaveQueue();
  }

  function renderRecent(entries,emptyText){
    const wrap=document.getElementById('recentList');wrap.innerHTML='';
    if(!entries.length){wrap.innerHTML='<div class="recent-empty">'+escapeHtml(emptyText||'\u041d\u0430 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u043e\u043c \u043b\u0438\u0441\u0442\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0437\u0430\u043f\u0438\u0441\u0435\u0439.')+'</div>';return;}
    entries.forEach(function(entry){const item=document.createElement('div');item.className='recent-item';const main=document.createElement('div');main.className='recent-main';main.innerHTML='<span class="recent-day">'+escapeHtml(entry.day||'\u2014')+'</span><span class="recent-label">'+escapeHtml(entry.label||'')+'</span><span>'+escapeHtml(entry.method||'')+'</span><span class="recent-amount">'+escapeHtml(entry.amount?entry.amount+' \u20bd':'')+'</span>';const sub=document.createElement('div');sub.className='recent-sub';sub.textContent=[entry.description,entry.expenseType,entry.comment].filter(Boolean).join(' \u2022 ')||('\u0441\u0442\u0440\u043e\u043a\u0430 '+entry.row);item.appendChild(main);item.appendChild(sub);wrap.appendChild(item);});
  }

  function openSpreadsheet(){if(state.spreadsheetUrl)window.open(state.spreadsheetUrl,'_blank');else showError('\u0421\u0441\u044b\u043b\u043a\u0430 \u043d\u0430 \u0442\u0430\u0431\u043b\u0438\u0446\u0443 \u0435\u0449\u0451 \u0441\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0438\u0440\u0443\u0435\u0442\u0441\u044f.');}
  function setBackgroundLoading(value){document.getElementById('loadingLine').classList.toggle('active',value);}
  function showSuccess(title,details){const s=document.getElementById('status');s.className='status show success';s.innerHTML='<strong>\u2713 '+escapeHtml(title)+'</strong>'+escapeHtml(details||'');}
  function showError(message){const s=document.getElementById('status');s.className='status show error';s.innerHTML='<strong>\u041d\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e</strong>'+escapeHtml(message||'\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043e\u0448\u0438\u0431\u043a\u0430.');window.scrollTo({top:0,behavior:'smooth'});}
  function showServerError(error){showError(error&&error.message?error.message:String(error||'\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430.'));}
  function clearStatus(){if(state.saveInFlight||state.saveQueue.length){showQueuePending();return;}const s=document.getElementById('status');s.className='status';s.innerHTML='';}
  function addDaysIso(iso,days){const d=isoToLocalDate(iso);d.setDate(d.getDate()+days);return localDateToIso(d);}
  function isoToLocalDate(iso){const p=iso.split('-').map(Number);return new Date(p[0],p[1]-1,p[2],12,0,0);}
  function localDateToIso(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
  function escapeHtml(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}

  if('serviceWorker' in navigator){
    window.addEventListener('load',function(){
      navigator.serviceWorker.register('/ventkub-payments/sw.js').catch(function(error){console.log('SW',error);});
    });
  }
