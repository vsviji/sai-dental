/* ═══════════════════════════════════════════
   SAI DENTAL CLINIC — PRESCRIPTION SYSTEM
   app.js
═══════════════════════════════════════════ */

/* ─── WAIT FOR FIREBASE MODULE ─── */
function waitFB(cb){ window._fb ? cb() : setTimeout(()=>waitFB(cb),80); }

let _editingRxId=null;
let _deleteRxId=null;

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
const RX_COL   = () => window._rxCol();
const SETT_COL = () => window._fb.collection(window._db,'settings');
const FUP_COL  = () => window._fupCol();

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
  try{
    const n = ((await getSetting('rxCounter'))||0)+1;
    await setSetting('rxCounter',n);
    return 'RX-'+String(n).padStart(4,'0');
  }catch{
    /* Fallback: derive next number from history */
    let max=0;
    _histCache.forEach(r=>{
      const m=(r.rxno||'').match(/RX-(\d+)/i);
      if(m)max=Math.max(max,parseInt(m[1],10));
    });
    return 'RX-'+String(max+1).padStart(4,'0');
  }
}

/* ═══ ROLE-BASED ACCESS ═══ */
let _currentRole = 'admin'; /* default: admin (backward compat) */

async function getUserRole(email) {
  if (!email) return 'admin';
  try {
    const docRef = window._fb.doc(window._fb.collection(window._db, 'users'), email);
    const snap = await window._fb.getDoc(docRef);
    if (snap.exists()) {
      const role = snap.data().role;
      console.log('Role fetched for', email, ':', role);
      return role || 'staff';
    }
    console.warn('No role doc found for', email, '- defaulting to admin');
  } catch (e) { console.warn('Role fetch error for', email, ':', e.message, '- defaulting to admin'); }
  return 'admin';
}

function isAdmin() { return _currentRole === 'admin'; }
function isStaff() { return _currentRole === 'staff'; }

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

/* ─── FOLLOW-UP HELPERS ─── */
function calcFollowupDays(str){
  if(!str)return null;
  const s=str.toLowerCase();
  const md=s.match(/(\d+)\s*days?/);
  if(md)return parseInt(md[1]);
  if(s.match(/(\d+)\s*week/)){const w=s.match(/(\d+)/);return w?parseInt(w[1])*7:7;}
  if(s.match(/(\d+)\s*month/)){const mo=s.match(/(\d+)/);return mo?parseInt(mo[1])*30:30;}
  if(s.includes('until')||s.includes('finished'))return null;
  return null;
}
function calcFollowupIso(followupStr,fromIso){
  const days=calcFollowupDays(followupStr);
  if(!days)return null;
  const d=fromIso?new Date(fromIso):new Date();
  d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
}
function todayIso(){return new Date().toISOString().slice(0,10)}

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
  /* Show visit history inline */
  const existing=qs('patVisitsInline');
  if(existing)existing.remove();
  const visits=_histCache.filter(r=>
    r.id!==id&&(r.patientName||'').toLowerCase()===(rx.patientName||'').toLowerCase()&&
    (!rx.patientContact||!r.patientContact||(r.patientContact||'').includes(rx.patientContact)||(rx.patientContact||'').includes(r.patientContact))
  );
  if(visits.length){
    const div=document.createElement('div');div.id='patVisitsInline';
    div.style.cssText='margin-top:6px;padding:8px 12px;background:var(--gold-l);border:1px solid var(--gold);border-radius:var(--r);font-size:12px;color:var(--gold)';
    div.innerHTML='<strong>'+visits.length+' previous visit(s):</strong> '+visits.slice(0,3).map(r=>r.rxno+' ('+r.date+')').join(', ')+(visits.length>3?'…':'');
    div.onclick=()=>showPatientProfile(id);
    div.style.cursor='pointer';
    qs('pName').parentNode.appendChild(div);
  }
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
    let rxno,id,existing;
    if(_editingRxId){
      existing=_histCache.find(r=>r.id===_editingRxId);
      if(!existing){showToast('Original prescription not found','err');btn.disabled=false;btn.classList.remove('saving');return;}
      rxno=existing.rxno;
      id=_editingRxId;
    }else{
      rxno=await nextRxNo();
      id='rx_'+Date.now();
    }
    const rx={
      id,rxno,
      date:new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}),
      dateISO:new Date().toISOString(),
      followupDate:calcFollowupIso(qs('followup').value)||'',
      followupStatus:qs('followup').value?'pending':'',
      followupNotes:existing?.followupNotes||[],
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
      grand:         Math.round(grand),
      paid:          existing?.paid||0,
      paymentStatus: existing?.paymentStatus||'pending'
    };
    try{
      await putRx(rx);
    }catch(e1){
      delete rx.paid;delete rx.paymentStatus;
      await putRx(rx);
    }
    if(_editingRxId){
      const idx=_histCache.findIndex(r=>r.id===_editingRxId);
      if(idx>=0)_histCache[idx]=rx;
      _editingRxId=null;
      _payRxId=rx.id;
      updateBillPay(rx);
      qs('btnSaveLabel').textContent='Save Prescription';
      showToast('✓ '+rxno+' updated');
    }else{
      _histCache.unshift(rx);
      updateStats();
      _payRxId=rx.id;
      updateBillPay(rx);
      const counter=await getSetting('rxCounter')||0;
      qs('rxNo').textContent='RX-'+String(counter+1).padStart(4,'0');
      showToast('✓ '+rxno+' saved'+(navigator.onLine?' to Firebase':' offline — will sync when online'));
    }
  }catch(e){
    showToast('Save failed: '+e.message,'err');
  }
  btn.disabled=false;btn.classList.remove('saving');
}

