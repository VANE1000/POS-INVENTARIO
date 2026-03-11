/* global POSINV */
(function(){
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = {
    store: null,
    mode: 'sale',
    cart: [],
    lastTicket: null,
    syncing: false,
    customer: {type:'none'},
    ticketDisc: {type:'none', value:0},
    payment: {method:'cash', cash:0, transfer:0, card:0},
    returnInfo: {original_ticket_id:0, found:null, reason:'defectuoso', reason_other:'', return_type:'inventory'},
    shift: null,
    busy: false,
    activePriceLine: null,
    layaway: {enabled:false, product:null, deposit:0},
  };

  // Scanner routing (Caja / Stock+)
  let __scanTargetSel = '#posinvQuery';
  let __scanOnDecode = function(){ try{ search({ blurAfter:false, clearAfter:true }); }catch(e){} };
  let __scanPrevTargetSel = null;
  let __scanPrevOnDecode = null;

  function fmtMoney(n){
    try{
      return new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN'}).format(n||0);
    }catch(e){
      return '$' + (n||0).toFixed(2);
    }
  }


  function openModal(sel){
    const el = $(sel);
    if(!el) return;
    el.setAttribute('aria-hidden','false');
    el.classList.add('is-open');
    el.style.display = 'flex';
  }

  function closeModal(sel){
    const el = $(sel);
    if(!el) return;
    el.setAttribute('aria-hidden','true');
    el.classList.remove('is-open');
    el.style.display = 'none';
  }

  function showNotice(text, type, title){
    const titleEl = $('#posinvNoticeTitle');
    const bodyEl = $('#posinvNoticeBody');
    if(titleEl){
      titleEl.textContent = title || (type === 'err' ? 'Error' : (type === 'ok' ? 'Listo' : 'Aviso'));
    }
    if(bodyEl){
      bodyEl.textContent = text || '';
    }
    openModal('#posinvNoticeModal');
  }

  function closeNotice(){
    closeModal('#posinvNoticeModal');
  }

  function msg(text, type){
    const el = $('#posinvMsg');
    if(el){
      el.textContent = text || '';
      el.className = 'posinv-msg ' + (type ? ('is-' + type) : '');
    }
    if(text && type && type !== 'ok'){
      showNotice(text, type);
    }
  }

  function netBadge(){
    const el = $('#posinvNet');
    if(!el) return;
    const online = navigator.onLine;
    const q = getQueue().length;
    el.textContent = (online ? 'Online' : 'Offline') + (q ? ` • Pendientes: ${q}` : '');
  }

  function getQueue(){
    try{ return JSON.parse(localStorage.getItem('posinv_queue') || '[]'); }
    catch(e){ return []; }
  }
  function setQueue(q){
    localStorage.setItem('posinv_queue', JSON.stringify(q||[]));
    netBadge();
  }

  async function api(path, opts){
    const url = POSINV.rest.replace(/\/$/, '') + path;
    const o = Object.assign({
      headers: {'X-WP-Nonce': POSINV.nonce,'Content-Type':'application/json'},
      credentials:'same-origin',
    }, opts||{});
    const res = await fetch(url, o);
    if(!res.ok){
      let detail = '';
      try{ detail = await res.json(); }catch(e){}
      const err = new Error('API error');
      err.status = res.status;
      err.detail = detail;
      throw err;
    }
    return res.json();
  }


  async function loadCurrentShift(){
    if(state.mode !== 'sale') return;
    try{
      const res = await api('/shift/current?store=' + encodeURIComponent(state.store||''), {method:'GET'});
      state.shift = res.shift || null;
      renderShift();
    }catch(e){
      // silencio
    }
  }

  function renderShift(){
    const st = state.shift;
    const statusEl = $('#posinvShiftStatus');
    const expEl = $('#posinvShiftExpected');
    const diffEl = $('#posinvShiftDiff');
    const openBtn = $('#posinvShiftOpenBtn');
    const wBtn = $('#posinvShiftWithdrawBtn');
    const closeBtn = $('#posinvShiftCloseBtn');
    const salesTotalEl = $('#posinvShiftSalesTotal');
    const salesCashEl = $('#posinvShiftSalesCash');
    const salesTransferEl = $('#posinvShiftSalesTransfer');
    const salesCardEl = $('#posinvShiftSalesCard');
    if(!statusEl || !expEl || !diffEl) return;
    if(!st || st.status !== 'open'){
      statusEl.textContent = 'Sin turno abierto';
      if(openBtn) openBtn.disabled = false;
      if(wBtn) wBtn.disabled = true;
      if(closeBtn) closeBtn.disabled = true;
      expEl.textContent = fmtMoney(0);
      diffEl.textContent = fmtMoney(0);
      if(salesTotalEl) salesTotalEl.textContent = fmtMoney(0);
      if(salesCashEl) salesCashEl.textContent = fmtMoney(0);
      if(salesTransferEl) salesTransferEl.textContent = fmtMoney(0);
      if(salesCardEl) salesCardEl.textContent = fmtMoney(0);
      return;
    }
    statusEl.textContent = 'Abierto • ' + (st.opened_at_local || '');
    if(openBtn) openBtn.disabled = true;
    if(wBtn) wBtn.disabled = false;
    if(closeBtn) closeBtn.disabled = false;
    expEl.textContent = fmtMoney(Number(st.expected_cash||0));
    diffEl.textContent = fmtMoney(Number(st.diff||0));
    if(salesTotalEl) salesTotalEl.textContent = fmtMoney(Number(st.sales_total||0));
    if(salesCashEl) salesCashEl.textContent = fmtMoney(Number(st.sales_cash||0));
    if(salesTransferEl) salesTransferEl.textContent = fmtMoney(Number(st.sales_transfer||0));
    if(salesCardEl) salesCardEl.textContent = fmtMoney(Number(st.sales_card||0));
  }

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

  function renderShiftReport(report){
    const body = $('#posinvShiftReportBody');
    const modal = $('#posinvShiftReportModal');
    if(!body || !modal || !report) return;
    const withdrawals = Array.isArray(report.withdrawals) ? report.withdrawals : [];
    const tx = Array.isArray(report.transactions) ? report.transactions : [];
    let html = `
      <div class="posinv-shift-report-grid">
        <div><strong>Tienda:</strong> ${esc(report.store || '')}</div>
        <div><strong>Apertura:</strong> ${esc(report.opened_at || '')}</div>
        <div><strong>Cierre:</strong> ${esc(report.closed_at || '')}</div>
        <div><strong>Fondo inicial:</strong> ${fmtMoney(Number(report.open_amount||0))}</div>
        <div><strong>Esperado efectivo:</strong> ${fmtMoney(Number(report.expected_cash||0))}</div>
        <div><strong>Efectivo contado:</strong> ${fmtMoney(Number(report.close_amount||0))}</div>
        <div><strong>Diferencia:</strong> ${fmtMoney(Number(report.diff||0))}</div>
        <div><strong>Retiros:</strong> ${fmtMoney(Number(report.withdraw_total||0))}</div>
        <div><strong>Ventas totales:</strong> ${fmtMoney(Number(report.sales_total||0))}</div>
        <div><strong>Efectivo:</strong> ${fmtMoney(Number(report.sales_cash||0))}</div>
        <div><strong>Transferencia:</strong> ${fmtMoney(Number(report.sales_transfer||0))}</div>
        <div><strong>Terminal:</strong> ${fmtMoney(Number(report.sales_card||0))}</div>
      </div>`;
    html += '<h4 style="margin:14px 0 8px;">Retiros</h4>';
    if(!withdrawals.length){
      html += '<div class="posinv-muted">No hubo retiros.</div>';
    } else {
      html += '<div class="posinv-shift-report-list">';
      withdrawals.forEach(w=>{
        html += `<div class="posinv-shift-report-item"><strong>${fmtMoney(Number(w.amount||0))}</strong> • ${esc(w.concept||'Sin concepto')} <span class="posinv-muted">${esc(w.time||'')}</span></div>`;
      });
      html += '</div>';
    }
    html += '<h4 style="margin:14px 0 8px;">Transacciones</h4>';
    if(!tx.length){
      html += '<div class="posinv-muted">No hubo ventas registradas en este turno.</div>';
    } else {
      html += '<div class="posinv-shift-report-table"><div class="posinv-shift-report-tr posinv-shift-report-th"><div>Folio</div><div>Fecha</div><div>Total</div><div>Efectivo</div><div>Transferencia</div><div>Terminal</div></div>';
      tx.forEach(it=>{
        html += `<div class="posinv-shift-report-tr"><div>${esc(it.folio||('T-'+it.ticket_id))}</div><div>${esc(it.created_at||'')}</div><div>${fmtMoney(Number(it.total||0))}</div><div>${fmtMoney(Number(it.cash||0))}</div><div>${fmtMoney(Number(it.transfer||0))}</div><div>${fmtMoney(Number(it.card||0))}</div></div>`;
      });
      html += '</div>';
    }
    body.innerHTML = html;
    openModal('#posinvShiftReportModal');
  }

  function closeShiftReport(){
    closeModal('#posinvShiftReportModal');
  }

  function openShiftWithdrawModal(){
    const amountEl = $('#posinvShiftWithdrawAmount');
    const amount = Number((amountEl?.value)||0);
    if(!isFinite(amount) || amount <= 0){ showNotice('Escribe primero el monto del retiro.'); if(amountEl) amountEl.focus(); return; }
    const mirror = $('#posinvShiftWithdrawAmountMirror');
    if(mirror) mirror.value = amount.toFixed(2);
    const concept = $('#posinvShiftWithdrawConcept');
    if(concept) concept.value = '';
    openModal('#posinvShiftWithdrawModal');
    if(concept) setTimeout(()=>concept.focus(), 30);
  }

  function closeShiftWithdrawModal(){
    closeModal('#posinvShiftWithdrawModal');
  }

  function openPriceModal(line){
    state.activePriceLine = line || null;
    const val = $('#posinvPriceValue');
    const reason = $('#posinvPriceReason');
    if(val) val.value = line ? String(Number(line.price||0)) : '';
    if(reason) reason.value = line?.price_reason || '';
    openModal('#posinvPriceModal');
    if(val) setTimeout(()=>val.focus(), 30);
  }

  function closePriceModal(){
    state.activePriceLine = null;
    closeModal('#posinvPriceModal');
  }

  function clearLayaway(){
    state.layaway = {enabled:false, product:null, deposit:0};
    const dep = $('#posinvLayawayDeposit'); if(dep) dep.value='';
  }

  function openLayawayModal(product){
    state.layaway.product = product || null;
    const dep = $('#posinvLayawayDeposit'); if(dep) dep.value='';
    openModal('#posinvLayawayModal');
    if(dep) setTimeout(()=>dep.focus(), 30);
  }

  function closeLayawayModal(){
    closeModal('#posinvLayawayModal');
  }

  function saveLayawayModal(){
    const dep = Number(String(($('#posinvLayawayDeposit')?.value)||'').replace(/[, ]/g,''));
    const total = Number(calcTotals().total||0);
    if(!isFinite(dep) || dep <= 0){ showNotice('Escribe cuánto dinero dejará el cliente.', 'warn'); return; }
    if(dep > total){ showNotice('El anticipo no puede ser mayor al total del apartado.', 'warn'); return; }
    state.layaway.enabled = true;
    state.layaway.deposit = dep;
    closeLayawayModal();
    renderCart();
    openPayModal();
  }

  function getPaymentExpectedTotal(){
    if(state.layaway && state.layaway.enabled){
      return Number(state.layaway.deposit||0);
    }
    return Number(calcTotals().total||0);
  }

  function savePriceModal(){
    const line = state.activePriceLine;
    if(!line) return;
    const val = Number(String(($('#posinvPriceValue')?.value)||'').replace(/[, ]/g,''));
    const reason = String(($('#posinvPriceReason')?.value)||'').trim();
    if(!isFinite(val) || val < 0){ showNotice('Precio inválido.'); return; }
    if(!reason){ showNotice('Es obligatorio escribir la causa del cambio de precio.'); const r=$('#posinvPriceReason'); if(r) r.focus(); return; }
    line.price = val;
    line.price_reason = reason;
    closePriceModal();
    renderCart();
  }

  async function shiftOpen(){
    const raw = String((($('#posinvShiftOpenAmount')?.value)||'')).trim();
    if(raw === ''){ showNotice('Escribe el monto con el que se abre el turno, aunque sea 0.'); const f=$('#posinvShiftOpenAmount'); if(f) f.focus(); return; }
    const v = Number(raw);
    if(!isFinite(v) || v<0){ showNotice('Monto inválido'); return; }
    const res = await api('/shift/open', {method:'POST', body: JSON.stringify({store: state.store, open_amount: v})});
    state.shift = res.shift || null;
    renderShift();
  }
  async function shiftWithdraw(){
    const v = Number(($('#posinvShiftWithdrawAmount')?.value)||0);
    const concept = String(($('#posinvShiftWithdrawConcept')?.value)||'').trim();
    if(!isFinite(v) || v<=0){ showNotice('Monto inválido'); return; }
    if(!concept){ showNotice('Escribe el concepto del retiro.'); return; }
    const res = await api('/shift/withdraw', {method:'POST', body: JSON.stringify({store: state.store, amount: v, concept})});
    state.shift = res.shift || null;
    renderShift();
    const amt = $('#posinvShiftWithdrawAmount'); if(amt) amt.value = '';
    const c = $('#posinvShiftWithdrawConcept'); if(c) c.value = '';
    const m = $('#posinvShiftWithdrawAmountMirror'); if(m) m.value = '';
    closeShiftWithdrawModal();
  }
  async function shiftClose(){
    const v = Number(($('#posinvShiftCloseAmount')?.value)||0);
    if(!isFinite(v) || v<0){ showNotice('Monto inválido', 'warn'); return; }
    const res = await api('/shift/close', {method:'POST', body: JSON.stringify({store: state.store, close_amount: v})});
    const report = res && res.report ? res.report : null;
    state.shift = null;
    renderShift();
    if(report){
      renderShiftReport(report);
    } else {
      showNotice('El turno se cerró, pero no se pudo generar el reporte final.', 'warn');
    }
  }

  function paymentMethodLabel(v){
    if(v === 'transfer') return 'Transferencia';
    if(v === 'card') return 'Tarjeta / terminal';
    return 'Efectivo';
  }

  function getPayMode(){
    return ($('#posinvPayMode')?.value) || 'cash';
  }

  function setPayMode(mode){
    const hiddenMode = $('#posinvPayMode');
    if(hiddenMode) hiddenMode.value = mode;
    const partsEl = $('#posinvPayParts');
    if(partsEl){
      partsEl.value = (mode === 'mixed3') ? '3' : ((mode === 'mixed2') ? '2' : '1');
    }
    $$('.posinv-pay-choice').forEach(btn => {
      const active = btn.dataset.payChoice === mode;
      btn.classList.toggle('is-active', !!active);
    });
    if(mode === 'cash' && $('#posinvPayMethod1')) $('#posinvPayMethod1').value = 'cash';
    if(mode === 'transfer' && $('#posinvPayMethod1')) $('#posinvPayMethod1').value = 'transfer';
    if(mode === 'card' && $('#posinvPayMethod1')) $('#posinvPayMethod1').value = 'card';
    updatePayUI();
  }

  function openPayModal(){
    openModal('#posinvPayModal');
    updatePayUI();
  }

  function closePayModal(){
    closeModal('#posinvPayModal');
  }

  function updatePayUI(){
    const mode = getPayMode();
    const parts = (mode === 'mixed3') ? 3 : ((mode === 'mixed2') ? 2 : 1);
    [1,2,3].forEach(i => {
      const row = document.querySelector('[data-pay-row="'+i+'"]');
      if(row) row.style.display = (i <= parts) ? 'grid' : 'none';
      const amt = $('#posinvPayAmount'+i);
      if(amt){
        amt.disabled = (parts === 1 && i === 1);
        amt.placeholder = (parts === 1) ? 'Se toma el total automáticamente' : ('Monto ' + i);
      }
    });
    const hidden = $('#posinvPayMethod');
    const m1 = $('#posinvPayMethod1') ? $('#posinvPayMethod1').value : 'cash';
    if(hidden) hidden.value = (parts === 1 ? m1 : 'mixed');
    updatePayMixedHint();
  }

  function updatePayMixedHint(){
    const hint = $('#posinvPayMixedHint');
    const openBtn = $('#posinvPayOpen');
    const summaryText = $('#posinvPaySummaryText');
    if(!hint && !openBtn && !summaryText) return;
    const t = calcTotals();
    const mode = getPayMode();
    const parts = (mode === 'mixed3') ? 3 : ((mode === 'mixed2') ? 2 : 1);
    let text = '';
    if(parts === 1){
      const m1 = $('#posinvPayMethod1') ? $('#posinvPayMethod1').value : 'cash';
      text = 'Pago único: ' + paymentMethodLabel(m1);
      if(hint) hint.textContent = 'Se cobrará el total completo en ' + paymentMethodLabel(m1) + ': ' + fmtMoney(getPaymentExpectedTotal());
      const hidden = $('#posinvPayMethod');
      if(hidden) hidden.value = m1;
    } else {
      const methods = [];
      let sum = 0;
      const seen = new Set();
      let dup = false;
      for(let i=1;i<=parts;i++){
        const m = $('#posinvPayMethod'+i) ? $('#posinvPayMethod'+i).value : 'cash';
        const a = Number(($('#posinvPayAmount'+i)?.value)||0);
        methods.push(paymentMethodLabel(m) + ' ' + fmtMoney(isFinite(a)?a:0));
        sum += isFinite(a)?a:0;
        if(seen.has(m)) dup = true;
        seen.add(m);
      }
      const diff = getPaymentExpectedTotal() - sum;
      text = parts + ' formas de pago: ' + methods.join(' + ');
      if(hint) hint.textContent = (dup ? 'No repitas el mismo método. ' : '') + 'Total a cobrar ahora: ' + fmtMoney(getPaymentExpectedTotal()) + ' • Capturado: ' + fmtMoney(sum) + ' • Falta / sobra: ' + fmtMoney(diff);
      const hidden = $('#posinvPayMethod');
      if(hidden) hidden.value = 'mixed';
    }
    if(openBtn) openBtn.textContent = text;
    if(summaryText) summaryText.textContent = text;
  }

  function resetPayConfig(){
    const hidden = $('#posinvPayMethod'); if(hidden) hidden.value = 'cash';
    const pm1 = $('#posinvPayMethod1'); if(pm1) pm1.value = 'cash';
    const pm2 = $('#posinvPayMethod2'); if(pm2) pm2.value = 'transfer';
    const pm3 = $('#posinvPayMethod3'); if(pm3) pm3.value = 'card';
    const pa1 = $('#posinvPayAmount1'); if(pa1) pa1.value = '';
    const pa2 = $('#posinvPayAmount2'); if(pa2) pa2.value = '';
    const pa3 = $('#posinvPayAmount3'); if(pa3) pa3.value = '';
    setPayMode('cash');
  }

  function getPayment(){
    const mode = getPayMode();
    const parts = (mode === 'mixed3') ? 3 : ((mode === 'mixed2') ? 2 : 1);
    const t = calcTotals();
    if(parts === 1){
      const m1 = $('#posinvPayMethod1') ? $('#posinvPayMethod1').value : 'cash';
      const dueNow = Number(getPaymentExpectedTotal()||0);
      return {method:m1, cash: m1==='cash'? dueNow:0, transfer: m1==='transfer'? dueNow:0, card: m1==='card'? dueNow:0};
    }
    const out = {method:'mixed', cash:0, transfer:0, card:0};
    for(let i=1;i<=parts;i++){
      const m = $('#posinvPayMethod'+i) ? $('#posinvPayMethod'+i).value : 'cash';
      const a = Number(($('#posinvPayAmount'+i)?.value)||0);
      const val = isFinite(a)?a:0;
      if(m === 'cash') out.cash += val;
      else if(m === 'transfer') out.transfer += val;
      else out.card += val;
    }
    return out;
  }
  // Clientes: quick (no crea usuario) o vincular usuario existente
  
  // =========================
  // Devolución: ticket original / motivo / tipo
  // =========================
  function setReturnFound(found){
    state.returnInfo.found = found || null;
    state.returnInfo.original_ticket_id = (found && found.ticket_id) ? Number(found.ticket_id) : 0;
    renderReturnSummary();
  }

  function renderReturnSummary(){
    const box = $('#posinvReturnSummary');
    if(!box) return;
    const f = state.returnInfo.found;
    if(!f){
      box.innerHTML = '<div class="posinv-muted">Opcional: vincula esta devolución a un ticket previo.</div>';
      return;
    }
    const meta = f.meta || {};
    const t = (meta.totals && meta.totals.total!=null) ? fmtMoney(meta.totals.total) : '';
    const created = f.created ? escapeHtml(f.created.replace('T',' ').replace('Z','')) : '';
    const store = meta.store ? escapeHtml(meta.store) : '';
    const undone = f.undone ? ' <span class="posinv-pill posinv-pill-warn">DESHECHO</span>' : '';
    box.innerHTML = `
      <div class="posinv-return-sum">
        <strong>Ticket #${escapeHtml(f.ticket_id)}</strong>${undone}
        <div class="posinv-muted">Fecha: ${created || '-'} • Tienda: ${store || '-'} • Total: ${t || '-'}</div>
      </div>
    `;
  }

  
  function updateReturnTypeHint(){
    const sel = $('#posinvReturnType');
    const hint = $('#posinvReturnTypeHint');
    if(!sel || !hint) return;
    if(sel.value === 'merma'){
      hint.textContent = '⚠️ Merma: se registra la devolución pero NO aumenta el inventario.';
    } else {
      hint.textContent = 'Regresa a inventario: aumenta stock de la tienda.';
    }
  }

function getReturnPayload(){
    const reasonSel = $('#posinvReturnReason');
    const reasonOther = $('#posinvReturnReasonOther');
    const typeSel = $('#posinvReturnType');
    const reason = reasonSel ? (reasonSel.value||'') : '';
    const rt = typeSel ? (typeSel.value||'inventory') : 'inventory';
    let r = reason;
    if(reason === 'otro'){
      r = (reasonOther ? reasonOther.value : '').trim();
    }
    return {
      original_ticket_id: Number(state.returnInfo.original_ticket_id||0) || 0,
      reason: r || reason || '',
      return_type: (rt === 'merma' ? 'merma' : 'inventory')
    };
  }

  async function findReturnTicket(){
    const inp = $('#posinvReturnRef');
    if(!inp) return;
    const q = normalizeQuery(inp.value||'');
    if(!q){ msg('Escribe/pega el folio/QR del ticket.', 'warn'); return; }
    const btn = $('#posinvReturnFind'); if(btn) btn.disabled = true;
    try{
      const res = await api(`/ticket/find?q=${encodeURIComponent(q)}`, {method:'GET'});
      setReturnFound(res);
      msg('Ticket encontrado #' + res.ticket_id, 'ok');
    }catch(e){
      setReturnFound(null);
      msg('No se encontró el ticket.', 'warn');
    }finally{
      if(btn) btn.disabled = false;
    }
  }

  function loadReturnTicketItems(){
    const f = state.returnInfo.found;
    if(!f || !f.meta || !Array.isArray(f.meta.items) || !f.meta.items.length){
      msg('Primero busca un ticket válido.', 'warn'); return;
    }
    // Carga todos los productos del ticket original al carrito para devolver (ajustable).
    clearCart();
    for(const it of f.meta.items){
      const pid = Number(it.product_id||0);
      const qty = Number(it.qty||0);
      if(!pid || !qty) continue;
      state.cart.push({
        product_id: pid,
        name: it.name || ('Producto #' + pid),
        sku: it.sku || '',
        image: '',
        stock: null,
        qty: qty,
        price: Number(it.price||0),
        origPrice: Number(it.price||0),
        discType: it.discount_type || 'none',
        discValue: Number(it.discount_value||0) || 0,
      });
    }
    renderCart();
    msg('Productos cargados del ticket #' + f.ticket_id + '. Ajusta cantidades si es necesario.', 'ok');
  }

function setCustomerNone(){
    state.customer = {type:'none'};
    const d = $('#posinvCustomerDisplay'); if(d) d.value = '';
    const qb = $('#posinvCustomerQuickBox'); if(qb) qb.style.display='none';
    const qn = $('#posinvCustomerQuickName'); if(qn) qn.value='';
    const qp = $('#posinvCustomerQuickPhone'); if(qp) qp.value='';
  }
  function setCustomerQuick(name, phone){
    state.customer = {type:'quick', name: (name||'').trim(), phone: (phone||'').trim()};
    const d = $('#posinvCustomerDisplay'); if(d) d.value = (state.customer.name || 'Cliente rápido') + (state.customer.phone ? (' • '+state.customer.phone) : '');
  }
  function setCustomerUser(user){
    state.customer = {type:'user', user_id: Number(user.id||0), name: user.name||'', phone: user.phone||'', email: user.email||''};
    const d = $('#posinvCustomerDisplay'); if(d) d.value = (state.customer.name||('Usuario #' + state.customer.user_id)) + (state.customer.phone ? (' • '+state.customer.phone) : '');
  }
  function getCustomerPayload(){
    if(state.customer?.type === 'user'){
      return {type:'user', user_id: state.customer.user_id, name: state.customer.name||'', phone: state.customer.phone||'', email: state.customer.email||''};
    }
    if(state.customer?.type === 'quick'){
      return {type:'quick', name: state.customer.name||'', phone: state.customer.phone||''};
    }
    // Si el quick box está visible, tomar de inputs
    const qb = $('#posinvCustomerQuickBox');
    if(qb && qb.style.display !== 'none'){
      const name = ($('#posinvCustomerQuickName')?.value||'').trim();
      const phone = ($('#posinvCustomerQuickPhone')?.value||'').trim();
      if(name || phone){ return {type:'quick', name, phone}; }
    }
    return {type:'none'};
  }

  function openCustomerModal(){
    const m = $('#posinvCustomerModal'); if(!m) return;
    m.setAttribute('aria-hidden','false');
    m.style.display='flex';
    const q = $('#posinvCustomerQuery'); if(q){ q.value=''; q.focus(); }
    const r = $('#posinvCustomerResults'); if(r) r.innerHTML = '<div class="posinv-muted">Escribe para buscar.</div>';
  }
  function closeCustomerModal(){
    const m = $('#posinvCustomerModal'); if(!m) return;
    m.setAttribute('aria-hidden','true');
    m.style.display='none';
  }
  async function customerSearch(){
    const q = ($('#posinvCustomerQuery')?.value||'').trim();
    const box = $('#posinvCustomerResults'); if(!box) return;
    box.innerHTML = '<div class="posinv-muted">Buscando…</div>';
    try{
      const res = await api('/customers?q=' + encodeURIComponent(q) + '&limit=20', {method:'GET'});
      const items = res.items || [];
      if(!items.length){ box.innerHTML = '<div class="posinv-muted">Sin resultados.</div>'; return; }
      box.innerHTML = '';
      items.forEach(u=>{
        const row = document.createElement('div');
        row.className='posinv-bc-item';
        row.style.cursor='pointer';
        row.innerHTML = '<div class="posinv-item-main"><div class="posinv-item-title">'+escapeHtml(u.name||('Usuario #'+u.id))+'</div><div class="posinv-item-sub"><span class="posinv-pill"><span class="posinv-pill-label">ID</span>: '+Number(u.id)+'</span>'+(u.phone?(' <span class="posinv-pill"><span class="posinv-pill-label">Tel</span>: '+escapeHtml(u.phone)+'</span>'):'')+'</div></div><div class="posinv-item-side"><button class="posinv-btn" type="button">Seleccionar</button></div>';
        row.querySelector('button').addEventListener('click', (ev)=>{ ev.stopPropagation(); setCustomerUser(u); closeCustomerModal(); });
        row.addEventListener('click', ()=>{ setCustomerUser(u); closeCustomerModal(); });
        box.appendChild(row);
      });
    }catch(e){
      box.innerHTML = '<div class="posinv-muted">Error al buscar.</div>';
    }
  }
  function storeOptions(){
    const locked = POSINV.settings.role_store_locked;
    const def = POSINV.settings.default_store || 'store1';
    const sel = $('#posinvStore');
    sel.innerHTML = '';
    const opt1 = document.createElement('option');
    opt1.value = 'store1';
    opt1.textContent = POSINV.settings.store1_name || 'San Mateo';
    const opt2 = document.createElement('option');
    opt2.value = 'store2';
    opt2.textContent = POSINV.settings.store2_name || 'Xaltocán';
    sel.appendChild(opt1); sel.appendChild(opt2);
    sel.value = def;
    sel.disabled = !!locked;
    state.store = sel.value;
    sel.addEventListener('change', ()=>{ state.store = sel.value; renderCart(); msg(''); });
  }

  function setMode(mode){
    if(mode === 'transfer'){ mode = 'sale'; }
    state.mode = mode;
    $$('.posinv-tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === mode));

    // Asegura que el "destino" del escaneo/búsqueda sea el correcto por pestaña.
    // (Evita que después de usar Stock+ la Caja se quede sin buscar.)
    try{
      if(mode === 'stockin'){
        __scanTargetSel = '#posinv_si_search';
        __scanOnDecode = function(){ try{ /* lo maneja stockin.js */ }catch(e){} };
    }else if(mode === 'inventory'){
        __scanTargetSel = '#posinv_inv_scan';
        __scanOnDecode = function(){ try{ if(window.POSINV_INV && typeof window.POSINV_INV.onScan === 'function') window.POSINV_INV.onScan(); }catch(e){} };
      }else if(mode === 'bodega'){
        __scanTargetSel = '#posinv_bodega_search';
        __scanOnDecode = function(){ try{ if(window.POSINV_BODEGA_API && typeof window.POSINV_BODEGA_API.onScan === 'function') window.POSINV_BODEGA_API.onScan(); }catch(e){} };
	    }else if(mode === 'ingresos'){
      __scanTargetSel = '#posinv_ing_search';
      __scanOnDecode = function(){ try{ if(window.POSINV_INGRESOS_API && typeof window.POSINV_INGRESOS_API.onScan === 'function') window.POSINV_INGRESOS_API.onScan(); }catch(e){} };
    }else if(mode === 'existencias'){
      __scanTargetSel = '#posinv_exi_search';
      __scanOnDecode = function(){ try{ if(window.POSINV_EXISTENCIAS_API && typeof window.POSINV_EXISTENCIAS_API.onScan === 'function') window.POSINV_EXISTENCIAS_API.onScan(); }catch(e){} };
    }else if(mode === 'traspaso'){
      __scanTargetSel = '#posinv_tras_search';
      __scanOnDecode = function(){ try{ if(window.POSINV_TRASPASO_API && typeof window.POSINV_TRASPASO_API.onScan === 'function') window.POSINV_TRASPASO_API.onScan(); }catch(e){} };
    }else{
        __scanTargetSel = '#posinvQuery';
        __scanOnDecode = function(){ try{ search({ blurAfter:false, clearAfter:true }); }catch(e){} };
      }
    }catch(e){}

    const mainGrid = $('#posinvMainGrid');
    const labelsView = $('#posinvLabelsView');
    const codeView = $('#posinvCodeView');
    const stockInView = $('#posinvStockInView');
    const inventoryView = $('#posinvInventoryView');
    const bodegaView = $('#posinvBodegaView');
    const ingresosView = $('#posinvIngressView');
    const existenciasView = $('#posinvExistenciasView');
    const traspasoView = $('#posinvTraspasoView');
    const nuevoView = $('#posinvNuevoView');

    if(mode === 'codigo'){
      if(mainGrid) mainGrid.style.display = 'none';
      if(labelsView) labelsView.style.display = 'none';
      if(codeView) codeView.style.display = 'block';
      if(stockInView) stockInView.style.display = 'none';
      if(inventoryView) inventoryView.style.display = 'none';
      if(bodegaView) bodegaView.style.display = 'none';
      if(ingresosView) ingresosView.style.display = 'none';
      if(existenciasView) existenciasView.style.display = 'none';
      if(traspasoView) traspasoView.style.display = 'none';
      if(nuevoView) nuevoView.style.display = 'none';
      const mt = $('#posinvModeTitle'); if(mt) mt.textContent = 'Código';
      const commit = $('#posinvCommit'); if(commit) commit.style.display = 'none';
      const totals = document.querySelector('.posinv-totals'); if(totals) totals.style.display = 'none';
      msg('');
      return;
    }

    if(mode === 'inventory'){
      if(mainGrid) mainGrid.style.display = 'none';
      if(labelsView) labelsView.style.display = 'none';
      if(codeView) codeView.style.display = 'none';
      if(stockInView) stockInView.style.display = 'none';
      if(inventoryView) inventoryView.style.display = 'block';
      if(bodegaView) bodegaView.style.display = 'none';
      if(ingresosView) ingresosView.style.display = 'none';
      if(existenciasView) existenciasView.style.display = 'none';
      if(traspasoView) traspasoView.style.display = 'none';
      if(nuevoView) nuevoView.style.display = 'none';
      const mt = $('#posinvModeTitle'); if(mt) mt.textContent = 'Inventario';
      const commit = $('#posinvCommit'); if(commit) commit.style.display = 'none';
      const totals = document.querySelector('.posinv-totals'); if(totals) totals.style.display = 'none';
      msg('');
      try{ document.dispatchEvent(new CustomEvent('posinv:tab', { detail: { tab: 'inventory' } })); }catch(e){}
      try{ const q = document.querySelector('#posinv_inv_scan'); if(q) q.focus(); }catch(e){}
      return;
    }

    if(mode === 'labels'){
      if(mainGrid) mainGrid.style.display = 'none';
      if(labelsView) labelsView.style.display = 'block';
      if(stockInView) stockInView.style.display = 'none';
      if(inventoryView) inventoryView.style.display = 'none';
      if(bodegaView) bodegaView.style.display = 'none';
      if(ingresosView) ingresosView.style.display = 'none';
      if(existenciasView) existenciasView.style.display = 'none';
      if(traspasoView) traspasoView.style.display = 'none';
      if(nuevoView) nuevoView.style.display = 'none';
      // Cambia títulos solo para consistencia (aunque la vista principal esté oculta)
      const mt = $('#posinvModeTitle'); if(mt) mt.textContent = 'Etiquetas';
      const commit = $('#posinvCommit'); if(commit) commit.style.display = 'none';
      const totals = document.querySelector('.posinv-totals'); if(totals) totals.style.display = 'none';
      msg('');
      return;
    }

    if(mode === 'nuevo'){
      if(mainGrid) mainGrid.style.display = 'none';
      if(labelsView) labelsView.style.display = 'none';
      if(codeView) codeView.style.display = 'none';
      if(stockInView) stockInView.style.display = 'none';
      if(inventoryView) inventoryView.style.display = 'none';
      if(bodegaView) bodegaView.style.display = 'none';
      if(ingresosView) ingresosView.style.display = 'none';
      if(existenciasView) existenciasView.style.display = 'none';
      if(nuevoView) nuevoView.style.display = 'block';
      const mt = $('#posinvModeTitle'); if(mt) mt.textContent = 'Nuevo';
      const commit = $('#posinvCommit'); if(commit) commit.style.display = 'none';
      const totals = document.querySelector('.posinv-totals'); if(totals) totals.style.display = 'none';
      msg('');
      try{ const q = document.querySelector('#posinvNuevoName'); if(q) q.focus(); }catch(e){}
      return;
    }

    {
      if(mainGrid) mainGrid.style.display = '';
      if(labelsView) labelsView.style.display = 'none';
      if(codeView) codeView.style.display = 'none';
      if(stockInView) stockInView.style.display = 'none';
      if(inventoryView) inventoryView.style.display = 'none';
      if(bodegaView) bodegaView.style.display = 'none';
      if(ingresosView) ingresosView.style.display = 'none';
      if(existenciasView) existenciasView.style.display = 'none';
      if(traspasoView) traspasoView.style.display = 'none';
      if(nuevoView) nuevoView.style.display = 'none';
      const commit = $('#posinvCommit'); if(commit) commit.style.display = '';
      const totals = document.querySelector('.posinv-totals'); if(totals) totals.style.display = '';
    }

    if(mode === 'bodega'){
      if(mainGrid) mainGrid.style.display = 'none';
      if(labelsView) labelsView.style.display = 'none';
      if(codeView) codeView.style.display = 'none';
      if(stockInView) stockInView.style.display = 'none';
      if(inventoryView) inventoryView.style.display = 'none';
      if(bodegaView) bodegaView.style.display = 'block';
      if(ingresosView) ingresosView.style.display = 'none';
      if(existenciasView) existenciasView.style.display = 'none';
      if(traspasoView) traspasoView.style.display = 'none';
      if(nuevoView) nuevoView.style.display = 'none';
      const mt = $('#posinvModeTitle'); if(mt) mt.textContent = 'Bodega';
      const commit = $('#posinvCommit'); if(commit) commit.style.display = 'none';
      const totals = document.querySelector('.posinv-totals'); if(totals) totals.style.display = 'none';
      msg('');
      try{ const q = document.querySelector('#posinv_bodega_search'); if(q) q.focus(); }catch(e){}

      try{
        document.dispatchEvent(new CustomEvent('posinv:tab', { detail: { tab: 'bodega' } }));
      }catch(e){}
      return;
    }

	if(mode === 'ingresos'){
	  if(mainGrid) mainGrid.style.display = 'none';
	  if(labelsView) labelsView.style.display = 'none';
	  if(codeView) codeView.style.display = 'none';
	  if(stockInView) stockInView.style.display = 'none';
	  if(inventoryView) inventoryView.style.display = 'none';
	  if(bodegaView) bodegaView.style.display = 'none';
	  if(ingresosView) ingresosView.style.display = 'block';
	  const mt = $('#posinvModeTitle'); if(mt) mt.textContent = 'Ingresos';
	  const commit = $('#posinvCommit'); if(commit) commit.style.display = 'none';
	  const totals = document.querySelector('.posinv-totals'); if(totals) totals.style.display = 'none';
	  msg('');
	  try{ const q = document.querySelector('#posinv_ing_search'); if(q) q.focus(); }catch(e){}
	  try{ document.dispatchEvent(new CustomEvent('posinv:tab', { detail: { tab: 'ingresos' } })); }catch(e){}
	  return;
	}


    if(mode === 'existencias'){
      if(mainGrid) mainGrid.style.display = 'none';
      if(labelsView) labelsView.style.display = 'none';
      if(codeView) codeView.style.display = 'none';
      if(stockInView) stockInView.style.display = 'none';
      if(inventoryView) inventoryView.style.display = 'none';
      if(bodegaView) bodegaView.style.display = 'none';
      if(ingresosView) ingresosView.style.display = 'none';
      if(existenciasView) existenciasView.style.display = 'block';
      const mt = $('#posinvModeTitle'); if(mt) mt.textContent = 'Existencias';
      const commit = $('#posinvCommit'); if(commit) commit.style.display = 'none';
      const totals = document.querySelector('.posinv-totals'); if(totals) totals.style.display = 'none';
      msg('');
      try{ const q = document.querySelector('#posinv_exi_search'); if(q) q.focus(); }catch(e){}
      try{ document.dispatchEvent(new CustomEvent('posinv:tab', { detail: { tab: 'existencias' } })); }catch(e){}
      return;
    }

    if(mode === 'traspaso'){
      if(mainGrid) mainGrid.style.display = 'none';
      if(labelsView) labelsView.style.display = 'none';
      if(codeView) codeView.style.display = 'none';
      if(stockInView) stockInView.style.display = 'none';
      if(inventoryView) inventoryView.style.display = 'none';
      if(bodegaView) bodegaView.style.display = 'none';
      if(ingresosView) ingresosView.style.display = 'none';
      if(existenciasView) existenciasView.style.display = 'none';
      if(traspasoView) traspasoView.style.display = 'block';
      if(nuevoView) nuevoView.style.display = 'none';
      const mt = $('#posinvModeTitle'); if(mt) mt.textContent = 'Traspaso';
      const commit = $('#posinvCommit'); if(commit) commit.style.display = 'none';
      const totals = document.querySelector('.posinv-totals'); if(totals) totals.style.display = 'none';
      msg('');
      try{ const q = document.querySelector('#posinv_tras_search'); if(q) q.focus(); }catch(e){}
      try{ document.dispatchEvent(new CustomEvent('posinv:tab', { detail: { tab: 'traspaso' } })); }catch(e){}
      return;
    }


    if(mode === 'stockin'){
      if(mainGrid) mainGrid.style.display = 'none';
      if(labelsView) labelsView.style.display = 'none';
      if(codeView) codeView.style.display = 'none';
      if(stockInView) stockInView.style.display = 'block';
      if(inventoryView) inventoryView.style.display = 'none';
      if(bodegaView) bodegaView.style.display = 'none';
      if(ingresosView) ingresosView.style.display = 'none';
      if(existenciasView) existenciasView.style.display = 'none';
      if(traspasoView) traspasoView.style.display = 'none';
      if(nuevoView) nuevoView.style.display = 'none';
      const mt = $('#posinvModeTitle'); if(mt) mt.textContent = 'Stock +';
      const commit = $('#posinvCommit'); if(commit) commit.style.display = 'none';
      const totals = document.querySelector('.posinv-totals'); if(totals) totals.style.display = 'none';
      msg('');
      // foco listo para escaneo en Stock+
      try{ const si = document.querySelector('#posinv_si_search'); if(si) si.focus(); }catch(e){}
      return;
    }

    $('#posinvModeTitle').textContent = mode === 'sale' ? 'Venta' : (mode === 'return' ? 'Devolución' : 'Traspaso');
    $('#posinvCommit').textContent = mode === 'sale' ? 'Registrar venta' : 'Registrar devolución';

    // Caja/Devolución: cajas específicas por modo
    const shiftBox = $('#posinvShiftBox');
    const payBox = $('#posinvPayBox');
    const discBox = $('#posinvDiscountBox');
    const custBox = $('#posinvCustomerBox');
    const retBox  = $('#posinvReturnBox');

    if(mode === 'sale'){
      if(shiftBox) shiftBox.style.display = 'block';
      if(payBox) payBox.style.display = 'block';
      if(discBox) discBox.style.display = 'none';
      if(custBox) custBox.style.display = 'block';
      if(retBox)  retBox.style.display = 'none';
      try{ loadCurrentShift(); }catch(e){}
    } else if(mode === 'return'){
      if(shiftBox) shiftBox.style.display = 'none';
      if(payBox) payBox.style.display = 'none';
      if(discBox) discBox.style.display = 'none';
      if(custBox) custBox.style.display = 'none';
      if(retBox)  retBox.style.display = 'block';
      // limpia descuentos/pago para no afectar otras pestañas
      const tdv = $('#posinvTicketDiscValue'); if(tdv) tdv.value = '0';
      const tdt = $('#posinvTicketDiscType'); if(tdt) tdt.value = 'none';
      try{ resetPayConfig(); }catch(e){}
      // hint tipo devolución
      try{ updateReturnTypeHint(); }catch(e){}
      try{ renderReturnSummary(); }catch(e){}
    } else {
      if(shiftBox) shiftBox.style.display = 'none';
      if(payBox) payBox.style.display = 'none';
      if(discBox) discBox.style.display = 'none';
      if(custBox) custBox.style.display = 'none';
      if(retBox)  retBox.style.display = 'none';
      const tdv = $('#posinvTicketDiscValue'); if(tdv) tdv.value = '0';
      const tdt = $('#posinvTicketDiscType'); if(tdt) tdt.value = 'none';
      try{ resetPayConfig(); }catch(e){}
    }
    renderCart(); msg('');

    // foco listo para escaneo en Caja
    try{ const q = document.querySelector('#posinvQuery'); if(q) q.focus(); }catch(e){}
  }

  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }


  function calcLineTotal(line){
    const qty = Number(line.qty||0);
    const price = Number(line.price||0);
    const base = price * qty;
    const t = (line.discType||'none');
    const v = Number(line.discValue||0);
    let disc = 0;
    if(t === 'percent' && v > 0){ disc = base * (v/100); }
    if(t === 'amount' && v > 0){ disc = v; }
    if(disc > base) disc = base;
    const total = Math.max(0, base - disc);
    return {base, disc, total, type:t, value:v};
  }

  function getTicketDiscount(){
    const typeEl = $('#posinvTicketDiscType');
    const valEl = $('#posinvTicketDiscValue');
    const type = typeEl ? (typeEl.value||'none') : 'none';
    const value = valEl ? Number(valEl.value||0) : 0;
    return {type, value: isFinite(value)? value:0};
  }

  function calcTotals(){
    const lines = state.cart || [];
    let subtotal = 0;
    let discLines = 0;
    for(const l of lines){
      const r = calcLineTotal(l);
      subtotal += r.total;
      discLines += r.disc;
    }
    const td = getTicketDiscount();
    let discTicket = 0;
    if(td.type === 'percent' && td.value > 0){ discTicket = subtotal * (td.value/100); }
    if(td.type === 'amount' && td.value > 0){ discTicket = td.value; }
    if(discTicket > subtotal) discTicket = subtotal;
    const total = Math.max(0, subtotal - discTicket);
    return {subtotal, total, discLines, discTicket, ticket: td};
  }

  function renderTotals(){
    const t = calcTotals();
    const subEl = $('#posinvSubtotal'); if(subEl) subEl.textContent = fmtMoney(t.subtotal);
    const totEl = $('#posinvTotal'); if(totEl) totEl.textContent = fmtMoney(t.total);
    const lay = $('#posinvLayawaySummary');
    if(lay){
      if(state.layaway && state.layaway.enabled){
        const paid = Number(state.layaway.deposit||0);
        const due = Math.max(0, Number(t.total||0) - paid);
        lay.style.display = 'block';
        lay.textContent = 'Apartado activo • Pagado: ' + fmtMoney(paid) + ' • Resta: ' + fmtMoney(due);
      } else {
        lay.style.display = 'none';
        lay.textContent = '';
      }
    }
    try{ updatePayMixedHint(); }catch(e){}
    return t;
  }


  function findInCart(id){ return state.cart.find(x => x.product_id === id); }

  function addToCart(p){
    const found = findInCart(p.id);
    if(found){ found.qty += 1; }
    else{
      state.cart.push({product_id:p.id,name:p.name,sku:p.sku,image:p.image,stock:p.stock,qty:1,price:p.price,origPrice:p.price});
    }
    if(state.layaway && state.layaway.enabled){ clearLayaway(); }
    renderCart();
  }

  function removeFromCart(pid){
    state.cart = state.cart.filter(x => x.product_id !== pid);
    if(!state.cart.length){ clearLayaway(); try{ resetPayConfig(); }catch(e){} }
    renderCart();
  }

  function clearCart(){ state.cart = []; clearLayaway(); try{ resetPayConfig(); }catch(e){} renderCart(); }

  function renderResults(results){
    const box = $('#posinvResults');
    if(!results || !results.length){
      box.innerHTML = '<div class="posinv-muted">Sin resultados.</div>';
      return;
    }
    box.innerHTML = '';
    results.forEach(p => {
      const el = document.createElement('div');
      el.className = 'posinv-item';
      el.innerHTML = `
        <img class="posinv-thumb" src="${p.image}" alt=""/>
        <div class="posinv-item-main">
          <div class="posinv-item-title">${escapeHtml(p.name)}</div>
          <div class="posinv-item-sub">
            <span class="posinv-pill"><span class="posinv-pill-label">ID</span>: ${Number(p.id)}</span>
            <span class="posinv-pill"><span class="posinv-pill-label">Stock</span>: ${Number(p.stock||0)}</span>
          </div>
        </div>
        <div class="posinv-item-side">
          <div class="posinv-money">${fmtMoney(Number(p.price||0))}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="posinv-btn" type="button" data-action="add">Agregar</button>
            <button class="posinv-btn posinv-btn-ghost" type="button" data-action="layaway">Apartar</button>
          </div>
        </div>
      `;
      el.querySelector('[data-action="add"]').addEventListener('click', ()=> addToCart(p));
      el.querySelector('[data-action="layaway"]').addEventListener('click', ()=>{ clearCart(); addToCart(p); openLayawayModal(p); });
      box.appendChild(el);
    });
  }

  function renderCart(){
    const box = $('#posinvCart');
    if(!state.cart.length){
      box.innerHTML = '<div class="posinv-muted">Carrito vacío.</div>';
      renderTotals();
      return;
    }
    box.innerHTML = '';
    state.cart.forEach(line => {
      const row = document.createElement('div');
      row.className = 'posinv-line';
      row.innerHTML = `
        <img class="posinv-thumb" src="${line.image}" alt=""/>
        <div class="posinv-line-main">
          <div class="posinv-item-title">${escapeHtml(line.name)}</div>
          <div class="posinv-item-sub">
            <span class="posinv-pill"><span class="posinv-pill-label">ID</span>: ${Number(line.product_id)}</span>
            <span class="posinv-pill"><span class="posinv-pill-label">Stock</span>: ${Number(line.stock||0)}</span>
          </div>
          <div class="posinv-line-controls">
            <label>Cant</label>
            <input type="number" min="1" step="1" value="${Number(line.qty)}" class="posinv-qty"/>
            <button class="posinv-btn posinv-btn-ghost posinv-pricebtn" type="button">Cambiar precio</button>
            <button class="posinv-btn posinv-btn-ghost posinv-discbtn" type="button">Descuento</button>
            <button class="posinv-btn posinv-btn-ghost posinv-laybtn" type="button">Apartar</button>
            <button class="posinv-btn posinv-btn-ghost posinv-del" type="button">Quitar</button>
          </div>
          <div class="posinv-muted">${line.price !== line.origPrice ? ('Precio modificado: ' + fmtMoney(line.price) + ' (antes ' + fmtMoney(line.origPrice) + ')') : ''}${(state.layaway && state.layaway.enabled) ? (' • APARTADO activo') : ''}</div>
        </div>
        <div class="posinv-line-side">
          <div class="posinv-money">${fmtMoney(Number(line.price||0))}</div>
          <div class="posinv-muted">x ${Number(line.qty)}</div>
          <div class="posinv-money"><strong>${fmtMoney(calcLineTotal(line).total)}</strong></div>
        </div>
      `;
      row.querySelector('.posinv-qty').addEventListener('change', (e)=>{
        const v = Math.max(1, parseInt(e.target.value||'1',10));
        line.qty = v; renderCart();
      });
      row.querySelector('.posinv-del').addEventListener('click', ()=> removeFromCart(line.product_id));
      const layBtn = row.querySelector('.posinv-laybtn');
      if(layBtn){ layBtn.addEventListener('click', ()=> openLayawayModal(line)); }
      row.querySelector('.posinv-pricebtn').addEventListener('click', ()=>{
        openPriceModal(line);
      });

      const discBtn = row.querySelector('.posinv-discbtn');
      if(discBtn){
        discBtn.addEventListener('click', ()=>{
          const curType = (line.discType || 'none');
          const curVal = Number(line.discValue || 0);
          const how = prompt('Descuento del producto: escribe % o $ (ej: 10% o 15). Vacío para quitar.', curType==='percent' ? (curVal+'%') : (curType==='amount' ? String(curVal) : ''));
          if(how === null) return;
          const s = String(how||'').trim();
          if(!s){ line.discType='none'; line.discValue=0; renderCart(); return; }
          if(s.endsWith('%')){
            const v = Number(s.replace('%','').trim());
            if(!isFinite(v) || v<0){ showNotice('Valor inválido'); return; }
            line.discType='percent'; line.discValue=v;
            renderCart(); return;
          }
          const v = Number(s.replace('$','').trim());
          if(!isFinite(v) || v<0){ showNotice('Valor inválido'); return; }
          line.discType='amount'; line.discValue=v;
          renderCart();
        });
      }
      box.appendChild(row);
    });

    renderTotals();
  }

  function normalizeQuery(raw){
    let q = (raw || '').toString();
    // Quitar saltos de línea / tabulaciones que a veces mandan los escáneres
    q = q.replace(/[\r\n\t]/g, '').trim();
    // Code39 muchas veces viene como *12345* (con asteriscos). Los quitamos.
    if(q.length >= 3 && q.startsWith('*') && q.endsWith('*')){
      q = q.slice(1, -1).trim();
    }
    return q;
  }

  async function search(opts){
    opts = opts || {};
    const blurAfter  = !!opts.blurAfter;
    const clearAfter = !!opts.clearAfter;
    msg('');
    const targetEl = (__scanTargetSel ? $(__scanTargetSel) : $('#posinvQuery'));
    const q = normalizeQuery(targetEl ? targetEl.value : '');
    const cat = ($('#posinvCat') ? ($('#posinvCat').value || '') : '');
    if(!q && !cat){ renderResults([]); return; }
    $('#posinvSearchBtn').disabled = true;
    try{
      const data = await api(`/products?q=${encodeURIComponent(q)}&cat=${encodeURIComponent(cat)}&store=${encodeURIComponent(state.store)}&limit=20`, {method:'GET'});
      renderResults(data.results || []);
      if(blurAfter){
        try{ $('#posinvQuery').blur(); }catch(e){}
        try{ document.activeElement && document.activeElement.blur && document.activeElement.blur(); }catch(e){}
      }
      if(clearAfter){
        // Limpia el campo para que el siguiente escaneo entre directo
        // (sin tener que borrar manualmente el código anterior).
        try{ $(__scanTargetSel).value = ''; }catch(e){}
        // Mantén foco en el input para escaneo continuo.
        try{ $('#posinvQuery').focus(); }catch(e){}
      }
    }catch(e){
      renderResults([]);
      msg('No se pudo buscar (¿sin internet?).', 'warn');
    }finally{
      $('#posinvSearchBtn').disabled = false;
      netBadge();
    }
  }

  function queueOp(op){
    const q = getQueue();
    q.push(Object.assign({queued_at:new Date().toISOString()}, op));
    setQueue(q);
  }

  async function commit(){
    msg('');
    if(state.busy) return;
    if(!state.cart.length){ msg('Carrito vacío.', 'warn'); return; }

    // Protección: confirmación + bloqueo doble click
    if(state.mode === 'sale'){
      if(!state.shift || state.shift.status !== 'open'){ msg('Primero debes abrir turno antes de registrar ventas.', 'warn'); return; }
      const t = calcTotals();
      const actionLabel = (state.layaway && state.layaway.enabled) ? 'Registrar apartado por ' : 'Registrar venta por ';
      const ok = confirm(actionLabel + fmtMoney(t.total) + ' ?');
      if(!ok) return;
    } else if(state.mode === 'return'){
      const rp = getReturnPayload();
      const warn = (rp.return_type === 'merma') ? ' (MERMA: no regresa a stock)' : '';
      const t = calcTotals();
      const ok = confirm('Registrar devolución por ' + fmtMoney(t.total) + warn + ' ?');
      if(!ok) return;
      // si eligió "otro" y no escribió motivo, avisar
      if(!rp.reason || (rp.reason === 'otro')){}
    }

    const totals = calcTotals();
    let return_payload = null;
    if(state.mode === 'return'){
      return_payload = getReturnPayload();
      if((($('#posinvReturnReason')?.value||'') === 'otro') && (!return_payload.reason || return_payload.reason.trim()==='')){
        showNotice('Escribe el motivo de devolución.');
        return;
      }
    }


    const customer_obj = getCustomerPayload();
    if(state.mode === 'sale' && state.layaway && state.layaway.enabled){
      if(!customer_obj || customer_obj.type === 'none' || !String(customer_obj.name||'').trim() || !String(customer_obj.phone||'').trim()){
        showNotice('Para registrar un apartado es obligatorio buscar o capturar un cliente con nombre y celular. No se permite Mostrador en apartados.', 'warn');
        const qb = $('#posinvCustomerQuickBox');
        if(qb && qb.style.display === 'none'){ qb.style.display='flex'; }
        const qn = $('#posinvCustomerQuickName'); if(qn) qn.focus();
        return;
      }
    }
    const payment = (state.mode === 'sale') ? getPayment() : {method:'none', cash:0, transfer:0, card:0};

    const payload = {
      type: (state.mode === 'sale' && state.layaway && state.layaway.enabled) ? 'layaway' : state.mode,
      store: state.store,
      customer_obj,
      payment,
      return: return_payload,
      ticket_discount: totals.ticket,
      totals: {subtotal: totals.subtotal, total: totals.total, disc_lines: totals.discLines, disc_ticket: totals.discTicket},
      layaway: (state.mode === 'sale' && state.layaway && state.layaway.enabled) ? {deposit: Number(state.layaway.deposit||0), remaining: Math.max(0, Number(totals.total||0) - Number(state.layaway.deposit||0))} : null,
      items: state.cart.map(l => ({
        product_id:l.product_id,
        qty:l.qty,
        price:l.price,
        price_reason:l.price_reason||'',
        discount_type: (l.discType||'none'),
        discount_value: Number(l.discValue||0) || 0,
      })),
    };


    const btn = $('#posinvCommit');
    if(btn) btn.disabled = true;
    state.busy = true;

    try{
      const res = await api('/ticket', {method:'POST', body: JSON.stringify(payload)});
      state.lastTicket = res;

      // UI: deshacer inmediato (solo último ticket)
      msg('Registrado. Ticket #' + res.ticket_id, 'ok');

      clearCart();
      setCustomerNone();
      try{ resetPayConfig(); }catch(e){}
      if(state.mode === 'return'){
        try{ $('#posinvReturnRef').value=''; }catch(e){}
        try{ $('#posinvReturnReason').value='defectuoso'; }catch(e){}
        try{ $('#posinvReturnReasonOther').value=''; $('#posinvReturnReasonOther').style.display='none'; }catch(e){}
        try{ $('#posinvReturnType').value='inventory'; }catch(e){}
        setReturnFound(null);
      }

      // Refrescar turno
      try{ await loadCurrentShift(); }catch(e){}

      // abrir impresión
      if(res.print_url){ window.open(res.print_url, '_blank'); }

      // Mostrar botón "Deshacer" rápido
      const msgEl = $('#posinvMsg');
      if(msgEl){
        const undoBtn = document.createElement('button');
        undoBtn.type='button';
        undoBtn.className='posinv-btn posinv-btn-ghost';
        undoBtn.style.marginLeft='10px';
        undoBtn.textContent='Deshacer (último)';
        undoBtn.addEventListener('click', async ()=>{
          if(!confirm('¿Deshacer el último ticket #' + res.ticket_id + '?')) return;
          undoBtn.disabled = true;
          try{
            await api('/ticket/undo', {method:'POST', body: JSON.stringify({ticket_id: res.ticket_id})});
            msg('Ticket deshecho #' + res.ticket_id, 'ok');
            try{ await loadCurrentShift(); }catch(e){}
          }catch(e){
            msg('No se pudo deshacer.', 'err');
          }finally{
            undoBtn.disabled = false;
          }
        });
        msgEl.appendChild(undoBtn);
      }

    }catch(err){
      if(!navigator.onLine){
        queueOp({kind:'ticket', payload});
        msg('Sin internet: guardado para sincronizar.', 'warn');
        clearCart();
      } else {
        let reason = 'Error al registrar.';
        try{
          if(err && err.detail){
            if(typeof err.detail.message === 'string' && err.detail.message){ reason = err.detail.message; }
            if(err.detail.data && typeof err.detail.data.detail === 'string' && err.detail.data.detail){ reason += ' ' + err.detail.data.detail; }
          }
        }catch(e){}
        msg(reason, 'err');
      }
    }finally{
      state.busy = false;
      if(btn) btn.disabled = false;
      netBadge();
    }
  }

  async function syncQueue(){
    if(state.syncing) return;
    state.syncing = true;
    $('#posinvSyncBtn').disabled = true;
    msg('Sincronizando...', 'warn');

    const q = getQueue();
    if(!q.length){
      msg('No hay pendientes.', 'ok');
      state.syncing = false;
      $('#posinvSyncBtn').disabled = false;
      netBadge();
      return;
    }

    const remaining = [];
    for(const op of q){
      if(op.kind === 'ticket'){
        try{ state.lastTicket = await api('/ticket', {method:'POST', body: JSON.stringify(op.payload)}); }
        catch(e){ remaining.push(op); }
      } else remaining.push(op);
    }
    setQueue(remaining);
    msg(remaining.length ? ('Pendientes: ' + remaining.length) : 'Sincronizado.', remaining.length ? 'warn' : 'ok');
    state.syncing = false;
    $('#posinvSyncBtn').disabled = false;
    netBadge();
  }

  function bind(){
    storeOptions();
    netBadge();

  // Camera scanner (html5-qrcode). Requires HTTPS + camera permission.
  let scanner = null;
  let scanning = false;

  // Native BarcodeDetector fallback (Chrome/Android). No external library needed.
  let mediaStream = null;
  let rafId = null;
  let scanLastRaw = '';
  let scanStableCount = 0;
  let scanStartedAt = 0;
  let scanLastSeenAt = 0;


  function ensureScanGuide(){
    const reader = $('#posinvScanReader');
    if(!reader) return;
    reader.style.position = 'relative';
    if(!reader.querySelector('.posinv-scan-guide')){
      const guide = document.createElement('div');
      guide.className = 'posinv-scan-guide';
      reader.appendChild(guide);
    }
  }

// Target input for scanner + callback (so Stock+ can reuse the same cámara modal)
// (Declarado en el scope principal para que setMode() y search() lo puedan usar.)
// Expose for other modules (e.g., Stock+)
window.POSINV_OPEN_SCANNER = function(opts){
  opts = opts || {};
  // Guarda el destino anterior para no romper el flujo de 'Caja'
  __scanPrevTargetSel = __scanTargetSel;
  __scanPrevOnDecode = __scanOnDecode;
  if(opts.target) __scanTargetSel = opts.target;
  if(typeof opts.onDecode === 'function') __scanOnDecode = opts.onDecode;
  openScanner();
};
window.POSINV_CLOSE_SCANNER = function(){
  closeScanner();
};


  async function startNativeScanner(){
    const reader = $('#posinvScanReader');
    if(!reader){ msg('Scanner no disponible.', 'err'); scanning=false; return; }
    reader.innerHTML = '';
    const video = document.createElement('video');
    video.setAttribute('playsinline','');
    video.autoplay = true;
    video.muted = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    video.style.borderRadius = '12px';
    reader.appendChild(video);
    ensureScanGuide();

    if(!('BarcodeDetector' in window)){
      msg('Tu navegador no soporta escaneo nativo. Usa Chrome actualizado o permite cargar librería.', 'err');
      scanning = false;
      return;
    }

    let detector = null;
    try{
      const formats = ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code'];
      detector = new BarcodeDetector({ formats });
    }catch(e){
      detector = new BarcodeDetector();
    }

    try{
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          focusMode: { ideal: 'continuous' }
        },
        audio:false
      });
      video.srcObject = mediaStream;
      await video.play();
      const track = (mediaStream && mediaStream.getVideoTracks) ? (mediaStream.getVideoTracks()[0] || null) : null;
      if(track && track.applyConstraints){
        try{
          const caps = (track.getCapabilities ? track.getCapabilities() : {}) || {};
          const advanced = [];
          if(caps.focusMode && caps.focusMode.indexOf && caps.focusMode.indexOf('continuous') !== -1){ advanced.push({ focusMode: 'continuous' }); }
          if(caps.zoom){
            let z = 1;
            if(typeof caps.zoom === 'object'){
              const minZ = Number(caps.zoom.min || 1);
              const maxZ = Number(caps.zoom.max || minZ || 1);
              z = Math.max(minZ, Math.min(maxZ, 2));
            }
            if(z > 1) advanced.push({ zoom: z });
          }
          if(advanced.length) track.applyConstraints({ advanced }).catch(function(){});
        }catch(_e){}
      }
    }catch(e){
      msg('Permiso de cámara denegado o no disponible.', 'err');
      scanning = false;
      return;
    }

    scanLastRaw = '';
    scanStableCount = 0;
    scanStartedAt = Date.now();
    scanLastSeenAt = 0;
    msg('Enfocando cámara…', 'warn');

    const tick = async ()=>{
      if(!scanning) return;
      try{
        const barcodes = await detector.detect(video);
        if(barcodes && barcodes.length){
          const val = String((barcodes[0].rawValue || '')).trim();
          if(val){
            scanLastSeenAt = Date.now();
            if((Date.now() - scanStartedAt) < 500){
              msg('Enfocando cámara…', 'warn');
            }else{
              if(val === scanLastRaw){
                scanStableCount = Math.min(scanStableCount + 1, 2);
              }else{
                scanLastRaw = val;
                scanStableCount = 1;
              }
              msg(scanStableCount >= 2 ? ('Código confirmado: ' + val) : ('Código detectado: ' + val + ' (1/2)'), scanStableCount >= 2 ? 'ok' : 'warn');
              if(scanStableCount >= 2){
                $(__scanTargetSel).value = val;
                closeScanner();
                __scanOnDecode();
                return;
              }
            }
          }
        }else if(scanLastSeenAt && (Date.now() - scanLastSeenAt) > 2200){
          scanLastRaw = '';
          scanStableCount = 0;
          msg('Acerca o aleja un poco la cámara para enfocar…', 'warn');
        }
      }catch(e){ /* ignore */ }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }


  
  async function openScanner(){
    const modal = $('#posinvScanModal');
    if(!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden','false');

    if(scanning) return;
    scanning = true;

    try{
      if(typeof Html5Qrcode === 'undefined'){
        // Use native scanner if available
        await startNativeScanner();
        return;
      }

      scanner = new Html5Qrcode("posinvScanReader");
      ensureScanGuide();

      // Intentar cámara trasera primero
      try{
        await scanner.start(
          { facingMode: { exact: "environment" } },
          { fps: 10, qrbox: { width: 200, height: 90 } },
          (decodedText)=>{
            $(__scanTargetSel).value = decodedText.trim();
            closeScanner();
            __scanOnDecode();
          }
        );
        return;
      }catch(e){
        console.warn("Rear camera fallback:", e);
      }

      // Si falla, usar cualquier cámara disponible
      const cams = await Html5Qrcode.getCameras();
      if(!cams.length){
        msg('No se detectó cámara.', 'err');
        scanning=false;
        return;
      }

      await scanner.start(
        cams[0].id,
        { fps: 10, qrbox: { width: 200, height: 90 } },
        (decodedText)=>{
          $(__scanTargetSel).value = decodedText.trim();
          closeScanner();
          search();
        }
      );

    }catch(err){
      console.error(err);
      msg('Error cámara: '+err.message, 'err');
      scanning=false;
    }
  }


  async function closeScanner(){
    const modal = $('#posinvScanModal');
    if(modal){
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden','true');
    }
    if(scanner){
      try{ await scanner.stop(); }catch(e){}
      try{ await scanner.clear(); }catch(e){}
      scanner = null;
    }

    if(rafId){ try{ cancelAnimationFrame(rafId); }catch(e){} rafId=null; }
    if(mediaStream){
      try{ mediaStream.getTracks().forEach(t=>t.stop()); }catch(e){}
      mediaStream=null;
    }

    scanning = false;

    // Restaurar destino previo del scanner (ej. volver a #posinvQuery en Caja)
    if(__scanPrevTargetSel){
      __scanTargetSel = __scanPrevTargetSel;
      __scanPrevTargetSel = null;
    }
    if(__scanPrevOnDecode){
      __scanOnDecode = __scanPrevOnDecode;
      __scanPrevOnDecode = null;
    }
  }

    $('#posinvSearchBtn').addEventListener('click', search);
    const scanBtn = $('#posinvScanBtn');
    if(scanBtn) scanBtn.addEventListener('click', openScanner);
    const scanClose = $('#posinvScanClose');
    if(scanClose) scanClose.addEventListener('click', closeScanner);
    const scanModal = $('#posinvScanModal');
    if(scanModal) scanModal.addEventListener('click', (e)=>{ if(e.target === scanModal) closeScanner(); });
    // Enter normalmente lo manda el lector de código de barras.
    // Buscamos inmediato y limpiamos para permitir escaneo continuo.
    $('#posinvQuery').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); search({ blurAfter:false, clearAfter:true }); }});

    // Auto-búsqueda para escáner tipo "teclado" (Bluetooth/USB):
    // muchos mandan TAB/ENTER (o nada). Hacemos debounce y buscamos al
    // detenerse ~250ms. Esto también ayuda a "soltar" el foco después.
    let __scanTimer = null;
    $('#posinvQuery').addEventListener('input', ()=>{
      if(__scanTimer) clearTimeout(__scanTimer);
      __scanTimer = setTimeout(()=>{
        const v = normalizeQuery($(__scanTargetSel).value);
        if(v && v.length >= 3){
          search({ blurAfter: false, clearAfter: true });
        }
      }, 250);
    });
    $$('.posinv-tab').forEach(b => b.addEventListener('click', ()=> setMode(b.dataset.tab)));
    $('#posinvClear').addEventListener('click', clearCart);
    $('#posinvCommit').addEventListener('click', commit);

    // Caja: UI extra
    const payOpen = $('#posinvPayOpen');
    if(payOpen){ payOpen.addEventListener('click', openPayModal); }
    const payClose = $('#posinvPayClose');
    if(payClose){ payClose.addEventListener('click', closePayModal); }
    const payCancel = $('#posinvPayCancel');
    if(payCancel){ payCancel.addEventListener('click', closePayModal); }
    const paySave = $('#posinvPaySave');
    if(paySave){ paySave.addEventListener('click', ()=>{
      const mode = getPayMode();
      const parts = (mode === 'mixed3') ? 3 : ((mode === 'mixed2') ? 2 : 1);
      if(parts > 1){
        const used = new Set();
        let sum = 0;
        for(let i=1;i<=parts;i++){
          const m = $('#posinvPayMethod'+i)?.value || 'cash';
          const a = Number(($('#posinvPayAmount'+i)?.value)||0);
          if(used.has(m)){ showNotice('No repitas el mismo método en pagos combinados.'); return; }
          used.add(m);
          if(!isFinite(a) || a <= 0){ showNotice('Escribe un monto válido en cada forma de pago.'); return; }
          sum += a;
        }
        const total = Number(getPaymentExpectedTotal()||0);
        if(Math.abs(sum - total) > 0.009){ showNotice('La suma de los pagos debe ser igual al total a cobrar en este momento.'); return; }
      }
      updatePayMixedHint();
      closePayModal();
    }); }
        $$('.posinv-pay-choice').forEach(btn=>{ btn.addEventListener('click', ()=> setPayMode(btn.dataset.payChoice || 'cash')); });
    ['#posinvPayAmount1','#posinvPayAmount2','#posinvPayAmount3','#posinvPayMethod1','#posinvPayMethod2','#posinvPayMethod3'].forEach(sel=>{
      const el = $(sel); if(el){ el.addEventListener(el.tagName==='SELECT' ? 'change' : 'input', updatePayMixedHint); }
    });
    const payModal = $('#posinvPayModal');
    if(payModal){
      payModal.addEventListener('click', (e)=>{ if(e.target === payModal) closePayModal(); });
    }
    const shiftWithdrawModal = $('#posinvShiftWithdrawModal');
    if(shiftWithdrawModal){ shiftWithdrawModal.addEventListener('click', (e)=>{ if(e.target === shiftWithdrawModal) closeShiftWithdrawModal(); }); }
    const priceModal = $('#posinvPriceModal');
    if(priceModal){ priceModal.addEventListener('click', (e)=>{ if(e.target === priceModal) closePriceModal(); }); }
    const priceClose = $('#posinvPriceClose'); if(priceClose){ priceClose.addEventListener('click', closePriceModal); }
    const priceCancel = $('#posinvPriceCancel'); if(priceCancel){ priceCancel.addEventListener('click', closePriceModal); }
    const priceSave = $('#posinvPriceSave'); if(priceSave){ priceSave.addEventListener('click', savePriceModal); }
    const layM = $('#posinvLayawayModal'); if(layM){ layM.addEventListener('click', (e)=>{ if(e.target === layM) closeLayawayModal(); }); }
    const layC = $('#posinvLayawayClose'); if(layC){ layC.addEventListener('click', closeLayawayModal); }
    const layX = $('#posinvLayawayCancel'); if(layX){ layX.addEventListener('click', closeLayawayModal); }
    const layS = $('#posinvLayawaySave'); if(layS){ layS.addEventListener('click', saveLayawayModal); }
    const noticeClose = $('#posinvNoticeClose'); if(noticeClose){ noticeClose.addEventListener('click', closeNotice); }
    const noticeOk = $('#posinvNoticeOk'); if(noticeOk){ noticeOk.addEventListener('click', closeNotice); }
    const noticeModal = $('#posinvNoticeModal'); if(noticeModal){ noticeModal.addEventListener('click', (e)=>{ if(e.target === noticeModal) closeNotice(); }); }
    const shiftReportClose = $('#posinvShiftReportClose');
    if(shiftReportClose){ shiftReportClose.addEventListener('click', closeShiftReport); }
    const shiftReportModal = $('#posinvShiftReportModal');
    if(shiftReportModal){ shiftReportModal.addEventListener('click', (e)=>{ if(e.target === shiftReportModal) closeShiftReport(); }); }
    try{ resetPayConfig(); }catch(e){}
    const tdv = $('#posinvTicketDiscValue'); if(tdv){ tdv.addEventListener('input', ()=>{ renderCart(); }); }
    const tdt = $('#posinvTicketDiscType'); if(tdt){ tdt.addEventListener('change', ()=>{ renderCart(); }); }

    const cf = $('#posinvCustomerFind'); if(cf){ cf.addEventListener('click', openCustomerModal); }
    const cc = $('#posinvCustomerClose'); if(cc){ cc.addEventListener('click', closeCustomerModal); }
    const cds = $('#posinvCustomerDoSearch'); if(cds){ cds.addEventListener('click', customerSearch); }
    const cq = $('#posinvCustomerQuery'); if(cq){ cq.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); customerSearch(); } }); }
    const cquick = $('#posinvCustomerQuick'); if(cquick){ cquick.addEventListener('click', ()=>{
      const qb = $('#posinvCustomerQuickBox'); if(!qb) return;
      qb.style.display = (qb.style.display==='none' || !qb.style.display) ? 'flex' : 'none';
      if(qb.style.display !== 'none'){ const n=$('#posinvCustomerQuickName'); if(n) n.focus(); }
    }); }
    const cclear = $('#posinvCustomerClear'); if(cclear){ cclear.addEventListener('click', setCustomerNone); }
    const qn = $('#posinvCustomerQuickName'); if(qn){ qn.addEventListener('input', ()=> setCustomerQuick(qn.value, ($('#posinvCustomerQuickPhone')?.value||''))); }
    const qp = $('#posinvCustomerQuickPhone'); if(qp){ qp.addEventListener('input', ()=> setCustomerQuick(($('#posinvCustomerQuickName')?.value||''), qp.value)); }


    // Devolución: UI
    const rfind = $('#posinvReturnFind'); if(rfind){ rfind.addEventListener('click', findReturnTicket); }
    const rload = $('#posinvReturnLoad'); if(rload){ rload.addEventListener('click', loadReturnTicketItems); }
    const rref = $('#posinvReturnRef'); if(rref){ rref.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); findReturnTicket(); } }); }
    const rreason = $('#posinvReturnReason'); if(rreason){ rreason.addEventListener('change', ()=>{
      const other = $('#posinvReturnReasonOther');
      if(!other) return;
      if(rreason.value === 'otro'){ other.style.display='block'; other.focus(); }
      else { other.style.display='none'; other.value=''; }
    }); }
    const rtype = $('#posinvReturnType'); if(rtype){ rtype.addEventListener('change', updateReturnTypeHint); }

    const so = $('#posinvShiftOpenBtn'); if(so){ so.addEventListener('click', async ()=>{ try{ await shiftOpen(); }catch(e){ msg((e && e.detail && e.detail.message) ? e.detail.message : 'No se pudo abrir turno.', 'err'); } }); }
    const sw = $('#posinvShiftWithdrawBtn'); if(sw){ sw.addEventListener('click', openShiftWithdrawModal); }
    const swc = $('#posinvShiftWithdrawClose'); if(swc){ swc.addEventListener('click', closeShiftWithdrawModal); }
    const swx = $('#posinvShiftWithdrawCancel'); if(swx){ swx.addEventListener('click', closeShiftWithdrawModal); }
    const sws = $('#posinvShiftWithdrawSave'); if(sws){ sws.addEventListener('click', async ()=>{ try{ await shiftWithdraw(); }catch(e){ msg((e && e.detail && e.detail.message) ? e.detail.message : 'No se pudo registrar retiro.', 'err'); } }); }
    const sc = $('#posinvShiftCloseBtn'); if(sc){ sc.addEventListener('click', async ()=>{ try{ await shiftClose(); if(state.shift && Math.abs(Number(state.shift.diff||0)) > 0.009){ const diff = Number(state.shift.diff||0); msg((diff < 0 ? 'Falta dinero en caja: ' : 'Sobra dinero en caja: ') + fmtMoney(Math.abs(diff)), 'warn'); } }catch(e){ let why = 'No se pudo cerrar turno.'; try{ if(e && e.detail && e.detail.message) why = e.detail.message; if(e && e.detail && e.detail.data && e.detail.data.detail) why += ' ' + e.detail.data.detail; }catch(_e){} msg(why, 'err'); } }); }
    $('#posinvSyncBtn').addEventListener('click', syncQueue);
    $('#posinvPrintLast').addEventListener('click', ()=>{
      if(state.lastTicket && state.lastTicket.print_url) window.open(state.lastTicket.print_url, '_blank');
      else msg('Aún no hay ticket.', 'warn');
    });
    $('#posinvPrintLastAndroid')?.addEventListener('click', ()=>{
      try{
        const t = state.lastTicket;
        if(!t || !t.meta){ msg('Aún no hay ticket.', 'warn'); return; }
        const payload = {mode:'ticket', ticket: t.meta, ticket_id: t.ticket_id || null};
        const url = 'posprinterbridge://print?text=' + encodeURIComponent(JSON.stringify(payload));
        try{
          if(window.top && window.top !== window) window.top.location.href = url;
          else window.location.href = url;
        }catch(e){ window.location.href = url; }
      }catch(e){
        console.error(e);
        msg('No se pudo enviar a la App.', 'warn');
      }
    });
    window.addEventListener('online', netBadge);
    window.addEventListener('offline', netBadge);
  }

  document.addEventListener('DOMContentLoaded', bind);
})();