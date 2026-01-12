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
    const d=todayISO();
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
    const d=todayISO();
    const key = salesSession==='pagi' ? 'sales_pagi' : 'sales_sore';

    // overwrite sesi
    store.transactions = store.transactions.filter(t => !(t.txn_date===d && t.type==='income' && t.ref_table===key));
    addTransaction({txn_date:d,type:'income',category_id:getCatId('income','Penjualan'),amount:total,note:'',ref_table:key});
    saveStore(store);
    enqueueSync('transactions', store.transactions.slice(-1));
    flushOutbox();
    alert('Penjualan tersimpan.');
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
      <label class="field" style="min-width:0">
        <span>Jenis stok</span>
        <input class="li-name" type="text" placeholder="mis. gula, minyak, kopi" list="dlStokType" autocomplete="off">
      </label>
      <label class="field" style="min-width:0">
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
      const amt=num(r.querySelector('.li-amt').value);
      if(!name){ alert('Isi nama jenis stok.'); return; }
      if(amt<=0){ alert('Nominal harus > 0.'); return; }
      lines.push({name, amt});
    }
    const total=lines.reduce((a,x)=>a+x.amt,0);
    const d=todayISO();

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
$('#stokTotal').textContent=rupiah(0);
    alert('Belanja stok tersimpan.');
  }

  function saveExpense(){
    const type = ($('#expType').value||'').trim();
    if(!type){ alert('Isi jenis pengeluaran.'); return; }
    const amtStr=$('#expAmount').value;
    if(amtStr===''){ alert('Isi nominal.'); return; }
    const amount=num(amtStr);
    if(amount<=0){ alert('Nominal harus > 0.'); return; }
    const d=todayISO();
    addTransaction({txn_date:d,type:'expense',category_id:getCatId('expense','Pengeluaran'),amount,note:type,ref_table:'expense'});
    saveStore(store);
    enqueueSync('transactions', store.transactions.slice(-1));
    flushOutbox();
    $('#expType').value='';
    $('#expAmount').value='';
    alert('Pengeluaran tersimpan.');
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
      pill.innerHTML = `
        <span class="dot" style="background:${t.type==='income'?'var(--green)':'var(--bad)'}"></span>
        <strong>${label}</strong>
        <span class="muted">${t.note ? t.note : ''}</span>
        <span style="margin-left:auto; font-weight:950; color:${t.type==='income'?'var(--green)':'var(--bad)'}">
          ${t.type==='income'?'+':'-'} ${rupiah(t.amount)}
        </span>`;
      list.appendChild(pill);

      if(t.ref_table==='stok'){
        const lines = store.stok_lines.filter(x=>x.txn_id===t.id);
        if(lines.length){
          const sub=document.createElement('div');
          sub.className='pill';
          sub.style.background='#fafbfc';
          sub.style.borderStyle='dashed';
          sub.innerHTML = `<span class="muted tiny">Rincian:</span>
            <span class="muted tiny">${lines.map(x=>`${x.item_name} (${rupiah(x.amount)})`).join(' • ')}</span>`;
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
  function openSettings(){
$('#setSbUrl').value = localStorage.getItem('wk_sb_url') || '';
    $('#setSbAnon').value = localStorage.getItem('wk_sb_anon') || '';
    $('#modalSettings').classList.remove('hidden');
  }
  function saveSettings(){
localStorage.setItem('wk_sb_url', ($('#setSbUrl').value||'').trim());
    localStorage.setItem('wk_sb_anon', ($('#setSbAnon').value||'').trim());
    saveStore(store);
    $('#modalSettings').classList.add('hidden');
    alert('Pengaturan tersimpan.');
    const active=$$('.nav-item').find(b=>b.classList.contains('active'));
    if(active && active.dataset.view==='harian') renderDaily();
    if(active?.dataset.view==='bulanan') renderMonthly();
  }
  function resetLocal(){
    if(!confirm('Reset semua data lokal?')) return;
    localStorage.removeItem(LS_KEY);
    store = loadStore();
    ensureSeed();
    location.reload();
  }

  
  // ===== AUTO-SYNC to Supabase (if configured) =====
  function sbReady(){
    return window.WK && window.WK.supabase;
  }

  function enqueueSync(table, rows){
    if(!rows || rows.length===0) return;
    store.outbox = store.outbox || [];
    store.outbox.push({table, rows});
    saveStore(store);
  }

  async function flushOutbox(){
    const sb = sbReady();
    if(!sb) return false;
    if(!store.outbox || store.outbox.length===0) return true;

    // merge ops by table to reduce requests
    const grouped = {};
    store.outbox.forEach(op=>{
      if(!grouped[op.table]) grouped[op.table] = [];
      grouped[op.table].push(...op.rows);
    });

    try{
      for(const table of Object.keys(grouped)){
        const rows = grouped[table];
        // de-duplicate by id
        const byId = new Map();
        rows.forEach(r=>{ if(r && r.id) byId.set(r.id, r); });
        const uniq = Array.from(byId.values());
        const onConflict = (table==='categories') ? 'type,name' : 'id';
        const { error } = await sb.from(table).upsert(uniq, { onConflict });
        if(error) throw error;
      }
      // clear outbox if success
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
    // enqueue base tables (idempotent)
    enqueueSync('accounts', store.accounts || []);
    enqueueSync('categories', store.categories || []);
    // flush
    await flushOutbox();
  }

  function scheduleSync(){
    // try soon after load (supabaseClient may still be loading)
    setTimeout(()=>flushOutbox(), 1200);
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

  function init(){
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
$('#btnSettings').addEventListener('click', openSettings);
    $('#btnCloseSettings').addEventListener('click', ()=>$('#modalSettings').classList.add('hidden'));
    $('#btnSaveSettings').addEventListener('click', saveSettings);
    $('#btnResetLocal').addEventListener('click', resetLocal);
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