/* ─── HISTORY ─── */
async function loadHist(){
  try{_histCache=await getAllRx();}catch(e){_histCache=[];}
  filterHist();updateStats();applyRoleUI();
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
    <div class="hist-item">
      <div onclick="loadRx('${r.id}')" class="hist-main">
      <div class="hi-name">${r.patientName||'—'} <span class="hi-amt">₹${r.grand}</span>
        <span class="hi-badge">${r.rxno||''}</span>
        <span style="font-weight:400;color:var(--muted);font-size:12px">${r.patientAge?'· '+r.patientAge+' yrs':''} ${r.patientGender||''}</span>
      </div>
      <div class="hi-pay-row">
        ${payStatusBadge(r)}
        ${!isStaff()?`
        <span class="hist-hover-actions">
          <button class="btn-icon-hist btn-edit-hist" onclick="event.stopPropagation();editRx('${r.id}')" title="Edit">✏️</button>
          <button class="btn-icon-hist btn-del-hist" onclick="event.stopPropagation();showDeleteConfirm('${r.id}')" title="Delete">✕</button>
        </span>`:''}
      </div>
      <div class="hi-sub">${r.date||''} &nbsp;·&nbsp; ${r.patientDx||'No diagnosis'} ${r.patientContact?'· '+r.patientContact:''}</div>
      <div class="hi-meds">${(r.medicines||[]).map(m=>m.name).filter(Boolean).slice(0,5).join(', ')}${(r.medicines||[]).length>5?'…':''}</div>
      </div>
      <div class="hist-extra-actions">
        <button class="btn-clr" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();duplicateRx('${r.id}')">🔁 Duplicate</button>
        <button class="btn-clr" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();showPatientProfile('${r.id}')">👤 Profile</button>
      </div>
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

function setFormReadOnly(ro){
  const ids=['pName','pAge','pGender','pContact','pBP','pDx','pAllergy','pRef','notes','followup'];
  ids.forEach(id=>{const el=qs(id);if(el)el.disabled=ro;});
  qs('btnSave').style.display=ro?'none':'';
  qs('addRowBtn').style.display=ro?'none':'';
  qs('tplBtns').style.display=ro?'none':'';
  qs('clearBtn').style.display=ro?'none':'';
  const banner=qs('readOnlyBanner');
  if(banner)banner.style.display=ro?'block':'none';
  /* Payment buttons: hide Pay for read-only, keep Receipt */
  const payActions=qs('billPaySection')?.querySelector('.bill-pay-actions');
  if(payActions)payActions.style.display=ro?'none':'';
  /* Disable all medicine row selects/inputs */
  document.querySelectorAll('#rxBody select,#rxBody input').forEach(el=>el.disabled=ro);
}
function loadRx(id){
  const isS=isStaff();
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
  setFormReadOnly(isS);
  _payRxId=rx.id;
  updateBillPay(rx);
  sw('rx',document.querySelectorAll('.tab')[0]);
  /* Show follow-up notes if any (from prescription + separate collection) */
  const fupEl=qs('loadedFupNotes');
  if(fupEl){
    (async()=>{
      let fupNotes=rx.followupNotes||[];
      let fupStatus=rx.followupStatus||'pending';
      try{
        const snap=await window._fb.getDoc(window._fb.doc(FUP_COL(),rx.id));
        if(snap.exists()){
          const d=snap.data();
          fupNotes=[...fupNotes,...(d.notes||[])];
          fupStatus=d.status||fupStatus;
        }
      }catch(e){}
      if(fupNotes?.length){
        fupEl.innerHTML='<div class="fup-loaded"><strong>Follow-up notes:</strong>'+
          fupNotes.map(n=>'<div class="fup-loaded-note"><span class="fup-note-by">'+n.by+'</span> '+n.note+' <span class="fup-note-at">'+new Date(n.at).toLocaleDateString('en-IN')+'</span></div>').join('')+
          '<span class="fup-status-tag">'+(
            fupStatus==='done'?'✅ Done':
            fupStatus==='contacted'?'📞 Contacted':
            '🟡 Pending'
          )+'</span></div>';
        fupEl.style.display='block';
      }else{
        fupEl.style.display='none';
      }
    })();
  }
  showToast('Loaded: '+rx.rxno);
}

function showDeleteConfirm(id){
  if(isStaff()){showToast('Staff cannot delete prescriptions','err');return;}
  const rx=_histCache.find(r=>r.id===id);
  if(!rx)return;
  _deleteRxId=id;
  qs('delRxName').textContent=rx.patientName||'Unknown';
  qs('delRxNo').textContent=rx.rxno||'—';
  qs('delConfirmModal').style.display='flex';
}

async function confirmDelete(){
  const id=_deleteRxId;
  if(!id)return;
  const rx=_histCache.find(r=>r.id===id);
  if(!rx){closeModal(null,'delConfirmModal');return;}
  const btn=qs('confirmDelBtn');
  btn.disabled=true;btn.textContent='Deleting…';
  try{
    await deleteRxById(id);
    /* Auto-adjust RX counter when deleting the most recent */
    const m=(rx.rxno||'').match(/RX-(\d+)/i);
    if(m){
      const rxNum=parseInt(m[1],10);
      try{
        const c=await getSetting('rxCounter')||0;
        if(rxNum>=c){await setSetting('rxCounter',Math.max(0,rxNum-1));}
      }catch(e){/* ignore */}
    }
    _histCache=_histCache.filter(r=>r.id!==id);
    updateStats();filterHist();
    closeModal(null,'delConfirmModal');
    showToast('Prescription deleted');
    /* Refresh displayed next RX number */
    if(!_editingRxId){
      getSetting('rxCounter').then(c=>{
        const rno=qs('rxNo');
        if(rno)rno.textContent='RX-'+String((c||0)+1).padStart(4,'0');
      });
    }
  }catch(e){showToast('Delete failed: '+e.message,'err');}
  btn.disabled=false;btn.textContent='Delete';
}

async function deleteRx(id){
  if(isStaff()){showToast('Staff cannot delete prescriptions','err');return;}
  showDeleteConfirm(id);
}

function editRx(id){
  const rx=_histCache.find(r=>r.id===id);
  if(!rx){showToast('Prescription not found','err');return;}
  loadRx(id);
  _editingRxId=id;
  qs('btnSaveLabel').textContent='💾 Update '+rx.rxno;
  showToast('Editing '+rx.rxno+' — make changes and click Update');
}
function cancelEdit(){
  if(!_editingRxId)return;
  _editingRxId=null;
  qs('btnSaveLabel').textContent='Save Prescription';
  newRxForm();
  showToast('Edit cancelled');
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
  if(isStaff()){showToast('Export not available for staff','err');return;}
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
  const tabs=['rx','hist','dash','apt','inv','fup'];
  tabs.forEach(t=>{
    const el=qs(t+'Tab');
    if(el)el.style.display=t===tab?'block':'none';
  });
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  if(tab==='hist')loadHist();
  if(tab==='dash')renderDash();
  if(tab==='apt'){todayApt();}
  if(tab==='inv')renderInv();
  if(tab==='fup')renderFollowups();
}
function printRx(){
  document.title=qs('rxNo').textContent+' — '+(qs('pName').value||'Patient')+' — Sai Dental';
  window.print();
}
async function clearAll(){
  if(_editingRxId){cancelEdit();return;}
  if(!confirm('Clear all fields and start fresh?'))return;
  newRxForm();
}
function newRxForm(){
  if(_editingRxId){_editingRxId=null;qs('btnSaveLabel').textContent='Save Prescription';}
  rows=[];rid=0;renderRows();
  ['pName','pAge','pContact','pBP','pRef','notes','followup'].forEach(id=>qs(id).value='');
  ['pGender','pDx'].forEach(id=>qs(id).value='');
  qs('pAllergy').value='';
  _payRxId=null;
  const sec=qs('billPaySection');
  if(sec)sec.style.display='none';
  setFormReadOnly(false);
  const rno=qs('rxNo');
  if(rno)rno.textContent='';
  (async()=>{
    const c=await getSetting('rxCounter')||0;
    qs('rxNo').textContent='RX-'+String(c+1).padStart(4,'0');
  })();
}
async function repeatPreviousRx(){
  if(!_histCache.length){showToast('No previous prescriptions found','warn');return;}
  newRxForm();
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
function newRx(){
  newRxForm();
  showToast('New prescription ready');
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

/* ═══════════════════════════════════════════
   NEW FEATURES
═══════════════════════════════════════════ */

/* ─── ROLE-BASED UI ─── */
function applyRoleUI() {
  const isS = isStaff();
  const existing = document.getElementById('sd-role-style');
  if (existing) existing.remove();

  if (isS) {
    /* Hide admin-only tabs: Dashboard, Inventory */
    ['dash', 'inv'].forEach(t => {
      const btn = document.querySelector(`.tab[onclick*="'${t}'"]`);
      if (btn) btn.style.display = 'none';
    });
    /* Hide specific admin buttons by onclick handler name */
    ['exportAll', 'importJSON'].forEach(fn => {
      const btn = document.querySelector(`[onclick*="${fn}"]`);
      if (btn) btn.style.display = 'none';
    });
    /* Inject CSS for read-only history */
    const style = document.createElement('style');
    style.id = 'sd-role-style';
    style.textContent = '.btn-del-hist,.btn-edit-hist{display:none!important}';
    document.head.appendChild(style);
  } else {
    /* Show the follow-ups tab for admin/doctor too */
    const fupBtn = document.querySelector(`.tab[onclick*="'fup'"]`);
    if (fupBtn) fupBtn.style.display = '';
  }
  /* Update follow-up badge asynchronously */
  updateFupBadge();
}

/* ─── MODAL HELPERS ─── */
function closeModal(ev,id){
  if(ev&&ev.target!==ev.currentTarget)return;
  qs(id).style.display='none';
}

/* ─── DARK MODE ─── */
function toggleDark(){
  const html=document.documentElement;
  const isDark=html.getAttribute('data-theme')==='dark';
  if(isDark){html.removeAttribute('data-theme');localStorage.setItem('sd-theme','light');qs('darkBtn').textContent='🌙 Dark';}
  else{html.setAttribute('data-theme','dark');localStorage.setItem('sd-theme','dark');qs('darkBtn').textContent='☀️ Light';}
}
(function initTheme(){
  const saved=localStorage.getItem('sd-theme');
  if(saved==='dark'||(!saved&&window.matchMedia('(prefers-color-scheme: dark)').matches)){
    document.documentElement.setAttribute('data-theme','dark');
    if(qs('darkBtn'))qs('darkBtn').textContent='☀️ Light';
  }
})();

/* ─── MULTI-DOCTOR SUPPORT ─── */
const DOCTORS = [
  {name:'Dr. S. K. Srinivas',deg:'BDS, FDS (Endodontics)',reg:'TNDC-31721'},
  {name:'Dr. Arun',deg:'Orthodontist',reg:''},
  {name:'Dr. Pugazh',deg:'Periodontist (Laser Gum Surgery)',reg:''},
  {name:'Dr. Vigneshwari',deg:'Oral & Maxillofacial Surgeon (Wisdom Tooth Removal)',reg:''},
  {name:'Dr. Patrick',deg:'Dental Implants Specialist (Full Mouth Implants)',reg:''}
];
function getDoctors(){
  try{const s=JSON.parse(localStorage.getItem('sd-doctors')||'null');if(s&&s.length)return s;}catch{}
  return DOCTORS;
}
function saveDoctors(list){
  localStorage.setItem('sd-doctors',JSON.stringify(list.length?list:DOCTORS));
}
function populateDoctorSelect(){
  const sel=qs('aptDoctor');
  if(!sel)return;
  const docs=getDoctors();
  sel.innerHTML=docs.map((d,i)=>`<option value="${i}">${d.name}${d.deg?' — '+d.deg:''}</option>`).join('');
}
/* Expose doctors for HTML */
window.getDoctors=getDoctors;

/* ─── AUTO-SAVE DRAFTS ─── */
let _draftTimer=null;
function saveDraft(){
  const data={
    pName:qs('pName')?.value||'',pAge:qs('pAge')?.value||'',pGender:qs('pGender')?.value||'',
    pContact:qs('pContact')?.value||'',pBP:qs('pBP')?.value||'',pDx:qs('pDx')?.value||'',
    pAllergy:qs('pAllergy')?.value||'',pRef:qs('pRef')?.value||'',
    notes:qs('notes')?.value||'',followup:qs('followup')?.value||'',
    rows:rows.map(r=>({...r}))
  };
  localStorage.setItem('sd-draft',JSON.stringify(data));
}
function restoreDraft(){
  try{
    const raw=localStorage.getItem('sd-draft');
    if(!raw)return;
    const d=JSON.parse(raw);
    /* Skip prompt if only an empty default row (no patient name, no medicine chosen) */
    const hasData=d.pName||(d.rows||[]).some(r=>r.name);
    if(!hasData){localStorage.removeItem('sd-draft');return;}
    /* Auto-restore draft silently */
    qs('pName').value=d.pName||'';
    qs('pAge').value=d.pAge||'';
    qs('pGender').value=d.pGender||'';
    qs('pContact').value=d.pContact||'';
    qs('pBP').value=d.pBP||'';
    qs('pDx').value=d.pDx||'';
    qs('pAllergy').value=d.pAllergy||'';
    qs('pRef').value=d.pRef||'';
    qs('notes').value=d.notes||'';
    qs('followup').value=d.followup||'';
    if(d.rows?.length){rows=[];rid=0;d.rows.forEach(m=>addRow(m));}
    localStorage.removeItem('sd-draft');
  }catch(e){localStorage.removeItem('sd-draft');}
}
/* Auto-save every 10s when on rx tab */
setInterval(()=>{
  if(qs('rxTab')&&qs('rxTab').style.display!=='none')saveDraft();
},10000);

/* ─── IMPORT JSON ─── */
function importJSON(){
  if(isStaff()){showToast('Import not available for staff','err');return;}
  qs('importFileInput').click();
}
async function handleImport(ev){
  const file=ev.target.files[0];
  if(!file)return;
  try{
    const text=await file.text();
    const data=JSON.parse(text);
    const list=data.prescriptions||data||[];
    if(!Array.isArray(list)||!list.length){showToast('Invalid backup file','err');return;}
    let count=0;
    for(const rx of list){
      if(!rx.id||!rx.patientName)continue;
      try{await putRx(rx);count++;}catch(e){}
    }
    showToast('Imported '+count+' prescriptions');
    ev.target.value='';
    loadHist();
  }catch(e){showToast('Import failed: '+e.message,'err');}
}

/* ─── PAYMENT ─── */
let _payRxId=null;
function showPayModal(){
  const rx=_histCache.find(r=>r.id===_payRxId);
  if(!rx){showToast('Save the prescription first','err');return;}
  const paid=rx.paid||0;
  const balance=rx.grand-paid;
  qs('payModalTitle').textContent='💰 Payment — '+rx.rxno;
  qs('payGrand').textContent='₹'+rx.grand;
  qs('payAlready').textContent='₹'+paid;
  qs('payBalance').textContent='₹'+Math.max(0,balance);
  qs('payAmount').value=balance>0?balance:'';
  qs('payAmount').max=balance;
  qs('payModal').dataset.rxId=rx.id;
  qs('payModal').style.display='flex';
  setTimeout(()=>qs('payAmount').focus(),200);
}
async function recordPayment(){
  const id=qs('payModal').dataset.rxId;
  const amount=parseInt(qs('payAmount').value);
  if(!amount||amount<1){showToast('Enter a valid amount','err');return;}
  const method=qs('payMethod').value;
  const rx=_histCache.find(r=>r.id===id);
  if(!rx){showToast('Prescription not found','err');return;}
  const newPaid=(rx.paid||0)+amount;
  if(newPaid>rx.grand){showToast('Payment exceeds grand total','err');return;}
  const status=newPaid>=rx.grand?'paid':newPaid>0?'partial':'pending';
  try{
    await window._fb.updateDoc(window._fb.doc(RX_COL(),id),{paid:newPaid,paymentStatus:status});
    rx.paid=newPaid;rx.paymentStatus=status;
    closeModal(null,'payModal');
    updateBillPay(rx);
    showToast('✅ Payment recorded ('+method+')');
    if(status==='paid')sharePaidPrescriptionPdf(rx);
  }catch(e){showToast('Payment failed: '+e.message,'err');}
}
function updateBillPay(rx){
  const sec=qs('billPaySection');
  if(!sec)return;
  if(!rx||!rx.grand){sec.style.display='none';return;}
  const paid=rx.paid||0;const bal=rx.grand-paid;
  qs('bPaid').textContent='₹'+paid;
  qs('bBalance').textContent='₹'+bal;
  qs('bBalance').style.color=bal>0?'var(--red)':'var(--teal)';
  sec.style.display='block';
}
function payStatusBadge(rx){
  const s=rx.paymentStatus||'pending';
  const paid=rx.paid||0;
  if(paid>=rx.grand&&rx.grand>0)return '<span class="pay-badge pay-paid">✅ Paid</span>';
  if(paid>0)return '<span class="pay-badge pay-partial">🟡 Partial ₹'+paid+'</span>';
  return '<span class="pay-badge pay-pending">🔴 Pending</span>';
}
async function sharePaidPrescriptionPdf(rx){
  const name=rx.patientName||'Patient';
  const rxno=rx.rxno||'RX-—';
  const el=qs('rxTab');
  if(!el)return;
  if(typeof html2pdf==='undefined'){showToast('PDF library not loaded','warn');return;}
  const opt={
    margin:8,
    filename:rxno+'_'+name.replace(/\s+/g,'_')+'_receipt.pdf',
    image:{type:'jpeg',quality:0.98},
    html2canvas:{scale:2,useCORS:true,letterRendering:true},
    jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}
  };
  const isMobile=/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  try{
    const pdf=await html2pdf().set(opt).from(el).toPdf().get('pdf');
    const phone=rx.patientContact?rx.patientContact.replace(/[^\d]/g,''):'918122835737';
    const dx=rx.patientDx||'—';
    const meds=(rx.medicines||[]).map(m=>m.name).join(', ').slice(0,150);
    const dateStr=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
    const text='🦷 *Sai Dental Clinic*\n✅ *Payment Received*\n\n👤 Patient: '+name+
      '\n📋 Rx No: '+rxno+
      '\n🏥 Diagnosis: '+dx+
      '\n💊 Medicines: '+meds+
      '\n💰 Amount: ₹'+rx.grand+' | 💵 Paid: ₹'+(rx.paid||0)+
      '\n📅 Date: '+dateStr+
      '\n\nPrescription receipt attached. Thank you! 🙏';
    if(isMobile&&navigator.canShare){
      const blob=pdf.output('blob');
      const file=new File([blob],opt.filename,{type:'application/pdf'});
      await navigator.share({title:'Receipt - '+name,text:text,files:[file]});
      showToast('✅ Receipt shared');
    }else{
      pdf.save(opt.filename);
      const url='https://wa.me/'+phone+'?text='+encodeURIComponent('🦷 Sai Dental Clinic\n✅ Payment Received\n\nPatient: '+name+'\nRx: '+rxno+'\n\n📄 Receipt PDF has been downloaded — please attach it to this chat.');
      const w=window.open('','sai_wa_share');if(w)w.location.href=url;
      showToast('📄 PDF downloaded — drag & drop file into WhatsApp Web chat');
    }
  }catch(e){
    if(e.name!=='AbortError')showToast('Could not share PDF: '+e.message,'err');
  }
}
function printReceipt(){
  const rx=_histCache.find(r=>r.id===_payRxId);
  if(!rx){showToast('Save and load the prescription first','err');return;}
  const paid=rx.paid||0;const bal=rx.grand-paid;
  const win=window.open('','_blank');
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt — '+rx.rxno+'</title>'+
    '<style>body{font-family:"DM Sans",sans-serif;padding:30px;max-width:400px;margin:0 auto;color:#1a1a1a}'+
    '.hdr{text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #0F6E56}'+
    '.hdr h2{margin:0;color:#0F6E56;font-size:18px}.hdr p{margin:4px 0;font-size:12px;color:#6b7280}'+
    '.info td{padding:4px 8px;font-size:13px}.info td:first-child{color:#6b7280}'+
    'table{width:100%;border-collapse:collapse;margin:16px 0}'+
    'th{background:#0F6E56;color:#fff;padding:8px 10px;font-size:12px;text-align:left}'+
    'td{padding:6px 10px;font-size:12px;border-bottom:1px solid #e5e7eb}'+
    '.total-row td{font-weight:600;padding:8px 10px}'+
    '.totals{margin-top:12px;padding-top:12px;border-top:2px solid #0F6E56}'+
    '.totals div{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}'+
    '.footer{text-align:center;margin-top:24px;font-size:11px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:14px}'+
    '@media print{body{padding:20px}}'+
    '</style></head><body>'+
    '<div class="hdr"><h2>SAI DENTAL CLINIC</h2><p>Kenikarai, Thiruvarur Main Road, Mayiladuthurai</p><p>+91 8122835737</p></div>'+
    '<table class="info"><tr><td>Rx No</td><td><strong>'+rx.rxno+'</strong></td></tr>'+
    '<tr><td>Patient</td><td><strong>'+rx.patientName+'</strong></td></tr>'+
    '<tr><td>Date</td><td>'+rx.date+'</td></tr></table>'+
    '<table><tr><th>#</th><th>Medicine</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>'+
    (rx.medicines||[]).map((m,i)=>'<tr><td>'+(i+1)+'</td><td>'+m.name+'</td><td>'+m.qty+'</td><td>₹'+m.rate+'</td><td>₹'+(m.qty*m.rate)+'</td></tr>').join('')+
    '</table>'+
    '<div class="totals"><div><span>Grand Total</span><span>₹'+rx.grand+'</span></div>'+
    '<div><span>Paid</span><span>₹'+paid+'</span></div>'+
    '<div style="font-weight:700;color:'+(bal>0?'#E24B4A':'#0F6E56')+'"><span>Balance</span><span>₹'+bal+'</span></div></div>'+
    '<div class="footer">Thank you — Visit again!<br>Sai Dental Clinic</div>'+
    '</body></html>');
  win.document.close();
  setTimeout(()=>{win.print();win.close();},300);
}

/* ─── DUPLICATE RX ─── */
function duplicateRx(id){
  const rx=_histCache.find(r=>r.id===id);
  if(!rx)return;
  newRxForm();
  qs('pName').value=rx.patientName||'';
  qs('pAge').value=rx.patientAge||'';
  qs('pGender').value=rx.patientGender||'';
  qs('pContact').value=rx.patientContact||'';
  qs('pBP').value=rx.patientBP||'';
  qs('pDx').value=rx.patientDx||'';
  qs('pAllergy').value=rx.patientAllergy||'';
  qs('pRef').value=rx.patientRef||'';
  qs('notes').value=rx.notes||'';
  qs('followup').value=rx.followup||'';
  (rx.medicines||[]).forEach(m=>addRow(m));
  sw('rx',document.querySelectorAll('.tab')[0]);
  showToast('Duplicated: '+rx.rxno);
}

/* ─── PATIENT VISIT HISTORY ─── */
function showPatientVisits(name,contact){
  if(!name)return;
  const visits=_histCache.filter(r=>
    (r.patientName||'').toLowerCase()===name.toLowerCase()&&
    (!contact||(r.patientContact||'').includes(contact))
  );
  if(visits.length<=1)return;
  let html='<div class="profile-visits" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">'+
    '<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px;font-weight:500">Previous Visits ('+visits.length+')</div>';
  visits.slice(0,10).forEach(r=>{
    html+='<div class="profile-visit" onclick="loadRx(\''+r.id+'\')">'+
      '<div class="profile-visit-top"><span class="profile-visit-rx">'+r.rxno+'</span><span class="profile-visit-date">'+r.date+'</span></div>'+
      '<div class="profile-visit-dx">'+(r.patientDx||'—')+'</div>'+
      '</div>';
  });
  html+='</div>';
  return html;
}

/* ─── PATIENT PROFILE ─── */
function showPatientProfile(id){
  const rx=_histCache.find(r=>r.id===id);
  if(!rx)return;
  const name=rx.patientName||'';
  const contact=rx.patientContact||'';
  const visits=_histCache.filter(r=>
    (r.patientName||'').toLowerCase()===name.toLowerCase()&&
    (!contact||(r.patientContact||'').includes(contact))
  );
  const totalAmt=visits.reduce((s,r)=>s+(r.grand||0),0);
  const totalRx=visits.length;
  const commonDx=[...new Set(visits.map(r=>r.patientDx).filter(Boolean))].slice(0,3).join(', ');
  qs('patProfileTitle').textContent=name;
  let html='<div class="profile-header">'+
    '<div class="profile-avatar">'+name[0]+'</div>'+
    '<div><div class="profile-name">'+name+'</div>'+
    '<div class="profile-meta">'+(contact||'')+' · '+commonDx+'</div></div></div>'+
    '<div class="profile-stats">'+
    '<div class="profile-stat"><div class="profile-stat-val">'+totalRx+'</div><div class="profile-stat-lbl">Total Visits</div></div>'+
    '<div class="profile-stat"><div class="profile-stat-val">₹'+totalAmt+'</div><div class="profile-stat-lbl">Total Amount</div></div>'+
    '<div class="profile-stat"><div class="profile-stat-val">₹'+(totalRx?Math.round(totalAmt/totalRx):0)+'</div><div class="profile-stat-lbl">Avg per Visit</div></div>'+
    '</div>'+
    '<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px;font-weight:500">Visit History</div>';
  visits.sort((a,b)=>(b.dateISO||'').localeCompare(a.dateISO||'')).forEach(r=>{
    html+='<div class="profile-visit" onclick="loadRx(\''+r.id+'\')">'+
      '<div class="profile-visit-top"><span class="profile-visit-rx">'+r.rxno+'</span><span class="profile-visit-date">'+r.date+'</span></div>'+
      '<div class="profile-visit-dx">'+(r.patientDx||'—')+(r.medicines?.length?' · '+r.medicines.length+' medicines':'')+'</div>'+
      '<div class="profile-visit-amt">₹'+(r.grand||0)+'</div></div>';
  });
  qs('patProfileBody').innerHTML=html;
  qs('patProfileModal').style.display='flex';
}

/* ─── CUSTOMIZABLE TEMPLATES ─── */
function getTemplates(){
  try{return JSON.parse(localStorage.getItem('sd-templates')||'[]');}catch{return [];}
}
function saveTemplateList(list){
  localStorage.setItem('sd-templates',JSON.stringify(list));
}
function saveCustomTemplate(){
  const name=qs('tplNameInput').value.trim();
  if(!name){showToast('Enter a template name','err');return;}
  if(!rows.length){showToast('Add at least one medicine','err');return;}
  const tpl={name,medicines:rows.map(r=>({name:r.name,dosage:r.dosage,freq:r.freq,dur:r.dur,qty:r.qty,rate:r.rate,inst:r.inst})),notes:qs('notes').value,followup:qs('followup').value};
  const list=getTemplates();
  list.unshift(tpl);
  saveTemplateList(list);
  qs('tplNameInput').value='';
  renderTplList();
  showToast('Template saved: '+name);
}
function renderTplList(){
  const el=qs('tplList');
  const list=getTemplates();
  if(!list.length){el.innerHTML='<div class="tpl-empty">No custom templates yet. Save your current prescription as a template.</div>';return;}
  el.innerHTML=list.map((t,i)=>'<div class="tpl-item">'+
    '<div><div class="tpl-name">'+t.name+'</div><div class="tpl-meds">'+(t.medicines||[]).map(m=>m.name).filter(Boolean).slice(0,4).join(', ')+(t.medicines?.length>4?'…':'')+'</div></div>'+
    '<div class="tpl-actions">'+
    '<button onclick="loadCustomTemplate('+i+')" title="Load">📋 Load</button>'+
    '<button class="tpl-del" onclick="deleteCustomTemplate('+i+')" title="Delete">🗑️</button>'+
    '</div></div>').join('');
}
function loadCustomTemplate(i){
  const list=getTemplates();
  const t=list[i];
  if(!t)return;
  rows=[];rid=0;(t.medicines||[]).forEach(m=>addRow(m));
  qs('notes').value=t.notes||'';
  qs('followup').value=t.followup||'';
  renderRows();
  closeModal(null,'tplModal');
  showToast('Template loaded: '+t.name);
}
function deleteCustomTemplate(i){
  if(!confirm('Delete this template?'))return;
  const list=getTemplates();
  list.splice(i,1);
  saveTemplateList(list);
  renderTplList();
}
function openTplManager(){
  renderTplList();
  qs('tplModal').style.display='flex';
}

/* ─── DENTAL CHART ─── */
let _dentalMarked=new Set();
function openDentalChart(){
  _dentalMarked=new Set();
  try{
    const saved=JSON.parse(localStorage.getItem('sd-dental')||'[]');
    saved.forEach(n=>_dentalMarked.add(n));
  }catch(e){}
  renderDentalChart();
  qs('dentalModal').style.display='flex';
}
function renderDentalChart(){
  const el=qs('dentalChartBody');
  const quads=[
    {label:'Upper Right',nums:[18,17,16,15,14,13,12,11]},
    {label:'Upper Left',nums:[21,22,23,24,25,26,27,28]},
    {label:'Lower Left',nums:[31,32,33,34,35,36,37,38]},
    {label:'Lower Right',nums:[48,47,46,45,44,43,42,41]}
  ];
  let html='<div class="tooth-legend">'+
    '<div class="tooth-legend-item"><div class="tooth-legend-swatch" style="background:var(--teal)"></div> Affected</div>'+
    '<div class="tooth-legend-item"><div class="tooth-legend-swatch"></div> Healthy</div>'+
    '</div>';
  quads.forEach(q=>{
    html+='<div class="dental-section"><div class="dental-section-title">'+q.label+'</div><div class="dental-grid">';
    q.nums.forEach(n=>{
      const isMarked=_dentalMarked.has(n);
      html+='<div class="tooth'+(isMarked?' marked':'')+'" onclick="toggleTooth('+n+')" title="Tooth #'+n+'">'+n+'</div>';
    });
    html+='</div></div>';
  });
  el.innerHTML=html;
}
function toggleTooth(n){
  if(_dentalMarked.has(n))_dentalMarked.delete(n);else _dentalMarked.add(n);
  localStorage.setItem('sd-dental',JSON.stringify([..._dentalMarked]));
  renderDentalChart();
}
function clearDentalChart(){
  _dentalMarked.clear();
  localStorage.setItem('sd-dental','[]');
  renderDentalChart();
}

/* ─── PDF GENERATION ─── */
function genPDF(){
  const name=qs('pName').value.trim()||'Patient';
  const rxno=qs('rxNo').textContent;
  document.title=rxno+' — '+name+' — Sai Dental';
  const el=qs('rxTab');
  const opt={
    margin:8,
    filename:rxno+'_'+name.replace(/\s+/g,'_')+'.pdf',
    image:{type:'jpeg',quality:0.98},
    html2canvas:{scale:2,useCORS:true,letterRendering:true},
    jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}
  };
  if(typeof html2pdf==='undefined'){showToast('PDF library loading, try again','warn');return;}
  html2pdf().set(opt).from(el).save();
  showToast('PDF generated: '+rxno);
}

