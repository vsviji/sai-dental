/* ═══════════════════════════════════════════
   SAI DENTAL CLINIC — PRESCRIPTION SYSTEM
   app.js
═══════════════════════════════════════════ */

/* ─── WAIT FOR FIREBASE MODULE ─── */
function waitFB(cb){ window._fb ? cb() : setTimeout(()=>waitFB(cb),80); }

/* ═══ AUTH ═══ */
function doLogin(){
  const email = document.getElementById('loginEmail').value.trim();
  const pwd   = document.getElementById('loginPwd').value;
  const err   = document.getElementById('loginErr');
  const btn   = document.getElementById('loginBtn');
  err.textContent = '';
  if(!email||!pwd){ err.textContent='Please enter email and password.'; return; }
  btn.disabled=true; btn.textContent='Signing in…';
  window._fb.signInWithEmailAndPassword(window._auth, email, pwd)
    .catch(e=>{
      err.textContent =
        e.code==='auth/wrong-password'        ? 'Incorrect password.'         :
        e.code==='auth/user-not-found'        ? 'No account with that email.' :
        e.code==='auth/invalid-email'         ? 'Invalid email address.'      :
        e.code==='auth/invalid-credential'    ? 'Invalid email or password.'  :
        e.code==='auth/network-request-failed'? 'Network error — check connection.' :
        'Login failed: '+e.message;
      btn.disabled=false; btn.textContent='Sign In';
    });
}

function doLogout(){
  if(!confirm('Sign out?')) return;
  window._fb.signOut(window._auth);
}

/* ═══ FIRESTORE HELPERS ═══ */
const RX_COL   = () => window._fb.collection(window._db,'prescriptions');
const SETT_COL = () => window._fb.collection(window._db,'settings');

async function getAllRx(){
  const snap = await window._fb.getDocs(
    window._fb.query(RX_COL(), window._fb.orderBy('dateISO','desc'))
  );
  return snap.docs.map(d=>({...d.data(), id:d.id}));
}
async function putRx(rx){
  const ref = window._fb.doc(RX_COL(), rx.id);
  await window._fb.setDoc(ref, rx);
}
async function deleteRxById(id){
  await window._fb.deleteDoc(window._fb.doc(RX_COL(), id));
}
async function getSetting(key){
  try{
    const snap = await window._fb.getDocs(SETT_COL());
    const found = snap.docs.find(d=>d.id===key);
    return found ? found.data().value : null;
  }catch{ return null; }
}
async function setSetting(key,value){
  await window._fb.setDoc(window._fb.doc(SETT_COL(),key),{value});
}
async function nextRxNo(){
  const n = ((await getSetting('rxCounter'))||0)+1;
  await setSetting('rxCounter',n);
  return 'RX-'+String(n).padStart(4,'0');
}

