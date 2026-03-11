(function(){
  'use strict';

  const $ = (sel, root) => (root||document).querySelector(sel);

  function getView(){
    return document.getElementById('posinvExistenciasView') || document;
  }

  const state = {
    cat: '',
    lastScan: {v:'', t:0},
    mode: 'search',
    page: 1,
    hasMore: false,
    loading: false,
  };

  const topScan = {
    stream:null, video:null, detector:null, raf:0, active:false,
    lastRaw:'', stableCount:0, startedAt:0, track:null, lastSeenAt:0
  };

  function esc(s){
    return String(s||'').replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;" }[c]));
  }

  function setMsg(t){
    const el = $('#posinv_exi_msg');
    if(el) el.textContent = t || '';
  }

  function copyCats(){
    const catSel = $('#posinv_exi_cat');
    const globalCat = $('#posinvCat');
    if(catSel && globalCat){
      catSel.innerHTML = globalCat.innerHTML;
      catSel.value = globalCat.value || '';
      catSel.addEventListener('change', ()=>{ state.cat = catSel.value; });
      state.cat = catSel.value || '';
    }
  }

  
  function setPager(meta){
    const pageEl = $('#posinv_exi_page');
    const prevEl = $('#posinv_exi_prev');
    const nextEl = $('#posinv_exi_next');
    if(!pageEl || !prevEl || !nextEl) return;

    if(true){
      pageEl.textContent = '';
      prevEl.disabled = true;
      nextEl.disabled = true;
      return;
    }
    state.page = meta && meta.page ? meta.page : state.page;
    state.total_pages = meta && meta.total_pages ? meta.total_pages : state.total_pages;
    state.total = meta && typeof meta.total === 'number' ? meta.total : state.total;

    pageEl.textContent = `Página ${state.page} de ${state.total_pages} • Total ${state.total}`;
    prevEl.disabled = (state.page <= 1);
    nextEl.disabled = (state.page >= state.total_pages);
  }
function toggleLoadMore(show){
    const wrap = $('#posinv_exi_loadmore_wrap');
    const btn = $('#posinv_exi_loadmore');
    if(wrap) wrap.style.display = show ? 'block' : 'none';
    if(btn) btn.disabled = !show || state.loading;
  }

  function render(items, append=false){
    const tb = $('#posinv_exi_tbody');
    if(!tb) return;

    if(!items || !items.length){
      tb.innerHTML = '<tr><td colspan="9" class="posinv-muted">Sin resultados.</td></tr>';
      return;
    }

    const rows = items.map(it => {
      const img = it.image_url ? `<img src="${esc(it.image_url)}" loading="lazy" decoding="async" style="width:44px;height:44px;object-fit:cover;border-radius:8px;" />` : ''; 
      const bLoc = it.bodega_locs ? esc(it.bodega_locs) : '<span class="posinv-muted">—</span>';
      return `<tr>
        <td>${img}</td>
        <td><strong>${esc(it.id)}</strong></td>
        <td>${esc(it.code||'')}</td>
        <td>${esc(it.name||'')}</td>
        <td><strong>${esc(it.store1_stock||0)}</strong></td>
        <td><strong>${esc(it.store2_stock||0)}</strong></td>
        <td><strong>${esc(it.bodega_stock||0)}</strong></td>
        <td>${bLoc}</td>
        <td><strong>${esc(it.total||0)}</strong></td>
      </tr>`;
    }).join('');

    if(append) tb.insertAdjacentHTML('beforeend', rows);
    else tb.innerHTML = rows;
  }


  let liveTimer = 0;
  function queueLiveSearch(){
    clearTimeout(liveTimer);
    liveTimer = setTimeout(()=>{ search(); }, 250);
  }

  async function search(append=false){
    const qEl = $('#posinv_exi_search');
    const q = qEl ? (qEl.value||'').trim() : '';
    const catEl = $('#posinv_exi_cat');
    const cat = catEl ? (catEl.value||'') : (state.cat||'');

    if(!window.POSINV_EXISTENCIAS || !POSINV_EXISTENCIAS.ajaxurl){
      setMsg('Config faltante.');
      return;
    }

    state.mode='search';
    if(!append) state.page = 1;
    state.loading = true;
    toggleLoadMore(false);
    setMsg(append ? 'Cargando más...' : 'Buscando...');
    try{
      const fd = new FormData();
      fd.append('action','posinv_existencias_search');
      fd.append('nonce', POSINV_EXISTENCIAS.nonce || '');
      fd.append('q', q);
      fd.append('cat', cat);
      fd.append('page', String(state.page || 1));

      const r = await fetch(POSINV_EXISTENCIAS.ajaxurl, { method:'POST', credentials:'same-origin', body: fd });
      const j = await r.json();
      if(!j || !j.success){
        setMsg((j && j.data && j.data.message) ? j.data.message : 'Error al buscar.');
        if(!append) render([], false);
        state.loading = false;
        toggleLoadMore(false);
        return;
      }
      const items = (j.data && j.data.items) ? j.data.items : [];
      render(items, append);
      state.hasMore = !!(j.data && j.data.has_more);
      state.loading = false;
      toggleLoadMore(state.hasMore);
      const currentCount = document.querySelectorAll('#posinv_exi_tbody tr').length;
      setMsg(`Listo: ${currentCount}`);
    }catch(e){
      state.loading = false;
      toggleLoadMore(false);
      setMsg('Error de red.');
      if(!append) render([], false);
    }
  }

  function clearView(){
    const qEl = $('#posinv_exi_search');
    if(qEl) qEl.value = '';
    const tb = $('#posinv_exi_tbody');
    if(tb) tb.innerHTML = '<tr><td colspan="9" class="posinv-muted">Busca un producto para ver existencias…</td></tr>';
    setPager(null);
    state.page = 1;
    state.hasMore = false;
    toggleLoadMore(false);
    setMsg('');
  }

  
  async function loadBodegaOnly(page){
    const catEl = $('#posinv_exi_cat');
    const cat = catEl ? (catEl.value||'') : (state.cat||'');
    state.mode = 'bodega_only';
    state.page = page || 1;

    if(!window.POSINV_EXISTENCIAS || !POSINV_EXISTENCIAS.ajaxurl){
      setMsg('Config faltante.');
      return;
    }
    setMsg('Cargando solo bodega…');

    try{
      const fd = new FormData();
      fd.append('action','posinv_existencias_bodega_only');
      fd.append('nonce', POSINV_EXISTENCIAS.nonce || '');
      fd.append('cat', cat);
      fd.append('page', String(state.page));
      fd.append('per_page', String(state.per_page));

      const r = await fetch(POSINV_EXISTENCIAS.ajaxurl, { method:'POST', credentials:'same-origin', body: fd });
      const j = await r.json();
      if(!j || !j.success){
        setMsg((j && j.data && j.data.message) ? j.data.message : 'Error al cargar.');
        render([]);
        setPager({page:1,total_pages:1,total:0});
        return;
      }
      const items = (j.data && j.data.items) ? j.data.items : [];
      render(items);
      setPager({page:j.data.page, total_pages:j.data.total_pages, total:j.data.total});
      setMsg(`Listo: ${Array.isArray(items)?items.length:0}`);
    }catch(e){
      setMsg('Error de red.');
      render([]);
      setPager({page:1,total_pages:1,total:0});
    }
  }

  async function doTransfer(pid){
    if(!pid) return;
    const storeSel = document.querySelector(`.posinv-exi-store[data-pid="${pid}"]`);
    const qtyEl = document.querySelector(`.posinv-exi-qty[data-pid="${pid}"]`);
    const store = storeSel ? (storeSel.value||'') : '';
    const qty = qtyEl ? parseFloat(qtyEl.value||'0') : 0;
    if(!store || !qty || qty<=0){
      setMsg('Elige tienda y cantidad.');
      return;
    }
    if(!confirm(`¿Transferir ${qty} a ${storeSel.options[storeSel.selectedIndex].text}?`)) return;

    try{
      const fd = new FormData();
      fd.append('action','posinv_existencias_transfer');
      fd.append('nonce', POSINV_EXISTENCIAS.nonce || '');
      fd.append('product_id', String(pid));
      fd.append('store', store);
      fd.append('qty', String(qty));

      const r = await fetch(POSINV_EXISTENCIAS.ajaxurl, { method:'POST', credentials:'same-origin', body: fd });
      const j = await r.json();
      if(!j || !j.success){
        setMsg((j && j.data && j.data.message) ? j.data.message : 'Error al transferir.');
        return;
      }
      setMsg('Transferido.');
      // refrescar vista actual
      if(state.mode === 'bodega_only'){
        loadBodegaOnly(state.page);
      }else{
        state.page = 1;
    search(false);
      }
    }catch(e){
      setMsg('Error de red.');
    }
  }

  function stopTopScanner(){
    if(topScan.raf){ cancelAnimationFrame(topScan.raf); topScan.raf = 0; }
    if(topScan.stream && topScan.stream.getTracks){
      topScan.stream.getTracks().forEach((t)=>{ try{ t.stop(); }catch(_e){} });
    }
    if(topScan.video){
      try{ topScan.video.pause(); }catch(_e){}
      try{ topScan.video.srcObject = null; }catch(_e){}
    }
    topScan.stream = null;
    topScan.video = null;
    topScan.detector = null;
    topScan.active = false;
    topScan.lastRaw = '';
    topScan.stableCount = 0;
    topScan.startedAt = 0;
    topScan.track = null;
    topScan.lastSeenAt = 0;
    const view = getView();
    const wrap = $('#posinv_exi_topscan', view);
    const box = $('#posinv_exi_topscan_video', view);
    if(wrap) wrap.style.display = 'none';
    if(box) box.innerHTML = '';
  }

  async function topScannerTick(){
    if(!topScan.detector || !topScan.video) return;
    try{
      const detected = await topScan.detector.detect(topScan.video);
      if(detected && detected.length){
        let raw = '';
        for(let i=0; i<detected.length; i++){
          raw = String((detected[i] && detected[i].rawValue) || '').trim();
          if(raw) break;
        }
        if(raw){
          const nowTs = Date.now();
          if(raw === topScan.lastRaw){
            if(!topScan.lastSeenAt || (nowTs - topScan.lastSeenAt) <= 1800) topScan.stableCount += 1;
            else topScan.stableCount = 1;
          }else{
            if(topScan.lastRaw && topScan.stableCount >= 1 && (nowTs - (topScan.lastSeenAt || 0)) <= 900){
              setTopScanStatus('Mantén estable el código… (' + topScan.stableCount + '/2)');
              topScan.lastSeenAt = nowTs;
              topScan.raf = requestAnimationFrame(topScannerTick);
              return;
            }
            topScan.lastRaw = raw;
            topScan.stableCount = 1;
          }
          topScan.lastSeenAt = nowTs;
          setTopScanStatus(topScan.stableCount >= 2 ? ('Código confirmado: ' + raw) : ('Enfocando… detectado ' + raw + ' (' + topScan.stableCount + '/2)'));
          if(topScan.stableCount >= 2){
            stopTopScanner();
            const qEl = $('#posinv_exi_search');
            if(qEl) qEl.value = raw;
            onScan();
            return;
          }
        }
      }else{
        const nowMiss = Date.now();
        if(topScan.lastSeenAt && (nowMiss - topScan.lastSeenAt) > 2200){
          topScan.lastRaw = '';
          topScan.stableCount = 0;
          setTopScanStatus('Acerca o aleja un poco la cámara para enfocar…');
        }
      }
    }catch(_e){}
    topScan.raf = requestAnimationFrame(topScannerTick);
  }

  function setTopScanStatus(t){
    const el = $('#posinv_exi_topscan_status', getView());
    if(el) el.textContent = t || '';
  }

  async function openTopScanner(ev){
    if(ev){ try{ ev.preventDefault(); ev.stopPropagation(); }catch(_e){} }
    if(window.POSINV_CLOSE_SCANNER){ try{ window.POSINV_CLOSE_SCANNER(); }catch(_e){} }
    if(topScan.active){ stopTopScanner(); return; }
    stopTopScanner();
    const view = getView();
    const wrap = $('#posinv_exi_topscan', view);
    const box = $('#posinv_exi_topscan_video', view);
    if(wrap) wrap.style.display = 'block';
    const viewEl = getView();
    if(viewEl){ try{ viewEl.scrollIntoView({ block:'nearest' }); }catch(_e){} }
    if(!('BarcodeDetector' in window)){
      setTopScanStatus('Tu navegador no soporta escaneo nativo aquí. Prueba con Chrome en Android.');
      return;
    }
    try{
      topScan.detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code'] });
    }catch(_e){
      try{ topScan.detector = new BarcodeDetector(); }catch(_e2){ topScan.detector = null; }
    }
    if(!topScan.detector){
      setTopScanStatus('No se pudo iniciar el lector.');
      return;
    }
    if(!box){ stopTopScanner(); return; }
    const video = document.createElement('video');
    video.setAttribute('playsinline','');
    video.autoplay = true;
    video.muted = true;
    box.innerHTML = '';
    box.appendChild(video);
    const guide = document.createElement('div');
    guide.className = 'posinv-scan-guide';
    box.appendChild(guide);
    try{
      topScan.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          focusMode: { ideal: 'continuous' }
        },
        audio:false
      });
      topScan.video = video;
      topScan.video.srcObject = topScan.stream;
      await topScan.video.play();
      topScan.active = true;
      topScan.startedAt = Date.now();
      topScan.lastRaw = '';
      topScan.stableCount = 0;
      topScan.lastSeenAt = 0;
      topScan.track = (topScan.stream && topScan.stream.getVideoTracks) ? (topScan.stream.getVideoTracks()[0] || null) : null;
      if(topScan.track && topScan.track.applyConstraints){
        try{
          const caps = (topScan.track.getCapabilities ? topScan.track.getCapabilities() : {}) || {};
          const advanced = [];
          if(caps.focusMode && caps.focusMode.indexOf && caps.focusMode.indexOf('continuous') !== -1) advanced.push({ focusMode: 'continuous' });
          if(caps.zoom){
            let z = 1;
            if(typeof caps.zoom === 'object'){
              const minZ = Number(caps.zoom.min || 1);
              const maxZ = Number(caps.zoom.max || minZ || 1);
              z = Math.max(minZ, Math.min(maxZ, 2));
            }
            if(z > 1) advanced.push({ zoom: z });
          }
          if(advanced.length) topScan.track.applyConstraints({ advanced }).catch(()=>{});
        }catch(_capsErr){}
      }
      setTopScanStatus('Enfocando cámara…');
      topScan.raf = requestAnimationFrame(topScannerTick);
    }catch(err){
      const msg = (err && err.message) ? err.message : 'No se pudo abrir la cámara.';
      setTopScanStatus(msg);
    }
  }

