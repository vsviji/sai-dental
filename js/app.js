/* ═══════════════════════════════════════════
   SAI DENTAL CLINIC — PRESCRIPTION SYSTEM
   app.js
═══════════════════════════════════════════ */

/* ─── WAIT FOR FIREBASE MODULE ─── */
function waitFB(cb){ window._fb ? cb() : setTimeout(()=>waitFB(cb),80); }

function toggleLoginPassword(){
  const input=qs('loginPwd');
  const button=qs('togglePassword');
  if(!input||!button)return;
  const show=input.type==='password';
  input.type=show?'text':'password';
  button.setAttribute('aria-pressed',String(show));
  button.setAttribute('aria-label',show?'Hide password':'Show password');
  button.title=show?'Hide password':'Show password';
  input.focus();
}

function escapeHtml(v){
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeHtmlAttr(v){
  return escapeHtml(v).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

let _editingRxId=null;
let _deleteRxId=null;
let _lastDeletedRx=null;
let _undoTimer=null;

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
const PAT_COL  = () => window._patCol();
const TOKEN_COL = () => window._tokenCol();
let _rxUnsubscribe=null;

async function getAllRx(){
  const snap = await window._fb.getDocs(
    window._fb.query(RX_COL(), window._fb.orderBy('dateISO','desc'))
  );
  return snap.docs.map(d=>({...d.data(), id:d.id}));
}
function startRxListener(){
  if(_rxUnsubscribe)_rxUnsubscribe();
  const rxQuery=window._fb.query(RX_COL(),window._fb.orderBy('dateISO','desc'));
  _rxUnsubscribe=window._fb.onSnapshot(rxQuery,snapshot=>{
    _histCache=snapshot.docs.map(doc=>({...doc.data(),id:doc.id}));
    filterHist();
    updateStats();
    if(qs('patientProfileSection')?.style.display!=='none'&&_activePatientMobile){
      renderPatientProfile(_activePatientMobile);
    }
  },error=>{
    console.error('Prescription sync error:',error);
    showToast('Prescription sync failed: '+error.message,'err');
  });
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
let _currentRole = 'staff';

async function getUserRole(email) {
  if (!email) return 'staff';
  try {
    const users = window._fb.collection(window._db, 'users');
    const docRef = window._fb.doc(users, email);
    const snap = await window._fb.getDoc(docRef);
    if (snap.exists()) {
      const role = String(snap.data().role || 'staff').trim().toLowerCase();
      console.log('Role fetched for', email, ':', role);
      return role;
    }
    /* Also support user documents with auto-generated IDs and an email field. */
    const byEmail = await window._fb.getDocs(
      window._fb.query(users, window._fb.where('email', '==', email))
    );
    if (!byEmail.empty) {
      const role = String(byEmail.docs[0].data().role || 'staff').trim().toLowerCase();
      console.log('Role fetched for', email, 'from email field:', role);
      return role;
    }
    console.warn('No role doc found for', email, '- defaulting to staff');
  } catch (e) { console.warn('Role fetch error for', email, ':', e.message, '- defaulting to staff'); }
  return 'staff';
}

function isAdmin() { return _currentRole === 'admin'; }
function isStaff() { return _currentRole === 'staff'; }
function isDoctor() { return _currentRole === 'doctor'; }

/* ═══ TOKEN REGISTRATION ═══ */
let _tokenUnsubscribe = null;
let _tokenCache = [];
let _allTokenCache = [];
let _tokenDateKey = tokenDateKey();
let _activeTokenId = null;
const TOKEN_FEE = 200;

function tokenDateKey(date=new Date()) {
  return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
}
function tokenDateLabel(dateKey=tokenDateKey()) {
  const parts=dateKey.split('-').map(Number);
  const date=parts.length===3?new Date(parts[0],parts[1]-1,parts[2]):new Date();
  return date.toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
}
function escapeTokenHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function startTokenListener() {
  if (_tokenUnsubscribe) _tokenUnsubscribe();
  const q = window._fb.query(TOKEN_COL());
  _tokenUnsubscribe = window._fb.onSnapshot(q, snap => {
    _allTokenCache = snap.docs.map(d => ({...d.data(), id:d.id}));
    _tokenCache = _allTokenCache.filter(t => t.dateKey === _tokenDateKey)
      .sort((a,b) => (a.tokenNumber||0) - (b.tokenNumber||0));
    renderTokens();
  }, e => {
    const status = qs('tokenSyncStatus');
    if (status) status.textContent = 'Unable to sync tokens';
    console.warn('Token listener error:', e.message);
  });
  const date = qs('tokenToday');
  if (date) date.textContent = 'Today: '+tokenDateLabel();
  const picker = qs('tokenDatePicker');
  if (picker) picker.value = _tokenDateKey;
}

function changeTokenDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
  _tokenDateKey = dateKey;
  _tokenCache = _allTokenCache.filter(t => t.dateKey === dateKey)
    .sort((a,b) => (a.tokenNumber||0) - (b.tokenNumber||0));
  const date = qs('tokenToday');
  if (date) date.textContent = tokenDateLabel(dateKey);
  const label = qs('tokenListDate');
  if (label) label.textContent = dateKey === tokenDateKey() ? 'Today' : tokenDateLabel(dateKey);
  renderTokens();
}

function setExportMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  qs('tokenExportFrom').value = month+'-01';
  qs('tokenExportTo').value = month+'-'+String(lastDay).padStart(2,'0');
}

function exportTokensExcel() {
  let from = qs('tokenExportFrom').value;
  let to = qs('tokenExportTo').value;
  const month = qs('tokenExportMonth').value;
  if (month) { setExportMonth(month); from=qs('tokenExportFrom').value; to=qs('tokenExportTo').value; }
  if (from && to && from > to) { showToast('From date must be before To date','err'); return; }
  const tokens = _allTokenCache.filter(t => (!from || t.dateKey >= from) && (!to || t.dateKey <= to));
  if (!tokens.length) { showToast('No tokens found for this period','warn'); return; }
  const rows = tokens.sort((a,b)=>(a.dateKey||'').localeCompare(b.dateKey||'')||(a.tokenNumber||0)-(b.tokenNumber||0)).map(t => {
    const rx = _histCache.find(r => r.tokenId === t.id);
    const treatmentFee = rx?.treatmentFee || 0;
    const medicineSubtotal = rx ? Math.max(0,(rx.grand||0)-treatmentFee) : 0;
    return {
      'Token Date':t.dateKey||'', 'Token Number':t.tokenNumber||'', 'Patient Name':t.patientName||'',
      'Contact':t.patientContact||'', 'Age':t.patientAge||'', 'Gender':t.patientGender||'',
      'Blood Pressure':t.bloodPressure||'', 'Allergies':t.allergies||'', 'Medication / Past History':t.medicationHistory||'',
      'Consultation Fee':t.fee ?? TOKEN_FEE, 'Payment Method':t.paymentMethod||'', 'Payment Status':t.paymentStatus||'',
      'Token Status':t.status||'', 'Receipt Number':t.receiptNumber||'', 'Registered By':t.createdBy||'',
      'Prescription':rx?'Yes':'No', 'Diagnosis':rx?.patientDx||'', 'Treatment Fee':treatmentFee,
      'Medicine Subtotal':medicineSubtotal, 'Grand Total':rx?.grand ?? t.fee ?? TOKEN_FEE,
      'Prescription Medicines':rx?(rx.medicines||[]).map(m=>m.name).filter(Boolean).join(', '):''
    };
  });
  if (typeof XLSX === 'undefined') { showToast('Excel export library is not loaded','err'); return; }
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = Object.keys(rows[0]).map(key => ({wch:Math.min(28,Math.max(12,key.length+2))}));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Token Details');
  const suffix = from && to ? from+'_to_'+to : 'all_dates';
  XLSX.writeFile(book, 'SaiDental_Tokens_'+suffix+'.xlsx');
  showToast('Downloaded '+rows.length+' token record(s)');
}

function setPrescriptionExportMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  qs('rxExportFrom').value = month+'-01';
  qs('rxExportTo').value = month+'-'+String(lastDay).padStart(2,'0');
}

function prescriptionDateKey(rx) {
  if (rx.dateISO) {
    const d = new Date(rx.dateISO);
    if (!Number.isNaN(d.getTime())) {
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    }
  }
  const parsed = new Date(rx.date||'');
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0,10);
}

function exportPrescriptionsExcel() {
  let from = qs('rxExportFrom').value;
  let to = qs('rxExportTo').value;
  const month = qs('rxExportMonth').value;
  if (month) { setPrescriptionExportMonth(month); from=qs('rxExportFrom').value; to=qs('rxExportTo').value; }
  if (from && to && from > to) { showToast('From date must be before To date','err'); return; }
  const tokenById = Object.fromEntries((_allTokenCache||[]).map(t => [t.id, t]));
  const prescriptions = _histCache.filter(rx => {
    const date = prescriptionDateKey(rx);
    return (!from || date >= from) && (!to || date <= to);
  });
  if (!prescriptions.length) { showToast('No prescriptions found for this period','warn'); return; }
  const rows = prescriptions.map(rx => {
    const token = tokenById[rx.tokenId];
    const medicines = (rx.medicines||[]).filter(m=>m.name).map(m =>
      [m.name, m.food||m.dosage, m.freq, m.dur].filter(Boolean).join(' - ')
    ).join('; ');
    return {
      'Date': rx.date||prescriptionDateKey(rx),
      'Rx No': rx.rxno||'',
      'Patient Name': rx.patientName||'',
      'Treatment': rx.patientDx||'',
      'Treatment Plan':rx.treatmentPlan||rx.notes||'',
      'Treatment Fee': Number(rx.treatmentFee)||0,
      'Medicines': medicines,
      'Payment Method': rx.paymentMethod||token?.paymentMethod||'',
      'Medicine Subtotal': Math.max(0,(rx.grand||0)-(Number(rx.treatmentFee)||0)),
      'Grand Total': rx.grand||0,
      'Paid': rx.paid||0,
      'Payment Status': rx.paymentStatus||'pending'
    };
  });
  if (typeof XLSX === 'undefined') { showToast('Excel export library is not loaded','err'); return; }
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = Object.keys(rows[0]).map(key => ({wch:Math.min(32,Math.max(12,key.length+2))}));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Prescription Details');
  const suffix = from && to ? from+'_to_'+to : 'all_dates';
  XLSX.writeFile(book, 'SaiDental_Prescriptions_'+suffix+'.xlsx');
  showToast('Downloaded '+rows.length+' prescription record(s)');
}

function renderTokens() {
  const list = qs('tokenList');
  if (!list) return;
  const waiting = _tokenCache.filter(t => t.status === 'waiting').length;
  const latest = _tokenCache[_tokenCache.length-1];
  qs('tokenWaitingCount').textContent = waiting;
  qs('tokenTotalCount').textContent = _tokenCache.length;
  qs('tokenLatest').textContent = latest ? latest.tokenNumber : '—';
  const badge = qs('tokenBadge');
  if (badge) { badge.textContent = waiting; badge.style.display = 'inline'; }
  if (!_tokenCache.length) {
    list.innerHTML = '<div class="empty-state"><p>No tokens registered for this date.</p><span>Registered tokens will appear here immediately.</span></div>';
    return;
  }
  list.innerHTML = _tokenCache.slice().reverse().map(token => {
    const status = token.status || 'waiting';
    const statusLabel = status === 'completed' ? 'Completed' : status === 'called' ? 'Called' : 'Waiting';
    return '<div class="token-row">' +
      '<div class="token-number">'+escapeTokenHtml(token.tokenNumber)+'</div>' +
      '<div class="token-patient" onclick="openPrescriptionForToken(\''+escapeTokenHtml(token.id)+'\')" style="cursor:pointer"><strong>'+escapeTokenHtml(token.patientName)+'</strong>' +
      '<span>BP: '+escapeTokenHtml(token.bloodPressure||'—')+' · Allergy: '+escapeTokenHtml(token.allergies||'—')+'</span></div>' +
      '<div class="token-meta"><strong>₹'+(token.fee ?? TOKEN_FEE)+'</strong><span>'+escapeTokenHtml(token.paymentMethod||'—')+'</span><span>'+escapeTokenHtml(statusLabel)+'</span></div>' +
      '<button class="btn-sm token-receipt-btn" onclick="showTokenReceipt(\''+escapeTokenHtml(token.id)+'\')">Receipt</button>' +
      '<button class="btn-sm" onclick="openPrescriptionForToken(\''+escapeTokenHtml(token.id)+'\')">'+(isStaff()?'View Prescription':'Write Prescription')+'</button>' +
      (status !== 'completed' && isStaff() ? '<button class="btn-sm" onclick="completeToken(\''+escapeTokenHtml(token.id)+'\')">Complete</button>' : '') +
      '</div>';
  }).join('');
}

function checkTokenPatient(){
  const mobile = normalizeMobile(qs('tokenPatientContact')?.value);
  const fee = qs('tokenFeeAmount');
  const status = qs('tokenFeeStatus');
  if(!fee || !status || !mobile){
    if(fee) fee.textContent='₹'+TOKEN_FEE;
    if(status) status.textContent='New patient';
    return;
  }
  window._fb.getDoc(window._fb.doc(PAT_COL(), mobile)).then(snap=>{
    const existing = snap.exists();
    fee.textContent='₹'+(existing ? 0 : TOKEN_FEE);
    status.textContent=existing ? 'Regular patient — no fee' : 'New patient';
  }).catch(()=>{});
}