/* ═══ MEDICINE DATA ═══ */
const MEDS=[
  {name:"Amoxicillin 500mg",dosage:"500mg",rate:9},
  {name:"Amoxicillin + Clavulanic Acid 375mg",dosage:"375mg",rate:22},
  {name:"Amoxicillin + Clavulanic Acid 625mg",dosage:"625mg",rate:22},
  {name:"Azithromycin 250mg",dosage:"250mg",rate:14},
  {name:"Azithromycin 500mg",dosage:"500mg",rate:20},
  {name:"Metronidazole 400mg",dosage:"400mg",rate:4},
  {name:"Metronidazole ER 600mg",dosage:"600mg",rate:8},
  {name:"Doxycycline 100mg",dosage:"100mg",rate:13},
  {name:"Paracetamol 500mg",dosage:"500mg",rate:3},
  {name:"Paracetamol 650mg",dosage:"650mg",rate:3},
  {name:"Diclofenac 50mg",dosage:"50mg",rate:4},
  {name:"Aceclofenac sp",dosage:"100mg",rate:14},
  {name:"Aceclofenac mr",dosage:"100mg",rate:14},
  {name:"Ketorolac dt 10mg",dosage:"10mg",rate:10},
  {name:"Tramadol 50mg",dosage:"50mg",rate:16},
  {name:"Pantoprazole 40mg",dosage:"40mg",rate:8},
  {name:"Omeprazole 20mg",dosage:"20mg",rate:7},
  {name:"Rabeprazole 20mg",dosage:"20mg",rate:11},
  {name:"Prednisolone 5mg",dosage:"5mg",rate:5},
  {name:"Dexamethasone 0.5mg",dosage:"0.5mg",rate:4},
  {name:"Serratiopeptidase 10mg",dosage:"10mg",rate:12},
  {name:"Serratiopeptidase 5mg",dosage:"5mg",rate:8},
  {name:"Diclofenac + Serratiopeptidase",dosage:"—",rate:14},
  {name:"Chlorhexidine Mouthwash 200ml",dosage:"200ml",rate:120},
  {name:"Betadine Gargle 100ml",dosage:"100ml",rate:180},
  {name:"Triamcinolone Paste (Turbocort)",dosage:"0.1%",rate:130},
  {name:"Nurobeon forte",dosage:"—",rate:4},
  {name:"Cefixime 200mg",dosage:"200mg",rate:11},
  {name:"Ofloxacin + Ornidazole 200mg",dosage:"—",rate:13},
  {name:"Chymoral forte",dosage:"—",rate:22},
  {name:"Oint. Metrogyl D.G LA",dosage:"—",rate:72},
  {name:"Oint. Metrogyl D.G forte",dosage:"—",rate:83},
  {name:"Inj. Taxim + syringe",dosage:"—",rate:55},
  {name:"Inj. Diclofenac 1ml + syringe",dosage:"—",rate:45},
  {name:"Inj. Diclofenac 4ml",dosage:"—",rate:30},
  {name:"Inj. Dexa 2ml",dosage:"—",rate:22},
  {name:"Toothpaste Sensodyne Proenamel",dosage:"—",rate:95},
  {name:"Toothpaste Omnident",dosage:"—",rate:167},
  {name:"Toothpaste Paradontax",dosage:"—",rate:120},
  {name:"Mouthwash Paradontax",dosage:"—",rate:120},
  {name:"Toothbrush Paradontax",dosage:"—",rate:120},
  {name:"Toothbrush Sensodyne",dosage:"—",rate:75},
];

const FREQS=["Once daily","Twice daily","Thrice daily","Four times daily","Every 6 hours","Every 8 hours","Every 12 hours","As needed (SOS)","Bedtime only","Before meals","After meals","With meals"];
const DURS=["1 day","2 days","3 days","4 days","5 days","7 days","10 days","14 days","21 days","Until finished"];
const INSTS=["After food","Before food","With warm water","With milk","At bedtime","Rinse & spit","Apply on affected area","Gargle & spit","Avoid alcohol","Avoid spicy food","Chew before swallowing","Swallow whole"];

/* ═══ UI STATE ═══ */
let rows=[], rid=0, _histCache=[], histPage=1;
const HIST_PER=15;

function qs(id){return document.getElementById(id)}
function fmt(n){return '₹'+parseFloat(n).toFixed(2)}
function medOpts(sel){
  return '<option value="">— Select medicine —</option>'+
    MEDS.map(m=>`<option ${m.name===sel?'selected':''}>${m.name}</option>`).join('');
}
function listOpts(arr,sel){
  return '<option value="">—</option>'+
    arr.map(v=>`<option ${v===sel?'selected':''}>${v}</option>`).join('');
}
function showToast(msg,type='ok'){
  const t=qs('toast');
  t.textContent=msg;
  t.className='toast show'+(type==='err'?' err':type==='warn'?' warn':'');
  clearTimeout(t._t);
  t._t=setTimeout(()=>t.className='toast',3200);
}