function bind(){
    copyCats();
    const view = getView();
    const btn = $('#posinv_exi_btn_search', view);
    if(btn) btn.addEventListener('click', ()=>{ stopTopScanner(); search(); });

    const btnC = $('#posinv_exi_btn_clear', view);
    if(btnC) btnC.addEventListener('click', ()=>{ stopTopScanner(); clearView(); });

    const btnScan = $('#posinv_exi_btn_scan', view);
    if(btnScan) btnScan.addEventListener('click', (ev)=>openTopScanner(ev));

    const btnScanClose = $('#posinv_exi_topscan_close', view);
    if(btnScanClose) btnScanClose.addEventListener('click', stopTopScanner);

    const prev = $('#posinv_exi_prev', view);
    const next = $('#posinv_exi_next', view);
    if(prev) prev.style.display = 'none';
    if(next) next.style.display = 'none';
    const pageLbl = $('#posinv_exi_page', view);
    if(pageLbl) pageLbl.style.display = 'none';

    const moreBtn = $('#posinv_exi_loadmore', view);
    if(moreBtn){ moreBtn.addEventListener('click', ()=>{ if(state.loading || !state.hasMore) return; state.page += 1; search(true); }); }

    const qEl = $('#posinv_exi_search', view);
    if(qEl){
      qEl.addEventListener('keydown', (ev)=>{
        if(ev.key === 'Enter'){
          ev.preventDefault();
          stopTopScanner();
          search();
        }
      });
      qEl.addEventListener('input', ()=>{ queueLiveSearch(); });
    }

    const catEl = $('#posinv_exi_cat', view);
    if(catEl){
      catEl.addEventListener('change', ()=>{ stopTopScanner(); search(); });
    }
  }

  function onScan(){
    const qEl = $('#posinv_exi_search');
    if(!qEl) return;
    const v = (qEl.value||'').trim();
    const now = Date.now();
    if(v && state.lastScan.v === v && (now - state.lastScan.t) < 900) return;
    state.lastScan = {v, t: now};
    search();
    try{ qEl.focus(); qEl.select(); }catch(e){}
  }

  // Exponer API para pos.js (scanner)
  window.POSINV_EXISTENCIAS_API = { onScan };

  document.addEventListener('DOMContentLoaded', bind);
  document.addEventListener('posinv:tab', (ev)=>{
    if(ev && ev.detail && ev.detail.tab === 'existencias'){
      // Asegura categorías copiadas si aún no estaban
      copyCats();
    }else{
      stopTopScanner();
    }
  });
})();