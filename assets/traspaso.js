(function(){
  'use strict';

  const $ = (sel, root) => (root||document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root||document).querySelectorAll(sel));
  function getView(){ return document.getElementById('posinvTraspasoView') || document; }

  const state = {
    page: 1,
    hasMore: false,
    loading: false,
    mode: 'search',
    catalog: [],
    bodegaRows: [],
    lastScan: {v:'', t:0},
    inline: null,
  };

  const topScan = {stream:null, video:null, detector:null, raf:0, active:false, lastRaw:'', stableCount:0, lastSeenAt:0};

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function msg(t){ const el = $('#posinv_tras_msg'); if(el) el.textContent = t || ''; }
  function showNotice(text, title){
    const modal = $('#posinv_tras_notice', getView());
    const titleEl = $('#posinv_tras_notice_title', getView());
    const bodyEl = $('#posinv_tras_notice_body', getView());
    if(titleEl) titleEl.textContent = title || 'Aviso';
    if(bodyEl) bodyEl.textContent = text || '';
    if(modal){ modal.setAttribute('aria-hidden','false'); modal.style.display='flex'; }
  }
  function closeNotice(){ const modal = $('#posinv_tras_notice', getView()); if(modal){ modal.setAttribute('aria-hidden','true'); modal.style.display='none'; } }

  function storeLabel(key){ return key === 'store1' ? 'San Mateo' : (key === 'store2' ? 'Xaltocán' : 'Bodega'); }
  function copyCats(){
    const catSel = $('#posinv_tras_cat', getView());
    const globalCat = $('#posinvCat');
    if(catSel && globalCat){ catSel.innerHTML = globalCat.innerHTML; catSel.value = globalCat.value || ''; }
  }


  function renderCatalog(){
    const dl = $('#posinv_tras_loc_catalog', getView());
    if(!dl) return;
    dl.innerHTML = (state.catalog||[]).map(loc => `<option value="${esc(loc)}"></option>`).join('');
  }

  async function loadLocations(productId){
    const fd = new FormData();
    fd.append('action','posinv_traspaso_locations');
    fd.append('nonce', POSINV_TRASPASO.nonce || '');
    if(productId) fd.append('product_id', String(productId));
    const r = await fetch(POSINV_TRASPASO.ajaxurl, {method:'POST', credentials:'same-origin', body:fd});
    const j = await r.json();
    if(j && j.success){
      state.catalog = (j.data && j.data.catalog) ? j.data.catalog : [];
      state.bodegaRows = (j.data && j.data.rows) ? j.data.rows : [];
    }else{
      state.catalog = [];
      state.bodegaRows = [];
    }
    renderCatalog();
  }

  function historyEmpty(){
    const tb = $('#posinv_tras_history_tbody', getView());
    if(tb) tb.innerHTML = '<tr><td colspan="10" class="posinv-muted">Sin traspasos registrados todavía.</td></tr>';
  }

  function historyItems(){
    const tb = $('#posinv_tras_history_tbody', getView());
    if(!tb) return [];
    const rows = $$('.posinv-tras-history-row', tb);
    return rows.map(row => ({
      date: row.getAttribute('data-date') || '',
      folio: row.getAttribute('data-folio') || '',
      product_id: row.getAttribute('data-product-id') || '',
      code: row.getAttribute('data-code') || '',
      name: row.getAttribute('data-name') || '',
      origin: row.getAttribute('data-origin') || '',
      destination: row.getAttribute('data-destination') || '',
      qty: row.getAttribute('data-qty') || '',
      user: row.getAttribute('data-user') || '',
      note: row.getAttribute('data-note') || ''
    }));
  }

  function downloadHistoryCsv(){
    const items = historyItems();
    if(!items.length){ return showNotice('No hay traspasos para guardar.', 'Aviso'); }
    const lines = [];
    const headers = ['Fecha','Folio','ID','Código','Producto','Origen','Destino','Cantidad','Usuario','Motivo'];
    lines.push(headers.join(','));
    items.forEach(it => {
      const row = [it.date,it.folio,it.product_id,it.code,it.name,it.origin,it.destination,it.qty,it.user,it.note]
        .map(v => '"' + String(v||'').replace(/"/g,'""') + '"');
      lines.push(row.join(','));
    });
    const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'traspasos_' + new Date().toISOString().slice(0,19).replace(/[T:]/g,'-') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function printHistory(){
    const wrap = $('#posinv_tras_history_table', getView());
    if(!wrap){ return showNotice('No se pudo preparar la impresión.', 'Error'); }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Historial de traspasos</title>
      <style>body{font-family:Arial,sans-serif;padding:24px} h1{font-size:20px;margin:0 0 12px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left} th{background:#f3f3f3}</style>
      </head><body><h1>Historial de traspasos</h1>${wrap.outerHTML}</body></html>`;
    const w = window.open('', '_blank');
    if(!w){ return showNotice('El navegador bloqueó la ventana de impresión.', 'Aviso'); }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(()=>{ try{ w.print(); }catch(_e){} }, 250);
  }

  async function clearHistory(){
    if(!window.confirm('¿Seguro que quieres limpiar todo el historial de traspasos?')) return;
    const fd = new FormData();
    fd.append('action','posinv_traspaso_clear_history');
    fd.append('nonce', POSINV_TRASPASO.nonce || '');
    try{
      const r = await fetch(POSINV_TRASPASO.ajaxurl, {method:'POST', credentials:'same-origin', body:fd});
      const j = await r.json();
      if(!j || !j.success){
        return showNotice((j && j.data && j.data.message) ? j.data.message : 'No se pudo limpiar el historial.', 'Error');
      }
      historyEmpty();
      msg('');
    }catch(e){
      showNotice('Error de red al limpiar el historial.', 'Error');
    }
  }

    function buildInlineRow(item, origin){
    const destOptions = origin === 'store1'
      ? '<option value="">— Destino —</option><option value="store2">Xaltocán</option><option value="bodega">Bodega</option>'
      : origin === 'store2'
      ? '<option value="">— Destino —</option><option value="store1">San Mateo</option><option value="bodega">Bodega</option>'
      : '<option value="">— Destino —</option><option value="store1">San Mateo</option><option value="store2">Xaltocán</option>';
    const originLocOptions = '<option value="">— Ubicación origen —</option>' + (state.bodegaRows||[]).map(r => `<option value="${esc(r.loc)}">${esc(r.loc)} (${esc(r.qty)})</option>`).join('');
    const max = origin === 'store1' ? Number(item.store1_stock||0) : origin === 'store2' ? Number(item.store2_stock||0) : Number(item.bodega_stock||0);
    return `<tr class="posinv-tras-inline-row" data-inline-for="${esc(item.id)}">
      <td colspan="9">
        <div class="posinv-bc-results" style="margin:8px 0 0; padding:12px; border:1px solid #ebe1ee; border-radius:14px; background:#fff;">
          <div class="posinv-labels-head" style="margin-bottom:8px;">
            <strong>Traspaso rápido</strong>
            <span class="posinv-muted">• origen: ${esc(storeLabel(origin))} • disponible: ${esc(max)}</span>
          </div>
          <div style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr 1.2fr auto;gap:10px;align-items:end;">
            <div>
              <label class="posinv-muted">Producto</label>
              <div>${esc(item.name || '')} • ID ${esc(item.id || '')}</div>
            </div>
            <div>
              <label class="posinv-muted">Origen</label>
              <input type="text" value="${esc(storeLabel(origin))}" readonly />
            </div>
            <div>
              <label class="posinv-muted">Destino</label>
              <select class="posinv-tras-inline-dest">${destOptions}</select>
            </div>
            <div>
              <label class="posinv-muted">Cantidad</label>
              <input class="posinv-tras-inline-qty" type="number" min="1" step="1" max="${esc(max)}" placeholder="0" />
            </div>
            <div>
              <label class="posinv-muted">Motivo / observaciones</label>
              <input class="posinv-tras-inline-note" type="text" placeholder="Opcional" />
            </div>
            <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;justify-content:flex-end;">
              <button class="posinv-btn posinv-btn-primary posinv-tras-inline-save" type="button">Guardar</button>
              <button class="posinv-btn posinv-btn-ghost posinv-tras-inline-cancel" type="button">Cancelar</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end;margin-top:10px;">
            <div class="posinv-tras-inline-origin-loc-wrap" style="display:${origin === 'bodega' ? 'block' : 'none'};">
              <label class="posinv-muted">Ubicación origen (bodega)</label>
              <select class="posinv-tras-inline-origin-loc">${originLocOptions}</select>
            </div>
            <div class="posinv-tras-inline-dest-loc-wrap" style="display:none;">
              <label class="posinv-muted">Ubicación destino (bodega)</label>
              <input class="posinv-tras-inline-dest-loc" type="text" list="posinv_tras_loc_catalog" placeholder="Ej. A1" />
            </div>
          </div>
        </div>
      </td>
    </tr>`;
  }

  function attachInlineEvents(row, item, origin){
    const dest = $('.posinv-tras-inline-dest', row);
    const qty = $('.posinv-tras-inline-qty', row);
    const note = $('.posinv-tras-inline-note', row);
    const originLoc = $('.posinv-tras-inline-origin-loc', row);
    const destLoc = $('.posinv-tras-inline-dest-loc', row);
    const destLocWrap = $('.posinv-tras-inline-dest-loc-wrap', row);
    if(dest){
      dest.addEventListener('change', ()=>{
        if(destLocWrap) destLocWrap.style.display = dest.value === 'bodega' ? 'block' : 'none';
      });
    }
    const cancel = $('.posinv-tras-inline-cancel', row);
    if(cancel){ cancel.addEventListener('click', ()=> closeInlineEditor()); }
    const save = $('.posinv-tras-inline-save', row);
    if(save){
      save.addEventListener('click', ()=> saveTransfer({
        product_id: item.id,
        item,
        origin,
        destination: dest ? dest.value.trim() : '',
        qty: qty ? qty.value : '',
        note: note ? note.value.trim() : '',
        origin_loc: originLoc ? originLoc.value.trim() : '',
        dest_loc: destLoc ? destLoc.value.trim() : ''
      }));
    }
  }

  async function openInlineEditor(item, origin, afterRow){
    closeInlineEditor();
    state.inline = {productId: String(item.id), origin};
    await loadLocations(origin === 'bodega' ? item.id : 0).catch(()=>{ state.catalog=[]; state.bodegaRows=[]; renderCatalog(); });
    const html = buildInlineRow(item, origin);
    afterRow.insertAdjacentHTML('afterend', html);
    const editorRow = afterRow.nextElementSibling;
    if(editorRow){
      attachInlineEvents(editorRow, item, origin);
    }
  }

  function closeInlineEditor(){
    const current = $('#posinv_tras_tbody .posinv-tras-inline-row', getView());
    if(current) current.remove();
    state.inline = null;
  }

  function render(items, append){
    const tb = $('#posinv_tras_tbody', getView());
    if(!tb) return;
    if(!items || !items.length){
      if(!append) tb.innerHTML = '<tr><td colspan="10" class="posinv-muted">Sin resultados.</td></tr>';
      return;
    }
    const rows = items.map(it => {
      const img = it.image_url ? `<img src="${esc(it.image_url)}" loading="lazy" decoding="async" style="width:44px;height:44px;object-fit:cover;border-radius:8px;" />` : '';
      const s1 = Number(it.store1_stock||0);
      const s2 = Number(it.store2_stock||0);
      const bd = Number(it.bodega_stock||0);
      const s1Html = s1 > 0 ? `<button class="posinv-tras-stockbtn" type="button" data-id="${esc(it.id)}" data-origin="store1" title="Mover desde San Mateo">${esc(s1)}</button>` : `<strong>${esc(s1)}</strong>`;
      const s2Html = s2 > 0 ? `<button class="posinv-tras-stockbtn" type="button" data-id="${esc(it.id)}" data-origin="store2" title="Mover desde Xaltocán">${esc(s2)}</button>` : `<strong>${esc(s2)}</strong>`;
      const bdHtml = bd > 0 ? `<button class="posinv-tras-stockbtn" type="button" data-id="${esc(it.id)}" data-origin="bodega" title="Mover desde Bodega">${esc(bd)}</button>` : `<strong>${esc(bd)}</strong>`;
      return `<tr class="posinv-tras-item-row" data-id="${esc(it.id)}">
        <td>${img}</td>
        <td><strong>${esc(it.id)}</strong></td>
        <td class="posinv-td-code">${esc(it.code||'')}</td>
        <td class="posinv-td-product">${esc(it.name||'')}</td>
        <td>${s1Html}</td>
        <td>${s2Html}</td>
        <td>${bdHtml}</td>
        <td class="posinv-td-locs">${it.bodega_locs ? esc(it.bodega_locs) : '<span class="posinv-muted">—</span>'}</td>
        <td class="posinv-td-total"><strong>${esc(it.total||0)}</strong></td>
      </tr>`;
    }).join('');
    if(append) tb.insertAdjacentHTML('beforeend', rows); else tb.innerHTML = rows;
    const map = new Map(items.map(it => [String(it.id), it]));
    tb.querySelectorAll('.posinv-tras-stockbtn').forEach(btn => {
      btn.addEventListener('click', ()=>{
        const id = String(btn.getAttribute('data-id') || '');
        const origin = String(btn.getAttribute('data-origin') || '');
        const item = map.get(id);
        const row = btn.closest('tr');
        if(item && row){ openInlineEditor(item, origin, row).catch(()=> showNotice('No se pudo abrir el formulario de traspaso.', 'Error')); }
      });
    });
  }

  function historyRowHtml(r){
    return `<tr>
      <td>${esc(r.date||'')}</td><td>${esc(r.folio||'')}</td><td>${esc(r.product_id||'')}</td><td>${esc(r.code||'')}</td><td>${esc(r.name||'')}</td><td>${esc(r.origin||'')}</td><td>${esc(r.destination||'')}</td><td><strong>${esc(r.qty||0)}</strong></td><td>${esc(r.user||'')}</td><td>${esc(r.note||'')}</td>
    </tr>`;
  }

  function renderHistory(items){
    const tb = $('#posinv_tras_history_tbody', getView());
    if(!tb) return;
    if(!items || !items.length){ historyEmpty(); return; }
    tb.innerHTML = items.map(r => historyRowHtml(r)).join('');
  }

  function prependHistory(r){
    const tb = $('#posinv_tras_history_tbody', getView());
    if(!tb || !r) return;
    const empty = tb.querySelector('td[colspan="10"]');
    if(empty) tb.innerHTML = '';
    tb.insertAdjacentHTML('afterbegin', historyRowHtml(r));
  }

  function toggleLoadMore(show){
    const wrap = $('#posinv_tras_loadmore_wrap', getView());
    const btn = $('#posinv_tras_loadmore', getView());
    if(wrap) wrap.style.display = show ? 'block' : 'none';
    if(btn) btn.disabled = !show || state.loading;
  }

  async function search(append=false){
    const q = ($('#posinv_tras_search', getView())?.value || '').trim();
    const cat = ($('#posinv_tras_cat', getView())?.value || '');
    if(!append) state.page = 1;
    state.loading = true;
    closeInlineEditor();
    toggleLoadMore(false);
    msg(append ? 'Cargando más…' : 'Buscando…');
    const fd = new FormData();
    fd.append('action', state.mode === 'bodega_only' ? 'posinv_traspaso_bodega_only' : 'posinv_traspaso_search');
    fd.append('nonce', POSINV_TRASPASO.nonce || '');
    fd.append('q', q);
    fd.append('cat', cat);
    fd.append('page', String(state.page||1));
    try{
      const r = await fetch(POSINV_TRASPASO.ajaxurl, {method:'POST', credentials:'same-origin', body:fd});
      const j = await r.json();
      if(!j || !j.success){ state.loading = false; const errMsg = (j && j.data && j.data.message) ? j.data.message : 'Error al buscar.'; msg(errMsg); showNotice(errMsg, 'Error'); if(!append) render([], false); return toggleLoadMore(false); }
      const items = (j.data && j.data.items) ? j.data.items : [];
      render(items, append);
      state.hasMore = !!(j.data && j.data.has_more);
      state.loading = false;
      toggleLoadMore(state.hasMore);
      const currentCount = $$('#posinv_tras_tbody tr.posinv-tras-item-row', getView()).length;
      msg(`Listo: ${currentCount}`);
    }catch(e){ state.loading = false; msg('Error de red.'); showNotice('Error de red al buscar productos.', 'Error'); if(!append) render([], false); toggleLoadMore(false); }
  }

  async function loadHistory(){
    const fd = new FormData();
    fd.append('action','posinv_traspaso_history');
    fd.append('nonce', POSINV_TRASPASO.nonce || '');
    try{
      const r = await fetch(POSINV_TRASPASO.ajaxurl, {method:'POST', credentials:'same-origin', body:fd});
      const j = await r.json();
      if(j && j.success) renderHistory((j.data && j.data.items) ? j.data.items : []);
    }catch(e){ historyEmpty(); }
  }

  async function saveTransfer(payload){
    const pid = String(payload && payload.product_id ? payload.product_id : '').trim();
    const origin = String(payload && payload.origin ? payload.origin : '').trim();
    const dest = String(payload && payload.destination ? payload.destination : '').trim();
    const qty = parseFloat(String(payload && payload.qty ? payload.qty : '0'));
    const note = String(payload && payload.note ? payload.note : '').trim();
    const originLoc = String(payload && payload.origin_loc ? payload.origin_loc : '').trim();
    const destLoc = String(payload && payload.dest_loc ? payload.dest_loc : '').trim();
    const item = payload && payload.item ? payload.item : null;

    if(!pid){ return showNotice('Selecciona un producto primero.', 'Error'); }
    if(!origin || !dest){ return showNotice('Elige origen y destino.', 'Error'); }
    if(origin === dest){ return showNotice('El origen no puede ser igual al destino.', 'Error'); }
    if(!qty || qty <= 0){ return showNotice('La cantidad debe ser mayor que 0.', 'Error'); }
    if(origin === 'bodega' && !originLoc){ return showNotice('Selecciona la ubicación de origen en bodega.', 'Error'); }
    if(dest === 'bodega' && !destLoc){ return showNotice('Captura la ubicación destino en bodega.', 'Error'); }

    const available = origin === 'store1' ? Number(item && item.store1_stock || 0) : origin === 'store2' ? Number(item && item.store2_stock || 0) : Number(item && item.bodega_stock || 0);
    if(qty > available){ return showNotice('No puedes mover más de lo disponible en el origen.', 'Error'); }
    if(origin === 'bodega' && originLoc){
      const found = (state.bodegaRows || []).find(r => String(r.loc||'') === originLoc);
      if(!found){ return showNotice('La ubicación origen seleccionada no existe en bodega.', 'Error'); }
      if(qty > Number(found.qty||0)){ return showNotice('La cantidad excede lo disponible en la ubicación origen de bodega.', 'Error'); }
    }

    const editor = document.querySelector('.posinv-tras-inline-row');
    const saveBtn = editor ? editor.querySelector('.posinv-tras-inline-save') : null;
    const cancelBtn = editor ? editor.querySelector('.posinv-tras-inline-cancel') : null;
    if(saveBtn) saveBtn.disabled = true;
    if(cancelBtn) cancelBtn.disabled = true;

    const fd = new FormData();
    fd.append('action','posinv_traspaso_save');
    fd.append('nonce', POSINV_TRASPASO.nonce || '');
    fd.append('product_id', pid);
    fd.append('origin', origin);
    fd.append('destination', dest);
    fd.append('qty', String(qty));
    fd.append('note', note);
    fd.append('origin_loc', originLoc);
    fd.append('dest_loc', destLoc);
    fd.append('client_txid', 'tr_' + Date.now() + '_' + Math.random().toString(36).slice(2,10));
    try{
      const r = await fetch(POSINV_TRASPASO.ajaxurl, {method:'POST', credentials:'same-origin', body:fd});
      const txt = await r.text();
      let j = null;
      try{ j = JSON.parse(txt); }catch(_e){
        if(txt && txt.indexOf('"success":true') !== -1){
          j = { success:true, data:{} };
        }
      }
      if(!j || !j.success){
        if(saveBtn) saveBtn.disabled = false;
        if(cancelBtn) cancelBtn.disabled = false;
        return showNotice((j && j.data && j.data.message) ? j.data.message : 'No se pudo guardar el traspaso.', 'Error');
      }
      if(j.data && Array.isArray(j.data.catalog)){
        state.catalog = j.data.catalog;
        renderCatalog();
      }
      try{ document.dispatchEvent(new CustomEvent('posinv:bodega-catalog-updated', { detail: { catalog: state.catalog.slice(), dest_loc: destLoc || '' } })); }catch(_e){}
      if(j.data && j.data.history){
        prependHistory(j.data.history);
      } else {
        loadHistory();
      }
      closeInlineEditor();
      msg('');
      await search(false);
    }catch(e){
      if(saveBtn) saveBtn.disabled = false;
      if(cancelBtn) cancelBtn.disabled = false;
      showNotice('Error de red al guardar el traspaso.', 'Error');
    }
  }

  function stopTopScanner(){
    if(topScan.raf){ cancelAnimationFrame(topScan.raf); topScan.raf = 0; }
    if(topScan.stream && topScan.stream.getTracks){ topScan.stream.getTracks().forEach(t=>{ try{ t.stop(); }catch(_e){} }); }
    if(topScan.video){ try{ topScan.video.pause(); }catch(_e){} try{ topScan.video.srcObject = null; }catch(_e){} }
    topScan.stream = null; topScan.video = null; topScan.detector = null; topScan.active = false; topScan.lastRaw=''; topScan.stableCount=0; topScan.lastSeenAt=0;
    const wrap = $('#posinv_tras_topscan', getView()); const box = $('#posinv_tras_topscan_video', getView());
    if(wrap) wrap.style.display = 'none'; if(box) box.innerHTML='';
  }
  function setTopScanStatus(t){ const el = $('#posinv_tras_topscan_status', getView()); if(el) el.textContent = t || ''; }
  async function topScannerTick(){
    if(!topScan.detector || !topScan.video) return;
    try{
      const detected = await topScan.detector.detect(topScan.video);
      if(detected && detected.length){
        let raw=''; for(let i=0;i<detected.length;i++){ raw = String((detected[i] && detected[i].rawValue) || '').trim(); if(raw) break; }
        if(raw){
          const now = Date.now();
          if(raw === topScan.lastRaw){ if(!topScan.lastSeenAt || (now-topScan.lastSeenAt)<=1800) topScan.stableCount += 1; else topScan.stableCount = 1; }
          else { topScan.lastRaw = raw; topScan.stableCount = 1; }
          topScan.lastSeenAt = now;
          setTopScanStatus(topScan.stableCount >= 2 ? ('Código confirmado: ' + raw) : ('Enfocando… detectado ' + raw + ' (' + topScan.stableCount + '/2)'));
          if(topScan.stableCount >= 2){ stopTopScanner(); const q=$('#posinv_tras_search', getView()); if(q) q.value = raw; onScan(); return; }
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
    const wrap = $('#posinv_tras_topscan', getView()); const box = $('#posinv_tras_topscan_video', getView());
    if(wrap) wrap.style.display = 'block';
    if(!('BarcodeDetector' in window)){ setTopScanStatus('Tu navegador no soporta escaneo nativo aquí.'); return; }
    try{ topScan.detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code'] }); }
    catch(_e){ try{ topScan.detector = new BarcodeDetector(); }catch(_e2){ topScan.detector = null; } }
    if(!topScan.detector || !box){ setTopScanStatus('No se pudo iniciar el lector.'); return; }
    const video = document.createElement('video'); video.setAttribute('playsinline',''); video.autoplay=true; video.muted=true; box.innerHTML=''; box.appendChild(video); const guide=document.createElement('div'); guide.className='posinv-scan-guide'; box.appendChild(guide);
    try{
      topScan.stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}, focusMode:{ideal:'continuous'}}, audio:false});
      topScan.video = video; topScan.video.srcObject = topScan.stream; await topScan.video.play(); topScan.active = true; setTopScanStatus('Enfocando cámara…'); topScan.raf = requestAnimationFrame(topScannerTick);
    }catch(err){ setTopScanStatus((err && err.message) ? err.message : 'No se pudo abrir la cámara.'); }
  }
  function onScan(){
    const q = ($('#posinv_tras_search', getView())?.value || '').trim();
    const now = Date.now();
    if(q && state.lastScan.v === q && (now - state.lastScan.t) < 900) return;
    state.lastScan = {v:q, t:now};
    state.mode = 'search';
    state.page = 1;
    search(false);
  }

  let liveTimer = 0;
  function queueLiveSearch(){ clearTimeout(liveTimer); liveTimer = setTimeout(()=>{ state.mode='search'; state.page=1; search(false); }, 250); }

  function bind(){
    copyCats();
    loadLocations(0).catch(()=>{});
    loadHistory();
    const legacy = $('#posinv_tras_legacy_form', getView()); if(legacy) legacy.style.display = 'none';
    const view = getView();
    const btn = $('#posinv_tras_btn_search', view); if(btn) btn.addEventListener('click', ()=>{ stopTopScanner(); state.mode='search'; state.page=1; search(false); });
    const btnClear = $('#posinv_tras_btn_clear', view); if(btnClear) btnClear.addEventListener('click', ()=>{ stopTopScanner(); const q=$('#posinv_tras_search', view); if(q) q.value=''; state.mode='search'; state.page=1; closeInlineEditor(); render([], false); msg(''); toggleLoadMore(false); });
    const btnScan = $('#posinv_tras_btn_scan', view); if(btnScan) btnScan.addEventListener('click', (ev)=>openTopScanner(ev));
    const btnScanClose = $('#posinv_tras_topscan_close', view); if(btnScanClose) btnScanClose.addEventListener('click', stopTopScanner);
    const btnBodega = $('#posinv_tras_btn_bodega_only', view); if(btnBodega) btnBodega.addEventListener('click', ()=>{ stopTopScanner(); state.mode='bodega_only'; state.page=1; search(false); });
    const btnMore = $('#posinv_tras_loadmore', view); if(btnMore) btnMore.addEventListener('click', ()=>{ if(state.hasMore && !state.loading){ state.page += 1; search(true); } });
    const btnHistSave = $('#posinv_tras_hist_save', view); if(btnHistSave) btnHistSave.addEventListener('click', downloadHistoryCsv);
    const btnHistPrint = $('#posinv_tras_hist_print', view); if(btnHistPrint) btnHistPrint.addEventListener('click', printHistory);
    const btnHistClear = $('#posinv_tras_hist_clear', view); if(btnHistClear) btnHistClear.addEventListener('click', clearHistory);
    const qEl = $('#posinv_tras_search', view); if(qEl){ qEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); stopTopScanner(); state.mode='search'; state.page=1; search(false); } }); qEl.addEventListener('input', ()=>{ state.mode='search'; queueLiveSearch(); }); }
    const catEl = $('#posinv_tras_cat', view); if(catEl){ catEl.addEventListener('change', ()=>{ state.mode='search'; state.page=1; search(false); }); }
    ['#posinv_tras_notice_close','#posinv_tras_notice_ok'].forEach(sel => { const el=$(sel, view); if(el) el.addEventListener('click', closeNotice); });
    const notice = $('#posinv_tras_notice', view); if(notice) notice.addEventListener('click', (e)=>{ if(e.target===notice) closeNotice(); });
    document.addEventListener('posinv:tab', (ev)=>{ if(ev && ev.detail && ev.detail.tab === 'traspaso'){ loadLocations(0).catch(()=>{}); try{ const q = $('#posinv_tras_search', view); if(q) q.focus(); }catch(e){} } else { stopTopScanner(); closeInlineEditor(); } });
  }

  window.POSINV_TRASPASO_API = { onScan };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
