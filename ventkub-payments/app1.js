const STATIC_OPTIONS = {
    labels:['\u0434','\u0440','\u0434 \u0441\u0435\u0439\u0444','\u0440 \u0441\u0435\u0439\u0444','\u0441','\u0436','\u0431\u043d','\u043d\u0431','\u043d\u0441\u043d\u0436','\u043d\u0436\u043d\u0441','\u0440\u0435\u0437','\u043d\u0430\u043b\u043e\u0433','\u043d\u043e','\u0434 \u0441\u0435\u0439\u0444 \u043a\u043e\u0440','\u0440 \u0441\u0435\u0439\u0444 \u043a\u043e\u0440'],
    methods:['\u0431','\u043d\u0441','\u043d\u0436'],
    expenseTypes:['\u0418\u043d\u043e\u0435','QR-\u043a\u043e\u0434','\u041b\u0438\u0447\u043d\u043e\u0435','\u0422\u0430\u043a\u0441\u0438','\u0422\u041a','\u0410\u0432\u0438\u0442\u043e','\u0414\u0438\u0440\u0435\u043a\u0442','\u0421\u0441\u044b\u043b\u043a\u0438','\u0411\u0430\u043b\u0430\u043d\u0441\u044b','\u041f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0438','\u041f\u043e\u0447\u0442\u0430']
  };
  const QUICK_LABELS=['\u0434','\u0440','\u0440 \u0441\u0435\u0439\u0444','\u0441'];
  const QUICK_EXPENSES=['QR-\u043a\u043e\u0434','\u041b\u0438\u0447\u043d\u043e\u0435','\u0422\u0430\u043a\u0441\u0438','\u0422\u041a'];
  const STORAGE_CACHE_KEY='ventkub-payments-cache-v116';
  const STORAGE_COMPANY_KEY='ventkub-payments-company';

  const state={
    todayIso:'',selectedDateIso:'',dateMode:'today',company:'\u0412\u0435\u043d\u0442\u041a\u0443\u0431',method:'',label:'',expenseType:'',spreadsheetUrl:'',
    options:{labels:STATIC_OPTIONS.labels.slice(),methods:STATIC_OPTIONS.methods.slice(),expenseTypes:STATIC_OPTIONS.expenseTypes.slice()},
    monthCache:Object.create(null),pendingMonths:Object.create(null),syncedMonths:Object.create(null),pickerKind:'',
    saveQueue:[],saveInFlight:false,queuePaused:false,lastFailedSave:null,lastSuccessfulSave:null
  };

  document.addEventListener('DOMContentLoaded',initFast);

  function initFast(){
    state.todayIso=localDateToIso(new Date());
    state.selectedDateIso=state.todayIso;
    state.company=localStorage.getItem(STORAGE_COMPANY_KEY)||'\u0412\u0435\u043d\u0442\u041a\u0443\u0431';
    state.method='';
    restorePersistentCache();
    renderMethods(state.options.methods);
    updateQuickUi();
    updateCompanyUi();
    selectQuickDate('today',true,true);
    renderCachedCompany();
    setTimeout(function(){ hydrateMonth(state.selectedDateIso); },60);
  }

  function restorePersistentCache(){
    try{
      const raw=localStorage.getItem(STORAGE_CACHE_KEY);
      if(!raw)return;
      const cached=JSON.parse(raw);
      if(cached&&cached.monthCache&&typeof cached.monthCache==='object') state.monthCache=cached.monthCache;
      if(cached&&cached.spreadsheetUrl) state.spreadsheetUrl=cached.spreadsheetUrl;
    }catch(e){ console.log(e); }
  }

  function persistCache(){
    try{
      const keys=Object.keys(state.monthCache).sort();
      const keep=keys.slice(Math.max(0,keys.length-4));
      const trimmed={};
      keep.forEach(function(k){trimmed[k]=state.monthCache[k];});
      localStorage.setItem(STORAGE_CACHE_KEY,JSON.stringify({savedAt:Date.now(),spreadsheetUrl:state.spreadsheetUrl||'',monthCache:trimmed}));
    }catch(e){ console.log(e); }
  }

  function selectCompany(company){
    if(!company||state.company===company)return;
    state.company=company;
    localStorage.setItem(STORAGE_COMPANY_KEY,company);
    updateCompanyUi(); clearStatus(); renderCachedCompany(); hydrateMonth(state.selectedDateIso);
  }

  function updateCompanyUi(){
    const isVentKub=state.company==='\u0412\u0435\u043d\u0442\u041a\u0443\u0431';
    document.getElementById('companyVentKub').classList.toggle('active',isVentKub);
    document.getElementById('companySiberia').classList.toggle('active',!isVentKub);
    const saveButton=document.getElementById('saveButton');
    saveButton.classList.toggle('ventkub',isVentKub); saveButton.classList.toggle('siberia',!isVentKub);
    document.getElementById('saveCompany').textContent='\u0432 '+state.company;
    updatePredictedSheetBadge();
  }

  function selectQuickDate(mode,silent,skipHydrate){
    state.dateMode=mode;
    const otherInput=document.getElementById('otherDate');
    document.getElementById('dateToday').classList.toggle('active',mode==='today');
    document.getElementById('dateYesterday').classList.toggle('active',mode==='yesterday');
    document.getElementById('dateOther').classList.toggle('active',mode==='other');
    otherInput.classList.toggle('hidden',mode!=='other');
    if(mode==='today')state.selectedDateIso=state.todayIso;
    else if(mode==='yesterday')state.selectedDateIso=addDaysIso(state.todayIso,-1);
    else{
      if(!otherInput.value)otherInput.value=state.selectedDateIso||state.todayIso;
      state.selectedDateIso=otherInput.value;
      if(!silent)setTimeout(function(){try{otherInput.showPicker();}catch(e){otherInput.focus();}},0);
    }
    updateDateSummary(); updatePredictedSheetBadge(); renderCachedCompany();
    if(!skipHydrate)hydrateMonth(state.selectedDateIso);
  }

  function onOtherDateChanged(){
    const value=document.getElementById('otherDate').value;
    if(!value)return;
    state.selectedDateIso=value; updateDateSummary(); updatePredictedSheetBadge(); renderCachedCompany(); hydrateMonth(state.selectedDateIso);
  }

  function updateDateSummary(){
    const d=isoToLocalDate(state.selectedDateIso);
    document.getElementById('dateSummary').textContent=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(d);
  }

  function monthKey(dateIso){return String(dateIso||'').slice(0,7);}
  function companyKey(company){return company==='\u0421\u0438\u0431\u0438\u0440\u044c'?'siberia':'ventkub';}

  function predictedSheetName(company,dateIso){
    const d=isoToLocalDate(dateIso);
    const months=['\u042f\u043d\u0432\u0430\u0440\u044c','\u0424\u0435\u0432\u0440\u0430\u043b\u044c','\u041c\u0430\u0440\u0442','\u0410\u043f\u0440\u0435\u043b\u044c','\u041c\u0430\u0439','\u0418\u044e\u043d\u044c','\u0418\u044e\u043b\u044c','\u0410\u0432\u0433\u0443\u0441\u0442','\u0421\u0435\u043d\u0442\u044f\u0431\u0440\u044c','\u041e\u043a\u0442\u044f\u0431\u0440\u044c','\u041d\u043e\u044f\u0431\u0440\u044c','\u0414\u0435\u043a\u0430\u0431\u0440\u044c'];
    const base=months[d.getMonth()]+' '+d.getFullYear();
    return company==='\u0421\u0438\u0431\u0438\u0440\u044c'?'\u041d\u0414\u0421 '+base:base;
  }
  function updatePredictedSheetBadge(){document.getElementById('sheetBadge').textContent=predictedSheetName(state.company,state.selectedDateIso);}

  async function apiCall(action,payload){
    const response=await fetch('/api/ventkub-payments',{
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      cache:'no-store',
      body:JSON.stringify({action:action,payload:payload||{}})
    });
    let data=null;
    try{data=await response.json();}catch(e){throw new Error('Сервер вернул некорректный ответ.');}
    if(!response.ok||!data||data.ok===false){throw new Error((data&&data.error)||('Ошибка сервера: '+response.status));}
    return data.result;
  }

  function hydrateMonth(dateIso){
    if(!dateIso)return;
    const key=monthKey(dateIso);
    if(state.pendingMonths[key]||state.syncedMonths[key])return;
    state.pendingMonths[key]=true; setBackgroundLoading(true);
    apiCall('getMonthSnapshot',{dateIso:dateIso})
      .then(function(snapshot){
        delete state.pendingMonths[key]; state.syncedMonths[key]=true;
        if(snapshot){state.monthCache[key]=snapshot;if(snapshot.spreadsheetUrl)state.spreadsheetUrl=snapshot.spreadsheetUrl;persistCache();}
        if(key===monthKey(state.selectedDateIso))renderCachedCompany();
        setBackgroundLoading(Object.keys(state.pendingMonths).length>0);
      })
      .catch(function(error){delete state.pendingMonths[key];setBackgroundLoading(Object.keys(state.pendingMonths).length>0);console.log(error);});
  }

  function renderCachedCompany(){
    const snapshot=state.monthCache[monthKey(state.selectedDateIso)];
    const data=snapshot&&snapshot.companies?snapshot.companies[companyKey(state.company)]:null;
    if(snapshot&&snapshot.spreadsheetUrl)state.spreadsheetUrl=snapshot.spreadsheetUrl;
    if(!data){
      state.options={labels:STATIC_OPTIONS.labels.slice(),methods:STATIC_OPTIONS.methods.slice(),expenseTypes:STATIC_OPTIONS.expenseTypes.slice()};
      renderMethods(state.options.methods); updateQuickUi();
      renderRecent([],'\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 \u0437\u0430\u043f\u0438\u0441\u0438 \u043e\u0431\u043d\u043e\u0432\u043b\u044f\u044e\u0442\u0441\u044f \u0432 \u0444\u043e\u043d\u0435\u2026');
      return;
    }
    state.options={
      labels:data.labels&&data.labels.length?data.labels.slice():STATIC_OPTIONS.labels.slice(),
      methods:data.methods&&data.methods.length?data.methods.slice():STATIC_OPTIONS.methods.slice(),
      expenseTypes:data.expenseTypes&&data.expenseTypes.length?data.expenseTypes.slice():STATIC_OPTIONS.expenseTypes.slice()
    };
    renderMethods(state.options.methods); updateQuickUi();
    if(data.sheetName)document.getElementById('sheetBadge').textContent=data.sheetName;
    renderRecent(data.recent||[],data.ok===false?'\u041b\u0438\u0441\u0442 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d.':'');
  }

  function setLabel(value){state.label=value||'';updateQuickUi();clearStatus();}
  function setExpenseType(value){value=value||'';state.expenseType=(state.expenseType===value?'':value);updateQuickUi();clearStatus();}
