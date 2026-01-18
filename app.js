
  function inputDateISO(){
    const el = document.getElementById('inputDate');
    if(el && el.value) return el.value;
    // fallback: today in local time
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const da = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${da}`;
  }

(function(){
  const fmt = new Intl.NumberFormat('id-ID');
  const rupiah = (n) => 'Rp ' + fmt.format(Math.round((Number(n)||0)));
  const todayISO = () => new Date().toISOString().slice(0,10);
  const LS_KEY = 'wk_store_v3';

  const DEFAULTS = {
    settings: {},
    accounts: [],
    categories: [],
    transactions: [],
    stok_lines: [], // {id, txn_id, item_name, amount, created_at}
    outbox: [] // queued sync ops: {table, rows}
  };

  function clone(obj){
    if(typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
  }
  function loadStore(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return clone(DEFAULTS);
      const obj = JSON.parse(raw);
      return {...clone(DEFAULTS), ...obj};
    }catch{
      return clone(DEFAULTS);
    }
  }
  function saveStore(s){ localStorage.setItem(LS_KEY, JSON.stringify(s)); }
  function uid(){
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
      const r = Math.random()*16|0;
      const v = c==='x'? r : (r&0x3|0x8);
      return v.toString(16);
    });
  }

  let store = loadStore();
  const $ = (q)=>document.querySelector(q);
  const $$ = (q)=>Array.from(document.querySelectorAll(q));

  function escapeHtml(s){
    return String(s||'')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  function showToast(msg){
    const t = document.getElementById('toast');
    if(!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._tm);
    showToast._tm = setTimeout(()=>t.classList.remove('show'), 2200);
  }


  function isOnline(){
    // navigator.onLine is not perfect, but good enough to avoid noisy fetch errors
    return (typeof navigator !== 'undefined') ? navigator.onLine : true;
  }

  const num = (v)=>Number(v||0);

  function ensureSeed(){
    if(store.accounts.length===0){
      store.accounts.push({id: uid(), name:'Kas Warung', type:'cash', opening_balance:0});
    }
    if(store.categories.length===0){
      store.categories.push({id: uid(), type:'income', name:'Penjualan'});
      store.categories.push({id: uid(), type:'expense', name:'Belanja Stok'});
      store.categories.push({id: uid(), type:'expense', name:'Pengeluaran'});
    }
    saveStore(store);
  }
  ensureSeed();

  function getCatId(type, name){
    const c = store.categories.find(x=>x.type===type && x.name===name);
    return c ? c.id : null;
  }

  function addTransaction({txn_date, type, category_id, amount, note, ref_table}){
    const t = {
      id: uid(),
      txn_date,
      type,
      account_id: store.accounts[0].id,
      category_id,
      amount: num(amount),
      note: note||'',
      ref_table: ref_table||null,
      created_at: new Date().toISOString()
    };
    store.transactions.push(t);
    saveStore(store);
    return t;
  }

  function txnsBetween(startISO, endISO){
    return store.transactions.filter(t => t.txn_date>=startISO && t.txn_date<=endISO);
  }

  function computeRunningBalance(untilDate){
    const opening = num(store.accounts[0].opening_balance||0);
    const txns = store.transactions
      .filter(t=>t.txn_date<=untilDate)
      .sort((a,b)=>a.txn_date.localeCompare(b.txn_date));
    return txns.reduce((b,t)=>{
      if(t.type==='income') return b + num(t.amount);
      if(t.type==='expense') return b - num(t.amount);
      return b;
    }, opening);
  }

  function sumSalesSession(d, session){
    const key = session==='pagi' ? 'sales_pagi' : 'sales_sore';
    return store.transactions
      .filter(t=>t.txn_date===d && t.type==='income' && t.ref_table===key)
      .reduce((a,t)=>a+num(t.amount),0);
  }

  function sumExpenseByCat(d, catName){
    const catId = getCatId('expense', catName);
    return store.transactions
      .filter(t=>t.txn_date===d && t.type==='expense' && t.category_id===catId)
      .reduce((a,t)=>a+num(t.amount),0);
  }

  function dailySummary(d){
    const pagi = sumSalesSession(d,'pagi');
    const sore = sumSalesSession(d,'sore');
    const sales = pagi+sore;
    const stok = sumExpenseByCat(d,'Belanja Stok');
    const exp = sumExpenseByCat(d,'Pengeluaran');
    const net = sales - stok - exp;
    const bal = computeRunningBalance(d);
    return {sales, pagi, sore, stok, exp, net, bal};
  }

  // ===== UI NAV =====
  function showView(name){
    $$('.view').forEach(v=>v.classList.add('hidden'));
    $('#view-'+name).classList.remove('hidden');
    $$('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
    if(name==='harian') renderDaily();
    if(name==='bulanan') renderMonthly();
  }

  // ===== CATAT: SALES =====
  let salesSession='pagi';
  function setSalesSession(sess){
    salesSession=sess;
    $('#btnSessPagi').classList.toggle('active', sess==='pagi');
    $('#btnSessSore').classList.toggle('active', sess==='sore');
    $('#sessLabel').textContent = sess==='pagi' ? 'Pagi' : 'Sore';
    loadSalesSessionValue();
  }

  function loadSalesSessionValue(){
    const d=inputDateISO();
    const key = salesSession==='pagi' ? 'sales_pagi' : 'sales_sore';
    const tx = store.transactions
      .filter(t=>t.txn_date===d && t.type==='income' && t.ref_table===key)
      .sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''))[0];
    $('#salesTotal').value = tx ? String(num(tx.amount)) : '';
}

  function saveSales(){
    const totalStr=$('#salesTotal').value;
    if(totalStr===''){ alert('Isi total penjualan.'); return; }
    const total=num(totalStr);
    const d=inputDateISO();
    const key = salesSession==='pagi' ? 'sales_pagi' : 'sales_sore';

    // overwrite sesi
    store.transactions = store.transactions.filter(t => !(t.txn_date===d && t.type==='income' && t.ref_table===key));
    addTransaction({txn_date:d,type:'income',category_id:getCatId('income','Penjualan'),amount:total,note:'',ref_table:key});
    saveStore(store);
    enqueueSync('transactions', store.transactions.slice(-1));
    flushOutbox();
    showToast('Penjualan tersimpan.');
  }

  // ===== CATAT: EXPENSE (MERGED) =====
  let expMode='stok'; // stok | lain

  function setExpMode(mode){
    expMode=mode;
    $('#btnExpStok').classList.toggle('active', mode==='stok');
    $('#btnExpLain').classList.toggle('active', mode==='lain');
    $('#panel-stok').classList.toggle('hidden', mode!=='stok');
    $('#panel-lain').classList.toggle('hidden', mode!=='lain');
  }

  function makeStokRow(){
    const row=document.createElement('div');
    row.className='stok-line';
    row.innerHTML = `
      <label class="field col-name" style="min-width:0">
        <span>Jenis stok</span>
        <input class="li-name" type="text" placeholder="mis. gula, minyak, kopi" list="dlStokType" autocomplete="off">
      </label>
      <label class="field" style="min-width:0">
        <span>Qty</span>
        <input class="li-qty" type="number" min="0" step="1" placeholder="mis. 2">
      </label>
      <label class="field" style="min-width:0">
        <span>Unit</span>
        <input class="li-unit" type="text" placeholder="pcs/kg/dus">
      </label>
      <label class="field col-amt" style="min-width:0">
        <span>Nominal</span>
        <input class="li-amt" type="number" min="0" step="500" placeholder="mis. 25000">
      </label>
      <button class="remove" title="Hapus">🗑</button>
    `;
    row.querySelector('.remove').addEventListener('click', ()=>{ row.remove(); recalcStokTotal(); });
    row.querySelector('.li-amt').addEventListener('input', recalcStokTotal);
    return row;
  }

  function recalcStokTotal(){
    const rows=Array.from($('#stokItems').querySelectorAll('.stok-line'));
    const total=rows.reduce((a,r)=>a+num(r.querySelector('.li-amt').value),0);
    $('#stokTotal').textContent = rupiah(total);
    return total;
  }

  function addStokRow(){
    const row = makeStokRow();
    $('#stokItems').appendChild(row);
    recalcStokTotal();
    // UX: fokus ke input pertama dan scroll halus
    const inp = row.querySelector('.li-name');
    if(inp){ inp.focus({preventScroll:true}); }
    row.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  function saveStok(){
    const rows=Array.from($('#stokItems').querySelectorAll('.stok-line'));
    if(rows.length===0){ alert('Tambah minimal 1 item stok.'); return; }
    const lines=[];
    for(const r of rows){
      const name=(r.querySelector('.li-name').value||'').trim();
      const qty=num(r.querySelector('.li-qty')?.value);
      const unit=(r.querySelector('.li-unit')?.value||'').trim();
      const amt=num(r.querySelector('.li-amt').value);
      if(!name){ alert('Isi nama jenis stok.'); return; }
      if(amt<=0){ alert('Nominal harus > 0.'); return; }
      lines.push({name, amt});
    }
    const total=lines.reduce((a,x)=>a+x.amt,0);
    const d=inputDateISO();

    const tx=addTransaction({txn_date:d,type:'expense',category_id:getCatId('expense','Belanja Stok'),amount:total,note:'',ref_table:'stok'});
    for(const x of lines){
      store.stok_lines.push({id:uid(), txn_id:tx.id, item_name:x.name, amount:x.amt, created_at:new Date().toISOString()});
    }
    saveStore(store);
    // queue sync (transaction + stok lines)
    enqueueSync('transactions', [tx]);
    enqueueSync('stok_lines', store.stok_lines.filter(x=>x.txn_id===tx.id));
    flushOutbox();

    // reset
    $('#stokItems').innerHTML='';
    addStokRow();
    // default tanggal input
    const idt = $('#inputDate');
    if(idt && !idt.value) idt.value = todayISO();

    // edit modal bindings
    const bClose = $('#btnCloseEdit');
    if(bClose) bClose.addEventListener('click', closeEditTxn);
    const bSave = $('#btnSaveEdit');
    if(bSave) bSave.addEventListener('click', saveEditTxn);
    const bDel = $('#btnDeleteTxn');
    if(bDel) bDel.addEventListener('click', deleteEditTxn);
    const bAdd = $('#btnAddEditStok');
    if(bAdd) bAdd.addEventListener('click', ()=>{
      const box = $('#editStokItems');
      if(box) box.appendChild(makeEditStokRow({item_name:'', qty:null, unit:'', amount:0}));
    });

    // klik transaksi di laporan harian untuk edit
    const dtl = $('#dailyTxnList');
    if(dtl){
      dtl.addEventListener('click', (e)=>{
        const pill = e.target.closest('.pill');
        if(pill && pill.dataset && pill.dataset.txnId){
          openEditTxn(pill.dataset.txnId);
        }
      });
    }

    // close modal on backdrop
    const me = $('#modalEditTxn');
    if(me){
      me.addEventListener('click', (e)=>{ if(e.target===me) closeEditTxn(); });
    }

$('#stokTotal').textContent=rupiah(0);
    showToast('Belanja stok tersimpan.');
  }

  function saveExpense(){
    const type = ($('#expType').value||'').trim();
    if(!type){ alert('Isi jenis pengeluaran.'); return; }
    const amtStr=$('#expAmount').value;
    if(amtStr===''){ alert('Isi nominal.'); return; }
    const amount=num(amtStr);
    if(amount<=0){ alert('Nominal harus > 0.'); return; }
    const d=inputDateISO();
    addTransaction({txn_date:d,type:'expense',category_id:getCatId('expense','Pengeluaran'),amount,note:type,ref_table:'expense'});
    saveStore(store);
    enqueueSync('transactions', store.transactions.slice(-1));
    flushOutbox();
    $('#expType').value='';
    $('#expAmount').value='';
    showToast('Pengeluaran tersimpan.');
  }

  // ===== REPORT: DAILY =====
  function renderDaily(){
    const dateEl=$('#dailyDate');
    if(!dateEl.value) dateEl.value=todayISO();
    const d=dateEl.value;
    const s=dailySummary(d);

    $('#dSales').textContent=rupiah(s.sales);
    $('#dSalesSplit').textContent=`Pagi ${rupiah(s.pagi)} • Sore ${rupiah(s.sore)}`;
    $('#dStok').textContent=rupiah(s.stok);
    $('#dExp').textContent=rupiah(s.exp);
    $('#dNet').textContent=rupiah(s.net);
$('#dBalance').textContent=rupiah(s.bal);

    const txns = store.transactions
      .filter(t=>t.txn_date===d)
      .sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));

    const list=$('#dailyTxnList');
    if(txns.length===0){
      list.classList.add('muted');
      list.textContent='Belum ada transaksi.';
      return;
    }
    list.classList.remove('muted');
    list.innerHTML='';
    txns.forEach(t=>{
      const cat=store.categories.find(c=>c.id===t.category_id);
      let label = cat ? cat.name : '';
      if(t.ref_table==='sales_pagi') label='Penjualan (Pagi)';
      if(t.ref_table==='sales_sore') label='Penjualan (Sore)';

      const pill=document.createElement('div');
      pill.className='pill';
      pill.dataset.txnId = t.id;
      pill.innerHTML = `
        <span class="dot" style="background:${t.type==='income'?'var(--green)':'var(--bad)'}"></span>
        <strong>${label}</strong>
        <span class="muted">${t.note ? t.note : ''}</span>
        <span style="margin-left:auto; font-weight:950; color:${t.type==='income'?'var(--green)':'var(--bad)'}">
          ${t.type==='income'?'+':'-'} ${rupiah(t.amount)}
        </span>`;
      pill.style.cursor='pointer';
      pill.addEventListener('click', ()=>openEditTxn(t.id));
      list.appendChild(pill);

      if(t.ref_table==='stok'){
        const lines = store.stok_lines.filter(x=>x.txn_id===t.id);
        if(lines.length){
          const sub=document.createElement('div');
          sub.className='pill';
          sub.dataset.txnId = t.id;
          sub.style.background='#fafbfc';
          sub.style.borderStyle='dashed';
          sub.innerHTML = `<span class="muted tiny">Rincian:</span>
            <span class="muted tiny">${lines.map(x=>`${x.item_name} (${rupiah(x.amount)})`).join(' • ')}</span>`;
          sub.style.cursor='pointer';
          sub.addEventListener('click', ()=>openEditTxn(t.id));
          list.appendChild(sub);
        }
      }
    });
  }

  // ===== REPORT: MONTHLY =====
  function renderMonthly(){
    const monthEl=$('#reportMonth');
    if(!monthEl.value) monthEl.value=new Date().toISOString().slice(0,7);
    const ym=monthEl.value;
    const start=ym+'-01', end=ym+'-31';
    const txns=txnsBetween(start,end);

    const sales = txns.filter(t=>t.type==='income').reduce((a,t)=>a+num(t.amount),0);
    const stokCat=getCatId('expense','Belanja Stok');
    const expCat=getCatId('expense','Pengeluaran');
    const stok = txns.filter(t=>t.type==='expense' && t.category_id===stokCat).reduce((a,t)=>a+num(t.amount),0);
    const exp = txns.filter(t=>t.type==='expense' && t.category_id===expCat).reduce((a,t)=>a+num(t.amount),0);
    const net = sales - stok - exp;

    $('#mSales').textContent=rupiah(sales);
    $('#mStok').textContent=rupiah(stok);
    $('#mExp').textContent=rupiah(exp);
    $('#mNet').textContent=rupiah(net);
const list=$('#monthTxnList');
    if(txns.length===0){
      list.classList.add('muted');
      list.textContent='Belum ada transaksi.';
      return;
    }
    list.classList.remove('muted');
    list.innerHTML='';
    txns.sort((a,b)=> (b.txn_date+(b.created_at||'')).localeCompare(a.txn_date+(a.created_at||''))).slice(0,80).forEach(t=>{
      const cat=store.categories.find(c=>c.id===t.category_id);
      let label = cat ? cat.name : '';
      if(t.ref_table==='sales_pagi') label='Penjualan (Pagi)';
      if(t.ref_table==='sales_sore') label='Penjualan (Sore)';
      const pill=document.createElement('div');
      pill.className='pill';
      pill.dataset.txnId = t.id;
      pill.style.cursor='pointer';
      pill.addEventListener('click', ()=>openEditTxn(t.id));
      pill.dataset.txnId = t.id;
      pill.innerHTML = `
        <span class="dot" style="background:${t.type==='income'?'var(--green)':'var(--bad)'}"></span>
        <strong>${t.txn_date}</strong>
        <span class="muted">${label}</span>
        <span style="margin-left:auto; font-weight:950; color:${t.type==='income'?'var(--green)':'var(--bad)'}">
          ${t.type==='income'?'+':'-'} ${rupiah(t.amount)}
        </span>`;
      list.appendChild(pill);
    });
  }

  // ===== SETTINGS =====

  
  
  async function bootstrapSupabase(){
    const sb = sbReady();
    if(!sb) return;

    try{
      // 1) Load categories from remote (source of truth)
      const { data: remoteCats, error: catErr } = await sb.from('categories').select('id,type,name');
      if(catErr) throw catErr;

      if(Array.isArray(remoteCats) && remoteCats.length){
        // Build mapping by (type|name) -> id
        const map = new Map(remoteCats.map(c=>[`${c.type}||${c.name}`, c.id]));
        const oldCats = store.categories || [];
        const newCats = oldCats.map(c=>{
          const key = `${c.type}||${c.name}`;
          const rid = map.get(key);
          return rid ? {...c, id: rid} : c;
        });

        // migrate existing transactions category_id to remote ids (by matching type+name)
        const oldIdToKey = new Map(oldCats.map(c=>[c.id, `${c.type}||${c.name}`]));
        const keyToNewId = new Map(newCats.map(c=>[`${c.type}||${c.name}`, c.id]));
        if(store.transactions && store.transactions.length){
          store.transactions = store.transactions.map(t=>{
            const key = oldIdToKey.get(t.category_id);
            if(!key) return t;
            const nid = keyToNewId.get(key);
            return nid ? {...t, category_id: nid} : t;
          });
        }
        store.categories = newCats;
      }

      // 2) Load accounts from remote (source of truth)
      const { data: remoteAcc, error: accErr } = await sb.from('accounts').select('id,name,type,opening_balance');
      if(accErr) throw accErr;

      if(Array.isArray(remoteAcc) && remoteAcc.length){
        const oldAcc = store.accounts || [];
        // take first account as main (Kas Warung)
        const main = remoteAcc[0];
        // migrate transactions account_id
        const oldMainId = oldAcc[0]?.id;
        if(oldMainId && store.transactions && store.transactions.length){
          store.transactions = store.transactions.map(t=> t.account_id===oldMainId ? {...t, account_id: main.id} : t);
        }
        store.accounts = [main];
      }

      saveStore(store);
      console.log('[WarungKu] Bootstrap OK (categories/accounts aligned)');
    }catch(err){
      if(!isOnline()) return; console.warn('[WarungKu] Bootstrap gagal:', err?.message || err);
    }
  }

// ===== AUTO-SYNC to Supabase (if configured) =====
  function sbReady(){
    return window.WK && window.WK.supabase;
  }

  function enqueueSync(table, rows){
    if(!rows || rows.length===0) return;
    store.outbox = store.outbox || [];
    store.outbox.push({table, action:'upsert', rows});
    saveStore(store);
  }

  function enqueueDelete(table, ids){
    if(!ids || ids.length===0) return;
    store.outbox = store.outbox || [];
    store.outbox.push({table, action:'delete', ids});
    saveStore(store);
  }


  async function pullRemoteData(days=365){
    const sb = sbReady();
    if(!sb) return;

    const since = new Date();
    since.setDate(since.getDate()-days);
    const sinceISO = since.toISOString().slice(0,10);

    const { data: rTx, error: txErr } = await sb
      .from('transactions')
      .select('id,txn_date,type,account_id,category_id,amount,note,ref_table,created_at')
      .gte('txn_date', sinceISO)
      .order('txn_date', { ascending: true })
      .limit(5000);
    if(txErr) throw txErr;

    // merge by id
    const txById = new Map((store.transactions||[]).map(t=>[t.id,t]));
    (rTx||[]).forEach(t=>txById.set(t.id, t));
    store.transactions = Array.from(txById.values());

    const ids = (rTx||[]).map(t=>t.id);
    if(ids.length){
      const { data: rLines, error: lErr } = await sb
        .from('stok_lines')
        .select('id,txn_id,item_name,qty,unit,amount,created_at')
        .in('txn_id', ids)
        .limit(20000);
      if(lErr) throw lErr;

      const lineById = new Map((store.stok_lines||[]).map(l=>[l.id,l]));
      (rLines||[]).forEach(l=>lineById.set(l.id, l));
      store.stok_lines = Array.from(lineById.values());
    }

    saveStore(store);
    console.log('[WarungKu] Pull remote OK');
  }


  async function flushOutbox(){
    const sb = sbReady();
    if(!sb) return false;
    if(!store.outbox || store.outbox.length===0) return true;

    // normalize legacy ops (no action)
    store.outbox = store.outbox.map(op=>{
      if(!op.action){
        return { table: op.table, action: 'upsert', rows: op.rows || [] };
      }
      return op;
    });

    const upserts = {};
    const deletes = {};
    for(const op of store.outbox){
      if(op.action==='delete'){
        if(!deletes[op.table]) deletes[op.table] = new Set();
        (op.ids||[]).forEach(id=>deletes[op.table].add(id));
      }else{
        if(!upserts[op.table]) upserts[op.table] = [];
        (op.rows||[]).forEach(r=>upserts[op.table].push(r));
      }
    }

    try{
      // deletes first (FK: stok_lines -> transactions)
      const delOrder = ['stok_lines','transactions'];
      for(const table of delOrder){
        if(!deletes[table]) continue;
        const ids = Array.from(deletes[table]);
        if(ids.length===0) continue;
        const { error } = await sb.from(table).delete().in('id', ids);
        if(error) throw error;
      }
      for(const table of Object.keys(deletes)){
        if(delOrder.includes(table)) continue;
        const ids = Array.from(deletes[table]);
        if(ids.length===0) continue;
        const { error } = await sb.from(table).delete().in('id', ids);
        if(error) throw error;
      }

      for(const table of Object.keys(upserts)){
        if(table==='categories' || table==='accounts') continue;
        const rows = upserts[table];
        const byId = new Map();
        rows.forEach(r=>{ if(r && r.id) byId.set(r.id, r); });
        const uniq = Array.from(byId.values());
        if(uniq.length===0) continue;
        const onConflict = (table==='categories') ? 'type,name' : 'id';
        const { error } = await sb.from(table).upsert(uniq, { onConflict });
        if(error) throw error;
      }

      store.outbox = [];
      saveStore(store);
      console.log('[WarungKu] Sync OK');
      return true;
    }catch(err){
      console.warn('[WarungKu] Sync gagal, akan coba lagi:', err?.message || err);
      return false;
    }
  }

  async function syncNow(){
    if(!isOnline()){
      // offline: jangan spam error, tunggu online
      return;
    }

    const sb = sbReady();
    if(!sb) return;
    const url = (window.SUPABASE_URL||'');
    if(/YOUR_PROJECT|your_project/i.test(url)){
      // config placeholder, jangan sync
      return;
    }
    try{
      await bootstrapSupabase();
    }catch(e){
      if(!isOnline()) return; console.warn('[WarungKu] Bootstrap gagal:', e?.message || e);
    }
    try{
      await pullRemoteData(365);
    }catch(e){
      console.warn('[WarungKu] Pull gagal:', e?.message || e);
    }
    try{
      await flushOutbox();
    }catch(e){
      console.warn('[WarungKu] Flush gagal:', e?.message || e);
    }
  }

  function scheduleSync(){
    if(!isOnline()){
      // offline: coba lagi saat online
      return;
    }

    // try soon after load (supabaseClient may still be loading)
    setTimeout(()=>{ const u=(window.SUPABASE_URL||''); if(!/YOUR_PROJECT|your_project/i.test(u)){ bootstrapSupabase(); flushOutbox(); } }, 1200);
    // periodic retry
    setInterval(()=>flushOutbox(), 15000);
  }

// ===== SYNC (OPTIONAL) =====
  async function syncToSupabase(){
    const sb=window.WK && window.WK.supabase;
    if(!sb){ alert('Supabase belum siap. Isi di Pengaturan, lalu reload.'); return; }
    try{
      const payloads=[
        ['accounts',store.accounts],
        ['categories',store.categories],
        ['transactions',store.transactions],
        ['stok_lines',store.stok_lines],
      ];
      for(const [table,rows] of payloads){
        if(!rows||rows.length===0) continue;
        const {error}=await sb.from(table).upsert(rows,{onConflict:'id'});
        if(error) throw error;
      }
      alert('Sync selesai.');
    }catch(err){
      alert('Sync gagal: '+(err.message||err));
    }
  }

  
  let _editTxnId = null;

  function makeEditStokRow(line){
    const row=document.createElement('div');
    row.className='stok-line';
    row.innerHTML = `
      <label class="field col-name" style="min-width:0">
        <span>Jenis stok</span>
        <input class="li-name" type="text" list="dlStokType" autocomplete="off" value="${escapeHtml(line.item_name||'')}">
      </label>
      <label class="field" style="min-width:0">
        <span>Qty</span>
        <input class="li-qty" type="number" min="0" step="1" value="${line.qty ?? ''}">
      </label>
      <label class="field" style="min-width:0">
        <span>Unit</span>
        <input class="li-unit" type="text" value="${escapeHtml(line.unit||'')}">
      </label>
      <label class="field col-amt" style="min-width:0">
        <span>Nominal</span>
        <input class="li-amt" type="number" min="0" step="500" value="${line.amount ?? 0}">
      </label>
      <button class="remove" title="Hapus">🗑</button>
    `;
    row.querySelector('.remove').addEventListener('click', ()=>row.remove());
    return row;
  }

  function openEditTxn(txnId){
    const tx = (store.transactions||[]).find(x=>x.id===txnId);
    if(!tx) return;
    _editTxnId = txnId;

    $('#editDate').value = tx.txn_date;
    $('#editAmount').value = tx.amount;

    const cat = (store.categories||[]).find(c=>c.id===tx.category_id);
    const isPengeluaran = (tx.type==='expense' && cat && cat.name==='Pengeluaran');
    const isStok = (tx.type==='expense' && cat && cat.name==='Belanja Stok');

    $('#editTypeWrap').classList.toggle('hidden', !isPengeluaran);
    $('#editStokWrap').classList.toggle('hidden', !isStok);

    if(isPengeluaran){
      $('#editType').value = tx.note || '';
    }

    if(isStok){
      const box = $('#editStokItems');
      box.innerHTML = '';
      const lines = (store.stok_lines||[]).filter(l=>l.txn_id===tx.id);
      (lines.length?lines:[{item_name:'',qty:null,unit:'',amount:0}]).forEach(line=>{
        box.appendChild(makeEditStokRow(line));
      });
    }

    $('#modalEditTxn').classList.remove('hidden');
  }

  function closeEditTxn(){
    $('#modalEditTxn').classList.add('hidden');
    _editTxnId = null;
  }

  async function saveEditTxn(){
    const id = _editTxnId;
    if(!id) return;
    const tx = (store.transactions||[]).find(x=>x.id===id);
    if(!tx) return;

    const newDate = $('#editDate').value || tx.txn_date;
    const newAmt = num($('#editAmount').value);
    if(newAmt<=0){ alert('Nominal harus > 0.'); return; }

    const cat = (store.categories||[]).find(c=>c.id===tx.category_id);
    const isPengeluaran = (tx.type==='expense' && cat && cat.name==='Pengeluaran');
    const isStok = (tx.type==='expense' && cat && cat.name==='Belanja Stok');

    tx.txn_date = newDate;
    tx.amount = newAmt;

    if(isPengeluaran){
      tx.note = ($('#editType').value||'').trim();
    }


  async function deleteEditTxn(){
    const id = _editTxnId;
    if(!id) return;
    if(!confirm('Hapus transaksi ini?')) return;

    // remove local transaction
    store.transactions = (store.transactions||[]).filter(t=>t.id!==id);

    // remove local stok lines
    const lines = (store.stok_lines||[]).filter(l=>l.txn_id===id);
    store.stok_lines = (store.stok_lines||[]).filter(l=>l.txn_id!==id);

    saveStore(store);

    enqueueDelete('stok_lines', lines.map(l=>l.id));
    enqueueDelete('transactions', [id]);

    await flushOutbox();

    showToast('Transaksi dihapus.');
    renderDaily();
    renderMonthly();
    closeEditTxn();
  }

    if(isStok){
      store.stok_lines = (store.stok_lines||[]).filter(l=>l.txn_id!==tx.id);
      const rows = Array.from($('#editStokItems').querySelectorAll('.stok-line'));
      rows.forEach(r=>{
        const name=(r.querySelector('.li-name').value||'').trim();
        const qty=num(r.querySelector('.li-qty')?.value);
        const unit=(r.querySelector('.li-unit')?.value||'').trim();
        const amt=num(r.querySelector('.li-amt').value);
        if(name && amt>0){
          store.stok_lines.push({id:uid(), txn_id: tx.id, item_name:name, qty:(qty||null), unit:(unit||null), amount:amt, created_at: new Date().toISOString()});
        }
      });
    }

    saveStore(store);
    enqueueSync('transactions', [tx]);
    if(isStok){
      enqueueSync('stok_lines', (store.stok_lines||[]).filter(l=>l.txn_id===tx.id));
    }
    await flushOutbox();

    showToast('Perubahan disimpan.');
    renderDaily();
    renderMonthly();
    closeEditTxn();
  }

function init(){
    // when connection returns, pull + flush
    window.addEventListener('online', ()=>{ try{ syncNow(); }catch(e){} });
    window.addEventListener('offline', ()=>{ try{ showToast('Mode offline: data disimpan lokal'); }catch(e){} });

    
    // default dates
    const _today = (function(){
      const d=new Date(); const y=d.getFullYear();
      const m=String(d.getMonth()+1).padStart(2,'0');
      const da=String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${da}`;
    })();
    const _thisMonth = _today.slice(0,7);

    const idt = document.getElementById('inputDate');
    if(idt && !idt.value) idt.value = _today;

    const dd = document.getElementById('dailyDate');
    if(dd && !dd.value) dd.value = _today;

    const mp = document.getElementById('monthPick');
    if(mp && !mp.value) mp.value = _thisMonth;

$$('.nav-item').forEach(b=>b.addEventListener('click', ()=>showView(b.dataset.view)));

    $('#btnSessPagi').addEventListener('click', ()=>setSalesSession('pagi'));
    $('#btnSessSore').addEventListener('click', ()=>setSalesSession('sore'));
    $('#btnSaveSales').addEventListener('click', saveSales);

    $('#btnExpStok').addEventListener('click', ()=>setExpMode('stok'));
    $('#btnExpLain').addEventListener('click', ()=>setExpMode('lain'));
    $('#btnAddStokItem').addEventListener('click', addStokRow);
    $('#btnSaveStok').addEventListener('click', saveStok);
    $('#btnSaveExpense').addEventListener('click', saveExpense);

    addStokRow();

    $('#dailyDate').addEventListener('change', renderDaily);
setSalesSession('pagi');
    setExpMode('stok');

    scheduleSync();
    syncNow();

    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
    }
  }
  init();
})();