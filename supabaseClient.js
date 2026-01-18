// Supabase client bootstrap (permanen via supabase.config.js)
window.WK = window.WK || {};
(function(){
  const url = window.SUPABASE_URL;
  const anon = window.SUPABASE_ANON_KEY;
  const valid = (x)=> typeof x==="string" && x.trim().length>10;
  if(!valid(url) || !valid(anon)){
    console.warn('[WarungKu] Supabase config belum diisi (supabase.config.js). App tetap jalan offline.');
    return;
  }
  if(!window.supabase){
    console.warn('[WarungKu] supabase-js belum termuat.');
    return;
  }
  try{
    window.WK.supabase = window.supabase.createClient(url, anon, {
      auth: { persistSession: false },
      global: { headers: { 'x-client-info': 'warungku-pwa' } }
    });
    console.log('[WarungKu] Supabase siap');
  }catch(e){
    console.warn('[WarungKu] Gagal init Supabase:', e?.message || e);
  }
})();
