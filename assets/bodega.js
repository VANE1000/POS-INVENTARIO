/* POS Inventario - Bodega (multi-ubicación)
 * No toca otras pestañas.
 */
(function(){
  'use strict';

  // Exponer un hook mínimo para el router de escaneo (pos.js)
  window.POSINV_BODEGA_API = window.POSINV_BODEGA_API || {};

  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

  function ajax(action, data){
    const fd = new FormData();
    fd.append('action', action);
    // Cada endpoint usa su propio nonce.
    // - Acciones de Bodega: posinv_bodega_nonce
    // - Búsqueda de productos (reutiliza el endpoint de Etiquetas/Código): posinv_barcodes_nonce
    let nonce = (window.POSINV_BODEGA && POSINV_BODEGA.nonce) ? POSINV_BODEGA.nonce : '';
    if(action === 'posinv_barcode_search'){
      if(window.POSINV_BARCODES && POSINV_BARCODES.nonce){
        nonce = POSINV_BARCODES.nonce;
      }
    }
    fd.append('nonce', nonce);
    Object.keys(data||{}).forEach(k=>fd.append(k, data[k]));
    return fetch((window.POSINV_BODEGA && POSINV_BODEGA.ajaxurl) ? POSINV_BODEGA.ajaxurl : window.ajaxurl, {
      method:'POST',
      credentials:'same-origin',
      body: fd
    }).then(r=>r.text()).then(txt=>{
      try { return JSON.parse(txt); }
      catch(e){
        return { success:false, data:{ message:'Error del servidor (respuesta no-JSON).', raw: txt.slice(0,200) } };
      }
    });
  }

  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function escapeAttr(s){
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  const topScan = {
    stream:null, video:null, detector:null, raf:0, active:false,
    lastRaw:'', stableCount:0, startedAt:0, track:null, lastSeenAt:0
  };

  function getView(){
    return document.getElementById('posinvBodegaView') || document;
  }


  function initHScroll(topWrap, topInner, tableWrap){
    if(!topWrap || !topInner || !tableWrap) return;
    const sync = ()=>{ topInner.style.width = (tableWrap.scrollWidth||0) + 'px'; };
    const syncScrollTopToBottom = ()=>{ tableWrap.scrollLeft = topWrap.scrollLeft; };
    const syncScrollBottomToTop = ()=>{ topWrap.scrollLeft = tableWrap.scrollLeft; };
    topWrap.addEventListener('scroll', syncScrollTopToBottom);
    tableWrap.addEventListener('scroll', syncScrollBottomToTop);
    window.addEventListener('resize', sync);
    setTimeout(sync, 250);
  }

  // Render table rows
  function renderRows(items){
    const tbody = $('#posinv_bodega_table tbody');
    if(!tbody) return;
    if(!items || !items.length){
      tbody.innerHTML = currentLoc
        ? '<tr><td colspan="9" class="posinv-muted">Escanea o busca para agregar productos a esta ubicación…</td></tr>'
        : '<tr><td colspan="9" class="posinv-muted">Selecciona una ubicación para comenzar…</td></tr>';
      return;
    }
    const canEdit = !!(window.POSINV_BODEGA && POSINV_BODEGA.caps && POSINV_BODEGA.caps.edit);
    tbody.innerHTML = items.map(p=>{
      const img = p.image || '';
      const code = p.code || '';
      const name = p.name || '';
      const pid = p.id;
      const lastLoc = currentLoc || '';
      const lastQty = (p.qty != null) ? p.qty : '';
      const lastObs = (p.obs != null) ? p.obs : '';
      const lastTs  = (p.ts != null) ? p.ts : '';
      return `
<tr class="posinv-bodega-row" data-product-id="${pid}">
  <td><img src="${escapeHtml(img)}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;"/></td>
  <td>${pid}</td>
  <td class="posinv-td-code">${escapeHtml(code)}</td>
  <td class="posinv-td-product">${escapeHtml(name)}</td>
  <td><input class="posinv-bodega-loc" type="text" readonly value="${escapeHtml(lastLoc)}"/></td>
  <td><input class="posinv-bodega-qty" type="number" step="1" value="${escapeHtml(lastQty)}" ${canEdit ? '' : 'readonly'}/></td>
  <td><input class="posinv-bodega-obs" type="text" placeholder="Notas…" value="${escapeHtml(lastObs)}" ${canEdit ? '' : 'readonly'}/></td>
  <td class="posinv-bodega-ts">${escapeHtml(lastTs)}</td>
  <td style="white-space:nowrap;">
    ${canEdit ? '<button type="button" class="posinv-btn posinv-bodega-save">Guardar</button>' : ''}
    <button type="button" class="posinv-btn posinv-btn-ghost posinv-bodega-view">Ver</button>
  </td>
</tr>
<tr class="posinv-bodega-sub" data-product-id="${pid}" style="display:none;">
  <td colspan="9">
    <div class="posinv-bodega-subbox">
      <div class="posinv-muted" style="margin-bottom:6px;">Ubicaciones guardadas:</div>
      <div class="posinv-bodega-list" data-product-id="${pid}">Cargando…</div>
    </div>
  </td>
</tr>`;
    }).join('');
  }

  function setMsg(txt){
    const el = $('#posinv_bodega_msg');
    if(el) el.textContent = txt||'';
  }

  function setPanelMsg(txt){
    const el = $('#posinv_bodega_loc_panel_msg');
    if(el) el.textContent = txt||'';
  }

  function setLocHint(txt){
    const el = $('#posinv_bodega_loc_hint');
    if(el) el.textContent = txt||'';
  }

  function clearResults(){
    const box = $('#posinv_bodega_results');
    if(box) box.innerHTML = '';
    searchState = { q:'', cat:'', offset:0, perPage:30, hasMore:false, loading:false, items:[] };
  }

  function renderSearchLoadMore(){
    const box = $('#posinv_bodega_results');
    if(!box) return;
    let wrap = box.querySelector('.posinv-bodega-more-wrap');
    if(!wrap){
      wrap = document.createElement('div');
      wrap.className = 'posinv-bodega-more-wrap';
      wrap.style.cssText = 'margin-top:12px;text-align:center;';
      box.appendChild(wrap);
    }
    if(searchState.hasMore){
      wrap.innerHTML = `<button type="button" class="button button-secondary" id="posinv_bodega_load_more"${searchState.loading?' disabled':''}>${searchState.loading?'Cargando…':'Cargar más'}</button>`;
    }else{
      wrap.innerHTML = '';
    }
  }

  let currentLoc = '';

  function panelShow(show){
    const p = $('#posinv_bodega_loc_panel');
    if(!p) return;
    p.style.display = show ? '' : 'none';
    if(!show) setPanelMsg('');
  }

  function renderLocationPanel(loc, items){
    const title = $('#posinv_bodega_loc_panel_title');
    if(title) title.textContent = loc ? ('• ' + loc) : '';
    const tbody = $('#posinv_bodega_loc_table tbody');
    if(!tbody) return;
    if(!items || !items.length){
      tbody.innerHTML = '<tr><td colspan="9" class="posinv-muted">No hay productos guardados en esta ubicación.</td></tr>';
      return;
    }
    const canDelPerm = !!(window.POSINV_BODEGA && POSINV_BODEGA.caps && POSINV_BODEGA.caps.delete);
    // Mostrar botón siempre (algunas tablets/cachés pueden traer caps incorrectas); el servidor valida permisos.
    const canDel = true;
    tbody.innerHTML = items.map(it=>{
      return `
        <tr class="posinv-bodega-locrow" data-product-id="${it.product_id}" data-row-id="${escapeHtml(it.row_id)}">
          <td><img src="${escapeHtml(it.image||'')}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;"/></td>
          <td>${it.product_id}</td>
          <td>${escapeHtml(it.code||'')}</td>
          <td>${escapeHtml(it.name||'')}</td>
          <td><strong>${escapeHtml(it.bodega_total != null ? it.bodega_total : '')}</strong></td>
          <td><input type="number" class="posinv-bodega-loc-qty" step="1" value="${escapeHtml(it.qty)}"/></td>
          <td><input type="text" class="posinv-bodega-loc-obs" placeholder="Notas…" value="${escapeHtml(it.obs)}"/></td>
          <td class="posinv-bodega-loc-ts">${escapeHtml(it.ts||'')}</td>
          <td style="white-space:nowrap;">
            <button type="button" class="posinv-btn posinv-bodega-loc-save">Guardar</button>
            ${canDel ? `<button type="button" class="posinv-btn posinv-btn-ghost posinv-bodega-loc-del${!canDelPerm?' is-disabled':''}" ${!canDelPerm?'disabled title="Sin permiso para eliminar"':''}>Eliminar</button>` : ''}
          </td>
        </tr>`;
    }).join('');
  }

  function viewCurrentLocation(){
    if(!currentLoc){
      setMsg('Primero selecciona una ubicación');
      return;
    }
    panelShow(true);
    setPanelMsg('Cargando…');
    ajax('posinv_bodega_location_view', { loc: currentLoc }).then(res=>{
      if(!res || !res.success){
        setPanelMsg((res && res.data && res.data.message) ? res.data.message : 'Error');
        renderLocationPanel(currentLoc, []);
        return;
      }
      const items = (res.data && res.data.items) ? res.data.items : [];
      renderLocationPanel(currentLoc, items);
      setPanelMsg('');
    });
  }

  function updatePanelRow(tr){
    if(!(window.POSINV_BODEGA && POSINV_BODEGA.caps && POSINV_BODEGA.caps.edit)){
      setPanelMsg('Sin permiso');
      return;
    }
    const pid = tr.getAttribute('data-product-id');
    const rowId = tr.getAttribute('data-row-id');
    const qty = ($('.posinv-bodega-loc-qty', tr)||{}).value || '';
    const obs = ($('.posinv-bodega-loc-obs', tr)||{}).value || '';
    setPanelMsg('Guardando…');
    ajax('posinv_bodega_update_row', { product_id: pid, row_id: rowId, qty: qty, obs: String(obs||'').trim() }).then(res=>{
      if(!res || !res.success){
        setPanelMsg((res && res.data && res.data.message) ? res.data.message : 'Error');
        return;
      }
      const ts = (res.data && res.data.ts) ? res.data.ts : '';
      const tsEl = $('.posinv-bodega-loc-ts', tr);
      if(tsEl) tsEl.textContent = ts;
      setPanelMsg('Guardado');
      setTimeout(()=>setPanelMsg(''), 900);
    });
  }

  function deletePanelRow(tr){
    if(!(window.POSINV_BODEGA && POSINV_BODEGA.caps && POSINV_BODEGA.caps.delete)){
      setPanelMsg('Sin permiso');
      return;
    }
    const pid = tr.getAttribute('data-product-id');
    const rowId = tr.getAttribute('data-row-id');
    if(!confirm('¿Eliminar este producto de esta ubicación?')) return;
    setPanelMsg('Eliminando…');
    ajax('posinv_bodega_delete', { product_id: pid, row_id: rowId }).then(res=>{
      if(!res || !res.success){
        setPanelMsg((res && res.data && res.data.message) ? res.data.message : 'Error');
        return;
      }
      // refrescar el panel completo para mantener consistencia
      viewCurrentLocation();
    });
  }

  function renderLocationsCatalog(list){
    const sel = $('#posinv_bodega_loc_select');
    if(!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Selecciona ubicación —</option>' +
      (list||[]).map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    if(prev && (list||[]).includes(prev)) sel.value = prev;
  }

  function loadLocationsCatalog(){
    return ajax('posinv_bodega_locations_list', {}).then(res=>{
      if(res && res.success) return (res.data.items||[]);
      return [];
    });
  }

  function promptNewLocation(){
    const name = prompt('Nombre de nueva ubicación (ej: CAJA1, ESTANTE-A, etc):');
    if(!name) return;
    setMsg('Guardando ubicación…');
    ajax('posinv_bodega_locations_add', { name }).then(res=>{
      if(!res || !res.success){
        setMsg((res && res.data && res.data.message) ? res.data.message : 'Error');
        return;
      }
      const items = res.data.items || [];
      renderLocationsCatalog(items);
      const sel = $('#posinv_bodega_loc_select');
      if(sel){
        sel.value = (res.data && res.data.normalized) ? String(res.data.normalized) : name.trim();
        sel.dispatchEvent(new Event('change'));
      }
      setMsg('Ubicación agregada');
    });
  }

  // Load locations list for product
  function loadLocations(pid){
    return ajax('posinv_bodega_list', { product_id: pid }).then(res=>{
      if(!res || !res.success){
        throw new Error((res && res.data && res.data.message) ? res.data.message : 'Error');
      }
      return res.data.items || [];
    });
  }

  function renderLocationsList(pid, items){
    const wrap = document.querySelector('.posinv-bodega-list[data-product-id="'+pid+'"]');
    if(!wrap) return;
    if(!items || !items.length){
      wrap.innerHTML = '<div class="posinv-muted">Sin ubicaciones guardadas.</div>';
      return;
    }
    const canDelPerm = !!(window.POSINV_BODEGA && POSINV_BODEGA.caps && POSINV_BODEGA.caps.delete);
    // Mostrar botón siempre (algunas tablets/cachés pueden traer caps incorrectas); el servidor valida permisos.
    const canDel = true;
    wrap.innerHTML = `
<table class="posinv-bc-table" style="margin:0;">
  <thead><tr>
    <th style="width:180px;">Ubicación</th>
    <th style="width:120px;">Cantidad</th>
    <th>Observaciones</th>
    <th style="width:170px;">Guardado</th>
    <th style="width:120px;"></th>
  </tr></thead>
  <tbody>
    ${items.map(it=>`
      <tr data-row-id="${escapeHtml(it.id)}">
        <td>${escapeHtml(it.loc)}</td>
        <td>${escapeHtml(it.qty)}</td>
        <td>${escapeHtml(it.obs)}</td>
        <td>${escapeHtml(it.ts)}</td>
        <td>${canDel ? `<button type="button" class="posinv-btn posinv-btn-ghost posinv-bodega-del" data-row-id="${escapeHtml(it.id)}" data-product-id="${pid}">Borrar</button>` : ''}</td>
      </tr>
    `).join('')}
  </tbody>
</table>`;
  }

  function fillTransferStores(){
    const sel = $('#posinv_bodega_transfer_store');
    if(!sel) return;
    const stores = (window.POSINV_BODEGA && POSINV_BODEGA.stores) ? POSINV_BODEGA.stores : [];
    sel.innerHTML = (stores||[]).map(s=>`<option value="${escapeHtml(s.key)}">${escapeHtml(s.name||s.key)}</option>`).join('');
  }

  function getTransferStore(){
    const sel = $('#posinv_bodega_transfer_store');
    return sel ? (sel.value || '') : '';
  }

  function transferBulk(direction){
    if(!currentLoc){ setMsg('Primero selecciona una ubicación'); return; }
    if(!(window.POSINV_BODEGA && POSINV_BODEGA.caps && POSINV_BODEGA.caps.transfer)){
      setMsg('Sin permiso para traspasos');
      return;
    }
    const store = getTransferStore();
    const rows = $all('#posinv_bodega_table tr.posinv-bodega-row');
    if(!rows.length){ setMsg('No hay productos en la lista'); return; }
    const items = [];
    rows.forEach(tr=>{
      const pid = tr.getAttribute('data-product-id');
      const qty = parseFloat(($('.posinv-bodega-qty', tr)||{}).value || '0') || 0;
      const obs = String(($('.posinv-bodega-obs', tr)||{}).value || '').trim();
      if(pid && qty > 0) items.push({ product_id: pid, qty: qty, obs });
    });
    if(!items.length){ setMsg('No hay cantidades válidas'); return; }
    const label = direction === 'bodega_to_store' ? 'Enviar a tienda' : 'Recibir de tienda';
    if(!confirm(`${label}: ${items.length} producto(s) — ¿Continuar?`)) return;
    setMsg('Procesando traspaso…');
    ajax('posinv_bodega_transfer_bulk', { direction, store, loc: currentLoc, items: JSON.stringify(items) }).then(res=>{
      if(!res || !res.success){
        setMsg((res && res.data && res.data.message) ? res.data.message : 'Error');
        return;
      }
      const done = (res.data && res.data.done) ? res.data.done : [];
      const fails = done.filter(d=>!d.ok);
      if(fails.length){
        setMsg(`Traspaso con errores: ${fails.length}. Ej: ${(fails[0].message||'')}`);
      }else{
        setMsg('Traspaso listo');
      }
      // limpiar lista
      staged.clear();
      refreshStagedTable();
      clearResults();
    });
  }

  // Estado de productos agregados a la ubicación actual
  const staged = new Map(); // pid -> {id,name,code,image,qty,obs,ts}

  function refreshStagedTable(){
    renderRows(Array.from(staged.values()));
    setTimeout(()=>{
      const tw = $('#posinv_bodega_tablewrap');
      const inner = $('#posinv_bodega_hscroll_top_inner');
      if(tw && inner) inner.style.width = tw.scrollWidth + 'px';
    }, 40);
  }

  function addStagedProduct(p){
    if(!p || !p.id) return;
    const pid = String(p.id);
    const ex = staged.get(pid);
    if(ex){
      const v = parseFloat(ex.qty || 0) || 0;
      ex.qty = v + 1;
      staged.set(pid, ex);
    }else{
      staged.set(pid, {
        id: p.id,
        name: p.name || '',
        code: p.code || '',
        image: p.image || '',
        qty: 1,
        obs: '',
        ts: ''
      });
    }
    refreshStagedTable();
  }

  function renderSearchResults(items){
    const box = $('#posinv_bodega_results');
    if(!box) return;
    if(!items || !items.length){
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `
      <div class="posinv-muted" style="margin-bottom:6px;">Selecciona un producto para agregar a <strong>${escapeHtml(currentLoc||'')}</strong>:</div>
      <div class="posinv-bc-tablewrap" style="overflow-x:auto;">
        <table class="posinv-bc-table" style="margin:0;">
          <thead><tr>
            <th style="width:60px;">Img</th>
            <th style="width:90px;">ID</th>
            <th style="width:160px;">Código</th>
            <th>Producto</th>
            <th style="width:140px;"></th>
          </tr></thead>
          <tbody>
            ${(items||[]).map(p=>`
              <tr data-product-id="${p.id}">
                <td><img src="${escapeHtml(p.image||'')}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;"/></td>
                <td>${p.id}</td>
                <td>${escapeHtml(p.code||'')}</td>
                <td>${escapeHtml(p.name||'')}</td>
                <td><button type="button" class="posinv-btn posinv-bodega-add" data-product-id="${p.id}">Agregar</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
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
    const wrap = $('#posinv_bodega_topscan', view);
    const box = $('#posinv_bodega_topscan_video', view);
    if(wrap) wrap.style.display = 'none';
    if(box) box.innerHTML = '';
  }

  function setTopScanStatus(t){
    const el = $('#posinv_bodega_topscan_status', getView());
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
            const qEl = $('#posinv_bodega_search');
            if(qEl) qEl.value = raw;
            if(window.POSINV_BODEGA_API && window.POSINV_BODEGA_API.onScan){
              window.POSINV_BODEGA_API.onScan();
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
    const wrap = $('#posinv_bodega_topscan', view);
    const box = $('#posinv_bodega_topscan_video', view);
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

  // Search products using existing endpoint (same as etiquetas/código)
  let searchTimer = null;
  let lastSearchQ = '';
  let lastSearchAt = 0;
  let searchState = { q:'', cat:'', offset:0, perPage:30, hasMore:false, loading:false, items:[] };
  function doSearch(opts){
    opts = opts || {};
    const append = !!opts.append;
    const q = String(opts.q != null ? opts.q : (($('#posinv_bodega_search')||{}).value || '')).trim();
    const cat = String(opts.cat != null ? opts.cat : (($('#posinv_bodega_cat')||{}).value || ''));
    if(!currentLoc){
      setMsg('Primero selecciona una ubicación');
      return;
    }
    if(!q && !cat){
      clearResults();
      setMsg('');
      return;
    }

    const now = Date.now();
    const offset = append ? (searchState.offset || 0) : 0;
    if(q && q === lastSearchQ && (now - lastSearchAt) < 250 && !append){
      return;
    }
    lastSearchQ = q;
    lastSearchAt = now;

    searchState.q = q;
    searchState.cat = cat;
    searchState.loading = true;
    if(append) renderSearchLoadMore();
    setMsg('Buscando…');
    ajax('posinv_barcode_search', { q: q, cat: cat, per_page: searchState.perPage, offset: offset, module: 'bodega', store: (document.querySelector("#posinvStore")?document.querySelector("#posinvStore").value:"") }).then(res=>{
      searchState.loading = false;
      if(!res || !res.success){
        setMsg((res && res.data && res.data.message) ? res.data.message : 'Error');
        renderSearchLoadMore();
        return;
      }
      const payload = res.data || {};
      const raw = Array.isArray(res.data) ? res.data : ((res.data && res.data.items) ? res.data.items : []);
      const items = (raw||[]).map(p => ({
        id: p.id,
        name: p.name,
        code: (p.barcode && String(p.barcode).trim()) ? String(p.barcode).trim() : String(p.id),
        image: p.image_url || p.image || '',
      }));
      searchState.hasMore = !!(payload && payload.has_more);
      searchState.offset = (payload && typeof payload.next_offset !== 'undefined') ? parseInt(payload.next_offset,10)||0 : (offset + items.length);
      if(items.length === 1 && !append && q){
        addStagedProduct(items[0]);
        clearResults();
        setMsg('Agregado');
        const inp = $('#posinv_bodega_search');
        if(inp){ inp.value=''; inp.focus(); }
        return;
      }
      searchState.items = append ? searchState.items.concat(items) : items;
      renderSearchResults(searchState.items);
      renderSearchLoadMore();
      setMsg(searchState.items.length ? ('Resultados: '+searchState.items.length) : 'Sin resultados');
    }).catch(()=>{
      searchState.loading = false;
      searchState.hasMore = false;
      renderSearchLoadMore();
      setMsg('Error');
    });
  }

  // llamado por pos.js cuando se detecta un escaneo  // llamado por pos.js cuando se detecta un escaneo
  window.POSINV_BODEGA_API.onScan = function(){
    const q = $('#posinv_bodega_search');
    if(!q) return;
    const v = (q.value||'').trim();
    if(!v) return;
    try{ doSearch({append:false}); }catch(e){}
  };

  function scheduleSearch(){
    if(searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function(){ doSearch({append:false}); }, 180);
  }

  function saveAll(){
    if(!(window.POSINV_BODEGA && POSINV_BODEGA.caps && POSINV_BODEGA.caps.edit)){
      setMsg('Sin permiso para editar bodega');
      return;
    }
    if(!currentLoc){
      setMsg('Primero selecciona una ubicación');
      return;
    }
    const rows = $all('#posinv_bodega_table tr.posinv-bodega-row');
    if(!rows.length){
      setMsg('No hay productos para guardar');
      return;
    }
    const payload = [];
    rows.forEach(tr=>{
      const pid = tr.getAttribute('data-product-id');
      const loc = ($('.posinv-bodega-loc', tr)||{}).value || '';
      const qty = ($('.posinv-bodega-qty', tr)||{}).value || '';
      const obs = ($('.posinv-bodega-obs', tr)||{}).value || '';
      if(pid && String(loc).trim() !== ''){
        payload.push({ product_id: pid, loc: String(loc).trim(), qty: qty, obs: String(obs||'').trim() });
      }
    });
    if(!payload.length){
      setMsg('No hay productos para guardar');
      return;
    }
    setMsg('Guardando todo…');
    ajax('posinv_bodega_save_bulk', { rows: JSON.stringify(payload) }).then(res=>{
      if(!res || !res.success){
        setMsg((res && res.data && res.data.message) ? res.data.message : 'Error');
        return;
      }
      const saved = (res.data && res.data.saved) ? res.data.saved : {};
      rows.forEach(tr=>{
        const pid = String(tr.getAttribute('data-product-id')||'');
        if(pid && saved[pid]){
          const tsEl = $('.posinv-bodega-ts', tr);
          if(tsEl) tsEl.textContent = saved[pid];
          const ex = staged.get(pid);
          if(ex){
            ex.ts = saved[pid];
            ex.qty = ($('.posinv-bodega-qty', tr)||{}).value || ex.qty;
            ex.obs = ($('.posinv-bodega-obs', tr)||{}).value || ex.obs;
            staged.set(pid, ex);
          }
        }
      });
      setMsg('Guardado general listo');
      const inp = $('#posinv_bodega_search');
      if(inp){ inp.focus(); }
    });
  }

  function onSaveRow(tr){
    if(!(window.POSINV_BODEGA && POSINV_BODEGA.caps && POSINV_BODEGA.caps.edit)){
      setMsg('Sin permiso para editar bodega');
      return;
    }
    const pid = tr.getAttribute('data-product-id');
    const loc = $('.posinv-bodega-loc', tr).value.trim();
    const qty = $('.posinv-bodega-qty', tr).value;
    const obs = $('.posinv-bodega-obs', tr).value.trim();
    if(!loc){
      setMsg('Falta ubicación');
      return;
    }
    setMsg('Guardando…');
    ajax('posinv_bodega_save', { product_id: pid, loc: loc, qty: qty, obs: obs }).then(res=>{
      if(!res || !res.success){
        setMsg((res && res.data && res.data.message) ? res.data.message : 'Error');
        return;
      }
      const ts = res.data.ts || '';
      $('.posinv-bodega-ts', tr).textContent = ts;
      setMsg('Guardado');
      // If sublist is open, refresh
      const sub = document.querySelector('.posinv-bodega-sub[data-product-id="'+pid+'"]');
      if(sub && sub.style.display !== 'none'){
        loadLocations(pid).then(items=>renderLocationsList(pid, items)).catch(e=>{ setMsg(e.message||'Error'); });
      }
      // Sync staged state
      const ex = staged.get(String(pid));
      if(ex){
        ex.ts = ts;
        ex.qty = qty;
        ex.obs = obs;
        staged.set(String(pid), ex);
      }
      const inp = $('#posinv_bodega_search');
      if(inp){ inp.focus(); }
    });
  }

  function toggleView(tr){
    const pid = tr.getAttribute('data-product-id');
    const sub = document.querySelector('.posinv-bodega-sub[data-product-id="'+pid+'"]');
    if(!sub) return;
    const open = sub.style.display !== 'none';
    sub.style.display = open ? 'none' : '';
    if(!open){
      loadLocations(pid).then(items=>renderLocationsList(pid, items)).catch(e=>{ setMsg(e.message||'Error'); });
    }
  }

  function onDelete(btn){
    if(!(window.POSINV_BODEGA && POSINV_BODEGA.caps && POSINV_BODEGA.caps.delete)){
      setMsg('Sin permiso para borrar');
      return;
    }
    const pid = btn.getAttribute('data-product-id');
    const rowId = btn.getAttribute('data-row-id');
    if(!confirm('¿Borrar esta ubicación?')) return;
    setMsg('Borrando…');
    ajax('posinv_bodega_delete', { product_id: pid, row_id: rowId }).then(res=>{
      if(!res || !res.success){
        setMsg((res && res.data && res.data.message) ? res.data.message : 'Error');
        return;
      }
      const items = res.data.items || [];
      renderLocationsList(pid, items);
      setMsg('Borrado');
    });
  }

  function bindEvents(){
    // Catalogo de ubicaciones
    loadLocationsCatalog().then(list=>{
      renderLocationsCatalog(list);
    });

    fillTransferStores();

    // Permisos: ocultar controles de traspaso si no aplica
    const canTransfer = !!(window.POSINV_BODEGA && POSINV_BODEGA.caps && POSINV_BODEGA.caps.transfer);
    const btnSend = $('#posinv_bodega_btn_send_store');
    const btnRecv = $('#posinv_bodega_btn_recv_store');
    const selStore = $('#posinv_bodega_transfer_store');
    if(!canTransfer){
      if(btnSend) btnSend.style.display = 'none';
      if(btnRecv) btnRecv.style.display = 'none';
      if(selStore) selStore.style.display = 'none';
    }

    const selLoc = $('#posinv_bodega_loc_select');
    if(selLoc){
      selLoc.addEventListener('change', ()=>{
        currentLoc = selLoc.value || '';
        panelShow(false);
        if(!currentLoc){
          setLocHint('Primero elige la ubicación, después escanea productos.');
          staged.clear();
          refreshStagedTable();
          clearResults();
          return;
        }
        setLocHint('Escaneando en: ' + currentLoc);
        staged.clear();
        refreshStagedTable();
        clearResults();
        const inp = $('#posinv_bodega_search');
        if(inp){ inp.focus(); }
      });
    }

    const btnAddLoc = $('#posinv_bodega_loc_add');
    if(btnAddLoc){ btnAddLoc.addEventListener('click', promptNewLocation); }

    const btnViewLoc = $('#posinv_bodega_loc_view');
    if(btnViewLoc){ btnViewLoc.addEventListener('click', viewCurrentLocation); }

    const btnPanelClose = $('#posinv_bodega_loc_panel_close');
    if(btnPanelClose){ btnPanelClose.addEventListener('click', ()=>panelShow(false)); }

    const search = $('#posinv_bodega_search');
    const btn = $('#posinv_bodega_btn_search');
    const btnScan = $('#posinv_bodega_btn_scan', getView());
    const btnScanClose = $('#posinv_bodega_topscan_close', getView());
    const btnSaveAll = $('#posinv_bodega_btn_saveall');
    const btnSendStore = $('#posinv_bodega_btn_send_store');
    const btnRecvStore = $('#posinv_bodega_btn_recv_store');
    if(search){
      search.addEventListener('input', scheduleSearch);
      // Enter triggers immediate
      search.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter'){
          e.preventDefault();
          if(searchTimer) clearTimeout(searchTimer);
          stopTopScanner();
          doSearch();
        }
      });
    }
    if(btn){ btn.addEventListener('click', ()=>{ stopTopScanner(); doSearch(); }); }
    if(btnScan) btnScan.addEventListener('click', (ev)=>openTopScanner(ev));
    if(btnScanClose) btnScanClose.addEventListener('click', stopTopScanner);
    if(btnSaveAll){ btnSaveAll.addEventListener('click', saveAll); }
    if(btnSendStore){ btnSendStore.addEventListener('click', ()=>transferBulk('bodega_to_store')); }
    if(btnRecvStore){ btnRecvStore.addEventListener('click', ()=>transferBulk('store_to_bodega')); }

    document.addEventListener('click', (e)=>{
      const t = e.target;
      if(!(t instanceof Element)) return;

      if(t.classList.contains('posinv-bodega-loc-save')){
        const tr = t.closest('tr.posinv-bodega-locrow');
        if(tr) updatePanelRow(tr);
      }
      if(t.classList.contains('posinv-bodega-loc-del')){
        const tr = t.closest('tr.posinv-bodega-locrow');
        if(tr) deletePanelRow(tr);
      }

      if(t.classList.contains('posinv-bodega-add')){
        const pid = t.getAttribute('data-product-id');
        const row = t.closest('tr');
        if(row){
          const imgEl = row.querySelector('img');
          const tds = row.querySelectorAll('td');
          const code = (tds && tds[2]) ? (tds[2].textContent||'').trim() : '';
          const name = (tds && tds[3]) ? (tds[3].textContent||'').trim() : '';
          addStagedProduct({ id: parseInt(pid,10), image: imgEl ? imgEl.getAttribute('src') : '', code, name });
          clearResults();
          setMsg('Agregado');
          const inp = $('#posinv_bodega_search');
          if(inp){ inp.value=''; inp.focus(); }
        }
      }
      if(t.classList.contains('posinv-bodega-save')){
        const tr = t.closest('tr.posinv-bodega-row');
        if(tr) onSaveRow(tr);
      }
      if(t.classList.contains('posinv-bodega-view')){
        const tr = t.closest('tr.posinv-bodega-row');
        if(tr) toggleView(tr);
      }
      if(t.classList.contains('posinv-bodega-del')){
        onDelete(t);
      }
      if(t.classList.contains("posinv-bodega-loc-save")){
        const tr = t.closest("tr.posinv-bodega-loc-row");
        if(tr){
          const pid = tr.dataset.productId;
          const rid = tr.dataset.rowId;
          const qtyEl = tr.querySelector(".posinv-bodega-loc-qty");
          const obsEl = tr.querySelector(".posinv-bodega-loc-obs");
          const qty = qtyEl ? qtyEl.value : "0";
          const obs = obsEl ? obsEl.value : "";
          ajax("posinv_bodega_update", { product_id: pid, row_id: rid, qty: qty, obs: obs }).then(resp=>{
            if(resp && resp.success){
              const tsCell = tr.querySelector("td.posinv-muted");
              if(tsCell && resp.data && resp.data.ts) tsCell.textContent = resp.data.ts;
              setMsg("Guardado");
            }else{
              const msg = resp && resp.data && resp.data.message ? resp.data.message : "Error guardando";
              setMsg(msg);
            }
          }).catch(()=>setMsg("Error de servidor"));
        }
      }
      if(t.classList.contains("posinv-bodega-loc-del")){
        const tr = t.closest("tr.posinv-bodega-loc-row");
        if(tr){
          if(!confirm("¿Eliminar este producto de la ubicación?")) return;
          const pid = tr.dataset.productId;
          const rid = tr.dataset.rowId;
          ajax("posinv_bodega_delete", { product_id: pid, row_id: rid }).then(resp=>{
            if(resp && resp.success){
              tr.remove();
              setMsg("Eliminado");
            }else{
              const msg = resp && resp.data && resp.data.message ? resp.data.message : "Error eliminando";
              setMsg(msg);
            }
          }).catch(()=>setMsg("Error de servidor"));
        }
      }
    });

    // When switching tabs, focus input
    document.addEventListener('posinv:tab', (e)=>{
      if(e && e.detail && e.detail.tab === 'bodega'){
        const inp = $('#posinv_bodega_search');
        if(inp && currentLoc){ inp.focus(); }
        // sync scroll
        setTimeout(()=>{
          const tw = $('#posinv_bodega_tablewrap');
          const inner = $('#posinv_bodega_hscroll_top_inner');
          if(tw && inner) inner.style.width = tw.scrollWidth + 'px';
        }, 80);
      }else{
        stopTopScanner();
      }
    });

    document.addEventListener('posinv:bodega-catalog-updated', (ev)=>{
      const incoming = ev && ev.detail && Array.isArray(ev.detail.catalog) ? ev.detail.catalog : null;
      if(incoming){
        renderLocationsCatalog(incoming);
        const sel = $('#posinv_bodega_loc_select');
        const dest = ev.detail && ev.detail.dest_loc ? String(ev.detail.dest_loc) : '';
        if(sel && dest && incoming.includes(dest)){
          sel.value = dest;
        }
      }
    });

    initHScroll($('#posinv_bodega_hscroll_top'), $('#posinv_bodega_hscroll_top_inner'), $('#posinv_bodega_tablewrap'));
    initHScroll($('#posinv_bodega_loc_hscroll_top'), $('#posinv_bodega_loc_hscroll_top_inner'), $('#posinv_bodega_loc_tablewrap'));
  }

  // Wait for DOM ready
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bindEvents);
  }else{
    bindEvents();
  }
})();