/* ─── TABLE ROWS ─── */
function addRow(d){
  const m=MEDS.find(x=>x.name===d.name)||{dosage:'',rate:0};
  rid++;
  rows.push({id:rid,name:d.name||'',dosage:d.dosage||m.dosage||'',
    freq:d.freq||'',dur:d.dur||'',
    qty:d.qty!=null?+d.qty:1,
    rate:d.rate!=null?+d.rate:(m.rate||0),
    inst:d.inst||''});
  renderRows();
}
function renderRows(){
  qs('rxBody').innerHTML=rows.map((r,i)=>`
    <tr>
      <td style="text-align:center;color:var(--muted);font-size:12px;padding-left:8px">${i+1}</td>
      <td><select style="width:100%" onchange="onMed(${r.id},this.value)">${medOpts(r.name)}</select></td>
      <td><input type="text" value="${r.dosage}" style="width:100%" oninput="rc(${r.id},'dosage',this.value)"/></td>
      <td><select style="width:100%" onchange="rc(${r.id},'freq',this.value)">${listOpts(FREQS,r.freq)}</select></td>
      <td><select style="width:100%" onchange="rc(${r.id},'dur',this.value)">${listOpts(DURS,r.dur)}</select></td>
      <td><input type="number" value="${r.qty}" min="1" max="999" style="width:58px" oninput="rc(${r.id},'qty',+this.value);renderRows()"/></td>
      <td><input type="number" value="${r.rate}" min="0" step="0.5" style="width:70px" oninput="rc(${r.id},'rate',+this.value);renderRows()"/></td>
      <td class="amt-cell">${fmt(r.qty*r.rate)}</td>
      <td><select style="width:100%" onchange="rc(${r.id},'inst',this.value)">${listOpts(INSTS,r.inst)}</select></td>
      <td><button class="btn-del" onclick="delRow(${r.id})" title="Remove">✕</button></td>
    </tr>`).join('');
  qs('medCount').textContent=rows.length+' item(s)';
  calcBill();
}
function onMed(id,val){
  const r=rows.find(x=>x.id===id);if(!r)return;
  const m=MEDS.find(x=>x.name===val)||{dosage:'',rate:0};
  r.name=val;r.dosage=m.dosage;r.rate=m.rate;renderRows();
}
function rc(id,f,v){const r=rows.find(x=>x.id===id);if(r)r[f]=v;}
function delRow(id){
  rows=rows.filter(x=>x.id!==id);
  rows.forEach((r,i)=>r.id=i+1);
  rid=rows.length;renderRows();
}
function calcBill(){
  const sub=rows.reduce((a,r)=>a+(r.qty*r.rate),0);
  qs('bSub').textContent=fmt(sub);
  qs('bGrand').textContent='₹'+Math.round(sub);
  qs('subTotal').textContent=rows.length?'Subtotal: '+fmt(sub):'';
}

/* ─── TEMPLATES ─── */
function loadTemplate(type){
  rows=[];rid=0;
  if(type==='rct'||type==='rootcanal'){
    addRow({name:'Amoxicillin + Clavulanic Acid 625mg',freq:'Twice daily',dur:'5 days',qty:10,inst:'After food'});
    addRow({name:'Aceclofenac sp',freq:'Twice daily',dur:'3 days',qty:6,inst:'After food'});
    addRow({name:'Pantoprazole 40mg',freq:'Once daily',dur:'5 days',qty:5,inst:'Before food'});
    qs('notes').value='RCT done. Avoid chewing on treated side until numbness wears off. Maintain oral hygiene properly.';
  } else if(type==='extraction'){
    addRow({name:'Amoxicillin 500mg',freq:'Thrice daily',dur:'5 days',qty:15,inst:'After food'});
    addRow({name:'Aceclofenac sp',freq:'Twice daily',dur:'3 days',qty:6,inst:'After food'});
    addRow({name:'Chlorhexidine Mouthwash 200ml',freq:'Twice daily',dur:'7 days',qty:1,inst:'Gargle & spit'});
    qs('notes').value='Extraction done. Do not spit for 24 hours. Avoid hot foods, smoking. Bite on gauze for 30 minutes.';
  } else if(type==='scaling'){
    addRow({name:'Chlorhexidine Mouthwash 200ml',freq:'Twice daily',dur:'7 days',qty:1,inst:'Gargle & spit'});
    addRow({name:'Toothpaste Paradontax',freq:'Twice daily',dur:'30 days',qty:1,inst:'Brush gently'});
    qs('notes').value='Scaling done. Maintain oral hygiene. Avoid smoking and tobacco products.';
  } else if(type==='composite'){
    addRow({name:'Paracetamol 650mg',freq:'As needed (SOS)',dur:'2 days',qty:6,inst:'After food'});
    addRow({name:'Chlorhexidine Mouthwash 200ml',freq:'Twice daily',dur:'5 days',qty:1,inst:'Gargle & spit'});
    qs('notes').value='Composite filling done. Avoid very hard and sticky foods for 24 hours.';
  } else if(type==='crown'){
    addRow({name:'Amoxicillin 500mg',freq:'Twice daily',dur:'3 days',qty:6,inst:'After food'});
    addRow({name:'Paracetamol 650mg',freq:'As needed (SOS)',dur:'3 days',qty:6,inst:'After food'});
    qs('notes').value='Crown/bridge preparation done. Avoid very hard chewing until final cementation.';
  }
  renderRows();calcBill();
  showToast(type.toUpperCase()+' template loaded');
}