async function createToken() {
  const name = qs('tokenPatientName').value.trim();
  const contact = qs('tokenPatientContact').value.trim();
  const age = qs('tokenPatientAge').value.trim();
  const gender = qs('tokenPatientGender').value;
  const bp = qs('tokenBP').value.trim();
  const allergies = qs('tokenAllergies').value.trim();
  const medicationHistory = qs('tokenMedicationHistory').value.trim();
  const paymentMethod = qs('tokenPaymentMethod').value.trim();
  if (!name || !contact || !bp || !medicationHistory) { showToast('Enter name, contact, BP, and medication history','err'); return; }
  const btn = qs('createTokenBtn');
  btn.disabled = true; btn.textContent = 'Confirming…';
  try {
    const dateKey = tokenDateKey();
    const counterRef = window._fb.doc(SETT_COL(), 'tokenCounter_'+dateKey);
    const tokenNumber = await window._fb.runTransaction(window._db, async transaction => {
      const counter = await transaction.get(counterRef);
      const next = (counter.exists() ? Number(counter.data().value)||0 : 0) + 1;
      const tokenRef = window._fb.doc(TOKEN_COL(), 'token_'+dateKey+'_'+next);
      const patientMobile = normalizeMobile(contact);
      const patientRef = window._fb.doc(PAT_COL(), patientMobile);
      const patient = await transaction.get(patientRef);
      const isExistingPatient = patient.exists();
      const fee = isExistingPatient ? 0 : TOKEN_FEE;
      const recordedPaymentMethod = isExistingPatient ? '' : paymentMethod;
      if (!isExistingPatient && !paymentMethod) throw new Error('Enter payment method for a new patient');
      transaction.set(counterRef, {value:next, dateKey, updatedAt:window._fb.serverTimestamp()});
      transaction.set(tokenRef, {
        tokenNumber: next, dateKey, patientName:name, patientContact:contact,
        patientAge:age, patientGender:gender, bloodPressure:bp, allergies, medicationHistory, fee,
        paymentMethod:recordedPaymentMethod, paymentStatus:isExistingPatient?'not_applicable':'paid', status:'waiting', receiptNumber:'R-'+dateKey.replace(/-/g,'')+'-'+next,
        createdAt:new Date().toISOString(), createdAtServer:window._fb.serverTimestamp(),
        createdBy:window._auth.currentUser?.email||''
      });
      transaction.set(patientRef, {
        mobile:patientMobile, name, age, gender, allergies,
        lastBP:bp, medicalHistory:medicationHistory, lastToken:next,
        lastVisit:new Date().toISOString(), updatedAt:new Date().toISOString(),
        updatedBy:window._auth.currentUser?.email||''
      }, {merge:true});
      return next;
    });
    ['tokenPatientName','tokenPatientContact','tokenPatientAge','tokenBP','tokenAllergies','tokenMedicationHistory','tokenPaymentMethod'].forEach(id => qs(id).value='');
    qs('tokenPatientGender').value='';
    qs('tokenFeeAmount').textContent='₹'+TOKEN_FEE;
    qs('tokenFeeStatus').textContent='New patient';
    showToast('Token '+tokenNumber+' saved');
    setTimeout(() => {
      const token = _allTokenCache.find(t => t.tokenNumber === tokenNumber && t.dateKey === tokenDateKey());
      if (token) showTokenReceipt(token.id);
    }, 300);
  } catch (e) {
    showToast('Token save failed: '+e.message,'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Confirm Payment & Create Token';
  }
}

async function completeToken(id) {
  if (!isStaff()) return;
  try {
    await window._fb.updateDoc(window._fb.doc(TOKEN_COL(), id), {status:'completed', completedAt:new Date().toISOString(), completedBy:window._auth.currentUser?.email||''});
    showToast('Token marked completed');
  } catch (e) { showToast('Could not update token: '+e.message,'err'); }
}

function openPrescriptionForToken(id) {
  const token = _allTokenCache.find(t => t.id === id) || _tokenCache.find(t => t.id === id); if (!token) return;
  if (isStaff()) {
    const rx = _histCache.find(r => r.tokenId === token.id && !r.isTokenOnly);
    if (!rx) {
      showToast('Doctor prescription is not saved for this token yet','warn');
      return;
    }
    loadRx(rx.id);
    return;
  }
  if(isDoctor()||isAdmin())showOldDoctorRx();
  newRxForm();
  _activeTokenId = token.id;
  const context = qs('rxTokenContext');
  if (context) {
    context.textContent = 'Token '+token.tokenNumber+' · '+(token.fee ? 'Consultation fee ₹'+token.fee+' paid by '+(token.paymentMethod||'—') : 'Regular patient · no consultation fee');
    context.style.display = 'block';
  }
  qs('pName').value = token.patientName || '';
  qs('pContact').value = token.patientContact || '';
  qs('pAge').value = token.patientAge || '';
  qs('pGender').value = token.patientGender || '';
  qs('pBP').value = token.bloodPressure || '';
  qs('pAllergy').value = token.allergies || '';
  qs('pMedicationHistory').value = token.medicationHistory || '';
  const rxBtn = document.querySelector(`.tab[onclick*="newRx"]`);
  if (rxBtn) sw('rx', rxBtn);
  showToast('Patient details loaded for Token '+token.tokenNumber);
}

function showTokenReceipt(id) {
  const token = _allTokenCache.find(t => t.id === id) || _tokenCache.find(t => t.id === id); if (!token) return;
  qs('tokenReceipt').innerHTML = '<div class="receipt-brand">SAI DENTAL CLINIC</div>' +
    '<div class="receipt-sub">Consultation Receipt</div><div class="receipt-token">Token '+escapeTokenHtml(token.tokenNumber)+'</div>' +
    '<div class="receipt-line"><span>Receipt No.</span><strong>'+escapeTokenHtml(token.receiptNumber)+'</strong></div>' +
    '<div class="receipt-line"><span>Patient</span><strong>'+escapeTokenHtml(token.patientName)+'</strong></div>' +
    '<div class="receipt-line"><span>Contact</span><strong>'+escapeTokenHtml(token.patientContact||'—')+'</strong></div>' +
    '<div class="receipt-line"><span>Blood Pressure</span><strong>'+escapeTokenHtml(token.bloodPressure)+'</strong></div>' +
    '<div class="receipt-line"><span>Medication History</span><strong>'+escapeTokenHtml(token.medicationHistory||'—')+'</strong></div>' +
    '<div class="receipt-line"><span>Payment Method</span><strong>'+escapeTokenHtml(token.paymentMethod||'—')+'</strong></div>' +
    '<div class="receipt-total"><span>Consultation Fee</span><strong>₹'+(token.fee ?? TOKEN_FEE)+(token.fee ? ' · PAID' : ' · NOT CHARGED')+'</strong></div>' +
    '<div class="receipt-foot">'+escapeTokenHtml(new Date(token.createdAt).toLocaleString('en-IN'))+'<br>Thank you for visiting Sai Dental Clinic</div>';
  qs('tokenReceiptModal').style.display='flex';
}
function printTokenReceipt() {
  document.body.classList.add('token-print');
  window.print();
  setTimeout(() => document.body.classList.remove('token-print'), 500);
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

function getRctFollowupDays(dx){
  const s=(dx||'').toLowerCase();
  const m=s.match(/rct[^0-9]*([0-9]+)/);
  const n=s.match(/root\s*canal[^\d]*(\d+)/);
  const match = m || n;
  const sitting = match ? parseInt(match[1],10) : null;
  if(!sitting) return null;
  if(sitting===1||sitting===2) return 4;
  return null;
}

function getFollowupSuggestion(dx){
  const days=getRctFollowupDays(dx);
  return days ? 'After '+days+' days' : '';
}

function applyAutoFollowupFromDx(){
  const dx=qs('pDx')?.value||'';
  const followInput=qs('followup');
  if(!followInput) return;
  const existing=(followInput.value||'').trim();
  const suggested=getFollowupSuggestion(dx);
  if(existing || !suggested) return;
  followInput.value=suggested;
}
function getPdfElement(){
  const orig=qs('rxTab');
  if(!orig)return null;
  const livePaid=qs('bPaid')?.textContent||'₹0';
  const liveBal=qs('bBalance')?.textContent||'₹0';
  const liveBillDisplay=qs('billPaySection')?.style.display||'none';
  const clone=orig.cloneNode(true);
  clone.id='rxTabPdfClone';
  clone.style.cssText='position:absolute;top:0;left:0;width:210mm;background:#fff;color:#1a1a1a;padding:0;font-family:"DM Sans",sans-serif';
  document.body.classList.add('pdf-mode');
  clone.querySelectorAll('.action-bar,.tbl-foot,.btn-del,.no-print,#tplBtns,#patSearchWrap,.pat-search-wrap,.bill-pay-actions').forEach(el=>el.remove());
  const cBill=clone.querySelector('#billPaySection');
  if(cBill){cBill.style.display=liveBillDisplay;const cp=cBill.querySelector('#bPaid');if(cp)cp.textContent=livePaid;const cb=cBill.querySelector('#bBalance');if(cb)cb.textContent=liveBal;}
  clone.querySelectorAll('input:not([type="hidden"]),select,textarea').forEach(el=>{
    const d=document.createElement('div');
    d.style.cssText='padding:2px 0;font-size:11px;color:#1a1a1a;background:transparent;border:none;min-height:16px';
    if(el.tagName==='SELECT')d.textContent=el.options[el.selectedIndex]?el.options[el.selectedIndex].text:'';
     else d.textContent=el.value||el.placeholder||'—';
    const lbl=el.closest('.fld')?.querySelector('.flbl');
    if(lbl){
      const c=document.createElement('div');
      c.style.cssText='margin-bottom:6px';
      const lb=lbl.cloneNode(true);
      lb.style.cssText='font-size:9px;color:#6b7280;display:block;margin-bottom:1px;text-transform:uppercase;letter-spacing:.5px';
       d.style.cssText='font-size:13px;color:#1a1a1a;padding:8px 12px;border-bottom:1px solid #eee;min-height:34px;line-height:1.35';
      if(el.closest('.inline-med-history')){
         d.style.minHeight='34px';
         d.style.padding='8px 12px';
        d.style.lineHeight='1.35';
        d.style.whiteSpace='normal';
      }
      c.append(lb,d);
      el.parentNode.replaceChild(c,el);
    }else el.parentNode.replaceChild(d,el);
  });
  document.body.appendChild(clone);
  return clone;
}
function copyToClipboard(text){
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text);return true;}
  }catch(e){}
  try{
    const ta=document.createElement('textarea');
    ta.value=text;
    ta.style.cssText='position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return true;
  }catch(e){}
  return false;
}

/* ═══ UI STATE ═══ */
let rows=[], rid=0, _histCache=[], histPage=1;
const HIST_PER=15;
let _newRxModelEditingId=null;
let _savingNewRxModel=false;
let _pendingNewRxModelData=null;

/* ─── Back button navigation history ─── */
let _navHistory = [];

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
function showUndoToast(msg,onUndo){
  const t=qs('toast');
  clearTimeout(t._t);clearTimeout(_undoTimer);
  t.innerHTML=msg+' <button class="toast-action" id="undoBtn">⏪ Undo</button>';
  t.className='toast show undo';
  const undoBtn=qs('undoBtn');
  if(undoBtn)undoBtn.onclick=()=>{clearTimeout(_undoTimer);t.className='toast';onUndo();};
  _undoTimer=setTimeout(()=>{t.className='toast';_lastDeletedRx=null;},5000);
}

