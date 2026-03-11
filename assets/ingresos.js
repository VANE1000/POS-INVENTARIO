(function(){
  'use strict';

  const $ = (sel, root) => (root||document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root||document).querySelectorAll(sel));

  const state = {
    store: 'store1',
    cat: '',
    staged: [], // {id, img, code, name, qty, obs, saved_at}
    lastScan: {v:'', t:0},
    search: { q:'', cat:'', offset:0, perPage:30, hasMore:false, loading:false, items:[] }
  };

  const LS_KEY = () => 'posinv_ingresos_' + (window.POSINV && POSINV.user_id ? POSINV.user_id : '0') + '_' + state.store;


  function getView(){
    return document.getElementById('posinvIngressView') || document;
  }

  const topScan = {
    stream:null, video:null, detector:null, raf:0, active:false,
    lastRaw:'', stableCount:0, startedAt:0, track:null, lastSeenAt:0
  };

  function money(v){
    try{ return String(v); }catch(e){ return ''+v; }
  }

  function readStores(){
    const s = (window.POSINV && POSINV.settings) ? POSINV.settings : {};
    const out = [];
    if(s.store1_name) out.push({key:'store1', name:s.store1_name});
    if(s.store2_name) out.push({key:'store2', name:s.store2_name});
    return out;
  }

  function fillSelects(){
    const selStore = $('#posinv_ing_store');
    if(selStore){
      const stores = readStores();
      selStore.innerHTML = stores.map(st => `<option value="${st.key}">${escapeHtml(st.name)}</option>`).join('');
      // por defecto: el store global del POS si existe
      const global = $('#posinvStore');
      if(global && global.value) state.store = global.value;
      selStore.value = state.store;
      selStore.addEventListener('change', () => {
        state.store = selStore.value;
        loadStaged();
        updateStoreHint();
      });
    }

    const catSel = $('#posinv_ing_cat');
    const globalCat = $('#posinvCat');
    if(catSel && globalCat){
      catSel.innerHTML = globalCat.innerHTML;
      catSel.value = globalCat.value || '';
      catSel.addEventListener('change', () => { state.cat = catSel.value; doProductsSearch(false, {append:false, cat: state.cat}); });
      state.cat = catSel.value;
    }

    updateStoreHint();
  }

  function updateStoreHint(){
    const hint = $('#posinv_ing_store_hint');
    const stores = readStores();
    const st = stores.find(x => x.key === state.store);
    if(hint) hint.textContent = 'Escaneando en: ' + (st ? st.name : state.store);
  }

  function escapeHtml(s){
    return String(s||'').replace(/[&<>\"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#039;'}[c]));
  }

  function setMsg(t){
    const el = $('#posinv_ing_msg');
    if(el) el.textContent = t || '';
  }

  function saveStaged(){
    try{ localStorage.setItem(LS_KEY(), JSON.stringify(state.staged)); }catch(e){}
  }

  function loadStaged(){
    state.staged = [];
    try{
      const raw = localStorage.getItem(LS_KEY());
      if(raw){
        const arr = JSON.parse(raw);
        if(Array.isArray(arr)) state.staged = arr;
      }
    }catch(e){}
    renderStaged();
  }

  function ensureTopScroll(){
    const wrap = $('#posinv_ing_tablewrap');
    const top = $('#posinv_ing_hscroll_top');
    const inner = $('#posinv_ing_hscroll_top_inner');
    if(!wrap || !top || !inner) return;

    function syncWidth(){
      const table = $('#posinv_ing_table');
      inner.style.width = (table ? table.scrollWidth : wrap.scrollWidth) + 'px';
    }
    syncWidth();

    let lock=false;
    top.addEventListener('scroll', () => {
      if(lock) return;
      lock=true;
      wrap.scrollLeft = top.scrollLeft;
      lock=false;
    });
    wrap.addEventListener('scroll', () => {
      if(lock) return;
      lock=true;
      top.scrollLeft = wrap.scrollLeft;
      lock=false;
    });

    window.addEventListener('resize', syncWidth);
    setTimeout(syncWidth, 300);
  }

  function renderStaged(){
    const tbody = $('#posinv_ing_table tbody');
    if(!tbody) return;

    if(!state.staged.length){
      tbody.innerHTML = '<tr><td colspan="10" class="posinv-muted">Escanea o busca para agregar productos a los ingresos…</td></tr>';
      ensureTopScroll();
      return;
    }

    tbody.innerHTML = state.staged.map((it, idx) => {
      return `
        <tr data-idx="${idx}">
          <td>${it.img ? `<img src="${escapeHtml(it.img)}" style="width:42px;height:42px;object-fit:cover;border-radius:8px;"/>` : ''}</td>
          <td>${escapeHtml(it.id)}</td>
          <td>${escapeHtml(it.code || '')}</td>
          <td>${escapeHtml(it.name || '')}</td>
          <td><strong>${escapeHtml(String((parseInt(it.stock,10)||0)))}</strong></td>
          <td>
            <div style="display:flex;align-items:center;gap:6px;">
              <button type="button" class="posinv-btn posinv-btn-mini posinv-btn-ghost" data-act="dec">-</button>
              <input type="number" min="0" step="1" value="${escapeHtml(it.qty)}" data-act="qty" style="width:70px;" />
              <button type="button" class="posinv-btn posinv-btn-mini" data-act="inc">+</button>
            </div>
          </td>
          <td><input type="text" value="${escapeHtml(it.obs||'')}" data-act="obs" style="width:240px;" placeholder="(opcional)"/></td>
          <td>${it.saved_at ? escapeHtml(it.saved_at) : '<span class="posinv-muted">—</span>'}</td>
          <td>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button type="button" class="posinv-btn posinv-btn-mini" data-act="save">Guardar</button>
              <button type="button" class="posinv-btn posinv-btn-mini posinv-btn-ghost" data-act="del">Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.addEventListener('click', onRowClick);
    tbody.addEventListener('change', onRowChange);
    ensureTopScroll();
  }

  function onRowChange(e){
    const tr = e.target.closest('tr');
    if(!tr) return;
    const idx = parseInt(tr.getAttribute('data-idx'),10);
    if(isNaN(idx) || !state.staged[idx]) return;

    const act = e.target.getAttribute('data-act');
    if(act === 'qty'){
      state.staged[idx].qty = Math.max(0, parseInt(e.target.value||'0',10)||0);
      saveStaged();
    }else if(act === 'obs'){
      state.staged[idx].obs = e.target.value||'';
      saveStaged();
    }
  }

  function onRowClick(e){
    const btn = e.target.closest('button');
    if(!btn) return;
    const tr = btn.closest('tr');
    if(!tr) return;
    const idx = parseInt(tr.getAttribute('data-idx'),10);
    if(isNaN(idx) || !state.staged[idx]) return;

    const act = btn.getAttribute('data-act');
    if(act === 'inc'){
      state.staged[idx].qty = (parseInt(state.staged[idx].qty,10)||0) + 1;
      saveStaged();
      renderStaged();
    }
    if(act === 'dec'){
      state.staged[idx].qty = Math.max(0, (parseInt(state.staged[idx].qty,10)||0) - 1);
      saveStaged();
      renderStaged();
    }
    if(act === 'del'){
      state.staged.splice(idx,1);
      saveStaged();
      renderStaged();
    }
    if(act === 'save'){
      applyItems([state.staged[idx]], [idx]);
    }
  }

  function addToStaged(p){
    const existingIdx = state.staged.findIndex(x => String(x.id) === String(p.id));
    if(existingIdx >= 0){
      state.staged[existingIdx].qty = (parseInt(state.staged[existingIdx].qty,10)||0) + 1;
      saveStaged();
      renderStaged();
      return;
    }

    state.staged.unshift({
      id: p.id,
      img: p.img || '',
      code: p.barcode || p.code || '',
      name: p.name || '',
      stock: (typeof p.stock !== 'undefined') ? (parseInt(p.stock, 10) || 0) : 0,
      qty: 1,
      obs: '',
      saved_at: ''
    });
    saveStaged();
    renderStaged();
  }

  async function restPost(path, body){
    const base = (window.POSINV_INGRESOS && POSINV_INGRESOS.rest) ? POSINV_INGRESOS.rest : (window.POSINV && POSINV.rest ? POSINV.rest : '');
    const url = base.replace(/\/$/, '') + path;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-WP-Nonce': (window.POSINV_INGRESOS ? POSINV_INGRESOS.nonce : (window.POSINV ? POSINV.rest_nonce : ''))
      },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    try{ return {ok: res.ok, json: JSON.parse(text)}; }catch(e){ return {ok:false, json:null, text}; }
  }

  async function applyItems(items, idxs){
    const payload = {
      store: state.store,
      items: items.map(it => ({ id: it.id, qty: parseInt(it.qty,10)||0, obs: it.obs||'' }))
    };

    setMsg('Guardando…');
    const r = await restPost('/ingresos', payload);
    if(!r.ok || !r.json || !r.json.ok){
      setMsg('Error al guardar (servidor).');
      return;
    }

    // actualizar existencias (stock de tienda) con lo que devuelve el servidor
    if(r.json && Array.isArray(r.json.changed)){
      const mapNew = {};
      r.json.changed.forEach(ch => { mapNew[String(ch.id)] = (parseInt(ch.new, 10) || 0); });
      state.staged.forEach(it => {
        const k = String(it.id);
        if(k in mapNew) it.stock = mapNew[k];
      });
    }

    const ts = new Date();
    const stamp = ts.getFullYear()+'-'+String(ts.getMonth()+1).padStart(2,'0')+'-'+String(ts.getDate()).padStart(2,'0')+' '+String(ts.getHours()).padStart(2,'0')+':'+String(ts.getMinutes()).padStart(2,'0');
    (idxs||[]).forEach(i => { if(state.staged[i]) state.staged[i].saved_at = stamp; });
    saveStaged();
    renderStaged();
    setMsg('Guardado.');
    setTimeout(()=>setMsg(''), 1200);
  }

  async function saveAll(){
    if(!state.staged.length){ setMsg('No hay nada que guardar.'); return; }
    const idxs = state.staged.map((_,i)=>i);
    await applyItems(state.staged, idxs);
  }

  function renderResults(items){
    const box = $('#posinv_ing_results');
    if(!box) return;
    if(!items || !items.length){ box.innerHTML = '<div class="posinv-muted" style="margin-top:10px;">Sin resultados.</div>'; return; }

    box.innerHTML = `
      <div class="posinv-muted" style="margin:6px 0 10px;">Selecciona un producto para agregar a los ingresos:</div>
      <table class="posinv-bc-table" style="width:100%;">
        <thead>
          <tr>
            <th style="width:60px;">Img</th>
            <th style="width:90px;">ID</th>
            <th style="width:160px;">Código</th>
            <th>Producto</th>
            <th style="width:130px;"></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(p => `
            <tr>
              <td>${p.img ? `<img src="${escapeHtml(p.img)}" style="width:42px;height:42px;object-fit:cover;border-radius:8px;"/>` : ''}</td>
              <td>${escapeHtml(p.id)}</td>
              <td>${escapeHtml(p.barcode || p.code || '')}</td>
              <td>${escapeHtml(p.name || '')}</td>
              <td style="text-align:right;"><button type="button" class="posinv-btn posinv-btn-mini" data-add="${escapeHtml(p.id)}">Agregar</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-add]');
      if(!b) return;
      const pid = b.getAttribute('data-add');
      const p = items.find(x => String(x.id) === String(pid));
      if(p) addToStaged(p);
      clearSearch();
    }, { once:true });
    let more = box.querySelector('.posinv-ing-more-wrap');
    if(!more){
      more = document.createElement('div');
      more.className = 'posinv-ing-more-wrap';
      more.style.cssText = 'margin-top:12px;text-align:center;';
      box.appendChild(more);
    }
    if(state.search.hasMore){
      more.innerHTML = `<button type="button" class="button button-secondary" id="posinv_ing_load_more"${state.search.loading?' disabled':''}>${state.search.loading?'Cargando…':'Cargar más'}</button>`;
    }else{
      more.innerHTML = '';
    }
  }

  function clearSearch(){
    const q = $('#posinv_ing_search');
    if(q){ q.value=''; q.focus(); }
  }

  async function doSearch(autoAddIfExact){
    const qEl = $('#posinv_ing_search');
    if(!qEl) return;
    const q = (qEl.value || '').trim();
    if(!q){ setMsg(''); return; }

    state.search.q = q;
    state.search.cat = cat;
    state.search.loading = true;
    setMsg('Buscando…');
    const payload = { q, store: state.store, cat: state.cat || '', limit: 30 };
    const r = await restPost('/products', payload); // NOTE: products endpoint is GET normally; but we use fetch POST? use GET.
  }

  async function doProductsSearch(autoAddIfExact, opts){
    opts = opts || {};
    const append = !!opts.append;
    const qEl = $('#posinv_ing_search');
    if(!qEl) return;
    const q = String(opts.q != null ? opts.q : (qEl.value || '')).trim();
    const cat = String(opts.cat != null ? opts.cat : (state.cat || '')).trim();
    if(!q && !cat){ setMsg(''); renderResults([]); return; }

    setMsg('Buscando…');

    // Usar el mismo buscador AJAX que Etiquetas/Código (más estable que REST en frontend)
    const ajaxurl = (window.POSINV_BARCODES && POSINV_BARCODES.ajaxurl) ? POSINV_BARCODES.ajaxurl : (window.POSINV && POSINV.ajaxurl ? POSINV.ajaxurl : '');
    const nonce = (window.POSINV_BARCODES && POSINV_BARCODES.nonce) ? POSINV_BARCODES.nonce : '';
    if(!ajaxurl || !nonce){
      setMsg('Error: falta configuración de búsqueda.');
      return;
    }

    const fd = new FormData();
    fd.append('action', 'posinv_barcode_search');
    fd.append('nonce', nonce);
    fd.append('q', q);
    fd.append('store', state.store);
    if(cat) fd.append('cat', cat);
    fd.append('module', 'ingresos');
    fd.append('per_page', String(state.search.perPage));
    fd.append('offset', String(append ? (state.search.offset||0) : 0));

    const res = await fetch(ajaxurl, {
      method: 'POST',
      credentials: 'same-origin',
      body: fd
    });

    const text = await res.text();
    let json = null;
    try{ json = JSON.parse(text); }catch(e){}
    if(!res.ok || !json || !json.success){
      const msg = (json && json.data && json.data.message) ? json.data.message : 'Error de búsqueda.';
      setMsg(msg);
      renderResults([]);
      return;
    }

    const payload = json.data || {};
    const rawItems = Array.isArray(json.data) ? json.data : (Array.isArray(payload.items) ? payload.items : []);
    const items = rawItems.map(p => ({
      id: p.id,
      name: p.name,
      img: p.image_url || p.img || '',
      barcode: (p.barcode || p.code || ''),
      code: (p.barcode || p.code || ''),
      stock: (typeof p.store_stock !== 'undefined') ? (parseInt(p.store_stock, 10) || 0) : 0,
    }));

    // auto-agregar si escaneo exacto (por barcode o id)
    if(autoAddIfExact && items.length){
      const exact = items.find(p => String(p.barcode||p.code||'') === q || String(p.id) === q);
      if(exact){
        addToStaged(exact);
        clearSearch();
        setMsg('');
        renderResults([]);
        return;
      }
    }

    state.search.loading = false;
    state.search.hasMore = !!(payload && payload.has_more);
    state.search.offset = (payload && typeof payload.next_offset !== 'undefined') ? (parseInt(payload.next_offset,10)||0) : ((append ? state.search.offset : 0) + items.length);
    state.search.items = append ? state.search.items.concat(items) : items;
    renderResults(state.search.items);
    setMsg(state.search.items.length ? '' : 'Sin resultados.');
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
    const wrap = $('#posinv_ing_topscan', view);
    const box = $('#posinv_ing_topscan_video', view);
    if(wrap) wrap.style.display = 'none';
    if(box) box.innerHTML = '';
  }

  function setTopScanStatus(t){
    const el = $('#posinv_ing_topscan_status', getView());
    if(el) el.textContent = t || '';
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
            const qEl = $('#posinv_ing_search');
            if(qEl) qEl.value = raw;
            if(window.POSINV_INGRESOS_API && window.POSINV_INGRESOS_API.onScan){
              window.POSINV_INGRESOS_API.onScan();
            }
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

  async function openTopScanner(ev){
    if(ev){ try{ ev.preventDefault(); ev.stopPropagation(); }catch(_e){} }
    if(window.POSINV_CLOSE_SCANNER){ try{ window.POSINV_CLOSE_SCANNER(); }catch(_e){} }
    if(topScan.active){ stopTopScanner(); return; }
    stopTopScanner();
    const view = getView();
    const wrap = $('#posinv_ing_topscan', view);
    const box = $('#posinv_ing_topscan_video', view);
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

  function bindUI(){
    const btn = $('#posinv_ing_btn_search');
    const q = $('#posinv_ing_search');
    const saveAllBtn = $('#posinv_ing_btn_saveall');
    const clearBtn  = $('#posinv_ing_btn_clear');
    const scanBtn = $('#posinv_ing_btn_scan', getView());
    const scanCloseBtn = $('#posinv_ing_topscan_close', getView());

    if(btn) btn.addEventListener('click', () => { stopTopScanner(); doProductsSearch(false, {append:false}); });
    if(scanBtn) scanBtn.addEventListener('click', (ev) => openTopScanner(ev));
    if(scanCloseBtn) scanCloseBtn.addEventListener('click', stopTopScanner);
    if(saveAllBtn) saveAllBtn.addEventListener('click', saveAll);
    document.addEventListener('click', (e)=>{ const b=e.target && e.target.closest ? e.target.closest('#posinv_ing_load_more') : null; if(b){ e.preventDefault(); if(!state.search.loading && state.search.hasMore) doProductsSearch(false, {append:true, q:state.search.q, cat:state.search.cat}); } });
    if(clearBtn) clearBtn.addEventListener('click', () => {
      stopTopScanner();
      state.staged = [];
      // también limpia la UI
      const tbody = $('#posinv_ing_table tbody');
      if(tbody) tbody.innerHTML = '<tr><td colspan="10" class="posinv-muted">Escanea o busca para agregar productos a los ingresos…</td></tr>';
      const res = $('#posinv_ing_results');
      if(res) res.innerHTML = '';
      const msg = $('#posinv_ing_msg');
      if(msg) msg.textContent = 'Pantalla limpiada.';
      // limpia cache local de ingresos
      try{ localStorage.removeItem(LS_KEY()); }catch(e){}
    });

    if(q){
      // autosearch tipo "código": con scanners llega ENTER
      q.addEventListener('keydown', (e) => {
        if(e.key === 'Enter'){
          e.preventDefault();
          stopTopScanner();
          doProductsSearch(true, {append:false});
        }
      });

      // autosearch por tecleo: debounce
      let t=null;
      q.addEventListener('input', () => {
        if(t) clearTimeout(t);
        t = setTimeout(() => {
          const v = (q.value||'').trim();
          if(v.length >= 2 || state.cat) doProductsSearch(false, {append:false});
        }, 250);
      });
    }

    // cambiar tienda también cambia staged
    const stSel = $('#posinv_ing_store');
    if(stSel){
      stSel.addEventListener('change', () => {
        state.store = stSel.value;
        loadStaged();
        updateStoreHint();
        clearSearch();
      });
    }

    // escuchar evento de cambio de tab para reiniciar scroll top sync
    document.addEventListener('posinv:tab', (ev) => {
      if(ev && ev.detail && ev.detail.tab === 'ingresos'){
        setTimeout(() => {
          ensureTopScroll();
          try{ const q = $('#posinv_ing_search'); if(q) q.focus(); }catch(e){}
        }, 50);
      }else{
        stopTopScanner();
      }
    });
  }

  // API pública para el handler de scanner (pos.js)
  window.POSINV_INGRESOS_API = {
    onScan: function(){
      const q = $('#posinv_ing_search');
      if(!q) return;
      const v = (q.value||'').trim();
      if(!v) return;
      const now = Date.now();
      if(state.lastScan.v === v && (now - state.lastScan.t) < 350){
        // evita doble disparo por scanners
        return;
      }
      state.lastScan = {v, t: now};
      doProductsSearch(true, {append:false});
    }
  };

  function init(){
    if(!$('#posinvIngressView')) return;
    fillSelects();
    loadStaged();
    bindUI();
    ensureTopScroll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