/* ─── PATIENT SEARCH ─── */
function togglePatSearch(){
  const w=qs('patSearchWrap');
  w.style.display=w.style.display==='none'?'block':'none';
  if(w.style.display==='block')qs('patSearchInput').focus();
}
function searchPatients(q){
  const dd=qs('patDropdown');
  if(!q||q.length<2){dd.className='pat-dropdown';return;}
  const lo=q.toLowerCase(),seen=new Set();
  const unique=_histCache.filter(r=>{
    const ok=((r.patientName||'').toLowerCase().includes(lo)||(r.patientContact||'').includes(q));
    const k=(r.patientName||'')+'|'+(r.patientContact||'');
    if(!ok||seen.has(k))return false;seen.add(k);return true;
  }).slice(0,8);
  if(!unique.length){dd.className='pat-dropdown';return;}
  dd.innerHTML=unique.map(r=>`
    <div class="pat-opt" onclick="fillPatient('${r.id}')">
      <div class="pat-opt-name">${r.patientName||'—'} <span style="color:var(--teal);font-size:11px">${r.rxno||''}</span></div>
      <div class="pat-opt-sub">${r.patientContact||''} · ${r.patientDx||''} · ${r.date||''}</div>
    </div>`).join('');
  dd.className='pat-dropdown open';
}
function fillPatient(id){
  const rx=_histCache.find(r=>r.id===id);if(!rx)return;
  qs('pName').value    =rx.patientName   ||'';
  qs('pAge').value     =rx.patientAge    ||'';
  qs('pGender').value  =rx.patientGender ||'';
  qs('pContact').value =rx.patientContact||'';
  qs('pBP').value      =rx.patientBP     ||'';
  qs('pDx').value      =rx.patientDx     ||'';
  qs('pAllergy').value =rx.patientAllergy||'';
  qs('pRef').value     =rx.patientRef    ||'';
  qs('patDropdown').className='pat-dropdown';
  qs('patSearchWrap').style.display='none';
  showToast('Patient loaded: '+rx.patientName);
}

