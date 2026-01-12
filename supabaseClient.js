(function(){
  const sbUrl = localStorage.getItem('wk_sb_url') || '';
  const sbAnon = localStorage.getItem('wk_sb_anon') || '';
  window.WK = window.WK || {};
  window.WK.supabase = null;

  function loadScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function init(){
    if(!sbUrl || !sbAnon) return;
    try{
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
      window.WK.supabase = supabase.createClient(sbUrl, sbAnon);
    }catch(err){
      window.WK.supabase = null;
    }
  }
  init();
})();