/* ─── SHARE ─── */
function shareRx(){
  const name=qs('pName').value.trim();
  if(!name){showToast('Enter patient name first','err');return;}
  const rxno=qs('rxNo').textContent;
  const followupText=qs('followup').value.trim();
  qs('shareSummary').innerHTML=
    '<div style="font-size:14px;font-weight:600;margin-bottom:2px">'+name+'</div>'+
    '<div style="font-size:12px;color:var(--muted)">'+rxno+' · '+new Date().toLocaleDateString('en-IN')+'</div>';
  if(followupText){
    qs('shareFupSection').style.display='block';
    qs('shareAptPreview').textContent='📅 '+followupText;
    qs('shareCreateApt').checked=true;
  }else{
    qs('shareFupSection').style.display='none';
  }
  qs('shareModal').style.display='flex';
}

async function confirmShare(){
  const name=qs('pName').value.trim();
  const rxno=qs('rxNo').textContent;
  const followupText=qs('followup').value.trim();
  closeModal(null,'shareModal');
  showToast('Generating PDF…');
  if(followupText&&qs('shareCreateApt').checked){
    createApptFromFollowup(name,followupText);
  }
  const el=qs('rxTab');
  const opt={
    margin:8,
    filename:rxno+'_'+name.replace(/\s+/g,'_')+'.pdf',
    image:{type:'jpeg',quality:0.98},
    html2canvas:{scale:2,useCORS:true,letterRendering:true},
    jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}
  };
  if(typeof html2pdf==='undefined'){showToast('PDF library loading, try again','warn');return;}
  try{
    const pdf=await html2pdf().set(opt).from(el).toPdf().get('pdf');
    const shareText=followupText
      ?'🦷 Sai Dental Clinic\nRx: '+rxno+'\nPatient: '+name+'\n📅 Next visit: '+followupText
      :'🦷 Sai Dental Clinic\nRx: '+rxno+'\nPatient: '+name;
    pdf.save(opt.filename);
    const patientPhone=qs('pContact').value?.replace(/[^\d]/g,'')||'918122835737';
    const url='https://wa.me/'+patientPhone+'?text='+encodeURIComponent(shareText);
    const w=window.open('','sai_wa_share');if(w)w.location.href=url;
    showToast('PDF downloaded, WhatsApp opened');
  }catch(e){
    showToast('Share failed: '+e.message,'err');
  }
}