/* ─── SAVE ─── */
async function saveRx(){
  const name=qs('pName').value.trim();
  if(!name){showToast('Enter patient name before saving','err');return;}
  if(!rows.length){showToast('Add at least one medicine','err');return;}
  const btn=qs('btnSave');
  btn.disabled=true;btn.classList.add('saving');
  try{
    const grand=rows.reduce((a,r)=>a+(r.qty*r.rate),0);
    const rxno=await nextRxNo();
    const id='rx_'+Date.now();
    const rx={
      id,rxno,
      date:new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}),
      dateISO:new Date().toISOString(),
      patientName:   qs('pName').value,
      patientAge:    qs('pAge').value,
      patientGender: qs('pGender').value,
      patientContact:qs('pContact').value,
      patientBP:     qs('pBP').value,
      patientDx:     qs('pDx').value,
      patientAllergy:qs('pAllergy').value,
      patientRef:    qs('pRef').value,
      medicines:     rows.map(r=>({...r})),
      notes:         qs('notes').value,
      followup:      qs('followup').value,
      grand:         Math.round(grand)
    };
    await putRx(rx);
    _histCache.unshift(rx);
    updateStats();
    const counter=await getSetting('rxCounter')||0;
    qs('rxNo').textContent='RX-'+String(counter+1).padStart(4,'0');
    showToast('✓ '+rxno+' saved'+(navigator.onLine?' to Firebase':' offline — will sync when online'));
  }catch(e){
    showToast('Save failed: '+e.message,'err');
  }
  btn.disabled=false;btn.classList.remove('saving');
}

/* ─── HISTORY ─── */
async function loadHist(){
  try{_histCache=await getAllRx();}catch(e){_histCache=[];}
  filterHist();updateStats();
}
function filterHist(){
  const q=(qs('histSearch')?.value||'').toLowerCase();
  const dx=qs('histFilterDx')?.value||'';
  const sort=qs('histSort')?.value||'newest';
  let list=_histCache.filter(r=>{
    const mq=!q||[(r.patientName||''),(r.rxno||''),(r.patientDx||''),(r.patientContact||'')].some(s=>s.toLowerCase().includes(q));
    return mq&&(!dx||r.patientDx===dx);
  });
  if(sort==='newest')list.sort((a,b)=>(b.dateISO||'').localeCompare(a.dateISO||''));
  else if(sort==='oldest')list.sort((a,b)=>(a.dateISO||'').localeCompare(b.dateISO||''));
  else if(sort==='name')list.sort((a,b)=>(a.patientName||'').localeCompare(b.patientName||''));
  else if(sort==='amount')list.sort((a,b)=>b.grand-a.grand);
  histPage=1;renderHistPage(list);
}
function renderHistPage(list){
  const el=qs('histList'),pg=qs('pagination');
  const total=list.length,pages=Math.ceil(total/HIST_PER)||1;
  histPage=Math.min(histPage,pages);
  const slice=list.slice((histPage-1)*HIST_PER,histPage*HIST_PER);
  qs('histSubtitle').textContent=total+' prescription(s)';
  if(!total){
    el.innerHTML='<div class="empty-state"><p>No prescriptions found.<br>Create and save your first prescription.</p></div>';
    pg.innerHTML='';return;
  }
  el.innerHTML=slice.map(r=>`
    <div class="hist-item" onclick="loadRx('${r.id}')">
      <button class="btn-del-hist" onclick="event.stopPropagation();deleteRx('${r.id}')">✕</button>
      <span class="hi-amt">₹${r.grand}</span>
      <div class="hi-name">${r.patientName||'—'}
        <span class="hi-badge">${r.rxno||''}</span>
        <span style="font-weight:400;color:var(--muted);font-size:12px">${r.patientAge?'· '+r.patientAge+' yrs':''} ${r.patientGender||''}</span>
      </div>
      <div class="hi-sub">${r.date||''} &nbsp;·&nbsp; ${r.patientDx||'No diagnosis'} ${r.patientContact?'· '+r.patientContact:''}</div>
      <div class="hi-meds">${(r.medicines||[]).map(m=>m.name).filter(Boolean).slice(0,5).join(', ')}${(r.medicines||[]).length>5?'…':''}</div>
    </div>`).join('');
  if(pages<=1){pg.innerHTML='';return;}
  let h=`<button class="pg-btn" onclick="goPg(${histPage-1})" ${histPage===1?'disabled':''}>‹ Prev</button>`;
  for(let i=1;i<=pages;i++){
    if(pages<=7||Math.abs(i-histPage)<=2||i===1||i===pages)
      h+=`<button class="pg-btn ${i===histPage?'active':''}" onclick="goPg(${i})">${i}</button>`;
    else if(Math.abs(i-histPage)===3) h+=`<span class="pg-info">…</span>`;
  }
  h+=`<button class="pg-btn" onclick="goPg(${histPage+1})" ${histPage===pages?'disabled':''}>Next ›</button>`;
  h+=`<span class="pg-info">${(histPage-1)*HIST_PER+1}–${Math.min(histPage*HIST_PER,total)} of ${total}</span>`;
  pg.innerHTML=h;
}
function goPg(p){histPage=p;filterHist();window.scrollTo(0,0);}

