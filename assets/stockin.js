/* global POSINV_STOCKIN, POSINV */
(function(){
  const $ = (sel) => document.querySelector(sel);

  function restFetch(path, method, data){
    return fetch(POSINV_STOCKIN.rest + path, {
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-WP-Nonce': POSINV_STOCKIN.nonce
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: 'same-origin'
    }).then(r=>r.json());
  }

  const state = {
    results: [],
    cart: [] // {id,name,sku,stock,qty}
  };

  function currentStore(){
    // POSINV.store holds store key (san_mateo / xaltocan) in main module
    return (window.POSINV && window.POSINV.store) ? window.POSINV.store : (document.querySelector('#posinvStore') ? document.querySelector('#posinvStore').value : '');
  }

  function cloneCategories(){
    const src = $('#posinvCat');
    const dst = $('#posinv_si_category');
    if(!src || !dst) return;
    if(dst.options.length > 1) return;
    Array.from(src.options).forEach((opt, i)=>{
      if(i===0) return; // keep "Todas..."
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.textContent;
      dst.appendChild(o);
    });
  }

  
  function ensureCreateProductModal(){
    if(document.getElementById('posinv_np_modal')) return;
    const html = `
      <div id="posinv_np_modal" class="posinv-modal">
        <div class="posinv-modal-card">
          <div class="posinv-modal__title">Crear producto nuevo (para WooCommerce)</div>

          <label class="posinv-label">Nombre</label>
          <input id="posinv_np_name" class="posinv-input" type="text" placeholder="Nombre del producto" />

          <label class="posinv-label">Precio</label>
          <input id="posinv_np_price" class="posinv-input" type="number" step="0.01" min="0" value="0.00" />

          <label class="posinv-label">Categoría</label>
          <select id="posinv_np_category" class="posinv-input">
            <option value="">— Selecciona —</option>
          </select>

          <label class="posinv-label">Stock inicial (solo tienda)</label>
          <input id="posinv_np_stock" class="posinv-input" type="number" step="1" min="0" value="0" />

          <label class="posinv-label">Imagen</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button type="button" id="posinv_np_take" class="posinv-btn posinv-btn-primary">Tomar foto</button>
            <button type="button" id="posinv_np_pick" class="posinv-btn posinv-btn-primary">Elegir de galería</button>
            <input id="posinv_np_file_cam" type="file" accept="image/*" capture="environment" style="display:none;" />
            <input id="posinv_np_file_gal" type="file" accept="image/*" style="display:none;" />
          </div>
          <div class="posinv-muted" style="margin-top:6px;">En celular normalmente aparecerá opción de tomar foto o elegir de galería.</div>

          <div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap;">
            <button type="button" id="posinv_np_submit" class="posinv-btn posinv-btn-primary">Crear producto</button>
            <button type="button" class="posinv-btn" data-close="1">Cerrar</button>
            <div id="posinv_np_status" class="posinv-muted"></div>
          </div>

          <div class="posinv-muted" style="margin-top:12px;font-size:12px;">
            El ID lo asigna WooCommerce automáticamente. El stock se guarda solo en la tienda seleccionada.
          </div>
        </div>
      </div>
    `;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);

    // populate categories from stockin category select
    const src = document.getElementById('posinv_si_category');
    const dst = document.getElementById('posinv_np_category');
    if(src && dst && dst.options.length <= 1){
      Array.from(src.options).forEach((opt,i)=>{
        if(i===0) return;
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.textContent;
        dst.appendChild(o);
      });
    }

    // close handlers
    document.getElementById('posinv_np_modal').addEventListener('click', (e)=>{
            const t = e.target;
      if(!t) return;
      if(t.id==='posinv_np_modal' || t.getAttribute('data-close')==='1') closeCreateProductModal();
    });

    // file buttons
    document.getElementById('posinv_np_take').addEventListener('click', ()=> document.getElementById('posinv_np_file_cam').click());
    document.getElementById('posinv_np_pick').addEventListener('click', ()=> document.getElementById('posinv_np_file_gal').click());

    // submit
    document.getElementById('posinv_np_submit').addEventListener('click', submitCreateProduct);
  }

  function openCreateProductModal(prefill){
    ensureCreateProductModal();
    const modal = document.getElementById('posinv_np_modal');
    modal.classList.add('is-open');
    // reset
    document.getElementById('posinv_np_name').value = '';
    document.getElementById('posinv_np_price').value = '0.00';
    document.getElementById('posinv_np_category').value = '';
    document.getElementById('posinv_np_stock').value = '0';
    document.getElementById('posinv_np_status').textContent = '';
    // clear files
    document.getElementById('posinv_np_file_cam').value = '';
    document.getElementById('posinv_np_file_gal').value = '';
    // prefill helpers
    if(prefill && prefill.name) document.getElementById('posinv_np_name').value = prefill.name;
    if(prefill && typeof prefill.price !== 'undefined') document.getElementById('posinv_np_price').value = String(prefill.price);
    if(prefill && prefill.category_id) document.getElementById('posinv_np_category').value = String(prefill.category_id);
    if(prefill && typeof prefill.stock !== 'undefined') document.getElementById('posinv_np_stock').value = String(prefill.stock);

    setTimeout(()=>{ try{ document.getElementById('posinv_np_name').focus(); }catch(e){} }, 0);
  }

  function closeCreateProductModal(){
    const modal = document.getElementById('posinv_np_modal');
    if(modal) modal.classList.remove('is-open');
  }

  
  function bindInlineCreate(){
    const btn = document.getElementById('posinv_si_create');
    if(!btn) return;

    // populate categories from stockin select
    try{
      const src = document.getElementById('posinv_si_category');
      const dst = document.getElementById('posinv_si_new_cat');
      if(src && dst && dst.options.length <= 1){
        Array.from(src.options).forEach((opt,i)=>{
          if(i===0) return;
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.textContent;
          dst.appendChild(o);
        });
      }
    }catch(e){}

    const takeBtn = document.getElementById('posinv_si_new_take');
    const pickBtn = document.getElementById('posinv_si_new_pick');
    const fCam = document.getElementById('posinv_si_new_file_cam');
    const fGal = document.getElementById('posinv_si_new_file_gal');
    if(takeBtn && fCam) takeBtn.addEventListener('click', ()=> fCam.click());
    if(pickBtn && fGal) pickBtn.addEventListener('click', ()=> fGal.click());

    btn.addEventListener('click', async ()=>{
      const status = document.getElementById('posinv_si_create_status');
      const name = (document.getElementById('posinv_si_new_name')?.value || '').trim();
      const price = parseFloat(document.getElementById('posinv_si_new_price')?.value || '0') || 0;
      const category_id = parseInt(document.getElementById('posinv_si_new_cat')?.value || '0',10) || 0;
      const stock = parseInt(document.getElementById('posinv_si_new_stock')?.value || '0',10) || 0;
      const store = currentStore();

      if(!name){
        if(status) status.textContent = 'Escribe el nombre del producto.';
        return;
      }
      if(!store){
        if(status) status.textContent = 'Selecciona una tienda.';
        return;
      }

      let image_base64 = '';
      try{
        const f1 = fCam && fCam.files && fCam.files[0] ? fCam.files[0] : null;
        const f2 = fGal && fGal.files && fGal.files[0] ? fGal.files[0] : null;
        image_base64 = await fileToBase64(f1 || f2);
      }catch(e){ image_base64 = ''; }

      btn.disabled = true;
      if(status) status.textContent = 'Creando...';

      try{
        const res = await restFetch('/create-product','POST',{
          name, price, category_id, store, stock, image_base64
        });
        if(res && res.ok){
          if(status) status.textContent = 'Producto creado (ID: ' + res.id + ').';
          // limpiar formulario
          try{
            document.getElementById('posinv_si_new_name').value = '';
            document.getElementById('posinv_si_new_price').value = '0.00';
            document.getElementById('posinv_si_new_stock').value = '0';
            if(document.getElementById('posinv_si_new_cat')) document.getElementById('posinv_si_new_cat').value = '';
            if(fCam) fCam.value = '';
            if(fGal) fGal.value = '';
          }catch(e){}
          // opcional: refrescar resultados usando el nombre creado
          try{
            const inp = document.getElementById('posinv_si_search');
            if(inp){
              inp.value = String(res.id || name);
              inp.dispatchEvent(new Event('input'));
            }
          }catch(e){}
        }else{
          if(status) status.textContent = (res && res.message) ? res.message : 'No se pudo crear.';
        }
      }catch(e){
        if(status) status.textContent = 'Error al crear.';
      }finally{
        btn.disabled = false;
      }
    });
  }

function fileToBase64(file){
    return new Promise((resolve)=>{
      if(!file){ resolve(''); return; }
      const reader = new FileReader();
      reader.onload = ()=> resolve(String(reader.result||''));
      reader.onerror = ()=> resolve('');
      reader.readAsDataURL(file);
    });
  }

  async function submitCreateProduct(){
    const status = document.getElementById('posinv_np_status');
    const btn = document.getElementById('posinv_np_submit');

    const name = (document.getElementById('posinv_np_name').value||'').trim();
    const price = parseFloat(document.getElementById('posinv_np_price').value||'0') || 0;
    const category_id = parseInt(document.getElementById('posinv_np_category').value||'0',10) || 0;
    const stock = parseInt(document.getElementById('posinv_np_stock').value||'0',10) || 0;
    const store = currentStore();

    if(!name){
      status.textContent = 'Falta nombre.';
      return;
    }
    if(!store){
      status.textContent = 'Selecciona tienda.';
      return;
    }

    const f1 = document.getElementById('posinv_np_file_cam').files[0];
    const f2 = document.getElementById('posinv_np_file_gal').files[0];
    const image_base64 = await fileToBase64(f1 || f2);

    btn.disabled = true;
    status.textContent = 'Creando...';

    try{
      const res = await restFetch('/create-product','POST',{
        name, price, category_id, store, stock,
        image_base64
      });
      if(res && res.ok){
        status.textContent = 'Producto creado (ID: ' + res.id + ').';
        // refresca búsqueda para que puedas agregar stock enseguida
        closeCreateProductModal();
        // re-buscar por nombre
        state.results = [];
        renderResults();
        // opcional: vuelve a buscar por el texto actual
        try{
          const inp = document.getElementById('posinv_si_search');
          if(inp){
            inp.value = name;
            inp.dispatchEvent(new Event('input'));
          }
        }catch(e){}
      }else{
        status.textContent = (res && res.message) ? res.message : 'No se pudo crear.';
      }
    }catch(e){
      status.textContent = 'Error al crear.';
    }finally{
      btn.disabled = false;
    }
  }

function renderResults(){
    const box = $('#posinv_si_results');
    if(!box) return;
    if(!state.results.length){
      box.innerHTML = '<div class="posinv-muted">Sin resultados.</div>';
      return;
    }

    box.innerHTML = '<div class="posinv-results">' + state.results.map(p=>{
      const img = p.image ? `<img src="${p.image}" alt="" class="posinv-thumb">` : '';
      return `
        <div class="posinv-item">
          <div style="display:flex;gap:10px;align-items:center;flex:1;">
            ${img}
            <div>
              <div style="font-weight:700;">${escapeHtml(p.name||'')}</div>
              <div class="posinv-muted" style="font-size:12px;">SKU: ${escapeHtml(p.sku||'')} • ${escapeHtml(p.barcode||'')}</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
            <div class="posinv-muted" style="font-size:12px;">Stock: <strong>${Number(p.stock||0)}</strong></div>
            <button class="posinv-btn posinv-btn-primary" data-add="${p.id}">Agregar</button>
          </div>
        </div>
      `;
    }).join('') + '</div>';

    box.querySelectorAll('button[data-add]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = parseInt(btn.getAttribute('data-add'),10);
        const p = state.results.find(x=>parseInt(x.id,10)===id);
        if(p) addToCart(p);
      });
    });
  }

  function renderCart(){
    const box = $('#posinv_si_cart');
    if(!box) return;
    if(!state.cart.length){
      box.innerHTML = '<div class="posinv-muted">Sin productos.</div>';
      return;
    }

    box.innerHTML = state.cart.map(it=>{
      return `
        <div class="posinv-si-row">
          <div style="flex:1;">
            <div style="font-weight:600;">${escapeHtml(it.name||'')}</div>
            <div class="posinv-muted" style="font-size:12px;">SKU: ${escapeHtml(it.sku||'')} • Stock actual: ${Number(it.stock||0)}</div>
          </div>
          <input class="posinv-si-qty" type="number" step="1" min="-999999" value="${Number(it.qty||0)}" data-qty="${it.id}" />
          <button class="posinv-btn posinv-btn-ghost" data-del="${it.id}">✕</button>
        </div>
      `;
    }).join('') + '</div>';

    box.querySelectorAll('input[data-qty]').forEach(inp=>{
      inp.addEventListener('change', ()=>{
        const id = parseInt(inp.getAttribute('data-qty'),10);
        const v = parseInt(inp.value,10) || 0;
        const it = state.cart.find(x=>parseInt(x.id,10)===id);
        if(it){ it.qty = v; }
      });
    });

    box.querySelectorAll('button[data-del]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = parseInt(btn.getAttribute('data-del'),10);
        state.cart = state.cart.filter(x=>parseInt(x.id,10)!==id);
        renderCart();
      });
    });
  }

  function addToCart(p){
    const existing = state.cart.find(x=>parseInt(x.id,10)===parseInt(p.id,10));
    if(existing){
      existing.qty = (parseInt(existing.qty,10)||0) + 1;
    }else{
      state.cart.push({
        id: p.id,
        name: p.name,
        sku: p.sku,
        stock: p.stock,
        qty: 1
      });
    }
    renderCart();
  }

  function setLoading(isLoading){
    const box = $('#posinv_si_results');
    if(!box) return;
    if(isLoading){
      box.innerHTML = '<div class="posinv-muted">Buscando...</div>';
    }
  }

  function normalize(s){
    return (s||'').trim();
  }

  function isLikelyBarcode(q){
    q = String(q||'').trim();
    if(!q) return false;
    if(/\s/.test(q)) return false;
    return q.length >= 4;
  }

  let timer=null;
  function bindSearch(){
    const inp = $('#posinv_si_search');
    const btn = $('#posinv_si_btn_search');
    const scan = $('#posinv_si_btn_scan');
    const cat = $('#posinv_si_category');

    if(!inp) return;

    // force text keyboard (tablet)
    inp.setAttribute('type','text');
    inp.setAttribute('inputmode','search');
    inp.setAttribute('autocomplete','off');

    const doSearch = (opts)=>{
      opts = opts || {};
      const clearAfter = !!opts.clearAfter;
      const q = normalize(inp.value);
      const store = currentStore();
      const catId = cat ? (cat.value || '') : '';
      if(!store){ setLoading(false); return; }
      if(!q && !catId){
        state.results = [];
        renderResults();
        return;
      }
      setLoading(true);
      const params = new URLSearchParams();
      params.set('q', q);
      params.set('store', store);
      if(catId) params.set('cat', catId);
      params.set('limit', '30');

      fetch(POSINV_STOCKIN.rest + '/products?' + params.toString(), {
        method:'GET',
        headers:{ 'X-WP-Nonce': POSINV_STOCKIN.nonce },
        credentials:'same-origin'
      })
      .then(r=>r.json())
      .then(data=>{
        state.results = (data && data.results) ? data.results : [];
        renderResults();
        if(clearAfter){
          // Limpia para que el siguiente escaneo entre directo (como en Caja)
          setTimeout(()=>{ try{ inp.value=''; inp.focus(); }catch(e){} }, 0);
        }
      })
      .catch(()=>{
        state.results = [];
        renderResults();
      });
    };

    inp.addEventListener('keydown', (e)=>{
      if(e.key==='Enter'){
        e.preventDefault();
        if(timer) clearTimeout(timer);
        doSearch({clearAfter: isLikelyBarcode(inp.value)});
      }
    });

    inp.addEventListener('input', ()=>{
      if(timer) clearTimeout(timer);
      timer = setTimeout(()=> doSearch(), 350);
    });

    if(btn) btn.addEventListener('click', doSearch);
    if(cat) cat.addEventListener('change', doSearch);

    // Cámara (reutiliza el modal del POS)
    if(scan){
      scan.addEventListener('click', ()=>{
        if(typeof window.POSINV_OPEN_SCANNER === 'function'){
          window.POSINV_OPEN_SCANNER({
            target: '#posinv_si_search',
            onDecode: ()=> doSearch({clearAfter:true})
          });
        }else{
          alert('Scanner no disponible. Actualiza la página.');
        }
      });
    }

    // clear + commit
    const clearBtn = $('#posinv_si_clear');
    if(clearBtn) clearBtn.addEventListener('click', ()=>{
      state.cart = [];
      renderCart();
    });

    const commitBtn = $('#posinv_si_commit');
    if(commitBtn) commitBtn.addEventListener('click', ()=>{
      const store = currentStore();
      const items = state.cart
        .map(it=>({id: parseInt(it.id,10), qty: parseInt(it.qty,10)||0}))
        .filter(it=>it.id && it.qty);

      if(!store || !items.length){
        alert('No hay productos en la cola.');
        return;
      }

      commitBtn.disabled = true;
      restFetch('/stockin','POST',{store, items})
        .then(res=>{
          commitBtn.disabled = false;
          if(res && res.ok){
            state.cart = [];
            renderCart();
            // refrescar stocks en resultados
            doSearch();
            alert('Stock actualizado.');
          }else{
            alert((res && res.message) ? res.message : 'No se pudo actualizar.');
          }
        })
        .catch(()=>{
          commitBtn.disabled = false;
          alert('Error de red al actualizar stock.');
        });
    });

    // auto focus when entering stockin mode
    document.addEventListener('click', (e)=>{
      // if user clicks inside stockin view, keep focus
      if(e.target && e.target.closest && e.target.closest('#posinvStockInView')){
        // nothing
      }
    });

    // First render
    renderResults();
    renderCart();
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
  }

  // init once DOM ready
  document.addEventListener('DOMContentLoaded', ()=>{
    cloneCategories();
    bindSearch();
    bindInlineCreate();
    renderCart();
  });
})();