/* ─── TABLE ROWS ─── */
function addRow(d){
  const m=MEDS.find(x=>x.name===d.name)||{dosage:'',rate:0};
  rid++;
  rows.push({id:rid,name:d.name||'',dosage:d.preserveEmptyFields?(d.dosage||''):(d.dosage||m.dosage||''),food:d.food||'',
    freq:d.freq||'',dur:d.dur||'',
    qty:d.preserveEmptyFields&&d.qty===''?'':d.qty!=null?+d.qty:1,
    rate:d.rate!=null?+d.rate:(m.rate||0),
    inst:d.inst||''});
  renderRows();
}
function renderRows(){
  qs('rxBody').innerHTML=rows.map((r,i)=>`
    <tr>
       <td data-label="#" style="text-align:center;color:var(--muted);font-size:12px;padding-left:8px">${i+1}</td>
       <td data-label="Medicine Name"><select style="width:100%" onchange="onMed(${r.id},this.value)">${medOpts(r.name)}</select></td>
       <td data-label="Dosage"><input type="text" value="${r.dosage}" style="width:100%" oninput="rc(${r.id},'dosage',this.value)"/></td>
       <td data-label="Frequency"><select style="width:100%" onchange="rc(${r.id},'freq',this.value)">${listOpts(FREQS,r.freq)}</select></td>
       <td data-label="Duration"><select style="width:100%" onchange="rc(${r.id},'dur',this.value)">${listOpts(DURS,r.dur)}</select></td>
       <td data-label="Qty"><input type="number" value="${r.qty}" min="1" max="999" style="width:58px" oninput="rc(${r.id},'qty',+this.value);renderRows()"/></td>
       <td data-label="Rate (₹)"><input type="number" value="${r.rate}" min="0" step="0.5" style="width:70px" oninput="rc(${r.id},'rate',+this.value);renderRows()"/></td>
       <td data-label="Instructions"><select style="width:100%" onchange="rc(${r.id},'inst',this.value)">${listOpts(INSTS,r.inst)}</select></td>
       <td data-label="Amount (₹)" class="amt-cell">${fmt(r.qty*r.rate)}</td>
       <td data-label=""><button class="btn-del" onclick="delRow(${r.id})" title="Remove">✕</button></td>
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
  const treatmentFee=Math.max(0,Number(qs('treatmentFee')?.value)||0);
  qs('bSub').textContent=fmt(sub);
  qs('bGrand').textContent='₹'+Math.round(sub+treatmentFee);
  qs('subTotal').textContent=rows.length?'Subtotal: '+fmt(sub):'';
}

/* ─── TEMPLATES ─── */
function loadTemplate(type){
  rows=[];rid=0;
  if(type==='rct'||type==='rootcanal'){
    const dxEl=qs('pDx');
    if(dxEl && !dxEl.value) dxEl.value='Root Canal Treatment (RCT)';
    addRow({name:'Amoxicillin + Clavulanic Acid 625mg',freq:'Twice daily',dur:'5 days',qty:10,inst:'After food'});
    addRow({name:'Aceclofenac sp',freq:'Twice daily',dur:'3 days',qty:6,inst:'After food'});
    addRow({name:'Pantoprazole 40mg',freq:'Once daily',dur:'5 days',qty:5,inst:'Before food'});
    qs('notes').value='RCT done. Avoid chewing on treated side until numbness wears off. Maintain oral hygiene properly.';
    applyAutoFollowupFromDx();
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
      <div class="pat-opt-name">${escapeHtml(r.patientName||'—')} <span style="color:var(--teal);font-size:11px">${escapeHtml(r.rxno||'')}</span></div>
      <div class="pat-opt-sub">${escapeHtml(r.patientContact||'')} · ${escapeHtml(r.patientDx||'')} · ${escapeHtml(r.date||'')}</div>
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
  if(qs('pRef'))qs('pRef').value     =rx.patientOPNo||rx.patientRef||'';
  qs('pMedicationHistory').value =rx.patientMedicationHistory||'';
  applyAutoFollowupFromDx();
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
  if(!_savingNewRxModel&&!name){showToast('Enter patient name before saving','err');return false;}
  if(!_savingNewRxModel&&!rows.length){showToast('Add at least one medicine','err');return false;}
  if(!_savingNewRxModel)applyAutoFollowupFromDx();
  const btn=qs('btnSave');
  btn.disabled=true;btn.classList.add('saving');
  try{
    const treatmentFee=Math.max(0,Number(_savingNewRxModel?_pendingNewRxModelData.treatmentFee:qs('treatmentFee')?.value)||0);
    const medicineFee=_savingNewRxModel
      ?Math.max(0,Number(_pendingNewRxModelData.medicineFee)||0)
      :rows.reduce((a,r)=>a+(r.qty*r.rate),0);
    const grand=(_savingNewRxModel?medicineFee:rows.reduce((a,r)=>a+(r.qty*r.rate),0))+treatmentFee;
    const followupText=_savingNewRxModel?'':(qs('followup').value||'');
    let rxno,id,existing;
    if(_editingRxId){
      existing=_histCache.find(r=>r.id===_editingRxId);
      if(!existing){showToast('Original prescription not found','err');btn.disabled=false;btn.classList.remove('saving');return false;}
      rxno=existing.rxno;
      id=_editingRxId;
    }else{
      rxno=await nextRxNo();
      id='rx_'+Date.now();
    }
    const rxdata = _histCache.find(r => r.id === id) || existing || {};
    const wasPaid=rxdata.paymentStatus==='paid'||(Number(rxdata.grand)>0&&Number(rxdata.paid)>=Number(rxdata.grand));
    const rx={
      id,rxno,
      date:new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}),
      dateISO:new Date().toISOString(),
      prescriptionDate:_savingNewRxModel?_pendingNewRxModelData.date:(rxdata.prescriptionDate||''),
      followupDate:calcFollowupIso(followupText)||'',
      followupStatus:followupText?'pending':'',
      followupNotes:rxdata.followupNotes||existing?.followupNotes||[],
      patientName:   _savingNewRxModel?_pendingNewRxModelData.patientName:qs('pName').value,
      patientAge:    _savingNewRxModel?_pendingNewRxModelData.patientAge:qs('pAge').value,
      patientGender: _savingNewRxModel?_pendingNewRxModelData.patientSex:qs('pGender').value,
      patientContact:_savingNewRxModel?_pendingNewRxModelData.patientPhone:qs('pContact').value,
       patientBP:     qs('pBP').value,
       patientDx:     _savingNewRxModel?_pendingNewRxModelData.diagnosis:qs('pDx').value,
       patientAllergy:qs('pAllergy').value,
       patientRef:    _savingNewRxModel?_pendingNewRxModelData.opNumber:(qs('pRef')?.value||''),
        patientOPNo:   _savingNewRxModel?_pendingNewRxModelData.opNumber:(qs('pRef')?.value||''),
        patientMedicationHistory:qs('pMedicationHistory').value,
       tokenId:       _activeTokenId || rxdata.tokenId || '',
       treatmentFee,
       ...(_savingNewRxModel?{medicineFee}:{}),
       paid:_savingNewRxModel?(wasPaid?grand:(Number(_pendingNewRxModelData.paid)||0)):(rxdata.paid||0),
       paymentStatus:_savingNewRxModel?(wasPaid?'paid':(_pendingNewRxModelData.paymentStatus||'pending')):(rxdata.paymentStatus||'pending'),
       paymentMethod:_savingNewRxModel?(_pendingNewRxModelData.paymentMethod||''):(rxdata.paymentMethod||''),
      medicines:     rows.map(r=>({...r})),
      notes:         _savingNewRxModel?_pendingNewRxModelData.treatmentPlan:qs('notes').value,
      treatmentPlan: _savingNewRxModel?_pendingNewRxModelData.treatmentPlan:qs('notes').value,
      prescriptionModel:_savingNewRxModel?'mockup-v1':(rxdata.prescriptionModel||''),
      followup:      followupText,
      grand:         _savingNewRxModel?grand:Math.round(grand),
      xrays:         rxdata.xrays||[]
    };
    try{
      await putRx(rx);
    }catch(e1){
      delete rx.paid;delete rx.paymentStatus;
      await putRx(rx);
    }
    _editingRxId=rx.id;
    _xrayRxId=rx.id;
    const xc=qs('xrayCard');
    if(xc){xc.style.display='block';delete xc.dataset.readonly;}
    renderXrayGallery();
    if(!isStaff()){const ub=qs('xrayUploadBtn');if(ub)ub.style.display='inline-flex';}
    const wasNew = !_histCache.find(r=>r.id===rx.id);
    if(wasNew){
      _histCache.unshift(rx);
      updateStats();
    }else{
      const idx=_histCache.findIndex(r=>r.id===rx.id);
      if(idx>=0)_histCache[idx]=rx;
    }
    _payRxId=rx.id;
    updateBillPay(rx);
    qs('btnSaveLabel').textContent='💾 Update '+rxno;
    updatePatientFromRx(rx);
    if(_savingNewRxModel){
      _newRxModelEditingId=rx.id;
      const setData=qs('doctorRxFrame')?.contentWindow?.setPrescriptionData;
      if(typeof setData==='function')setNewRxFormData(setData,rx);
      updateStaffRxActions();
    }
    showToast('✓ '+rxno+' '+(wasNew?'saved':'updated'));
    return true;
  }catch(e){
    showToast('Save failed: '+e.message,'err');
    return false;
  }finally{
    btn.disabled=false;
    btn.classList.remove('saving');
  }
}

/* ─── HISTORY ─── */
async function loadHist(){
  try{_histCache=await getAllRx();}catch(e){
    console.error('Prescription history load error:',e);
    showToast('Could not refresh prescription history: '+e.message,'err');
  }
  filterHist();updateStats();applyRoleUI();
}
function filterHist(){
  const q=(qs('histSearch')?.value||'').toLowerCase();
  const dx=qs('histFilterDx')?.value||'';
  const sort=qs('histSort')?.value||'newest';
  const dateOrder=sort==='oldest'?1:-1;
  let list=_histCache.filter(r=>{
    const mq=!q||[(r.patientName||''),(r.rxno||''),(r.patientDx||''),(r.patientContact||''),(r.patientOPNo||r.patientRef||''),(r.treatmentPlan||r.notes||'')].some(s=>s.toLowerCase().includes(q));
    return mq&&(!dx||r.patientDx===dx);
  });
  list.sort((a,b)=>{
    const dateA=historyDateKey(a)||'0000-00-00';
    const dateB=historyDateKey(b)||'0000-00-00';
    const byDate=dateOrder*dateA.localeCompare(dateB);
    if(byDate)return byDate;
    if(sort==='name')return (a.patientName||'').localeCompare(b.patientName||'');
    if(sort==='amount')return (Number(b.grand)||0)-(Number(a.grand)||0);
    const timeA=a.dateISO||'';
    const timeB=b.dateISO||'';
    return dateOrder*timeA.localeCompare(timeB);
  });
  histPage=1;renderHistPage(list);
}
function historyDateKey(rx){
  const date=rx.dateISO?new Date(rx.dateISO):(rx.date?new Date(rx.date):null);
  if(date&&!Number.isNaN(date.getTime())){
    return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  }
  return rx.date?'legacy:'+rx.date:'';
}
function historyDateLabel(key){
  if(!key)return 'Date not recorded';
  if(key.startsWith('legacy:'))return key.slice(7);
  const date=new Date(key+'T00:00:00');
  return Number.isNaN(date.getTime())?key:date.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
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
  const groups=[];
  slice.forEach(r=>{
    const key=historyDateKey(r);
    let group=groups[groups.length-1];
    if(!group||group.key!==key){group={key,records:[]};groups.push(group);}
    group.records.push(r);
  });
  el.innerHTML=groups.map(group=>`
    <section class="hist-date-group" aria-label="${escapeHtmlAttr(historyDateLabel(group.key))}">
      <div class="hist-date-heading">
        <h3>${escapeHtml(historyDateLabel(group.key))}</h3>
        <span>${group.records.length} prescription${group.records.length===1?'':'s'}</span>
      </div>
      ${group.records.map(r=>`
    <div class="hist-item">
       <div onclick="${isStaff()?`loadRx('${r.id}')`:`duplicateRx('${r.id}')`}" class="hist-main">
      <div class="hi-name">${escapeHtml(r.patientName||'—')} <span class="hi-amt">₹${Number(r.grand)||0}</span>
        <span class="hi-badge">${escapeHtml(r.rxno||'')}</span>
        <span style="font-weight:400;color:var(--muted);font-size:12px">${r.patientAge?'· '+escapeHtml(r.patientAge)+' yrs':''} ${escapeHtml(r.patientGender||'')}</span>
      </div>
      <div class="hi-pay-row">
        ${payStatusBadge(r)}
        ${!isStaff()?`
        <span class="hist-hover-actions">
          <button class="btn-icon-hist btn-edit-hist" onclick="event.stopPropagation();editRx('${r.id}')" title="Edit">✏️</button>
          <button class="btn-icon-hist btn-del-hist" onclick="event.stopPropagation();showDeleteConfirm('${r.id}')" title="Delete">✕</button>
        </span>`:''}
      </div>
      <div class="hi-sub">${escapeHtml(r.patientDx||'No diagnosis')} ${(r.patientOPNo||r.patientRef)?'· OP '+escapeHtml(r.patientOPNo||r.patientRef):''} ${r.patientContact?'· '+escapeHtml(r.patientContact):''}</div>
      <div class="hi-sub">Treatment ₹${Number(r.treatmentFee)||0} · Medicine ₹${prescriptionMedicineFee(r)} · Total ₹${Number(r.grand)||0}${r.paymentStatus==='paid'?' · Paid'+(r.paymentMethod?' ('+escapeHtml(r.paymentMethod.toUpperCase())+')':''):' · Balance ₹'+Math.max(0,(Number(r.grand)||0)-(Number(r.paid)||0))}</div>
      <div class="hi-meds">${(r.medicines||[]).map(m=>escapeHtml(m.name||'')).filter(Boolean).slice(0,5).join(', ')}${(r.medicines||[]).length>5?'…':''}</div>
      </div>
       <div class="hist-extra-actions">
         ${!isStaff()?`<button class="btn-clr" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();duplicateRx('${r.id}')">🔁 Duplicate</button>`:''}
        ${(r.xrays||[]).length?'<span class="hi-xray" title="X-ray attached">📷</span> ':''}<button class="btn-clr" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();showPatientProfile('${r.id}')">👤 Profile</button>
      </div>
    </div>`).join('')}
    </section>`).join('');
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
  const ids=['pName','pAge','pGender','pContact','pBP','pDx','pAllergy','pMedicationHistory','treatmentFee','notes','followup'];
  ids.forEach(id=>{const el=qs(id);if(el)el.disabled=ro;});
  qs('btnSave').style.display=ro?'none':'';
  qs('addRowBtn').style.display=ro?'none':'';
  qs('tplBtns').style.display=ro?'none':'';
  qs('clearBtn').style.display=ro?'none':'';
  const banner=qs('readOnlyBanner');
  if(banner){
    banner.style.display=ro?'block':'none';
    const newRxBtn=banner.querySelector('[onclick*="newRx"]');
    if(newRxBtn)newRxBtn.style.display=ro?'none':'';
  }
  /* Staff can record payments while prescription fields remain read-only */
  const payActions=qs('billPaySection')?.querySelector('.bill-pay-actions');
  if(payActions)payActions.style.display='';
  /* Disable all medicine row selects/inputs */
  document.querySelectorAll('#rxBody select,#rxBody input').forEach(el=>el.disabled=ro);
  /* X-ray upload */
  const xub=qs('xrayUploadBtn');
  if(xub)xub.style.display=ro?'none':'inline-flex';
}
function loadRx(id){
  const isS=isStaff();
  const rx=_histCache.find(r=>r.id===id);if(!rx)return;
  if(isS){
    loadStaffPrescriptionDetails(rx);
    return;
  }
  if(isDoctor()||isAdmin()||isS)showOldDoctorRx();
  qs('pName').value   =rx.patientName   ||'';
  qs('pAge').value    =rx.patientAge    ||'';
  qs('pGender').value =rx.patientGender ||'';
  qs('pContact').value=rx.patientContact||'';
  qs('pBP').value     =rx.patientBP     ||'';
  qs('pDx').value     =rx.patientDx     ||'';
  qs('pAllergy').value=rx.patientAllergy||'';
  if(qs('pRef'))qs('pRef').value    =rx.patientOPNo||rx.patientRef||'';
  qs('pMedicationHistory').value=rx.patientMedicationHistory||'';
  qs('treatmentFee').value=rx.treatmentFee||0;
  qs('notes').value   =rx.treatmentPlan||rx.notes||'';
  qs('followup').value=rx.followup      ||'';
  applyAutoFollowupFromDx();
  rows=[];rid=0;(rx.medicines||[]).forEach(m=>addRow(m));
  setFormReadOnly(isS);
  _editingRxId=id;
  _payRxId=rx.id;
  _xrayRxId=rx.id;
  qs('btnSaveLabel').textContent=isS?'Viewing '+rx.rxno:'💾 Update '+rx.rxno;
  updateBillPay(rx);
  const xc=qs('xrayCard');
  if(xc){xc.style.display='block';delete xc.dataset.readonly;}
  renderXrayGallery();
  const uploadBtn=qs('xrayUploadBtn');
  if(uploadBtn)uploadBtn.style.display=isS?'none':'inline-flex';
  sw('rx',document.querySelector(`.tab[onclick*="newRx"]`));
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
  if(isStaff()){showToast('Staff cannot delete prescriptions','err');return;}
  const id=_deleteRxId;
  if(!id)return;
  const rx=_histCache.find(r=>r.id===id);
  if(!rx){closeModal(null,'delConfirmModal');return;}
  const btn=qs('confirmDelBtn');
  btn.disabled=true;btn.textContent='Deleting…';
  try{
    await deleteRxById(id);
    const m=(rx.rxno||'').match(/RX-(\d+)/i);
    if(m){
      const rxNum=parseInt(m[1],10);
      try{
        const c=await getSetting('rxCounter')||0;
        if(rxNum>=c){await setSetting('rxCounter',Math.max(0,rxNum-1));}
      }catch(e){}
    }
    _histCache=_histCache.filter(r=>r.id!==id);
    updateStats();filterHist();
    closeModal(null,'delConfirmModal');
    if(!_editingRxId){
      getSetting('rxCounter').then(c=>{
        const rno=qs('rxNo');
        if(rno)rno.textContent='RX-'+String((c||0)+1).padStart(4,'0');
      });
    }
    _lastDeletedRx={...rx};
    showUndoToast('Prescription deleted',()=>undoLastDelete());
  }catch(e){showToast('Delete failed: '+e.message,'err');}
  btn.disabled=false;btn.textContent='Delete';
}

async function undoLastDelete(){
  if(isStaff()){showToast('Staff cannot restore deleted prescriptions','err');return;}
  const rx=_lastDeletedRx;
  if(!rx){showToast('Nothing to undo','warn');return;}
  _lastDeletedRx=null;
  try{
    await putRx(rx);
    _histCache.unshift(rx);
    updateStats();filterHist();
    showToast('Undo: '+rx.rxno+' restored');
  }catch(e){showToast('Undo failed: '+e.message,'err');}
}

async function deleteRx(id){
  if(isStaff()){showToast('Staff cannot delete prescriptions','err');return;}
  showDeleteConfirm(id);
}

function editRx(id){
  if(isStaff()){showToast('Staff cannot edit prescriptions','err');return;}
  const rx=_histCache.find(r=>r.id===id);
  if(!rx){showToast('Prescription not found','err');return;}
  if(rx.prescriptionModel==='mockup-v1'&&(isDoctor()||isAdmin())){
    if(loadNewDoctorRx(rx))showToast('Editing '+rx.rxno+' in the new prescription model');
    return;
  }
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
function setDoctorPrescriptionMode(mode){
  const model=qs('doctorNewRxPanel');
  const legacy=qs('legacyRxPanel');
  const newToolbar=qs('newRxDoctorToolbar');
  const oldToolbar=qs('oldRxDoctorToolbar');
  if(!model||!legacy)return;
  const showNew=mode==='new';
  model.style.display=showNew?'block':'none';
  legacy.style.display=showNew?'none':'block';
  const frame=qs('doctorRxFrame');
  if(showNew&&frame){
    if(!frame.dataset.resizeBound){
      frame.addEventListener('load',()=>{
        resizeDoctorPrescriptionFrame();
        setNewPrescriptionReadOnly(isStaff());
        updateStaffRxActions();
      });
      frame.dataset.resizeBound='1';
    }
    if(!frame.src.includes('v=20261028j'))frame.src='./prescription-mockup.html?v=20261028j';
    else{
      resizeDoctorPrescriptionFrame();
      setNewPrescriptionReadOnly(isStaff());
    }
  }
  if(newToolbar)newToolbar.style.display=showNew?'flex':'none';
  if(oldToolbar)oldToolbar.style.display=showNew?'none':'flex';
}
let _doctorRxFrameResizeObserver=null;
function resizeDoctorPrescriptionFrame(){
  const frame=qs('doctorRxFrame');
  const doc=frame?.contentDocument;
  const paper=doc?.querySelector('.paper');
  if(!frame||!doc?.body||!paper)return;
  const resize=()=>{
    const bottomPadding=parseFloat(doc.defaultView.getComputedStyle(doc.body).paddingBottom)||0;
    const feePanel=doc.querySelector('.fee-panel');
    const bottom=Math.max(paper.getBoundingClientRect().bottom,feePanel?.getBoundingClientRect().bottom||0);
    frame.style.height=Math.ceil(bottom+doc.defaultView.scrollY+bottomPadding)+'px';
  };
  resize();
  _doctorRxFrameResizeObserver?.disconnect();
  _doctorRxFrameResizeObserver=new ResizeObserver(resize);
  _doctorRxFrameResizeObserver.observe(doc.body);
  _doctorRxFrameResizeObserver.observe(paper);
  const feePanel=doc.querySelector('.fee-panel');
  if(feePanel)_doctorRxFrameResizeObserver.observe(feePanel);
}
function setNewPrescriptionReadOnly(readOnly){
  const controls=qs('doctorRxFrame')?.contentDocument?.querySelectorAll('input,select,textarea,button');
  controls?.forEach(control=>{
    if(!readOnly){
      control.disabled=false;
      if(control.tagName==='INPUT'||control.tagName==='TEXTAREA'){
        control.readOnly=control.id==='prescriptionDate';
      }
      return;
    }
    if(control.tagName==='INPUT'||control.tagName==='TEXTAREA'){
      control.readOnly=readOnly;
      control.disabled=false;
    }else{
      control.disabled=readOnly;
    }
  });
  if(readOnly){
    const rx=_histCache.find(record=>record.id===_newRxModelEditingId);
    const frameDoc=qs('doctorRxFrame')?.contentDocument;
    const patientName=frameDoc?.getElementById('patientName');
    if(patientName)patientName.readOnly=false;
    const opNumber=frameDoc?.getElementById('opNumber');
    if(opNumber)opNumber.readOnly=false;
    ['patientAge','patientSex'].forEach(id=>{
      const field=frameDoc?.getElementById(id);
      const value=id==='patientAge'?rx?.patientAge:rx?.patientGender;
      if(field&&!String(value||'').trim())field.readOnly=false;
    });
    const phone=frameDoc?.getElementById('patientPhone');
    if(phone)phone.readOnly=false;
    const medicineFee=frameDoc?.getElementById('medicineFeeInput');
    if(medicineFee)medicineFee.readOnly=false;
    const treatmentFee=frameDoc?.getElementById('treatmentFeeInput');
    if(treatmentFee){
      treatmentFee.readOnly=false;
      treatmentFee.disabled=true;
    }
    const paymentMethod=frameDoc?.getElementById('paymentMethodInput');
    if(paymentMethod)paymentMethod.disabled=false;
  }
  const frameDoc=qs('doctorRxFrame')?.contentDocument;
  const saveBillingButton=frameDoc?.getElementById('saveBillingButton');
  if(saveBillingButton)saveBillingButton.disabled=!_newRxModelEditingId;
}
async function saveNewDoctorRx(){
  if(isStaff()){
    showToast('Staff can view the new prescription model but cannot save prescriptions','err');
    return false;
  }
  const frame=qs('doctorRxFrame');
  const getData=frame?.contentWindow?.getPrescriptionData;
  if(typeof getData!=='function'){
    showToast('Prescription form is still loading. Please try again.','err');
    return false;
  }
  let data;
  try{
    data=getData();
  }catch(e){
    showToast('Unable to read prescription form: '+e.message,'err');
    return false;
  }
  if([data.treatmentFee,data.medicineFee].some(fee=>!Number.isFinite(Number(fee))||Number(fee)<0)){
    showToast('Enter valid treatment and medicine fees (zero or more)','err');
    return false;
  }
  newRxForm();
  _editingRxId=_newRxModelEditingId;
  _activeTokenId=null;
  qs('pName').value=data.patientName;
  qs('pAge').value=data.patientAge;
  qs('pGender').value=data.patientSex;
  qs('pContact').value=data.patientPhone;
  qs('treatmentFee').value=data.treatmentFee;
  qs('pDx').value=data.diagnosis;
  qs('notes').value=data.treatmentPlan;
  rows=[];rid=0;
  data.medicines.forEach(medicine=>{
    const catalog=MEDS.find(m=>m.name===medicine.name);
    addRow({
      name:medicine.name,
      qty:medicine.qty===''?'':Number(medicine.qty),
      dosage:'',
      food:medicine.food,
      freq:medicine.freq,
      dur:medicine.dur,
      preserveEmptyFields:true,
      rate:catalog?.rate||0
    });
  });
  _pendingNewRxModelData=data;
  _savingNewRxModel=true;
  let saved=false;
  try{
    saved=await saveRx();
  }finally{
    _savingNewRxModel=false;
    _pendingNewRxModelData=null;
  }
  if(saved){
    _newRxModelEditingId=_editingRxId;
    updateStaffRxActions();
  }
  return saved;
}
function loadNewDoctorRx(rx){
  const frame=qs('doctorRxFrame');
  const setData=frame?.contentWindow?.setPrescriptionData;
  if(typeof setData!=='function'){
    showToast('Prescription form is still loading. Please try again.','err');
    return false;
  }
  setNewRxFormData(setData,rx);
  _newRxModelEditingId=rx.id;
  showNewDoctorRx();
  setNewPrescriptionReadOnly(false);
  updateStaffRxActions();
  const rxBtn=document.querySelector(`.tab[onclick*="newRx"]`);
  if(rxBtn)sw('rx',rxBtn);
  return true;
}
function loadStaffPrescriptionDetails(rx){
  const setData=qs('doctorRxFrame')?.contentWindow?.setPrescriptionData;
  if(typeof setData!=='function'){
    showToast('Prescription form is still loading. Please try again.','err');
    return false;
  }
  setData({
    patientName:rx.patientName||'',
    opNumber:rx.patientOPNo||rx.patientRef||'',
    patientAge:rx.patientAge||'',
    patientSex:rx.patientGender||'',
    patientPhone:rx.patientContact||'',
    treatmentFee:rx.treatmentFee||0,
    medicineFee:prescriptionMedicineFee(rx),
    paid:rx.paid||0,
    paymentStatus:rx.paymentStatus||'pending',
    paymentMethod:rx.paymentMethod||'',
    date:rx.prescriptionDate||rx.date||'',
    diagnosis:rx.patientDx||'',
    treatmentPlan:rx.treatmentPlan||rx.notes||'',
    medicines:rx.medicines||[]
  });
  _newRxModelEditingId=rx.id;
  showNewDoctorRx();
  setNewPrescriptionReadOnly(true);
  updateStaffRxActions();
  const rxBtn=document.querySelector(`.tab[onclick*="newRx"]`);
  if(rxBtn)sw('rx',rxBtn);
  return true;
}
async function savePrescriptionBilling(){
  if(!(isStaff()||isDoctor()||isAdmin())){
    showToast('You are not allowed to update prescription billing','err');
    return false;
  }
  const rx=_histCache.find(record=>record.id===_newRxModelEditingId);
  if(!rx){
    showToast('Save or open a prescription before updating billing','err');
    return false;
  }
  const getData=qs('doctorRxFrame')?.contentWindow?.getPrescriptionData;
  if(typeof getData!=='function'){
    showToast('Prescription form is still loading. Please try again.','err');
    return false;
  }
  const data=getData();
  const updates={};
  if(isStaff()){
    const patientName=data.patientName.trim();
    if(!patientName){
      showToast('Patient name cannot be empty','err');
      return false;
    }
    if((rx.patientName||'')!==patientName)updates.patientName=patientName;
    const opNumber=data.opNumber.trim();
    if((rx.patientOPNo||'')!==opNumber)updates.patientOPNo=opNumber;
    if((rx.patientRef||'')!==opNumber)updates.patientRef=opNumber;
    if(!String(rx.patientAge||'').trim()&&data.patientAge)updates.patientAge=data.patientAge;
    if(!String(rx.patientGender||'').trim()&&data.patientSex)updates.patientGender=data.patientSex;
  }else{
    if(String(rx.patientAge||'')!==data.patientAge)updates.patientAge=data.patientAge;
    if(String(rx.patientGender||'')!==data.patientSex)updates.patientGender=data.patientSex;
  }
  if(String(rx.patientContact||'')!==data.patientPhone)updates.patientContact=data.patientPhone;
  const treatmentFee=Number(data.treatmentFee);
  const medicineFee=Number(data.medicineFee);
  if(!Number.isFinite(medicineFee)||medicineFee<0||(!isStaff()&&(!Number.isFinite(treatmentFee)||treatmentFee<0))){
    showToast('Enter valid fee amounts (zero or more)','err');
    return false;
  }
  const newTreatmentFee=isStaff()?Number(rx.treatmentFee)||0:treatmentFee;
  const oldMedicineFee=prescriptionMedicineFee(rx);
  if(oldMedicineFee!==medicineFee)updates.medicineFee=medicineFee;
  if(!isStaff()&&Number(rx.treatmentFee||0)!==treatmentFee){
    updates.treatmentFee=treatmentFee;
  }
  const grand=newTreatmentFee+medicineFee;
  if(Number(rx.grand||0)!==grand)updates.grand=grand;
  const paymentMethod=data.paymentMethod||'';
  const wasPaid=rx.paymentStatus==='paid'||(Number(rx.grand)>0&&Number(rx.paid)>=Number(rx.grand));
  if(['cash','gpay','bpay'].includes(paymentMethod)){
    if(grand<=0){
      showToast('Enter the treatment and/or medicine fee before recording payment','err');
      return false;
    }
    updates.paid=grand;
    updates.paymentStatus='paid';
    updates.paymentMethod=paymentMethod;
  }else if(wasPaid){
    updates.paid=grand;
    updates.paymentStatus='paid';
    updates.paymentMethod=rx.paymentMethod||'';
  }
  if(Object.keys(updates).length===0){
    showToast('Billing details are already up to date','warn');
    return false;
  }
  const buttons=[qs('doctorRxFrame')?.contentDocument?.getElementById('saveBillingButton')].filter(Boolean);
  buttons.forEach(button=>button.disabled=true);
  try{
    await window._fb.updateDoc(window._fb.doc(RX_COL(),rx.id),updates);
    const index=_histCache.findIndex(record=>record.id===rx.id);
    if(index>=0)_histCache[index]={..._histCache[index],...updates};
    const setData=qs('doctorRxFrame')?.contentWindow?.setPrescriptionData;
    if(typeof setData==='function')setNewRxFormData(setData,_histCache[index]||{...rx,...updates});
    filterHist();
    updateStats();
    setNewPrescriptionReadOnly(isStaff());
    showToast(updates.paymentStatus==='paid'?'Billing and payment saved':'Billing details saved');
    return true;
  }catch(e){
    showToast('Billing update failed: '+e.message,'err');
    return false;
  }finally{
    buttons.forEach(button=>button.disabled=false);
    setNewPrescriptionReadOnly(isStaff());
  }
}
async function saveStaffDemographics(){
  return savePrescriptionBilling(false);
}
function setNewRxFormData(setData,rx){
  setData({
    patientName:rx.patientName||'',
    opNumber:rx.patientOPNo||rx.patientRef||'',
    patientAge:rx.patientAge||'',
    patientSex:rx.patientGender||'',
    patientPhone:rx.patientContact||'',
    treatmentFee:rx.treatmentFee||0,
    medicineFee:prescriptionMedicineFee(rx),
    paid:rx.paid||0,
    paymentStatus:rx.paymentStatus||'pending',
    paymentMethod:rx.paymentMethod||'',
    date:rx.prescriptionDate||rx.date||'',
    diagnosis:rx.patientDx||'',
    treatmentPlan:rx.treatmentPlan||rx.notes||'',
    medicines:rx.medicines||[]
  });
}
function prescriptionMedicineFee(rx){
  if(rx.medicineFee!=null&&Number.isFinite(Number(rx.medicineFee)))return Math.max(0,Number(rx.medicineFee));
  return Math.max(0,(Number(rx.grand)||0)-(Number(rx.treatmentFee)||0));
}
function showNewDoctorRx(){
  setDoctorPrescriptionMode('new');
}
function showOldDoctorRx(){
  setDoctorPrescriptionMode('old');
}
async function printDoctorPrescription(){
  if(isStaff()){
    showToast('Staff cannot print prescriptions from the new prescription model','err');
    return;
  }
  const saved=await saveNewDoctorRx();
  if(!saved)return;
  const print=qs('doctorRxFrame')?.contentWindow?.printPrescription;
  if(typeof print!=='function'){
    showToast('Prescription form is still loading. Please try again.','err');
    return;
  }
  print();
}

function sw(tab,btn){
  if(isDoctor()&&!['rx','hist'].includes(tab)){
    showToast('Doctors can access prescriptions and history only','err');
    return;
  }
  if(isStaff()&&!['rx','hist'].includes(tab)){
    showToast('Staff can access prescriptions and history only','err');
    return;
  }
  const tabs=['token','rx','hist','dash','apt','pat','inv','fup'];
  const curTab = tabs.find(t => {
    const el = qs(t+'Tab');
    return el && el.style.display !== 'none';
  });
  if (curTab && curTab !== tab) {
    _navHistory.push(curTab);
  }
  tabs.forEach(t=>{
    const el=qs(t+'Tab');
    if(el)el.style.display=t===tab?'block':'none';
  });
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  updateBackBtn();
  if(tab==='hist')loadHist();
  if(tab==='dash')renderDash();
  if(tab==='apt'){todayApt();}
  if(tab==='inv')renderInv();
  if(tab==='fup')renderFollowups();
  if(tab==='pat'){
    if(!_histCache.length) loadHist();
    renderPatientList();
  }
  /* Ensure X-ray card is visible on rx tab */
  if(tab==='rx' && !_xrayRxId){
    const xc=qs('xrayCard');
    if(xc){xc.style.display='block';xc.dataset.readonly='1';}
    const xg=qs('xrayGallery');
    if(xg)xg.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px 0">💡 Save this prescription first to enable X-ray uploads</div>';
    const xu=qs('xrayUploadBtn');
    if(xu)xu.style.display='none';
  }
}
function goBack(){
  if (!_navHistory.length) return;
  const prev = _navHistory.pop();
  const btn = document.querySelector(`.tab[onclick*="'${prev}'"]`);
  if (btn) sw(prev, btn);
}
function updateBackBtn(){
  const btn = qs('backBtn');
  if (!btn) return;
  btn.style.display = _navHistory.length ? 'flex' : 'none';
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
  if(isStaff()){showToast('Staff cannot create prescriptions','err');return;}
  if(_editingRxId){_editingRxId=null;qs('btnSaveLabel').textContent='Save Prescription';}
  _activeTokenId=null;
  const tokenContext=qs('rxTokenContext');
  if(tokenContext)tokenContext.style.display='none';
  rows=[];rid=0;renderRows();
  ['pName','pAge','pContact','pBP','pMedicationHistory','notes'].forEach(id=>qs(id).value='');
  qs('treatmentFee').value=0;
  calcBill();
  ['pGender','pDx'].forEach(id=>qs(id).value='');
  qs('followup').value='After 5 days';
  qs('pAllergy').value='';
  _payRxId=null;
  _xrayRxId=null;
  const xc=qs('xrayCard');
  if(xc){xc.style.display='block';xc.dataset.readonly='1';}
  const xgal=qs('xrayGallery');
  if(xgal)xgal.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px 0">💡 Save this prescription first to enable X-ray uploads</div>';
  const xcnt=qs('xrayCount');
  if(xcnt)xcnt.textContent='0';
  const xub=qs('xrayUploadBtn');
  if(xub)xub.style.display='none';
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
  if(isStaff()){showToast('Staff cannot create prescriptions','err');return;}
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
  if(qs('pRef'))  qs('pRef').value    =last.patientOPNo||last.patientRef||'';
  qs('pMedicationHistory').value=last.patientMedicationHistory||'';
  qs('treatmentFee').value=last.treatmentFee||0;
  qs('notes').value   =last.treatmentPlan||last.notes||'';
  qs('followup').value=last.followup      ||'';
  applyAutoFollowupFromDx();
  rows=[];rid=0;(last.medicines||[]).forEach(m=>addRow(m));
  showToast('Previous Rx loaded: '+last.rxno);
}
function newRx(){
  if(isStaff()){
    _newRxModelEditingId=null;
    updateStaffRxActions();
    showNewDoctorRx();
    const frame=qs('doctorRxFrame');
    if(typeof frame?.contentWindow?.resetPrescriptionForm==='function')frame.contentWindow.resetPrescriptionForm();
    const rxBtn=document.querySelector(`.tab[onclick*="newRx"]`);
    if(rxBtn)sw('rx',rxBtn);
    showToast('New prescription model opened in view-only mode');
    return;
  }
  if(isDoctor()||isAdmin()){
    _newRxModelEditingId=null;
    showNewDoctorRx();
    const frame=qs('doctorRxFrame');
    if(typeof frame?.contentWindow?.resetPrescriptionForm==='function')frame.contentWindow.resetPrescriptionForm();
    const rxBtn=document.querySelector(`.tab[onclick*="newRx"]`);
    if(rxBtn)sw('rx',rxBtn);
    return;
  }
  newRxForm();
  const rxBtn = document.querySelector(`.tab[onclick*="newRx"]`);
  if(rxBtn) sw('rx', rxBtn);
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
  const isD = isDoctor();
  const existing = document.getElementById('sd-role-style');
  if (existing) existing.remove();
  document.querySelectorAll('.tabs .tab').forEach(btn => { btn.style.display = ''; });
  const oldPrescriptionBtn = qs('showOldPrescriptionBtn');
  if (oldPrescriptionBtn) oldPrescriptionBtn.style.display = isD||isS ? 'none' : '';
  updateStaffRxActions();
  setNewPrescriptionReadOnly(isS);

  if (isS || isD) {
    const hiddenTabs = isD
      ? ['token', 'dash', 'apt', 'pat', 'inv', 'fup']
      : ['token', 'dash', 'apt', 'pat', 'inv', 'fup'];
    hiddenTabs.forEach(t => {
      const btn = document.querySelector(`.tab[onclick*="'${t}'"]`);
      if (btn) btn.style.display = 'none';
    });
    /* Hide JSON backup controls for doctor and staff */
    ['exportAll', 'importJSON'].forEach(fn => {
      const btn = document.querySelector(`[onclick*="${fn}"]`);
      if (btn) btn.style.display = 'none';
    });
    if(isS){
      /* Inject CSS for read-only history */
      const style = document.createElement('style');
      style.id = 'sd-role-style';
      style.textContent = '.btn-del-hist,.btn-edit-hist{display:none!important}';
      document.head.appendChild(style);
    }
  } else {
    /* Show the follow-ups tab for admin/doctor too */
    const fupBtn = document.querySelector(`.tab[onclick*="'fup'"]`);
    if (fupBtn) fupBtn.style.display = '';
  }
  /* Update follow-up badge asynchronously */
  updateFupBadge();
}
function updateStaffRxActions(){
  const isS=isStaff();
  const staffNotice=qs('staffRxReadonlyNotice');
  if(staffNotice){
    staffNotice.textContent=_newRxModelEditingId
      ? 'Staff can update medicine fee, payment and missing patient details'
      : 'Open a saved prescription to enter medicine fee and payment';
    staffNotice.style.display=isS?'inline':'none';
  }
  const treatmentFeeField=qs('doctorRxFrame')?.contentDocument?.getElementById('treatmentFeeField');
  if(treatmentFeeField)treatmentFeeField.style.display='';
  const feePanel=qs('doctorRxFrame')?.contentDocument?.querySelector('.fee-panel');
  if(feePanel)feePanel.style.display='';
  const saveBillingButton=qs('doctorRxFrame')?.contentDocument?.getElementById('saveBillingButton');
  if(saveBillingButton)saveBillingButton.textContent=isS?'Save patient details & bill':'Save fees/payment';
  if(saveBillingButton)saveBillingButton.disabled=!_newRxModelEditingId;
  const saveNewRxBtn=qs('newRxDoctorToolbar')?.querySelector('[onclick*="saveNewDoctorRx"]');
  const printNewRxBtn=qs('newRxDoctorToolbar')?.querySelector('[onclick*="printDoctorPrescription"]');
  if(saveNewRxBtn)saveNewRxBtn.style.display=isS?'none':'';
  if(printNewRxBtn)printNewRxBtn.style.display=isS?'none':'';
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
    pMedicationHistory:qs('pMedicationHistory')?.value||'',treatmentFee:qs('treatmentFee')?.value||0,
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
    qs('pMedicationHistory').value=d.pMedicationHistory||'';
    qs('treatmentFee').value=d.treatmentFee||0;
    if(qs('pRef'))qs('pRef').value=d.pRef||'';
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
     await window._fb.updateDoc(window._fb.doc(RX_COL(),id),{paid:newPaid,paymentStatus:status,paymentMethod:method});
     rx.paid=newPaid;rx.paymentStatus=status;rx.paymentMethod=method;
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
  if(paid>=rx.grand&&rx.grand>0)return '<span class="pay-badge pay-paid">Paid</span>';
  if(paid>0)return '<span class="pay-badge pay-partial">Partial Rs.'+paid+'</span>';
  return '<span class="pay-badge pay-pending">Pending</span>';
}
function sharePaidPrescriptionPdf(rx){
  const name=rx.patientName||'Patient';
  const rxno=rx.rxno||'RX-—';
  const phone=rx.patientContact?rx.patientContact.replace(/[^\d]/g,''):'918122835737';
  const dx=rx.patientDx||'—';
  const meds=(rx.medicines||[]).map(m=>m.name).join(', ').slice(0,150);
  const dateStr=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  const docName=(getDoctors()[0]||{}).name||'Dr. S. K. Srinivas';
  const fupText=rx.followup||'';
  let fupDateStr='';
  if(fupText){
    const days=calcFollowupDays(fupText);
    if(days){const dt=new Date();dt.setDate(dt.getDate()+days);fupDateStr=' ('+dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+')';}
  }
  const msgText='🦷 SAI DENTAL CLINIC\nPrescribed by '+docName+' on '+dateStr+'\n\n👤 Patient: '+name+'\n📋 Rx: '+rxno+'\n🏥 Diagnosis: '+dx+'\n💊 Medicines: '+meds+'\n💰 Amount: Rs.'+rx.grand+' | Paid: Rs.'+(rx.paid||0)+(fupText?'\n📅 Next visit: '+fupText+fupDateStr:'');
  copyToClipboard(msgText);
  showToast('Text copied — use Print (Save as PDF) and attach in WhatsApp');
  printRx();
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
  if(isStaff()){showToast('Staff cannot duplicate prescriptions','err');return;}
  const rx=_histCache.find(r=>r.id===id);
  if(!rx)return;
  if(rx.prescriptionModel==='mockup-v1'&&(isDoctor()||isAdmin())){
    _editingRxId=null;
    _newRxModelEditingId=null;
    newRxForm();
    const setData=qs('doctorRxFrame')?.contentWindow?.setPrescriptionData;
    if(typeof setData!=='function'){
      showToast('Prescription form is still loading. Please try again.','err');
      return;
    }
    setData({
      patientName:rx.patientName||'',
      opNumber:rx.patientOPNo||rx.patientRef||'',
      patientAge:rx.patientAge||'',
      patientSex:rx.patientGender||'',
      patientPhone:rx.patientContact||'',
      diagnosis:rx.patientDx||'',
      treatmentPlan:rx.treatmentPlan||rx.notes||'',
      medicines:rx.medicines||[]
    });
    showNewDoctorRx();
    sw('rx',document.querySelector(`.tab[onclick*="newRx"]`));
    showToast('Duplicated: '+rx.rxno);
    return;
  }
  if(isDoctor()||isAdmin())showOldDoctorRx();
  newRxForm();
  qs('pName').value=rx.patientName||'';
  qs('pAge').value=rx.patientAge||'';
  qs('pGender').value=rx.patientGender||'';
  qs('pContact').value=rx.patientContact||'';
  qs('pBP').value=rx.patientBP||'';
  qs('pDx').value=rx.patientDx||'';
  qs('pAllergy').value=rx.patientAllergy||'';
  if(qs('pRef'))  qs('pRef').value=rx.patientOPNo||rx.patientRef||'';
  qs('notes').value=rx.treatmentPlan||rx.notes||'';
  qs('followup').value=rx.followup||'';
  (rx.medicines||[]).forEach(m=>addRow(m));
   sw('rx',document.querySelector(`.tab[onclick*="newRx"]`));
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
      '<div class="profile-visit-dx">'+escapeHtml(r.patientDx||'—')+'</div>'+
      '</div>';
  });
  html+='</div>';
  return html;
}

/* ─── PATIENT MANAGEMENT ─── */
let _activePatientMobile = null;
let _patSaveTimer = null;

function normalizeMobile(val){
  return (val||'').replace(/[^\d]/g,'');
}

function tokenAsPatientVisit(token) {
  return {
    id:'token_'+token.id, tokenId:token.id, isTokenOnly:true,
    tokenNumber:token.tokenNumber, patientName:token.patientName||'',
    patientContact:token.patientContact||'', patientAge:token.patientAge||'',
    patientGender:token.patientGender||'', patientBP:token.bloodPressure||'',
    patientAllergy:token.allergies||'', patientMedicationHistory:token.medicationHistory||'',
    dateISO:token.createdAt||'', date:tokenDateLabel(token.dateKey),
    grand:token.fee ?? TOKEN_FEE, paid:token.paymentStatus==='paid'?(token.fee ?? TOKEN_FEE):0,
    patientDx:'Token consultation', medicines:[], notes:''
  };
}

function getPatientVisits(mobile){
  if(!mobile) return [];
  return _histCache.filter(r => normalizeMobile(r.patientContact) === mobile)
    .concat(_allTokenCache.filter(t => normalizeMobile(t.patientContact) === mobile).map(tokenAsPatientVisit));
}

function showPatientProfile(id){
  const rx=_histCache.find(r=>r.id===id);
  if(!rx)return;
  const mobile = normalizeMobile(rx.patientContact);
  if(mobile){
    _activePatientMobile = mobile;
    qs('patientListSection').style.display='none';
    qs('patientProfileSection').style.display='block';
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
    const patBtn = document.querySelector(`.tab[onclick*="'pat'"]`);
    if(patBtn){ patBtn.classList.add('on'); sw('pat', patBtn); }
    renderPatientProfile(mobile);
  }else{
    /* Fallback: group by name */
    const name = (rx.patientName||'').toLowerCase().trim();
    if(!name){ showToast('Patient has no name or mobile to link profile','warn'); return; }
    const visits = _histCache.filter(r => (r.patientName||'').toLowerCase().trim() === name);
    if(!visits.length){ showToast('No visits found for this patient','warn'); return; }
    _activePatientMobile = null;
    qs('patientListSection').style.display='none';
    qs('patientProfileSection').style.display='block';
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
    const patBtn = document.querySelector(`.tab[onclick*="'pat'"]`);
    if(patBtn){ patBtn.classList.add('on'); sw('pat', patBtn); }
    renderNameBasedProfile(visits);
  }
}

function openPatientProfile(mobile){
  if(!mobile)return;
  _activePatientMobile = mobile;
  qs('patientListSection').style.display='none';
  qs('patientProfileSection').style.display='block';
  renderPatientProfile(mobile);
}

function showPatientList(){
  _activePatientMobile = null;
  qs('patientListSection').style.display='block';
  qs('patientProfileSection').style.display='none';
  renderPatientList();
}

function renderPatientList(){
  const el = qs('patientList');
  const cnt = qs('patCount');
  if(!el)return;
  const q = (qs('patSearch')?.value||'').toLowerCase();
  const treatmentFilterEl = qs('patTreatmentFilter');
  const selectedTreatment = treatmentFilterEl ? treatmentFilterEl.value : '';
  const grouped = {};
  const allVisits = _histCache.concat(_allTokenCache.map(tokenAsPatientVisit));
  const treatmentSet = new Set();
  allVisits.forEach((r, idx) => {
    let key = normalizeMobile(r.patientContact);
    if(!key){
      const nk = (r.patientName||'unknown').toLowerCase().replace(/\s+/g,'');
      key = '__name__' + nk + '__' + idx;
    }
    const dtx = (r.patientDx||'').trim() || 'Other';
    treatmentSet.add(dtx);
    if(!grouped[key]) grouped[key] = { key, mobile: normalizeMobile(r.patientContact), name: r.patientName||'', visits: [], totalAmt: 0, totalPaid: 0, lastDate: '', lastDx: '' };
    const p = grouped[key];
    p.visits.push(r);
    p.totalAmt += r.grand||0;
    p.totalPaid += r.paid||0;
    if(!p.name) p.name = r.patientName||'';
    if((r.dateISO||'') > (p.lastDate||'')){ p.lastDate = r.dateISO; p.lastDx = r.patientDx||''; }
  });

  if(treatmentFilterEl){
    const prev = selectedTreatment;
    const treatments = [...treatmentSet].sort((a,b)=>a.localeCompare(b));
    treatmentFilterEl.innerHTML = '<option value="">All Treatments</option>' + treatments.map(t=>'<option value="'+escapeHtmlAttr(t)+'"'+(prev===t?' selected':'')+'>'+escapeHtml(t)+'</option>').join('');
    if(prev && !treatments.includes(prev)) treatmentFilterEl.value = '';
  }

  let patients = Object.values(grouped);
  if(q){
    patients = patients.filter(p => (p.name||'').toLowerCase().includes(q) || (p.mobile||'').includes(q));
  }
  const activeTreatment = treatmentFilterEl ? treatmentFilterEl.value : '';
  if(activeTreatment){
    patients = patients.filter(p=>p.visits.some(v=>((v.patientDx||'').trim() || 'Other')===activeTreatment));
  }
  patients.sort((a,b)=>((b.lastDate||'').localeCompare(a.lastDate||'')));
  cnt.textContent = patients.length + ' patient(s)';
  if(!patients.length){
    const msg = q ? 'No patients match your search' : (activeTreatment ? 'No patients for selected treatment' : 'No patients yet');
    el.innerHTML = '<div class="pat-empty">' + msg + '</div>';
    return;
  }
  el.innerHTML = patients.map(p => {
    const bal = p.totalAmt - p.totalPaid;
    const hasMobile = !!p.mobile;
    const onClick = hasMobile
      ? "openPatientProfile('" + p.mobile + "')"
      : "showToast('Add a mobile number to this prescription for full patient profile','warn')";
    return '<div class="pat-item" onclick="' + onClick + '">' +
      '<div class="pat-avatar">' + (p.name ? p.name[0].toUpperCase() : '?') + '</div>' +
      '<div class="pat-info">' +
      '<div class="pat-name">' + (p.name||'Unknown') + '</div>' +
      '<div class="pat-meta">' + (hasMobile ? '📞 ' + p.mobile : '⚠️ No mobile') + (p.lastDx ? ' · ' + p.lastDx : '') + '</div>' +
      '</div>' +
      '<div class="pat-stats">' +
      '<span>Visits <span class="pat-stat-val">' + p.visits.length + '</span></span>' +
      '<span>Total <span class="pat-stat-val">₹' + p.totalAmt + '</span></span>' +
      '<span>Balance <span class="pat-stat-val" style="color:' + (bal>0?'var(--red)':'var(--teal-d)') + '">₹' + Math.max(0,bal) + '</span></span>' +
      '</div>' +
      '</div>';
  }).join('');
}

async function renderPatientProfile(mobile){
  _activePatientMobile = mobile;
  const el = qs('patProfileContent');
  const loading = qs('patProfileLoading');
  const visits = getPatientVisits(mobile);
  if(loading) loading.style.display = 'block';
  if(el) el.style.display = 'none';

  const totalAmt = visits.reduce((s,r)=>s+(r.grand||0),0);
  const totalPaid = visits.reduce((s,r)=>s+(r.paid||0),0);
  const totalRx = visits.length;
  const commonDx = [...new Set(visits.map(r=>r.patientDx).filter(Boolean))];
  const allMeds = [...new Set(visits.flatMap(r=>(r.medicines||[]).map(m=>m.name).filter(Boolean)))];
  const allAdvice = [...new Set(visits.map(r=>r.notes).filter(Boolean))];

  qs('patProfileName').textContent = (visits[0]?.patientName||'Patient');
  qs('patProfileMobile').textContent = '📞 ' + mobile;
  qs('patVisitCount').textContent = totalRx + ' visit(s)';

  /* Stats */
  const bal = totalAmt - totalPaid;
  qs('patProfileStats').innerHTML =
    '<div class="profile-stat"><div class="profile-stat-val">' + totalRx + '</div><div class="profile-stat-lbl">Total Visits</div></div>' +
    '<div class="profile-stat"><div class="profile-stat-val">₹' + totalAmt + '</div><div class="profile-stat-lbl">Total Bill</div></div>' +
    '<div class="profile-stat"><div class="profile-stat-val">₹' + totalPaid + '</div><div class="profile-stat-lbl">Paid</div></div>' +
    '<div class="profile-stat"><div class="profile-stat-val" style="color:' + (bal>0?'var(--red)':'var(--teal-d)') + '">₹' + Math.max(0,bal) + '</div><div class="profile-stat-lbl">Balance</div></div>' +
    '<div class="profile-stat"><div class="profile-stat-val">' + (totalRx?Math.round(totalAmt/totalRx):0) + '</div><div class="profile-stat-lbl">Avg / Visit</div></div>' +
    '<div class="profile-stat"><div class="profile-stat-val">' + commonDx.length + '</div><div class="profile-stat-lbl">Treatments</div></div>';

  /* Visit history */
  const visitSorted = [...visits].sort((a,b)=>(b.dateISO||'').localeCompare(a.dateISO||''));
  qs('patVisitList').innerHTML = visitSorted.map(r => {
    const paid = r.paid||0;
    const vBal = (r.grand||0) - paid;
    const action = r.isTokenOnly ? "showTokenReceipt('"+r.tokenId+"')" : "loadRx('"+r.id+"')";
    return '<div class="pat-visit-item" onclick="'+action+'">' +
      '<div class="pat-visit-rxno">' + (r.isTokenOnly ? 'Token '+r.tokenNumber : (r.rxno||'—')) + '</div>' +
      '<div class="pat-visit-date">' + (r.date||'') + '</div>' +
      '<div class="pat-visit-dx">' + escapeHtml(r.patientDx||'—') + '</div>' +
      '<div class="pat-visit-meds" title="' + escapeHtmlAttr((r.medicines||[]).map(m=>m.name||'').join(', ')) + '">' + (r.medicines||[]).map(m=>escapeHtml(m.name||'')).join(', ') + '</div>' +
      '<div class="pat-visit-amt">₹' + (r.grand||0) + '</div>' +
      '<div class="pat-visit-paid">' + (vBal>0 ? '<span style="color:var(--red)">₹' + vBal + '</span>' : '<span style="color:var(--teal)">Paid</span>') + '</div>' +
      '</div>';
  }).join('');

  /* Load editable info from Firestore */
  try{
    const snap = await window._fb.getDoc(window._fb.doc(PAT_COL(), mobile));
    if(snap.exists()){
      const d = snap.data();
      qs('patEditName').value = d.name||'';
      qs('patEditAge').value = d.age||'';
      qs('patEditGender').value = d.gender||'';
      qs('patEditMobile').value = mobile;
      qs('patEditAddress').value = d.address||'';
      qs('patEditMedicalHistory').value = d.medicalHistory||'';
      qs('patEditNotes').value = d.notes||'';
    }else{
      /* Pre-fill from latest visit */
      const latest = visits[0];
      qs('patEditName').value = latest?.patientName||'';
      qs('patEditAge').value = latest?.patientAge||'';
      qs('patEditGender').value = latest?.patientGender||'';
      qs('patEditMobile').value = mobile;
      qs('patEditAddress').value = '';
      qs('patEditMedicalHistory').value = '';
      qs('patEditNotes').value = '';
    }
  }catch(e){
    console.warn('Patient profile load error:', e);
  }

  /* Toggle editability */
  const canEdit = !isStaff();
  qs('patInfoEditHint').textContent = canEdit ? '✏️ You can edit this information' : 'Only admin / doctor can edit';
  [qs('patEditName'),qs('patEditAge'),qs('patEditGender'),qs('patEditAddress'),qs('patEditMedicalHistory'),qs('patEditNotes')].forEach(el => {
    if(el) el.disabled = !canEdit;
  });

  if(loading) loading.style.display = 'none';
  if(el) el.style.display = 'block';
}

function queuePatientSave(){
  clearTimeout(_patSaveTimer);
  _patSaveTimer = setTimeout(() => savePatientProfile(), 800);
}

async function savePatientProfile(){
  const mobile = _activePatientMobile;
  if(!mobile) return;
  const data = {
    mobile,
    name: qs('patEditName').value,
    age: qs('patEditAge').value,
    gender: qs('patEditGender').value,
    address: qs('patEditAddress').value,
    medicalHistory: qs('patEditMedicalHistory').value,
    notes: qs('patEditNotes').value,
    updatedAt: new Date().toISOString(),
    updatedBy: qs('userEmail')?.textContent||''
  };
  try{
    await window._fb.setDoc(window._fb.doc(PAT_COL(), mobile), data, { merge: true });
    qs('patSaveHint').style.display = 'block';
    setTimeout(() => { const h=qs('patSaveHint'); if(h) h.style.display='none'; }, 2000);
  }catch(e){
    showToast('Failed to save patient info: ' + e.message, 'err');
  }
}

function renderNameBasedProfile(visits){
  if(!visits||!visits.length) return;
  const loading = qs('patProfileLoading');
  const el = qs('patProfileContent');
  if(loading) loading.style.display = 'none';
  if(el) el.style.display = 'block';

  const totalAmt = visits.reduce((s,r)=>s+(r.grand||0),0);
  const totalPaid = visits.reduce((s,r)=>s+(r.paid||0),0);
  const totalRx = visits.length;
  const commonDx = [...new Set(visits.map(r=>r.patientDx).filter(Boolean))];
  const bal = totalAmt - totalPaid;

  qs('patProfileName').textContent = (visits[0]?.patientName||'Patient') + ' ⚠️';
  qs('patProfileMobile').textContent = 'No mobile number — add one to enable profile editing';
  qs('patProfileMobile').style.color = 'var(--red)';
  qs('patVisitCount').textContent = totalRx + ' visit(s)';

  qs('patProfileStats').innerHTML =
    '<div class="profile-stat"><div class="profile-stat-val">' + totalRx + '</div><div class="profile-stat-lbl">Total Visits</div></div>' +
    '<div class="profile-stat"><div class="profile-stat-val">₹' + totalAmt + '</div><div class="profile-stat-lbl">Total Bill</div></div>' +
    '<div class="profile-stat"><div class="profile-stat-val">₹' + totalPaid + '</div><div class="profile-stat-lbl">Paid</div></div>' +
    '<div class="profile-stat"><div class="profile-stat-val" style="color:' + (bal>0?'var(--red)':'var(--teal-d)') + '">₹' + Math.max(0,bal) + '</div><div class="profile-stat-lbl">Balance</div></div>' +
    '<div class="profile-stat"><div class="profile-stat-val">' + (totalRx?Math.round(totalAmt/totalRx):0) + '</div><div class="profile-stat-lbl">Avg / Visit</div></div>' +
    '<div class="profile-stat"><div class="profile-stat-val">' + commonDx.length + '</div><div class="profile-stat-lbl">Treatments</div></div>';

  const visitSorted = [...visits].sort((a,b)=>(b.dateISO||'').localeCompare(a.dateISO||''));
  qs('patVisitList').innerHTML = visitSorted.map(r => {
    const paid = r.paid||0;
    const vBal = (r.grand||0) - paid;
    return '<div class="pat-visit-item" onclick="loadRx(\'' + r.id + '\')">' +
      '<div class="pat-visit-rxno">' + (r.rxno||'—') + '</div>' +
      '<div class="pat-visit-date">' + (r.date||'') + '</div>' +
      '<div class="pat-visit-dx">' + escapeHtml(r.patientDx||'—') + '</div>' +
      '<div class="pat-visit-meds" title="' + escapeHtmlAttr((r.medicines||[]).map(m=>m.name||'').join(', ')) + '">' + (r.medicines||[]).map(m=>escapeHtml(m.name||'')).join(', ') + '</div>' +
      '<div class="pat-visit-amt">₹' + (r.grand||0) + '</div>' +
      '<div class="pat-visit-paid">' + (vBal>0 ? '<span style="color:var(--red)">₹' + vBal + '</span>' : '<span style="color:var(--teal)">Paid</span>') + '</div>' +
      '</div>';
  }).join('');

  /* Disable all edit fields and show hint */
  qs('patInfoEditHint').textContent = '⚠️ Add a mobile number to the prescription to enable editing';
  qs('patInfoEditHint').style.color = 'var(--red)';
  [qs('patEditName'),qs('patEditAge'),qs('patEditGender'),qs('patEditAddress'),qs('patEditMedicalHistory'),qs('patEditNotes')].forEach(el => {
    if(el) el.disabled = true;
  });
}

/* Auto-update patient profile after Rx save */
function updatePatientFromRx(rx){
  const mobile = normalizeMobile(rx.patientContact);
  if(!mobile) return;
  window._fb.setDoc(window._fb.doc(PAT_COL(), mobile), {
    mobile,
    name: rx.patientName||'',
    lastVisit: rx.dateISO||'',
    updatedAt: new Date().toISOString()
  }, { merge: true }).catch(()=>{});
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
  printRx();
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

function confirmShare(){
  const name=qs('pName').value.trim();
  const rxno=qs('rxNo').textContent;
  const followupText=qs('followup').value.trim();
  closeModal(null,'shareModal');
  if(_payRxId){const rx=_histCache.find(r=>r.id===_payRxId);if(rx)updateBillPay(rx);}
  const docName=(getDoctors()[0]||{}).name||'Dr. S. K. Srinivas';
  const dateStr=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  const phone=(qs('pContact').value||'').replace(/[^\d]/g,'')||'918122835737';
  let fupDateStr='';
  if(followupText){
    const days=calcFollowupDays(followupText);
    if(days){const dt=new Date();dt.setDate(dt.getDate()+days);fupDateStr=' ('+dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+')';}
  }
  let msgText='🦷 SAI DENTAL CLINIC\nPrescribed by '+docName+' on '+dateStr+'\n\n👤 Patient: '+name+'\n📋 Rx: '+rxno;
  if(followupText)msgText+='\n📅 Next visit: '+followupText+fupDateStr;
  copyToClipboard(msgText);
  if(followupText&&qs('shareCreateApt').checked){
    createApptFromFollowup(name,followupText);
  }
  window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msgText),'_blank');
  showToast('Sent to WhatsApp');
  printRx();
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
  showToast('Appointment added to calendar for '+aptDate);
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
  const treatmentMap={};
  all.forEach((r,idx)=>{
    const d=r.patientDx||'Other';
    dxMap[d]=(dxMap[d]||0)+1;

    const contact=normalizeMobile(r.patientContact);
    const name=((r.patientName||'').toLowerCase().replace(/\s+/g,'')||'unknown');
    const pKey=contact ? ('mobile:'+contact) : ('name:'+name+':'+(r.id||r.tokenId||idx));

    if(!treatmentMap[d]) treatmentMap[d]={visits:0,revenue:0,patients:new Set()};
    treatmentMap[d].visits+=1;
    treatmentMap[d].revenue+=calcGrand(r);
    treatmentMap[d].patients.add(pKey);
  });
  const dxSorted=Object.entries(dxMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const dxTotal=dxSorted.reduce((s,[,c])=>s+c,0)||1;
  const dxEl=qs('dashDxList');
  if(dxEl){
    dxEl.innerHTML=dxSorted.length?dxSorted.map(([dx,cnt],i)=>{
      const pct=Math.round(cnt/dxTotal*100);
      return '<div class="dx-item" style="border-left-color:'+DASH_COLORS[i%DASH_COLORS.length]+'">'+
        '<div><div class="dx-name">'+escapeHtml(dx)+'</div>'+
        '<div class="dx-bar-bg"><div class="dx-bar-fill" style="width:'+pct+'%;background:'+DASH_COLORS[i%DASH_COLORS.length]+'"></div></div></div>'+
        '<div style="text-align:right"><div class="dx-count">'+cnt+'</div><div style="font-size:10px;color:var(--muted)">'+pct+'%</div></div></div>';
    }).join(''):'<div class="empty-state"><p>No data yet</p></div>';
  }

  /* ── Treatment-wise patient stats ── */
  const treatmentRows=Object.entries(treatmentMap).map(([name,d])=>({
    name,
    visits:d.visits,
    revenue:d.revenue,
    patients:d.patients.size
  }));

  const patEl=qs('dashTreatmentPatient');
  if(patEl){
    const rows=[...treatmentRows].sort((a,b)=>b.patients-a.patients).slice(0,10);
    const max=Math.max(...rows.map(r=>r.patients),1);
    patEl.innerHTML=rows.length?rows.map((r,i)=>{
      const pct=Math.round((r.patients/max)*100);
      return '<div class="dx-item" style="border-left-color:'+DASH_COLORS[i%DASH_COLORS.length]+'">'+
        '<div><div class="dx-name">'+escapeHtml(r.name)+'</div>'+
        '<div class="dx-bar-bg"><div class="dx-bar-fill" style="width:'+pct+'%;background:'+DASH_COLORS[i%DASH_COLORS.length]+'"></div></div></div>'+
        '<div style="text-align:right"><div class="dx-count">'+r.patients+'</div><div style="font-size:10px;color:var(--muted)">'+r.visits+' visit(s)</div></div></div>';
    }).join(''):'<div class="empty-state"><p>No treatment data</p></div>';
  }

  const treatmentRevEl=qs('dashTreatmentRevenue');
  if(treatmentRevEl){
    const rows=[...treatmentRows].sort((a,b)=>b.revenue-a.revenue).slice(0,10);
    const max=Math.max(...rows.map(r=>r.revenue),1);
    treatmentRevEl.innerHTML=rows.length?rows.map((r,i)=>{
      const pct=Math.round((r.revenue/max)*100);
      return '<div class="dx-item" style="border-left-color:'+DASH_COLORS[i%DASH_COLORS.length]+'">'+
        '<div><div class="dx-name">'+escapeHtml(r.name)+'</div>'+
        '<div class="dx-bar-bg"><div class="dx-bar-fill" style="width:'+pct+'%;background:'+DASH_COLORS[i%DASH_COLORS.length]+'"></div></div></div>'+
        '<div style="text-align:right"><div class="dx-count">₹'+r.revenue+'</div><div style="font-size:10px;color:var(--muted)">'+r.patients+' patient(s)</div></div></div>';
    }).join(''):'<div class="empty-state"><p>No treatment data</p></div>';
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
        leg.innerHTML='<span class="dash-pie-legend-dot" style="background:'+color+'"></span> '+escapeHtml(dx)+' ('+cnt+')';
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
  const isToday=_aptSelDate===todayStr;
  const pendingApts=apts.filter(a=>!a.whatsappSent);
  if(!apts.length){
    el.innerHTML='<div class="apt-cal-empty">No appointments on '+_aptSelDate+'</div>'+
      '<button class="btn-add" onclick="showAptForm()" style="display:block;margin:8px auto 0">+ Add Appointment</button>';
    updateAptBadge();
    return;
  }
  let html='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">'+
    '<span style="font-size:13px;font-weight:500;color:var(--muted)">'+_aptSelDate+' — '+apts.length+' appointment(s)</span>'+
    (isToday&&pendingApts.length?`<button class="btn-sm" style="margin-left:auto;color:var(--teal);border-color:var(--teal-m)" onclick="sendAllReminders()">📤 Remind All (${pendingApts.length})</button>`:'')+
    '</div><div class="apt-day-list">';
  apts.forEach(a=>{
    const st=a.status||'pending';
    const reminded=a.whatsappSent;
    html+='<div class="apt-item" style="'+(isToday?'border-color:var(--teal-m);background:var(--teal-l)':'')+'">'+
      '<div class="apt-time">'+(a.time||'—')+'</div>'+
      '<div><div class="apt-info-name">'+a.patientName+(
        (st==='done'?' <span class="apt-status done">✅ Done</span>':' <span class="apt-status pending">🔴 Pending</span>')
      )+(reminded?' <span class="apt-status done" style="font-size:10px">✅ Reminded</span>':'')+
      (isToday&&!reminded?' <span style="font-size:10px;color:var(--teal)">Today</span>':'')+'</div>'+
      '<div class="apt-info-sub">'+(a.purpose||'—')+(a.contact?' · '+a.contact:'')+'</div></div>'+
      '<div class="apt-actions">'+
      '<button onclick="shareAptWhatsApp(\''+a.id+'\')" title="'+(reminded?'Resend WhatsApp':'Send WhatsApp')+'">'+(reminded?'🔄':'📤')+'</button>'+
       '<button onclick="showAptForm('+JSON.stringify(a).replace(/"/g,'&quot;')+')" title="Edit">✏️</button>'+
       '<button onclick="showAptNoteModal(\''+a.id+'\')" title="Notes">📝</button>'+
       '<button class="apt-del" onclick="deleteApt(\''+a.id+'\')" title="Delete">🗑️</button>'+
      '</div></div>';
  });
  html+='</div>';
  el.innerHTML=html;
  updateAptBadge();
}
function sendAllReminders(){
  const all=getApts();
  const pending=all.filter(a=>a.date===_aptSelDate&&!a.whatsappSent);
  if(!pending.length){showToast('No pending appointments to remind','warn');return;}
  all.forEach(a=>{if(a.date===_aptSelDate)a.whatsappSent=1;});
  saveApts(all);
  renderApts();
  showToast('✅ Marked '+pending.length+' as reminded — send individually with 📤');
}
function showAptNoteModal(id){
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
  badge.style.display='inline';
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

function normalizeFollowupContact(raw){
  return String(raw||'').replace(/[^+\d]/g,'');
}

function callPatientFromFollowup(id){
  const rx=_histCache.find(r=>r.id===id);
  const phone=normalizeFollowupContact(rx?.patientContact);
  if(!phone){showToast('No patient contact for this follow-up','warn');return;}
  window.location.href='tel:'+phone;
}

function createFollowupAppointment(id){
  const rx=_histCache.find(r=>r.id===id);
  if(!rx){showToast('Prescription not found','err');return;}
  const fupDate=rx.followupDate||'';
  const purpose=(rx.patientDx||'').trim();
  showAptForm({
    patientName:rx.patientName||'',
    contact:rx.patientContact||'',
    date:fupDate||dateStr(new Date()),
    time:'10:00',
    purpose:purpose?`${purpose} Follow-up`:'Follow-up Visit',
    notes:`Reminder for Rx ${rx.rxno||''}. Follow-up due ${fupDate||'scheduled'}.`
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
         '<div><strong>'+r.patientName+'</strong><br><span style="font-size:11px;color:var(--muted)">'+r.rxno+' · '+(r.patientContact||'No phone')+' · Follow-up: '+r.followupDate+'</span></div>'+
        '<div style="display:flex;gap:6px">'+
          '<button class="btn-sm" onclick="callPatientFromFollowup(\''+r.id+'\')">📞 Call</button>'+
          '<button class="btn-sm" onclick="closeModal(null,\'fupNotifyModal\');document.querySelector(\'.tab:nth-child(6)\').click()">View</button>'+
        '</div></div>'
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
     return !isStaff() || r._fupStatus!=='done';
  }).map(r=>({...r,overdue:r._fupDate<now})).sort((a,b)=>{
      if(a.overdue&&!b.overdue)return -1;
      if(!a.overdue&&b.overdue)return 1;
      return (a._fupDate||'').localeCompare(b._fupDate||'');
    });
   const active=pending.filter(r=>r._fupStatus!=='done');
   const completed=pending.filter(r=>r._fupStatus==='done');
   const visible=isStaff()?active:active.concat(completed);
   if(!visible.length){
     el.innerHTML='<div class="fup-empty">No follow-ups pending</div>';
     qs('fupCount').textContent='0';
     return;
   }
   qs('fupCount').textContent=active.length;
   el.innerHTML=visible.map((r,i)=>{
     const isDone=r._fupStatus==='done';
     const label=isDone?'✅ Completed':r.overdue?'🔴 Overdue':'🟡 Pending';
     const followupText=r.followup||'Follow-up';
     const heading=isDone&&(i===0||visible[i-1]._fupStatus!=='done')?'<div style="margin:18px 0 8px;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.6px">Completed Follow-ups</div>':'';
     return heading+'<div class="fup-item">'+
      '<div class="fup-info">'+
      '<div class="fup-name">'+(r.patientName||'—')+' <span class="fup-rxno">'+r.rxno+'</span></div>'+
       '<div class="fup-sub">Rx: '+r.date+' · 📞 '+(r.patientContact||'No phone')+' · Follow-up: '+r._fupDate+' · '+followupText+'</div>'+
      (r._fupNotes?.length?'<div class="fup-notes">'+
        r._fupNotes.slice(-2).map(n=>'<div class="fup-note"><span class="fup-note-by">'+n.by+'</span> '+n.note+' <span class="fup-note-at">'+new Date(n.at).toLocaleDateString('en-IN')+'</span></div>').join('')+
        '</div>':'')+
      '</div>'+
      '<div class="fup-actions">'+
      '<span class="fup-status">'+label+'</span>'+
      '<button class="btn-sm" onclick="callPatientFromFollowup(\''+r.id+'\')">📞 Call</button>'+
      '<button class="btn-sm" onclick="createFollowupAppointment(\''+r.id+'\')">📅 Book</button>'+
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
function completeFollowup(){
  qs('fupNoteStatus').value='done';
  if(!qs('fupNoteText').value.trim())qs('fupNoteText').value='Follow-up completed';
  saveFupNote();
}

/* ─── X-RAY / SCAN UPLOAD ─── */
let _xrayRxId = null;

function resizeImage(file, maxDim, quality, cb) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', quality));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function xraySizeWarning(dataUrl) {
  const bytes = atob(dataUrl.split(',')[1]).length;
  if (bytes > 600 * 1024) showToast('X-ray is large (' + (bytes/1024).toFixed(0) + ' KB). It may fail if too many are added.', 'warn');
}

function handleXrayUpload(ev) {
  const file = ev.target.files?.[0];
  if (!file || !_xrayRxId) return;
  if (file.size > 20 * 1024 * 1024) { showToast('File too large (max 20MB)', 'err'); ev.target.value = ''; return; }
  const prog = qs('xrayProgress');
  prog.style.display = 'block'; prog.textContent = 'Compressing…';
  resizeImage(file, 800, 0.7, async function (dataUrl) {
    xraySizeWarning(dataUrl);
    try {
      const rx = _histCache.find(r => r.id === _xrayRxId);
      if (!rx) { showToast('Prescription not found', 'err'); prog.style.display = 'none'; ev.target.value = ''; return; }
      const fileId = Date.now();
      const entry = { id: fileId, url: dataUrl, name: file.name, uploadedAt: new Date().toISOString(), uploadedBy: qs('userEmail').textContent };
      const xrays = [...(rx.xrays || []), entry];
      prog.textContent = 'Saving to Firestore…';
      await window._fb.updateDoc(window._fb.doc(RX_COL(), _xrayRxId), { xrays });
      rx.xrays = xrays;
      showToast('✅ X-ray saved');
      renderXrayGallery();
    } catch (e) {
      showToast('Save failed: ' + (e.message || 'Firestore error'), 'err');
      console.error('X-ray save error:', e);
    }
    prog.style.display = 'none';
    ev.target.value = '';
  });
}

function renderXrayGallery() {
  const el = qs('xrayGallery');
  const cnt = qs('xrayCount');
  if (!el || !_xrayRxId) return;
  const rx = _histCache.find(r => r.id === _xrayRxId);
  if (!rx) { el.innerHTML = ''; if (cnt) cnt.textContent = '0'; return; }
  const xrays = rx.xrays || [];
  if (cnt) cnt.textContent = xrays.length + ' file(s)';
  if (!xrays.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">No X-rays uploaded yet</div>';
    return;
  }
  el.innerHTML = xrays.map(x => {
    const isImg = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(x.name);
    return '<div class="xray-item">' +
      (isImg
        ? '<img src="' + x.url + '" alt="' + x.name.replace(/"/g,'&quot;') + '" class="xray-thumb" onclick="window.open(\'' + x.url + '\',\'_blank\')" onerror="this.outerHTML=\'<div class=\\\'xray-thumb xray-thumb-fallback\\\' onclick=\\\'window.open(\\\'' + x.url + '\\\',\\\'_blank\\\')\\\'>📄</div>\'"/>'
        : '<div class="xray-thumb xray-thumb-fallback" onclick="window.open(\'' + x.url + '\',\'_blank\')">📄</div>'
      ) +
      '<div class="xray-info">' +
      '<div class="xray-name" title="' + x.name.replace(/"/g,'&quot;') + '">' + x.name.replace(/"/g,'&quot;') + '</div>' +
      '<div class="xray-meta">' + new Date(x.uploadedAt).toLocaleDateString('en-IN') + ' by ' + (x.uploadedBy||'—') + '</div>' +
      '</div>' +
      '<div class="xray-actions">' +
      '<button class="btn-sm" onclick="shareXray(\'' + _xrayRxId + '\',' + x.id + ')" title="Share via WhatsApp">📤</button>' +
      (!isStaff() ? '<button class="btn-sm" onclick="deleteXray(' + x.id + ')" style="color:var(--red)" title="Delete">🗑️</button>' : '') +
      '</div></div>';
  }).join('');
}

async function deleteXray(xrayId) {
  if (!_xrayRxId || !confirm('Remove this X-ray?')) return;
  const rx = _histCache.find(r => r.id === _xrayRxId);
  if (!rx || !rx.xrays) return;
  const xrays = rx.xrays.filter(x => x.id !== xrayId);
  try {
    await window._fb.updateDoc(window._fb.doc(RX_COL(), _xrayRxId), { xrays });
    rx.xrays = xrays;
    showToast('X-ray removed');
    renderXrayGallery();
  } catch (e) { showToast('Failed to remove: ' + e.message, 'err'); }
}

function shareXray(rxId, xrayId) {
  const rx = _histCache.find(r => r.id === rxId);
  if (!rx || !rx.xrays) return;
  const xray = rx.xrays.find(x => x.id === xrayId);
  if (!xray) return;
  const phone = (rx.patientContact||'').replace(/[^\d]/g,'') || '918122835737';
  const msgText = '🦷 SAI DENTAL CLINIC\nX-ray for ' + (rx.patientName||'Patient') + ' (' + (xray.name||'') + ')\n\n📎 Attach the downloaded image above';
  copyToClipboard(msgText);
  const a = document.createElement('a');
  a.href = xray.url;
  a.download = xray.name || 'xray.jpg';
  a.click();
  showToast('Image downloaded & text copied — paste in WhatsApp');
}
function dataUrlToBlob(dataUrl) {
  try {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const bytes = atob(parts[1]);
    const buf = new ArrayBuffer(bytes.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) view[i] = bytes.charCodeAt(i);
    return new Blob([buf], { type: mime });
  } catch(e) { return null; }
}

/* ═══ INIT ═══ */
waitFB(()=>{
  window._fb.onAuthStateChanged(window._auth, async user=>{
    if(user){
      qs('loginOverlay').style.display='none';
      qs('userEmail').textContent=user.email;
      qs('userAvatar').textContent=user.email[0].toUpperCase();

      /* Fetch user role (normalize email to lowercase) */
      _currentRole = await getUserRole(user.email.toLowerCase());
      setDoctorPrescriptionMode(isDoctor()||isAdmin()||isStaff()?'new':'old');
      qs('appMain').style.display='block';
      startRxListener();
      startTokenListener();

      /* Show role badge in sync bar */
      const roleBadge = document.createElement('span');
      roleBadge.id = 'roleBadge';
      roleBadge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:10px;font-weight:500;margin-left:6px';
      roleBadge.style.background = isStaff() ? '#f59e0b' : 'var(--teal)';
      roleBadge.style.color = '#fff';
      roleBadge.textContent = isStaff() ? 'STAFF' : isDoctor() ? 'DOCTOR' : 'ADMIN';
      const existingBadge = document.getElementById('roleBadge');
      if (existingBadge) existingBadge.remove();
      qs('userEmail').after(roleBadge);

      applyRoleUI();
      updateBackBtn();

      updateNet();
      qs('todayDate').textContent=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
      qs('notes').value='Avoid hot food for 24 hrs. Rinse with warm salt water twice daily. Take medicines after food.';
      qs('followup').value='After 5 days';
      addRow({});
      /* Init X-ray card in readonly (pre-save) state */
      _xrayRxId=null;
      const initXc=qs('xrayCard');
      if(initXc){initXc.style.display='block';initXc.dataset.readonly='1';}
      const initXg=qs('xrayGallery');
      if(initXg)initXg.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px 0">💡 Save this prescription first to enable X-ray uploads</div>';
      const initXu=qs('xrayUploadBtn');
      if(initXu)initXu.style.display='none';
      try{
        const c=await getSetting('rxCounter')||0;
        qs('rxNo').textContent='RX-'+String(c+1).padStart(4,'0');
      }catch(e){}
      await loadHist();
      applyRoleUI(); /* refresh follow-up badge after history loads */
      updateBackBtn();
      if(isStaff())setTimeout(()=>showFupNotification(),500);
      const rxBtn=document.querySelector(`.tab[onclick*="newRx"]`);
      if(rxBtn)sw('rx',rxBtn);
      restoreDraft();
      populateDoctorSelect();
      updateAptBadge();

      /* Register service worker for PWA */
      if('serviceWorker' in navigator){
        navigator.serviceWorker.register('./sw.js').catch(()=>{});
      }
    }else{
      if(_rxUnsubscribe){_rxUnsubscribe();_rxUnsubscribe=null;}
      if(_tokenUnsubscribe){_tokenUnsubscribe();_tokenUnsubscribe=null;}
      qs('loginOverlay').style.display='flex';
      qs('appMain').style.display='none';
      const btn=qs('loginBtn');
      if(btn){btn.disabled=false;btn.textContent='Sign In';}
    }
  });
});