function loadRx(id){
  const rx=_histCache.find(r=>r.id===id);if(!rx)return;
  qs('pName').value   =rx.patientName   ||'';
  qs('pAge').value    =rx.patientAge    ||'';
  qs('pGender').value =rx.patientGender ||'';
  qs('pContact').value=rx.patientContact||'';
  qs('pBP').value     =rx.patientBP     ||'';
  qs('pDx').value     =rx.patientDx     ||'';
  qs('pAllergy').value=rx.patientAllergy||'';
  qs('pRef').value    =rx.patientRef    ||'';
  qs('notes').value   =rx.notes         ||'';
  qs('followup').value=rx.followup      ||'';
  rows=[];rid=0;(rx.medicines||[]).forEach(m=>addRow(m));
  sw('rx',document.querySelectorAll('.tab')[0]);
  showToast('Loaded: '+rx.rxno);
}

async function deleteRx(id){
  if(!confirm('Delete this prescription permanently?'))return;
  try{
    await deleteRxById(id);
    _histCache=_histCache.filter(r=>r.id!==id);
    updateStats();filterHist();
    showToast('Prescription deleted');
  }catch(e){showToast('Delete failed: '+e.message,'err');}
}

function updateStats(){
  const c=_histCache.length;
  const p=new Set(_histCache.map(r=>r.patientName)).size;
  const l=c?_histCache[0].date:'—';
  qs('statCount').textContent=c;
  qs('statPats').textContent=p;
  qs('statLast').textContent=l;
  qs('hcnt').textContent=c;
  qs('syncStats').style.display='flex';
}

/* ─── NETWORK ─── */
function updateNet(){
  const on=navigator.onLine;
  qs('syncDot').className='sync-dot '+(on?'online':'offline');
  qs('syncMsg').textContent=on?'☁ Firebase connected — real-time sync active':'⚡ Offline — changes queued, auto-sync on reconnect';
  qs('offlineBanner').classList.toggle('show',!on);
}
window.addEventListener('online',updateNet);
window.addEventListener('offline',updateNet);