function createApptFromFollowup(name,followupText){
  let aptDate=dateStr(new Date());
  const days=calcFollowupDays(followupText);
  if(days){
    const d=new Date();
    d.setDate(d.getDate()+days);
    aptDate=dateStr(d);
  }
  const list=getApts();
  const entry={id:'apt_'+Date.now(),patientName:name,contact:qs('pContact').value||'',date:aptDate,time:'10:00',
    purpose:'Follow-up',doctor:'0',notes:'Auto-created from prescription share — '+followupText,
    status:'pending',adminNotes:'',createdAt:new Date().toISOString()};
  list.push(entry);
  list.sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.time||'').localeCompare(b.time||''));
  saveApts(list);
  renderApts();
  showToast('📅 Appointment added to calendar for '+aptDate);
}

/* ─── DASHBOARD ─── */
const DASH_COLORS=['#0F6E56','#1a8a7a','#2d9b8b','#085041','#5DCAA5','#0a5a46','#3aad9a','#0F6E56','#1a8a7a','#2d9b8b'];
const DASH_BAR_COLORS=['#0F6E56','#1a8a7a','#2d9b8b','#3aad9a','#5DCAA5','#9FE1CB','#0F6E56'];
function renderDash(){
  const all=_histCache||[];
  const totalRx=all.length;
  const totalPat=new Set(all.map(r=>r.patientName)).size;
  const calcGrand=r=>r.grand||Math.round((r.medicines||[]).reduce((s,m)=>s+(m.qty||0)*(m.rate||0),0));
  const totalRev=all.reduce((s,r)=>s+calcGrand(r),0);
  const totalOutstanding=all.reduce((s,r)=>s+Math.max(0,calcGrand(r)-(r.paid||0)),0);
  const now=new Date();
  const thisMonth=all.filter(r=>{
    const d=r.dateISO?new Date(r.dateISO):null;
    return d&&d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
  });
  const today=all.filter(r=>{
    const d=r.dateISO?new Date(r.dateISO):null;
    return d&&d.toDateString()===now.toDateString();
  });
  const avg=totalRx?Math.round(totalRev/totalRx):0;
  qs('dashTotalRx').textContent=totalRx;
  qs('dashTotalPat').textContent=totalPat;
  qs('dashRevenue').textContent='₹'+totalRev;
  qs('dashMonthRx').textContent=thisMonth.length;
  qs('dashTodayRx').textContent=today.length;
  qs('dashAvgAmt').textContent='₹'+avg;
  const outEl=qs('dashOutstanding');
  if(outEl){outEl.textContent='₹'+totalOutstanding;outEl.style.color=totalOutstanding?'var(--red)':'var(--teal)';}

  /* ── Build last 7 days data ── */
  const days=[],revDays=[];
  for(let i=6;i>=0;i--){
    const d=new Date(now);d.setDate(d.getDate()-i);
    const lbl=d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
    const dayRx=all.filter(r=>{
      const rd=r.dateISO?new Date(r.dateISO):null;
      return rd&&rd.toDateString()===d.toDateString();
    });
    days.push({lbl,cnt:dayRx.length});
    revDays.push({lbl,amt:dayRx.reduce((s,r)=>s+calcGrand(r),0)});
  }

  /* ── Rx count bar chart ── */
  const rxMax=Math.max(...days.map(d=>d.cnt),1);
  qs('dashChart').innerHTML=days.map((d,i)=>{
    const h=Math.max(8,(d.cnt/rxMax)*110);
    return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end">'+
      '<div class="dash-bar-val">'+d.cnt+'</div>'+
      '<div class="dash-bar" style="height:'+h+'px;background:'+DASH_BAR_COLORS[i]+';opacity:'+(0.5+(d.cnt/rxMax)*0.5)+'"></div>'+
      '<div class="dash-bar-lbl">'+d.lbl+'</div></div>';
  }).join('');

  /* ── Revenue bar chart ── */
  const revMax=Math.max(...revDays.map(d=>d.amt),1);
  const revEl=qs('dashRevChart');
  if(revEl){
    revEl.innerHTML=revDays.map((d,i)=>{
      const h=Math.max(8,(d.amt/revMax)*110);
      return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end">'+
        '<div class="dash-bar-val">₹'+d.amt+'</div>'+
        '<div class="dash-bar" style="height:'+h+'px;background:'+DASH_BAR_COLORS[i]+';opacity:0.7"></div>'+
        '<div class="dash-bar-lbl">'+d.lbl+'</div></div>';
    }).join('');
  }

  /* ── DX breakdown with horizontal bars ── */
  const dxMap={};
  all.forEach(r=>{const d=r.patientDx||'Other';dxMap[d]=(dxMap[d]||0)+1;});
  const dxSorted=Object.entries(dxMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const dxTotal=dxSorted.reduce((s,[,c])=>s+c,0)||1;
  const dxEl=qs('dashDxList');
  if(dxEl){
    dxEl.innerHTML=dxSorted.length?dxSorted.map(([dx,cnt],i)=>{
      const pct=Math.round(cnt/dxTotal*100);
      return '<div class="dx-item" style="border-left-color:'+DASH_COLORS[i%DASH_COLORS.length]+'">'+
        '<div><div class="dx-name">'+dx+'</div>'+
        '<div class="dx-bar-bg"><div class="dx-bar-fill" style="width:'+pct+'%;background:'+DASH_COLORS[i%DASH_COLORS.length]+'"></div></div></div>'+
        '<div style="text-align:right"><div class="dx-count">'+cnt+'</div><div style="font-size:10px;color:var(--muted)">'+pct+'%</div></div></div>';
    }).join(''):'<div class="empty-state"><p>No data yet</p></div>';
  }

  /* ── Pie chart (canvas) ── */
  const canvas=qs('dashPieCanvas');
  const legend=qs('dashPieLegend');
  if(canvas&&legend){
    const ctx=canvas.getContext('2d');
    const cw=canvas.width,ch=canvas.height,cx=cw/2,cy=ch/2,r=Math.min(cx,cy)-8;
    ctx.clearRect(0,0,cw,ch);
    legend.innerHTML='';
    if(dxSorted.length){
      let total=dxSorted.reduce((s,[,c])=>s+c,0);
      let startAngle=-Math.PI/2;
      dxSorted.slice(0,8).forEach(([dx,cnt],i)=>{
        const sliceAngle=(cnt/total)*Math.PI*2;
        const color=DASH_COLORS[i%DASH_COLORS.length];
        ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,startAngle,startAngle+sliceAngle);ctx.closePath();
        ctx.fillStyle=color;ctx.fill();
        /* White separator line */
        ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
        startAngle+=sliceAngle;
        /* Legend */
        const leg=document.createElement('div');leg.className='dash-pie-legend-item';
        leg.innerHTML='<span class="dash-pie-legend-dot" style="background:'+color+'"></span> '+dx+' ('+cnt+')';
        legend.appendChild(leg);
      });
      /* Center hole (donut effect) */
      ctx.beginPath();ctx.arc(cx,cy,r*.45,0,Math.PI*2);ctx.fillStyle='var(--surf2)';ctx.fill();
      ctx.fillStyle='var(--ink)';ctx.font='bold 14px "DM Sans",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(total,cx,cy-6);
      ctx.font='10px "DM Sans",sans-serif';ctx.fillStyle='var(--muted)';ctx.fillText('Total',cx,cy+12);
    }else{
      ctx.fillStyle='var(--border)';ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='var(--muted)';ctx.font='12px "DM Sans",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText('No data',cx,cy);
    }
  }
}

