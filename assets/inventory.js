/* POS Inventario - Inventario (conteo físico)
   - Diseñado para NO romper otras pestañas.
   - Usa REST /products para resolver escaneos.
   - Usa admin-ajax para descargar inventario esperado (productos con stock>0 en la tienda).
*/
(function(){
  'use strict';

  const CFG = window.POSINV_INVENTORY || {};
  const POSINV = window.POSINV || {};

  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel){ return Array.from(document.querySelectorAll(sel)); }
  function getView(){ return document.getElementById('posinvInventoryView') || document; }

  function storeKey(){
    const s = $('#posinvStore');
    return (s && s.value) ? s.value : '';
  }

  function lsKey(){
    const s = storeKey() || 'store';
    const u = CFG.user_id || 0;
    return `posinv_inv_session_${s}_${u}`;
  }

  function nowISO(){
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  const state = {
    session: null,
    expected: null, // map id -> expected row
    report: null,
    lastScan: {v:'', t:0},
  };

  const topScan = {
    stream:null, video:null, detector:null, raf:0, active:false,
    lastRaw:'', stableCount:0, startedAt:0, track:null, lastSeenAt:0
  };

  function setMsg(t, kind){
    const el = $('#posinvInvMsg');
    if(!el) return;
    el.textContent = t || '';
    el.className = 'posinv-msg' + (kind ? (' posinv-msg-' + kind) : '');
  }

  function save(){
    try{
      if(!state.session) return;
      localStorage.setItem(lsKey(), JSON.stringify(state.session));
    }catch(e){}
  }

  function load(){
    try{
      const raw = localStorage.getItem(lsKey());
      if(!raw) return null;
      const obj = JSON.parse(raw);
      if(obj && obj.items && typeof obj.items === 'object') return obj;
    }catch(e){}
    return null;
  }

  function clearLS(){
    try{ localStorage.removeItem(lsKey()); }catch(e){}
  }

  function ensureSession(){
    if(state.session) return true;
    const s = load();
    if(s){ state.session = s; render(); return true; }
    return false;
  }

  async function newSession(resetCounts){
    const sk = storeKey();
    if(!sk){ setMsg('Primero selecciona una tienda.', 'warn'); return; }
    resetCounts = (resetCounts !== false);
    state.session = {
      id: `INV-${Date.now()}`,
      store: sk,
      started_at: nowISO(),
      paused: false,
      items: {}, // id -> {id,name,code,image,expected,count,last_sale}
    };
    state.expected = null;
    state.report = null;
    save();
    render();
    setMsg('Cargando productos de la tienda…', 'warn');
    try{
      await preloadStoreProducts(resetCounts);
      setMsg('Listo. Ahora puedes escanear productos (cada escaneo suma 1).', 'ok');
    }catch(e){
      setMsg('No se pudo cargar productos: ' + (e && e.message ? e.message : ''), 'err');
    }
    const inp = $('#posinv_inv_scan'); if(inp){ inp.value=''; inp.focus(); }
  }

  async function preloadStoreProducts(resetCounts){
    if(!ensureSession()) return;
    const sk = storeKey();
    if(!sk) return;
    // Descargar inventario esperado (stock>0) por páginas
    const expected = new Map();
    let page = 1;
    let totalPages = 1;
    const per = 200;
    while(page <= totalPages){
      const d = await ajaxPost('posinv_inventory_expected', { store: sk, page: String(page), per_page: String(per) });
      totalPages = d.total_pages || 1;
      for(const it of (d.items || [])){
        expected.set(String(it.id), it);
      }
      page++;
      if(totalPages > 60){ /* safety */ break; }
    }
    state.expected = expected;

    // Poblar items: todos los productos que existen en la tienda (expected list)
    const newItems = {};
    for(const [id, ex] of expected.entries()){
      const prev = (state.session.items && state.session.items[id]) ? state.session.items[id] : null;
      const prevCount = prev ? Number(prev.count||0) : 0;
      newItems[id] = {
        id: Number(id),
        name: ex.name || (prev ? prev.name : ''),
        code: ex.code || (prev ? prev.code : ''),
        image: ex.image || (prev ? prev.image : ''),
        expected: Number(ex.stock||0),
        count: resetCounts ? 0 : prevCount,
        last_sale: prev ? (prev.last_sale||'') : '',
      };
    }
    state.session.items = newItems;
    save();
    render();
  }


  function pause(){
    if(!ensureSession()) { setMsg('No hay conteo activo.', 'warn'); return; }
    state.session.paused = true;
    save();
    $('#posinv_inv_btn_pause').style.display = 'none';
    $('#posinv_inv_btn_resume').style.display = '';
    setMsg('Conteo pausado. Puedes cambiar de pestaña y volver.', 'warn');
  }

  function resume(){
    if(!ensureSession()) { setMsg('No hay conteo guardado.', 'warn'); return; }
    state.session.paused = false;
    save();
    $('#posinv_inv_btn_pause').style.display = '';
    $('#posinv_inv_btn_resume').style.display = 'none';
    setMsg('Conteo reanudado.', 'ok');
    const inp = $('#posinv_inv_scan'); if(inp){ inp.focus(); }
  }

  // Búsqueda “segura” (la misma que usan Etiquetas/Código): soporta _op_barcode, SKU, ID y nombre.
  async function barcodeSearch(q){
    const B = window.POSINV_BARCODES || {};
    const ajaxurl = (B.ajaxurl || CFG.ajaxurl);
    const nonce = (B.nonce || CFG.nonce);
    if(!ajaxurl || !nonce) throw new Error('Config AJAX incompleta');

    const fd = new FormData();
    fd.append('action', 'posinv_barcode_search');
    fd.append('nonce', nonce);
    fd.append('store', storeKey());
    fd.append('q', String(q||''));
    fd.append('cat', '0');

    const res = await fetch(ajaxurl, { method:'POST', body: fd, credentials:'same-origin' });
    const json = await res.json();
    if(!json || !json.success) throw new Error((json && json.data && json.data.message) ? json.data.message : 'No se pudo buscar');
    // en este endpoint, data ES el arreglo de items
    return json.data;
  }

  function pickExact(results, q){
    q = String(q||'').trim();
    if(!q) return results[0] || null;
    // exact match por barcode/sku/id
    for(const r of results){
      if(String(r.id) === q) return r;
      if(r.barcode && String(r.barcode) === q) return r;
      if(r.sku && String(r.sku) === q) return r;
    }
    return results[0] || null;
  }

  async function onScan(){
    const inp = $('#posinv_inv_scan');
    if(!inp) return;
    const q = String(inp.value||'').trim();
    const now = Date.now();
    if(q && state.lastScan.v === q && (now - state.lastScan.t) < 900) return;
    state.lastScan = {v:q, t:now};
    if(!q) return;
    if(!ensureSession()){
      setMsg('Primero presiona “Nuevo” para iniciar el conteo.', 'warn');
      return;
    }
    if(state.session.paused){
      setMsg('El conteo está pausado. Presiona “Continuar”.', 'warn');
      return;
    }

    try{
      setMsg('Buscando…');

      // Usar el mismo buscador de Etiquetas/Código (incluye _op_barcode)
      const list = await barcodeSearch(q);
      if(!list || !list.length){
        setMsg('No se encontró ese producto.', 'warn');
        inp.select();
        return;
      }

      const p = pickExact(list, q);
      if(!p){ setMsg('No se encontró ese producto.', 'warn'); return; }

      const id = String(p.id);
      if(!state.session.items[id]){
        state.session.items[id] = {
          id: p.id,
          name: p.name,
          // si el endpoint no trae barcode (a veces en match por ID), usamos lo escaneado
          code: p.barcode || q,
          image: p.image_url || '',
          expected: (typeof p.store_stock === 'number') ? p.store_stock : parseFloat(p.store_stock||0),
          count: 0,
          last_sale: null,
        };
      }

      state.session.items[id].count += 1;
      // refrescar expected por si cambió
      const ss = (typeof p.store_stock === 'number') ? p.store_stock : parseFloat(p.store_stock||0);
      if(!isNaN(ss)) state.session.items[id].expected = ss;

      save();
      render();
      setMsg('OK', 'ok');

      // limpiar la barra para el siguiente escaneo
      inp.value = '';
      inp.focus();

    }catch(e){
      setMsg('Error buscando: ' + (e && e.message ? e.message : 'revisa conexión/SYNC'), 'err');
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
    const wrap = $('#posinv_inv_topscan', view);
    const box = $('#posinv_inv_topscan_video', view);
    if(wrap) wrap.style.display = 'none';
    if(box) box.innerHTML = '';
  }

  function setTopScanStatus(t){
    const el = $('#posinv_inv_topscan_status', getView());
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
            const qEl = $('#posinv_inv_scan');
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

  async function openTopScanner(ev){
    if(ev){ try{ ev.preventDefault(); ev.stopPropagation(); }catch(_e){} }
    if(window.POSINV_CLOSE_SCANNER){ try{ window.POSINV_CLOSE_SCANNER(); }catch(_e){} }
    if(topScan.active){ stopTopScanner(); return; }
    stopTopScanner();
    const view = getView();
    const wrap = $('#posinv_inv_topscan', view);
    const box = $('#posinv_inv_topscan_video', view);
    if(wrap) wrap.style.display = 'block';
    if(view){ try{ view.scrollIntoView({ block:'nearest' }); }catch(_e){} }
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

  function render(){
    const tbody = $('#posinv_inv_table tbody');
    if(!tbody) return;
    tbody.innerHTML = '';

    const filter = ($('#posinv_inv_filter') && $('#posinv_inv_filter').value) ? $('#posinv_inv_filter').value : 'all';

    const items = state.session ? Object.values(state.session.items) : [];
    items.sort((a,b) => (a.name||'').localeCompare(b.name||''));

    let shown = 0;
    for(const it of items){
      const diff = (Number(it.count)||0) - (Number(it.expected)||0);
      const isMissing = diff < 0;
      const isExtra = diff > 0;
      if(filter === 'missing' && !isMissing) continue;
      if(filter === 'extra' && !isExtra) continue;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><img src="${it.image||''}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;"/></td>
        <td>${it.id}</td>
        <td>${escapeHtml(it.code||'')}</td>
        <td>${escapeHtml(it.name||'')}</td>
        <td style="text-align:right;">${Number(it.expected)||0}</td>
        <td style="text-align:right;">
          <input type="number" class="posinv-inv-count" data-id="${it.id}" value="${Number(it.count)||0}" style="width:90px;" />
          <button class="posinv-btn posinv-btn-ghost posinv-inv-del" data-id="${it.id}" type="button" title="Quitar">✕</button>
        </td>
        <td style="text-align:right; font-weight:600;">${diff}</td>
        <td class="posinv-inv-sale" data-id="${it.id}">${it.last_sale ? escapeHtml(it.last_sale) : ''}</td>
      `;

      if(isMissing) tr.style.background = 'rgba(255, 193, 7, 0.10)';
      if(isExtra) tr.style.background = 'rgba(40, 167, 69, 0.10)';

      tbody.appendChild(tr);
      shown++;
    }

    const hint = $('#posinv_inv_hint');
    if(hint){
      if(!state.session){
        hint.textContent = 'Selecciona una tienda. Se cargan los productos con existencias; luego escanea para ir contando (cada escaneo suma 1).';
      }else{
        hint.textContent = `Sesión ${state.session.id} • ${state.session.started_at} • Productos contados: ${Object.keys(state.session.items).length} (mostrando ${shown})`;
      }
    }

    const btnPause = $('#posinv_inv_btn_pause');
    const btnResume = $('#posinv_inv_btn_resume');
    if(btnPause && btnResume){
      if(state.session && state.session.paused){ btnPause.style.display = 'none'; btnResume.style.display = ''; }
      else { btnPause.style.display = ''; btnResume.style.display = 'none'; }
    }

    try{ syncHScroll(); }catch(e){}
  }

  function escapeHtml(s){
    return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  // Scroll horizontal arriba sincronizado con la tabla (para tablet)
  function syncHScroll(){
    const top = $('#posinv_inv_hscroll_top');
    const topInner = $('#posinv_inv_hscroll_top_inner');
    const wrap = $('#posinv_inv_tablewrap');
    if(!top || !topInner || !wrap) return;
    // ancho del “riel” superior
    topInner.style.width = (wrap.scrollWidth || 0) + 'px';

    if(!top._posinvBound){
      top.addEventListener('scroll', ()=>{ wrap.scrollLeft = top.scrollLeft; });
      wrap.addEventListener('scroll', ()=>{ top.scrollLeft = wrap.scrollLeft; });
      top._posinvBound = true;
    }
  }

  function bind(){
    const inp = $('#posinv_inv_scan');
    if(inp){
      // Pistola: muchos lectores mandan ENTER o TAB al final
      inp.addEventListener('keydown', (e) => {
        if(e.key === 'Enter' || e.key === 'Tab'){
          e.preventDefault();
          stopTopScanner();
          onScan();
        }
      });

      // Auto-búsqueda por debounce (por si el lector NO manda Enter/Tab)
      let t = null;
      inp.addEventListener('input', () => {
        if(t) clearTimeout(t);
        t = setTimeout(() => {
          const v = String(inp.value||'').trim();
          if(!v) return;
          // Heurística: si parece barcode (>=4 chars) disparamos
          if(v.length >= 4){ stopTopScanner(); onScan(); }
        }, 220);
      });
    }

    const btnScan = $('#posinv_inv_btn_scan', getView());
    if(btnScan) btnScan.addEventListener('click', (ev)=>openTopScanner(ev));

    const btnScanClose = $('#posinv_inv_topscan_close');
    if(btnScanClose) btnScanClose.addEventListener('click', stopTopScanner);

    const btnNew = $('#posinv_inv_btn_new');
    if(btnNew) btnNew.addEventListener('click', ()=>{ stopTopScanner(); newSession(); });

    const btnPause = $('#posinv_inv_btn_pause');
    if(btnPause) btnPause.addEventListener('click', ()=>{ stopTopScanner(); pause(); });

    const btnResume = $('#posinv_inv_btn_resume');
    if(btnResume) btnResume.addEventListener('click', ()=>{ stopTopScanner(); resume(); });

    const btnClose = $('#posinv_inv_btn_close');
    if(btnClose) btnClose.addEventListener('click', ()=>{ stopTopScanner(); closeAndReport(); });

    const btnExport = $('#posinv_inv_btn_export');
    if(btnExport) btnExport.addEventListener('click', ()=>{ stopTopScanner(); exportCSV(); });

    const filter = $('#posinv_inv_filter');
    if(filter) filter.addEventListener('change', ()=>{ stopTopScanner(); render(); });

    // Delegación: editar conteo / borrar
    document.addEventListener('input', (e) => {
      const t = e.target;
      if(!(t && t.classList && t.classList.contains('posinv-inv-count'))) return;
      if(!state.session) return;
      const id = String(t.dataset.id||'');
      if(!id || !state.session.items[id]) return;
      const v = parseFloat(t.value);
      state.session.items[id].count = isNaN(v) ? 0 : v;
      save();
      render();
    });

    document.addEventListener('click', (e) => {
      const t = e.target;
      if(!(t && t.classList)) return;
      if(t.classList.contains('posinv-inv-del')){
        e.preventDefault();
        if(!state.session) return;
        const id = String(t.dataset.id||'');
        if(id && state.session.items[id]){
          delete state.session.items[id];
          save();
          render();
        }
      }
    });
  }

  async function ajaxPost(action, payload){
    const fd = new FormData();
    fd.append('action', action);
    fd.append('nonce', CFG.nonce || '');
    for(const k in payload){ fd.append(k, payload[k]); }
    const res = await fetch(CFG.ajaxurl, { method:'POST', body: fd, credentials:'same-origin' });
    const text = await res.text();
    let data = null;
    try{
      data = JSON.parse(text);
    }catch(e){
      // WordPress devuelve HTML cuando hay error fatal o wp_die
      throw new Error('Error del servidor (respuesta no-JSON). Revisa el log de errores de WordPress.');
    }
    if(!data || !data.success) throw new Error((data && data.data && data.data.message) ? data.data.message : 'Error');
    return data.data;
  }

  async function closeAndReport(){
    if(!ensureSession()){ setMsg('No hay conteo activo.', 'warn'); return; }
    setMsg('Generando reporte… esto puede tardar si hay muchos productos.', 'warn');

    try{
      // 1) Asegurar existencias (productos de la tienda)
      await preloadStoreProducts(false);
      const expected = state.expected || new Map();

      // 2) Armar reporte
      const countedIds = new Set(Object.keys(state.session.items || {}));
      const rows = [];

      // faltantes: en expected pero no contados o contados menor
      for(const [id, ex] of expected.entries()){
        const c = state.session.items[id];
        const counted = c ? Number(c.count||0) : 0;
        const exp = Number(ex.stock||0);
        if(counted !== exp){
          rows.push({
            id: Number(id),
            name: c ? c.name : ex.name,
            code: c ? c.code : ex.code,
            image: c ? c.image : ex.image,
            expected: exp,
            count: counted,
            diff: counted - exp,
            last_sale: null,
          });
        }
      }

      // sobrantes: contados que NO están en expected (expected stock 0) o mayor
      for(const id of countedIds){
        if(!expected.has(id)){
          const c = state.session.items[id];
          rows.push({
            id: Number(id),
            name: c.name,
            code: c.code,
            image: c.image,
            expected: 0,
            count: Number(c.count||0),
            diff: Number(c.count||0),
            last_sale: null,
          });
        }
      }

      // 3) Si faltó (diff<0), obtener última venta
      const missing = rows.filter(r => r.diff < 0);
      for(const r of missing.slice(0, 50)){
        try{
          const sale = await ajaxPost('posinv_inventory_last_sale', { store: storeKey(), product_id: String(r.id) });
          if(sale && sale.last_sale && sale.last_sale.date){
            r.last_sale = sale.last_sale.date;
          }
        }catch(e){}
      }

      // 5) Guardar reporte dentro de sesión (sin borrar la lista completa)
      state.session.report_at = nowISO();
      state.session.report_rows = rows;
      // si faltó (diff<0), copiar última venta al item correspondiente
      for(const r of rows){
        if(r.diff < 0 && r.last_sale){
          const k = String(r.id);
          if(state.session.items && state.session.items[k]){
            state.session.items[k].last_sale = r.last_sale;
          }
        }
      }
      save();
      render();

      setMsg(`Reporte listo. Diferencias: ${rows.length}. (Se consultó última venta para hasta 50 faltantes)`, 'ok');

      // 6) Guardar auditoría del cierre (no bloquea si falla)
      try{
        const missingCount = rows.filter(r => r.diff < 0).length;
        const extraCount = rows.filter(r => r.diff > 0).length;
        await ajaxPost('posinv_inventory_audit', {
          store: storeKey(),
          session_id: String(state.session.id||''),
          counted: String(Object.keys(newItems).length),
          diff_rows: String(rows.length),
          missing: String(missingCount),
          extra: String(extraCount),
        });
      }catch(e){}

    }catch(e){
      setMsg('Error generando reporte: ' + (e.message||e), 'err');
    }
  }

  function exportCSV(){
    if(!ensureSession() || !state.session.items){ setMsg('No hay datos para exportar.', 'warn'); return; }
    const rows = Object.values(state.session.items);
    if(!rows.length){ setMsg('No hay datos para exportar.', 'warn'); return; }

    const header = ['ID','Código','Producto','Existencias','Contado','Diferencia','Ultima_venta'];
    const lines = [header.join(',')];
    for(const r of rows){
      const diff = (Number(r.count)||0) - (Number(r.expected)||0);
      const line = [
        r.id,
        `"${String(r.code||'').replace(/"/g,'""')}"`,
        `"${String(r.name||'').replace(/"/g,'""')}"`,
        Number(r.expected)||0,
        Number(r.count)||0,
        diff,
        `"${String(r.last_sale||'').replace(/"/g,'""')}"`,
      ];
      lines.push(line.join(','));
    }
    const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inventario_${storeKey()||'tienda'}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setMsg('CSV generado.', 'ok');
  }

  function init(){
    // exponer para pos.js (lector)
    window.POSINV_INV = window.POSINV_INV || {};
    window.POSINV_INV.onScan = onScan;

    // Bind cuando exista la vista (página POS)
    bind();

    const storeEl = $('#posinvStore');
    if(storeEl){
      storeEl.addEventListener('change', async () => {
        // cambiar tienda reinicia/carga sesión de esa tienda
        const sk = storeKey();
        if(!sk){
          state.session = null;
          render();
          setMsg('Selecciona una tienda para empezar el inventario.', 'warn');
          return;
        }
        const s = load();
        if(s && s.store === sk){
          state.session = s;
          render();
          setMsg('Sesión cargada. Actualizando existencias…', 'warn');
          try{ await preloadStoreProducts(false); setMsg('Existencias actualizadas.', 'ok'); }catch(e){ setMsg('No se pudo actualizar existencias.', 'warn'); }
        }else{
          await newSession(true);
        }
      });
    }

    // si ya hay tienda seleccionada, cargar sesión o iniciar
    if(storeKey()){
      const s = load();
      if(s){ state.session = s; render(); preloadStoreProducts(false).catch(()=>{}); setMsg('Sesión cargada.', 'ok'); }
      else { newSession(true); }
    }else{
      setMsg('Selecciona una tienda para empezar el inventario.', 'warn');
      render();
    }
  }

  document.addEventListener('posinv:tab', (ev)=>{
    if(ev && ev.detail && ev.detail.tab === 'inventory'){
      try{ const q = $('#posinv_inv_scan'); if(q) q.focus(); }catch(e){}
    }else{
      stopTopScanner();
    }
  });

  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) stopTopScanner(); });

  // Iniciar cuando DOM listo
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