/* ─── EXPORT ─── */
async function exportAll(){
  try{
    const all=await getAllRx();
    const blob=new Blob([JSON.stringify({meta:{exportedAt:new Date().toISOString(),clinic:'Sai Dental Clinic',count:all.length},prescriptions:all},null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='SaiDental_Backup_'+new Date().toISOString().slice(0,10)+'.json';
    a.click();
    showToast('Exported '+all.length+' prescriptions');
  }catch(e){showToast('Export failed: '+e.message,'err');}
}

/* ─── TABS ─── */
function sw(tab,btn){
  qs('rxTab').style.display  =tab==='rx'  ?'block':'none';
  qs('histTab').style.display=tab==='hist'?'block':'none';
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  if(tab==='hist')loadHist();
}
function printRx(){
  document.title=qs('rxNo').textContent+' — '+(qs('pName').value||'Patient')+' — Sai Dental';
  window.print();
}
async function clearAll(){
  if(!confirm('Clear all fields and start fresh?'))return;
  rows=[];rid=0;renderRows();
  ['pName','pAge','pContact','pBP','pRef','notes','followup'].forEach(id=>qs(id).value='');
  ['pGender','pDx'].forEach(id=>qs(id).value='');
  qs('pAllergy').value='';
  const c=await getSetting('rxCounter')||0;
  qs('rxNo').textContent='RX-'+String(c+1).padStart(4,'0');
}
async function repeatPreviousRx(){
  if(!_histCache.length){showToast('No previous prescriptions found','warn');return;}
  const last=_histCache[0];
  qs('pName').value   =last.patientName   ||'';
  qs('pAge').value    =last.patientAge    ||'';
  qs('pGender').value =last.patientGender ||'';
  qs('pContact').value=last.patientContact||'';
  qs('pBP').value     =last.patientBP     ||'';
  qs('pDx').value     =last.patientDx     ||'';
  qs('pAllergy').value=last.patientAllergy||'';
  qs('pRef').value    =last.patientRef    ||'';
  qs('notes').value   =last.notes         ||'';
  qs('followup').value=last.followup      ||'';
  rows=[];rid=0;(last.medicines||[]).forEach(m=>addRow(m));
  showToast('Previous Rx loaded: '+last.rxno);
}

/* ─── PWA INSTALL ─── */
let _deferredPrompt=null;

/* Check if already running as installed PWA */
function isInstalled(){
  return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
}

/* Show banner only when not already installed */
function maybeShowBanner(){
  const banner=qs('pwaBanner');
  if(!banner)return;
  if(isInstalled()){
    banner.classList.remove('show');
  } else if(_deferredPrompt){
    banner.classList.add('show');
  }
}

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  _deferredPrompt=e;
  maybeShowBanner();
});

/* Hide banner if user installs via browser menu (not our button) */
window.addEventListener('appinstalled',()=>{
  _deferredPrompt=null;
  const banner=qs('pwaBanner');
  if(banner)banner.classList.remove('show');
});

/* Re-check when display-mode changes — fires when uninstalled and reopened in browser */
window.matchMedia('(display-mode: standalone)').addEventListener('change',e=>{
  if(!e.matches)maybeShowBanner();
});

function installPWA(){
  if(!_deferredPrompt)return;
  _deferredPrompt.prompt();
  _deferredPrompt.userChoice.then(choice=>{
    if(choice.outcome==='accepted'){
      _deferredPrompt=null;
      const banner=qs('pwaBanner');
      if(banner)banner.classList.remove('show');
    }
    /* If they cancel the prompt, keep _deferredPrompt so they can try again */
  });
}
function dismissPWA(){
  const banner=qs('pwaBanner');
  if(banner)banner.classList.remove('show');
  /* Don't null _deferredPrompt — install still available via browser menu */
}

/* ─── KEYBOARD SHORTCUT ─── */
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='s'&&qs('rxTab').style.display!=='none'){
    e.preventDefault();saveRx();
  }
});

/* ─── CLOSE PAT DROPDOWN ─── */
document.addEventListener('click',e=>{
  const w=qs('patSearchWrap');
  if(w&&!w.contains(e.target))qs('patDropdown').className='pat-dropdown';
});

/* ═══ INIT ═══ */
waitFB(()=>{
  window._fb.onAuthStateChanged(window._auth, async user=>{
    if(user){
      qs('loginOverlay').style.display='none';
      qs('appMain').style.display='block';
      qs('userEmail').textContent=user.email;
      qs('userAvatar').textContent=user.email[0].toUpperCase();
      updateNet();
      qs('todayDate').textContent=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
      qs('notes').value='Avoid hot food for 24 hrs. Rinse with warm salt water twice daily. Take medicines after food.';
      qs('followup').value='After 5 days';
      addRow({});
      try{
        const c=await getSetting('rxCounter')||0;
        qs('rxNo').textContent='RX-'+String(c+1).padStart(4,'0');
      }catch(e){}
      await loadHist();

      /* Register service worker for PWA */
      if('serviceWorker' in navigator){
        navigator.serviceWorker.register('./sw.js').catch(()=>{});
      }
    }else{
      qs('loginOverlay').style.display='flex';
      qs('appMain').style.display='none';
      const btn=qs('loginBtn');
      if(btn){btn.disabled=false;btn.textContent='Sign In';}
    }
  });
});