/* ─── APPOINTMENTS (Calendar) ─── */
let _aptMonth=new Date().getMonth();
let _aptYear=new Date().getFullYear();
let _aptSelDate=dateStr(new Date());
function dateStr(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function getApts(){
  try{return JSON.parse(localStorage.getItem('sd-apts')||'[]');}catch{return [];}
}
function saveApts(list){
  localStorage.setItem('sd-apts',JSON.stringify(list));
}
function showAptForm(data){
  if(data&&isStaff()){showToast('Staff cannot edit appointments','err');return;}
  const f=qs('aptFormModal');
  qs('aptFormTitle').textContent=data?'Edit Appointment':'New Appointment';
  qs('aptName').value=data?.patientName||'';
  qs('aptContact').value=data?.contact||'';
  qs('aptDate').value=data?.date||dateStr(new Date());
  qs('aptTime').value=data?.time||'10:00';
  qs('aptPurpose').value=data?.purpose||'';
  qs('aptNotes').value=data?.notes||'';
  populateDoctorSelect();
  if(data?.doctor!=null)qs('aptDoctor').value=data.doctor;
  qs('aptFormModal').dataset.editId=data?.id||'';
  f.style.display='flex';
}
function saveApt(){
  try{
    const name=qs('aptName').value.trim();
    const date=qs('aptDate').value;
    if(!name||!date){showToast('Enter patient name and date','err');return;}
    const editId=qs('aptFormModal').dataset.editId;
    const list=getApts();
    const existing=editId?list.find(a=>a.id===editId):null;
    const entry={id:editId||'apt_'+Date.now(),patientName:name,contact:qs('aptContact').value,date,time:qs('aptTime').value,
      purpose:qs('aptPurpose').value,doctor:qs('aptDoctor').value,notes:qs('aptNotes').value,
      status:existing?existing.status:'pending',adminNotes:existing?existing.adminNotes:'',createdAt:new Date().toISOString()};
    if(editId){const idx=list.findIndex(a=>a.id===editId);if(idx>=0)list[idx]=entry;else list.push(entry);}
    else list.push(entry);
    list.sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.time||'').localeCompare(b.time||''));
    saveApts(list);
    closeModal(null,'aptFormModal');
    renderApts();
    showToast(editId?'Appointment updated':'Appointment saved');
  }catch(e){showToast('Failed to save appointment: '+e.message,'err');}
}
function deleteApt(id){
  if(isStaff()){showToast('Staff cannot delete appointments','err');return;}
  if(!confirm('Delete this appointment?'))return;
  const list=getApts().filter(a=>a.id!==id);
  saveApts(list);
  renderApts();
  showToast('Appointment deleted');
}
function updateNotifBadge(){
  const list=getApts();
  const SURGICAL=['RCT','Extraction','Crown/Bridge','Filling'];
  const ROUTINE=['Scaling','Consultation'];
  const today=new Date();const todayStr=dateStr(today);
  const pending=[];
  list.forEach(a=>{
    if(a.whatsappSent)return;
    const aptDate=new Date(a.date+'T00:00:00');
    const daysDiff=Math.floor((aptDate-today)/86400000);
    if(SURGICAL.includes(a.purpose)){
      if(daysDiff>=0&&daysDiff<=3)pending.push(a);
    }else if(ROUTINE.includes(a.purpose)){
      if(daysDiff<=-28&&daysDiff>=-62)pending.push(a);
    }else{
      if(daysDiff>=0&&daysDiff<=7)pending.push(a);
    }
  });
  const count=pending.length;
  const badge=qs('notifCount');
  if(badge){
    badge.textContent=count;
    badge.style.display=count?'inline':'none';
  }
  return pending;
}
function showNotifModal(){
  const pending=updateNotifBadge();
  const el=qs('notifList');
  if(!el)return;
  if(!pending||!pending.length){
    el.innerHTML='<div class="empty-state" style="padding:24px"><p>✅ All reminders sent!<br><span style="font-size:12px;color:var(--muted)">No pending WhatsApp reminders.</span></p></div>';
  }else{
    const SURGICAL=['RCT','Extraction','Crown/Bridge','Filling'];
    const rows=pending.map(a=>{
      const days=Math.floor((new Date(a.date+'T00:00:00')-new Date())/86400000);
      const urgent=SURGICAL.includes(a.purpose)?days<=0:'';
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">'+
        '<span style="font-size:16px">'+(urgent?'🔴':'🟡')+'</span>'+
        '<div style="flex:1"><div style="font-size:13px;font-weight:500;color:var(--ink)">'+a.patientName+'</div>'+
        '<div style="font-size:11px;color:var(--muted)">'+(a.purpose||'—')+' · '+a.date+' '+(a.time||'')+'</div></div>'+
        '<button class="btn-save" style="padding:6px 12px;font-size:11px" onclick="closeModal(null,\'notifModal\');shareAptWhatsApp(\''+a.id+'\')">📤 Send</button></div>';
    }).join('');
    el.innerHTML='<div style="margin-bottom:8px;font-size:12px;color:var(--muted)">'+pending.length+' appointment(s) need WhatsApp reminders</div>'+rows;
  }
  qs('notifModal').style.display='flex';
}
function shareAptWhatsApp(id){
  const list=getApts();
  const a=list.find(x=>x.id===id);
  if(!a)return;
  a.whatsappSent=1;
  const idx=list.findIndex(x=>x.id===id);
  if(idx>=0)list[idx]=a;
  saveApts(list);
  updateNotifBadge();
  const rx=(_histCache||[]).filter(r=>r.patientName===a.patientName).sort((a,b)=>(b.dateISO||'').localeCompare(a.dateISO||''))[0];
  const today=dateStr(new Date());
  const nextApt=list.filter(x=>x.patientName===a.patientName&&x.date>today).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''))[0];
  const d=a.date?new Date(a.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—';
  const rxDate=rx?new Date(rx.dateISO).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—';
  const visitBenefits={
    'Consultation':'🟢 Why come? Get a thorough exam, catch issues early, and a personalized care plan for a healthy smile.',
    'Follow-up':'🟢 Why come? Ensure healing is on track, catch any complications early, and get peace of mind.',
    'RCT':'🟢 Why come? Confirm the tooth is healing properly, prevent re-infection, and avoid losing the tooth.',
    'Extraction':'🟢 Why come? Check healing is complete, ensure no dry socket or infection, and discuss replacement options.',
    'Scaling':'🟢 Why come? Keep gums healthy, prevent gum disease and tooth loss, maintain fresh breath.',
    'Crown/Bridge':'🟢 Why come? Ensure the restoration fits well, prevent damage to nearby teeth, restore full chewing power.',
    'Filling':'🟢 Why come? Confirm the filling is secure, prevent further decay, and protect the tooth long-term.',
    'Other':'🟢 Why come? Follow-up ensures proper recovery and long-lasting results.'
  };
  const benefit=visitBenefits[a.purpose]||'🟢 Why come? Follow-up ensures proper recovery and long-lasting results.';
  const SURGICAL=['RCT','Extraction','Crown/Bridge','Filling','Other'];
  const isSurgical=SURGICAL.includes(a.purpose);
  let text='🦷 *Sai Dental Clinic*\n━━━━━━━━━━━━━━━━\n';
  text+=isSurgical?'🏥 *Surgery / Procedure Completed*':'📅 *Appointment Reminder*';
  text+='\n━━━━━━━━━━━━━━━━\n\n👤 Patient: '+a.patientName;
  if(rx&&rx.dateISO)text+='\n📆 Treatment Date: '+rxDate+'\n🏥 Procedure: '+(rx.patientDx||a.purpose||'—');
  text+='\n\n━━━ *Follow-up Visit* ━━━\n📆 Date: '+d+'\n⏰ Time: '+(a.time||'—');
  if(a.purpose&&a.purpose!=='Consultation')text+='\n📋 Purpose: '+a.purpose;
  text+='\n\n━━━ *Benefits* ━━━\n'+benefit;
  if(rx&&rx.medicines&&rx.medicines.length)text+='\n💊 Prescribed: '+(rx.medicines||[]).map(m=>m.name).join(', ').slice(0,200);
  if(rx&&rx.followup)text+='\n📅 Follow-up: '+rx.followup;
  if(nextApt){
    const nd=new Date(nextApt.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
    text+='\n\n━━━ *Next Appointment* ━━━\n📆 '+nd+' at '+(nextApt.time||'—')+' ('+(nextApt.purpose||'Visit')+')';
  }
  if(a.notes&&!a.notes.startsWith('Auto-created'))text+='\n\n📝 '+a.notes;
  text+='\n\n━━━━━━━━━━━━━━━━\nThank you — Sai Dental Clinic 🙏';
  const phone=a.contact?a.contact.replace(/[^\d]/g,''):'918122835737';
  const url='https://wa.me/'+phone+'?text='+encodeURIComponent(text);
  window.open(url,'sai_wa_share');
}
function aptMonth(dir){
  _aptMonth+=dir;
  if(_aptMonth<0){_aptMonth=11;_aptYear--;}
  if(_aptMonth>11){_aptMonth=0;_aptYear++;}
  renderApts();
}
function todayApt(){
  const d=new Date();
  _aptYear=d.getFullYear();_aptMonth=d.getMonth();
  _aptSelDate=dateStr(d);
  renderApts();
}
function renderApts(){
  const list=getApts();
  const grid=qs('aptCalGrid');if(!grid)return;
  const title=qs('aptCalTitle');
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  title.textContent=months[_aptMonth]+' '+_aptYear;
  const now=new Date();
  const todayStr=dateStr(now);
  const firstDow=new Date(_aptYear,_aptMonth,1).getDay();
  const daysInMonth=new Date(_aptYear,_aptMonth+1,0).getDate();
  const daysInPrev=new Date(_aptYear,_aptMonth,0).getDate();
  /* Build day->apts map */
  const dayMap={};
  list.forEach(a=>{if(a.date){if(!dayMap[a.date])dayMap[a.date]=[];dayMap[a.date].push(a);}});
  let html='';
  /* Day-of-week header */
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d=>{html+='<div class="apt-cal-dow">'+d+'</div>';});
  /* Previous month filler */
  for(let i=firstDow-1;i>=0;i--){
    const d=daysInPrev-i;
    html+='<div class="apt-cal-day other">'+d+'</div>';
  }
  /* Current month days */
  for(let d=1;d<=daysInMonth;d++){
    const ds=_aptYear+'-'+String(_aptMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const isToday=ds===todayStr;
    const isSel=ds===_aptSelDate;
    const dayApts=dayMap[ds];
    const allDone=dayApts&&dayApts.every(a=>a.status==='done');
    const cls='apt-cal-day'+(isToday?' today':'')+(isSel?' sel':'');
    html+='<div class="'+cls+'" onclick="selAptDay(\''+ds+'\')">'+
      '<span>'+d+'</span>'+
      (dayApts?'<span class="apt-cal-count">'+dayApts.length+(allDone?' ✅':'')+'</span>':'')+
      '</div>';
  }
  /* Next month filler */
  const totalCells=firstDow+daysInMonth;
  const rem=(7-totalCells%7)%7;
  for(let d=1;d<=rem;d++){
    html+='<div class="apt-cal-day other">'+d+'</div>';
  }
  grid.innerHTML=html;
  /* Render selected day's appointments */
  renderDayApts(dayMap[_aptSelDate]||[],todayStr);
}
function selAptDay(ds){
  _aptSelDate=ds;
  renderApts();
}
function renderDayApts(apts,todayStr){
  const el=qs('aptDayApts');
  const isS=isStaff();
  if(!apts.length){
    el.innerHTML='<div class="apt-cal-empty">No appointments on '+_aptSelDate+'</div>'+
      '<button class="btn-add" onclick="showAptForm()" style="display:block;margin:8px auto 0">+ Add Appointment</button>';
    updateAptBadge();
    return;
  }
  let html='<div style="font-size:13px;font-weight:500;color:var(--muted);margin-bottom:8px">'+_aptSelDate+' — '+apts.length+' appointment(s)</div>'+
    '<div class="apt-day-list">';
  apts.forEach(a=>{
    const isToday=a.date===todayStr;
    const st=a.status||'pending';
    html+='<div class="apt-item" style="'+(isToday?'border-color:var(--teal-m);background:var(--teal-l)':'')+'">'+
      '<div class="apt-time">'+(a.time||'—')+'</div>'+
      '<div><div class="apt-info-name">'+a.patientName+(
        (st==='done'?' <span class="apt-status done">✅ Done</span>':' <span class="apt-status pending">🔴 Pending</span>')
      )+(isToday?' <span style="font-size:10px;color:var(--teal)">Today</span>':'')+'</div>'+
      '<div class="apt-info-sub">'+(a.purpose||'—')+(a.contact?' · '+a.contact:'')+'</div></div>'+
      '<div class="apt-actions">'+
      '<button onclick="shareAptWhatsApp(\''+a.id+'\')" title="Share via WhatsApp">📤</button>'+
      (isS?'':(
        '<button onclick="showAptForm('+JSON.stringify(a).replace(/"/g,'&quot;')+')" title="Edit">✏️</button>'+
        '<button onclick="showAptNoteModal(\''+a.id+'\')" title="Notes">📝</button>'+
        '<button class="apt-del" onclick="deleteApt(\''+a.id+'\')" title="Delete">🗑️</button>'
      ))+
      '</div></div>';
  });
  html+='</div>';
  el.innerHTML=html;
  updateAptBadge();
}
function showAptNoteModal(id){
  if(isStaff()){showToast('Staff cannot edit appointments','err');return;}
  const list=getApts();
  const a=list.find(x=>x.id===id);
  if(!a)return;
  qs('aptNoteModal').dataset.aptId=id;
  qs('aptNotePatient').textContent=a.patientName+' ('+(a.time||'—')+')';
  const st=a.status||'pending';
  qs('aptNoteStatus').innerHTML='<span class="apt-status '+st+'">'+(st==='done'?'✅ Done':'🔴 Pending')+'</span>';
  qs('aptDoneBtn').textContent=st==='done'?'Mark Pending':'Mark Done';
  qs('aptNoteText').value=a.adminNotes||'';
  qs('aptNoteModal').style.display='flex';
}
function toggleAptDone(){
  const id=qs('aptNoteModal').dataset.aptId;
  if(!id)return;
  const list=getApts();
  const a=list.find(x=>x.id===id);
  if(!a)return;
  a.status=a.status==='done'?'pending':'done';
  saveApts(list);
  const st=a.status;
  qs('aptNoteStatus').innerHTML='<span class="apt-status '+st+'">'+(st==='done'?'✅ Done':'🔴 Pending')+'</span>';
  qs('aptDoneBtn').textContent=st==='done'?'Mark Pending':'Mark Done';
  renderApts();
  showToast('Appointment '+(st==='done'?'completed':'reopened'));
}
function saveAptNote(){
  const id=qs('aptNoteModal').dataset.aptId;
  if(!id)return;
  const list=getApts();
  const a=list.find(x=>x.id===id);
  if(!a)return;
  a.adminNotes=qs('aptNoteText').value.trim();
  saveApts(list);
  closeModal(null,'aptNoteModal');
  renderApts();
  showToast('Notes saved');
}
function updateAptBadge(){
  const badge=qs('aptBadge');
  if(!badge)return;
  const today=dateStr(new Date());
  const list=getApts();
  const cnt=list.filter(a=>a.date===today).length;
  badge.textContent=cnt;
  badge.style.display=cnt?'inline':'none';
  updateNotifBadge();
}

/* ─── INVENTORY ─── */
function getInv(){
  try{return JSON.parse(localStorage.getItem('sd-inv')||'[]');}catch{return [];}
}
function saveInv(list){
  localStorage.setItem('sd-inv',JSON.stringify(list));
}
function showInvForm(data){
  const f=qs('invFormModal');
  qs('invFormTitle').textContent=data?'Edit Stock':'Add Stock';
  qs('invName').value=data?.name||'';
  qs('invQty').value=data?.qty||'';
  qs('invAlert').value=data?.alert||10;
  qs('invUnit').value=data?.unit||'Tablets';
  qs('invPrice').value=data?.price||'';
  /* Populate datalist from MEDS */
  const dl=qs('invMedsList');
  dl.innerHTML=MEDS.map(m=>'<option value="'+m.name+'">').join('');
  qs('invFormModal').dataset.editId=data?.id||'';
  f.style.display='flex';
}
function saveInvItem(){
  const name=qs('invName').value.trim();
  const qty=parseInt(qs('invQty').value)||0;
  if(!name){showToast('Enter medicine name','err');return;}
  const editId=qs('invFormModal').dataset.editId;
  const list=getInv();
  const entry={id:editId||'inv_'+Date.now(),name,qty,alert:parseInt(qs('invAlert').value)||10,unit:qs('invUnit').value,price:parseFloat(qs('invPrice').value)||0};
  if(editId){const idx=list.findIndex(a=>a.id===editId);if(idx>=0)list[idx]=entry;else list.push(entry);}
  else list.push(entry);
  saveInv(list);
  closeModal(null,'invFormModal');
  renderInv();
  showToast(editId?'Stock updated':'Stock added');
}
function deleteInv(id){
  if(!confirm('Remove this item from inventory?'))return;
  const list=getInv().filter(a=>a.id!==id);
  saveInv(list);
  renderInv();
  showToast('Item removed');
}
function adjustInvQty(id,delta){
  const list=getInv();
  const item=list.find(a=>a.id===id);
  if(!item)return;
  item.qty=Math.max(0,(item.qty||0)+delta);
  saveInv(list);
  renderInv();
}
function renderInv(){
  const list=getInv();
  const search=(qs('invSearch')?.value||'').toLowerCase();
  const filter=qs('invFilter')?.value||'all';
  qs('invCount').textContent=list.length+' item(s)';
  const low=list.filter(i=>i.qty<=i.alert).length;
  const out=list.filter(i=>!i.qty).length;
  qs('invLowCount').textContent=low?'⚠️ '+low+' low, '+out+' out of stock':'';
  let filtered=list.filter(i=>{
    if(filter==='low'&&i.qty>i.alert)return false;
    if(filter==='out'&&i.qty>0)return false;
    if(search&&!i.name.toLowerCase().includes(search)&&!i.unit.toLowerCase().includes(search))return false;
    return true;
  });
  const el=qs('invList');
  if(!filtered.length){
    el.innerHTML='<div class="inv-empty">'+(list.length?'No items match your filter':'No inventory yet. Add your first stock item.')+'</div>';
    return;
  }
  el.innerHTML=filtered.map(i=>{
    const status=i.qty<=0?'out':i.qty<=i.alert?'low':'ok';
    return '<div class="inv-item">'+
      '<div><div class="inv-name">'+i.name+'</div></div>'+
      '<div class="inv-qty '+status+'">'+(i.qty||0)+'</div>'+
      '<div class="inv-unit">'+i.unit+'</div>'+
      '<div class="inv-actions">'+
      '<button onclick="adjustInvQty(\''+i.id+'\',1)" title="+1">➕</button>'+
      '<button onclick="adjustInvQty(\''+i.id+'\',-1)" title="-1" '+(i.qty<=0?'disabled':'')+' style="'+(i.qty<=0?'opacity:0.3':'')+'">➖</button>'+
      '<button onclick="showInvForm('+JSON.stringify(i).replace(/"/g,'&quot;')+')" title="Edit">✏️</button>'+
      '<button class="inv-del" onclick="deleteInv(\''+i.id+'\')" title="Delete">🗑️</button>'+
      '</div></div>';
  }).join('');
}

/* ─── FOLLOW-UPS ─── */
function getFollowups(){
  return _histCache.filter(r=>r.followupDate)
    .map(r=>({...r,overdue:r.followupDate<todayIso()}))
    .sort((a,b)=>{
      if(a.overdue&&!b.overdue)return -1;
      if(!a.overdue&&b.overdue)return 1;
      return (a.followupDate||'').localeCompare(b.followupDate||'');
    });
}
async function showFupNotification(){
  try{
    const snap=await window._fb.getDocs(FUP_COL());
    const fupMap={};
    snap.docs.forEach(d=>{fupMap[d.id]=d.data();});
    const now=todayIso();
    const due=_histCache.filter(r=>{
      if(!r.followupDate||r.followupDate>now)return false;
      const fup=fupMap[r.id];
      const status=fup?fup.status:(r.followupStatus||'pending');
      return status!=='done';
    });
    /* Also check rescheduled items */
    for(const [id,fup] of Object.entries(fupMap)){
      if(fup.followupDate&&fup.followupDate<=now&&fup.status!=='done'&&!_histCache.find(r=>r.id===id&&r.followupDate)){
        const rx=_histCache.find(r=>r.id===id);
        if(rx)due.push(rx);
      }
    }
    if(!due.length)return;
    const body=qs('fupNotifyBody');
    if(!body)return;
    body.innerHTML='<div style="margin-bottom:12px;font-size:13px;color:var(--muted)">The following patients need follow-up:</div>'+
      due.slice(0,10).map(r=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">'+
        '<div><strong>'+r.patientName+'</strong><br><span style="font-size:11px;color:var(--muted)">'+r.rxno+' · Follow-up: '+r.followupDate+'</span></div>'+
        '<button class="btn-sm" onclick="closeModal(null,\'fupNotifyModal\');document.querySelector(\'.tab:nth-child(6)\').click()">View</button></div>'
      ).join('')+
      (due.length>10?'<div style="text-align:center;padding:8px;font-size:12px;color:var(--muted)">+'+(due.length-10)+' more</div>':'')+
      '<div style="margin-top:14px;text-align:center">'+
      '<button class="btn-save" onclick="closeModal(null,\'fupNotifyModal\')">Got it</button></div>';
    qs('fupNotifyModal').style.display='flex';
  }catch(e){}
}
async function updateFupBadge(){
  const badge=qs('fupBadge');
  if(!badge)return;
  try{
    let count=0;
    const snap=await window._fb.getDocs(FUP_COL());
    const fupMap={};
    snap.docs.forEach(d=>{fupMap[d.id]=d.data();});
    const now=todayIso();
    for(const r of _histCache){
      if(!r.followupDate)continue;
      const fup=fupMap[r.id];
      const status=fup?fup.status:(r.followupStatus||'pending');
      const fupDate=fup?.followupDate||r.followupDate;
      if(fupDate&&fupDate<=now&&status!=='done')count++;
    }
    /* Also count rescheduled items from followups collection */
    for(const [id,fup] of Object.entries(fupMap)){
      if(fup.followupDate&&fup.followupDate<=now&&fup.status!=='done'&&!_histCache.find(r=>r.id===id&&r.followupDate)){
        count++;
      }
    }
    badge.textContent=count;badge.style.display=count?'':'none';
  }catch(e){badge.style.display='none';}
}
async function renderFollowups(){
  const el=qs('fupList');
  let fupMap={};
  try{
    const snap=await window._fb.getDocs(FUP_COL());
    snap.docs.forEach(d=>{fupMap[d.id]=d.data();});
  }catch(e){}
  /* Items from prescriptions with followupDate */
  const rxItems=getFollowups().map(r=>{
    const fup=fupMap[r.id]||{};
    const notes=fup.notes||r.followupNotes||[];
    const status=fup.status||r.followupStatus||'pending';
    const fupDate=fup.followupDate||r.followupDate;
    return {...r,_fupNotes:notes,_fupStatus:status,_fupDate:fupDate};
  });
  /* Also include items that only exist in followups collection (rescheduled) */
  for(const [id,fup] of Object.entries(fupMap)){
    if(fup.followupDate&&!rxItems.find(x=>x.id===id)){
      const rx=_histCache.find(r=>r.id===id);
      if(rx)rxItems.push({...rx,_fupNotes:fup.notes||[],_fupStatus:fup.status||'pending',_fupDate:fup.followupDate});
    }
  }
  const now=todayIso();
  const pending=rxItems.filter(r=>{
    if(!r._fupDate)return false;
    if(r._fupStatus!=='done')return true;
    return r._fupDate<=now;
  }).map(r=>({...r,overdue:r._fupDate<now})).sort((a,b)=>{
      if(a.overdue&&!b.overdue)return -1;
      if(!a.overdue&&b.overdue)return 1;
      return (a._fupDate||'').localeCompare(b._fupDate||'');
    });
  if(!pending.length){
    el.innerHTML='<div class="fup-empty">No follow-ups pending</div>';
    qs('fupCount').textContent='0';
    return;
  }
  qs('fupCount').textContent=pending.length;
  el.innerHTML=pending.map(r=>{
    const isResched=r._fupStatus==='done';
    const label=isResched?'🔄 Rescheduled':r.overdue?'🔴 Overdue':'🟡 Pending';
    return '<div class="fup-item">'+
      '<div class="fup-info">'+
      '<div class="fup-name">'+(r.patientName||'—')+' <span class="fup-rxno">'+r.rxno+'</span></div>'+
      '<div class="fup-sub">Rx: '+r.date+' · Follow-up: '+r._fupDate+'</div>'+
      (r._fupNotes?.length?'<div class="fup-notes">'+
        r._fupNotes.slice(-2).map(n=>'<div class="fup-note"><span class="fup-note-by">'+n.by+'</span> '+n.note+' <span class="fup-note-at">'+new Date(n.at).toLocaleDateString('en-IN')+'</span></div>').join('')+
        '</div>':'')+
      '</div>'+
      '<div class="fup-actions">'+
      '<span class="fup-status">'+label+'</span>'+
      '<button class="btn-sm" onclick="loadRx(\''+r.id+'\')">👁️ View</button>'+
      '<button class="btn-sm" onclick="showFupNote(\''+r.id+'\')">📝 Note</button>'+
      '</div></div>';
  }).join('');
}
async function showFupNote(id){
  const rx=_histCache.find(r=>r.id===id);
  if(!rx)return;
  qs('fupNoteModal').dataset.rxId=id;
  qs('fupNoteTitle').textContent='Follow-up: '+(rx.patientName||'')+' ('+rx.rxno+')';
  qs('fupNoteText').value='';
  qs('fupRescheduleChk').checked=false;
  qs('fupRescheduleDays').style.display='none';
  qs('fupRescheduleWrap').style.display='none';
  let curStatus=rx.followupStatus||'pending';
  try{
    const snap=await window._fb.getDoc(window._fb.doc(FUP_COL(),id));
    if(snap.exists())curStatus=snap.data().status||curStatus;
  }catch(e){}
  qs('fupNoteStatus').value=curStatus==='done'?'done':'contacted';
  qs('fupRescheduleWrap').style.display=curStatus==='done'?'block':'none';
  qs('fupNoteModal').style.display='flex';
}
async function saveFupNote(){
  const id=qs('fupNoteModal').dataset.rxId;
  const note=qs('fupNoteText').value.trim();
  const status=qs('fupNoteStatus').value;
  if(!note&&status!=='done'){showToast('Enter a note or mark as done','err');return;}
  const rx=_histCache.find(r=>r.id===id);
  if(!rx){showToast('Prescription not found','err');return;}
  try{
    const ref=window._fb.doc(FUP_COL(),id);
    const snap=await window._fb.getDoc(ref);
    const data=snap.exists()?snap.data():{notes:[],status:'pending'};
    data.notes.push({by:qs('userEmail').textContent,note:note||'(Marked done)',at:new Date().toISOString()});
    /* Reschedule? */
    const resched=qs('fupRescheduleChk').checked;
    if(resched&&status==='done'){
      const days=parseInt(qs('fupRescheduleDays').value)||5;
      const d=new Date();d.setDate(d.getDate()+days);
      data.followupDate=d.toISOString().slice(0,10);
      data.status='pending';
    }else{
      data.status=status;
    }
    await window._fb.setDoc(ref,data);
    closeModal(null,'fupNoteModal');
    renderFollowups();
    showToast('Follow-up updated');
  }catch(e){showToast('Failed to save: '+e.message,'err');}
}

/* ═══ INIT ═══ */
waitFB(()=>{
  window._fb.onAuthStateChanged(window._auth, async user=>{
    if(user){
      qs('loginOverlay').style.display='none';
      qs('appMain').style.display='block';
      qs('userEmail').textContent=user.email;
      qs('userAvatar').textContent=user.email[0].toUpperCase();

      /* Fetch user role (normalize email to lowercase) */
      _currentRole = await getUserRole(user.email.toLowerCase());

      /* Show role badge in sync bar */
      const roleBadge = document.createElement('span');
      roleBadge.id = 'roleBadge';
      roleBadge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:10px;font-weight:500;margin-left:6px';
      roleBadge.style.background = isStaff() ? '#f59e0b' : 'var(--teal)';
      roleBadge.style.color = '#fff';
      roleBadge.textContent = isStaff() ? 'STAFF' : 'ADMIN';
      const existingBadge = document.getElementById('roleBadge');
      if (existingBadge) existingBadge.remove();
      qs('userEmail').after(roleBadge);

      applyRoleUI();

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
      applyRoleUI(); /* refresh follow-up badge after history loads */
      if(isStaff())setTimeout(()=>showFupNotification(),500);
      restoreDraft();
      populateDoctorSelect();
      updateAptBadge();

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