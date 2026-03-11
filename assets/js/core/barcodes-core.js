(function($){
  // Utilidades compartidas para las pestañas de Etiquetas y Código
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(m){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]);
    });
  }

  $(document).on("click", "#posinv_bc_btn_search", function(e){ e.preventDefault(); doSearch(); });

  // Autocomplete como Caja/Stock: busca sin presionar botón
  var __bcTimer = null;
  var __bcSuppressInput = false;
  $(document).on('input', '#posinv_bc_search', function(){
    if(__bcSuppressInput) return;
    clearTimeout(__bcTimer);
    __bcTimer = setTimeout(function(){ doSearch(); }, 350);
  });
  $(document).on('keydown', '#posinv_bc_search', function(e){
    if(e.key === 'Enter'){
      e.preventDefault();
      clearTimeout(__bcTimer);
      doSearch();
    }
  });
  // Filtro por categoría
  $(document).on('change', '#posinv_bc_cat', function(){
    clearTimeout(__bcTimer);
    doSearch();
  });

  $(document).on("click", ".posinv_bc_pick", function(e){
    e.preventDefault();
    var id = _bcNormId($(this).data("id"));
    var name = $(this).data("name");
    var pname = $("<div/>").html(name).text();
    setSelected({id:String(id), name: pname});

    var qty = parseInt($("#posinv_bc_results .posinv-bc-qty[data-id='"+id+"']").val(), 10) || _bcDefaultCopies();
    qty = Math.max(1, qty);
    POSINV_BC_QUEUE[id] = {id: id, name: pname, qty: qty};
    $("#posinv_bc_results .posinv-bc-sel[data-id='"+id+"']").prop('checked', true);
    _bcUpdateQueueUI();
  });

  // Limpiar cola
  $(document).on("click", "#posinv_bc_clear_selected", function(e){
    e.preventDefault();
    POSINV_BC_QUEUE = {};
    $("#posinv_bc_results .posinv-bc-sel").prop('checked', false);
    _bcUpdateQueueUI();
  });

  $(document).on("click", "#posinv_bc_btn_print", function(e){ e.preventDefault(); doPrint(); });
  $(document).on("click", "#posinv_bc_btn_print_android", function(e){ e.preventDefault(); doPrintAndroid(); });

  _bcUpdateQueueUI();


  function _bcCurrentStore(){
    return (window.POSINV && window.POSINV.store) ? window.POSINV.store : ($('#posinvStore').val() || 'store1');
  }

  function _bcAdjustStock(pid, delta){
    pid = _bcNormId(pid);
    delta = parseInt(delta, 10) || 0;
    if(!pid || delta === 0) return;

    if(!window.POSINV || !POSINV.rest || !POSINV.nonce){
      console.warn('POSINV REST no disponible');
      return;
    }
    var $saving = $(".posinv-bc-saving[data-id='"+pid+"']");
    $saving.text('Guardando...');
    fetch(POSINV.rest.replace(/\/$/, '') + '/stockin', {
      method: 'POST',
      headers: {'X-WP-Nonce': POSINV.nonce, 'Content-Type': 'application/json'},
      body: JSON.stringify({store: _bcCurrentStore(), items: [{id: parseInt(pid,10), qty: delta}]})
    }).then(function(r){ return r.json(); })
    .then(function(data){
      if(data && data.ok && data.changed && data.changed.length){
        var ch = data.changed[0];
        var newStock = (ch.new !== undefined) ? ch.new : (ch.new_stock !== undefined ? ch.new_stock : null);
        if(newStock !== null){
          $("#posinv_bc_results .posinv-bc-stock[data-id='"+pid+"'] .posinv-bc-stockval").text(String(newStock));
        }
        $saving.text('✓');
        setTimeout(function(){ $saving.text(''); }, 900);
      }else{
        $saving.text('Error');
        setTimeout(function(){ $saving.text(''); }, 1500);
      }
    }).catch(function(){
      $saving.text('Error');
      setTimeout(function(){ $saving.text(''); }, 1500);
    });
  }

  // Ajuste +/- desde Etiquetas
  $(document).on('click', '.posinv-bc-plus', function(e){
    e.preventDefault();
    var pid = $(this).data('id');
    var step = parseInt($(".posinv-bc-step[data-id='"+pid+"']").val(), 10) || 1;
    step = Math.max(1, step);
    _bcAdjustStock(pid, step);
  });
  $(document).on('click', '.posinv-bc-minus', function(e){
    e.preventDefault();
    var pid = $(this).data('id');
    var step = parseInt($(".posinv-bc-step[data-id='"+pid+"']").val(), 10) || 1;
    step = Math.max(1, step);
    _bcAdjustStock(pid, -step);
  });



  // ===========================
  //  Pestaña "Código" (solo edición de _op_barcode)
  // ===========================

  function renderCodeResults(list){
    if(!Array.isArray(list) || !list.length){
      $("#posinv_code_results").html('<div class="posinv-bc-hint">Sin resultados.</div>');
      return;
    }

    var html = '<div class="posinv-bc-table-wrap"><table class="posinv-bc-table" style="width:100%;">';
    html += '<thead><tr>' +
      '<th style="width:84px;">Img</th>' +
      '<th style="width:90px;">ID</th>' +
      '<th style="width:180px;">Código</th>' +
      '<th>Producto</th>' +
      '</tr></thead><tbody>';

    for(var i=0;i<list.length;i++){
      var p = list[i] || {};
      var pid = escapeHtml(String(p.id||''));
      var safeName = escapeHtml(decodeEntities(String(p.name||'')));
      // Back-compat: backend returns image_url, older code used img
      var img = (p.img ? String(p.img) : (p.image_url ? String(p.image_url) : ''));
      var imgCell = img ? ('<img class="posinv-bc-thumb" src="'+escapeHtml(img)+'" alt="">') : '<div class="posinv-bc-thumb" style="display:flex;align-items:center;justify-content:center;color:#999;">—</div>';
      var bcVal = (p.barcode && String(p.barcode).trim()) ? String(p.barcode).trim() : String(p.id||'');
      html += '<tr data-id="'+pid+'">' +
        '<td>'+imgCell+'</td>' +
        '<td>'+pid+'</td>' +
        '<td class="posinv-bc-code"><input type="text" class="posinv-code-barcode posinv-bc-barcode" data-id="'+pid+'" value="'+escapeHtml(bcVal)+'" style="width:150px;">' +
          '<span class="posinv-code-barcode-status posinv-bc-barcode-status" data-id="'+pid+'" style="margin-left:6px;"></span>' +
        '</td>' +
        '<td>'+safeName+'</td>' +
      '</tr>';
    }

    html += '</tbody></table></div>';
    $("#posinv_code_results").html(html);

    wireCodeBarcodeSave();
  }

  var __codeSaveTimer = {};
  function wireCodeBarcodeSave(){
    // Guardar valor previo para revertir si hay error (duplicado)
    $("#posinv_code_results .posinv-code-barcode").off('focus').on('focus', function(){
      this.dataset.prev = String(this.value || '').trim();
    });

    $("#posinv_code_results .posinv-code-barcode").off('input change').on('input change', function(){
      var id = _bcNormId(this.dataset.id);
      var val = String(this.value || '').trim();
      clearTimeout(__codeSaveTimer[id]);
      var $st = $("#posinv_code_results .posinv-code-barcode-status[data-id='"+id+"']");
      if($st.length){ $st.text('…'); }
      __codeSaveTimer[id] = setTimeout(function(){
        $.post(POSINV_BARCODES.ajaxurl, {
          action: 'posinv_set_barcode',
          nonce: POSINV_BARCODES.nonce,
          product_id: id,
          barcode: val
        }, function(resp){
          if(resp && resp.success){
            if($st.length){ $st.text('✓'); setTimeout(function(){ $st.text(''); }, 1200); }
          }else{
            var msg = (resp && resp.data && resp.data.message) ? resp.data.message : 'Error al guardar';
            if($st.length){ $st.text('!'); }
            alert(msg);
            // revertir
            var $inp = $("#posinv_code_results .posinv-code-barcode[data-id='"+id+"']");
            if($inp.length){
              $inp.val(String($inp.get(0).dataset.prev || ''));
            }
          }
        }).fail(function(){
          if($st.length){ $st.text('!'); }
        });
      }, 450);
    });
  }

  function codeSearch(){
    var q = String($("#posinv_code_search").val() || '').trim();
    var cat = ($("#posinv_code_cat").val() || '');
    if(!q){
      $("#posinv_code_results").html('<div class="posinv-bc-hint">Escribe algo para buscar.</div>');
      return;
    }
    $("#posinv_code_results").html('<div class="posinv-bc-hint">Buscando…</div>');

    return $.post(POSINV_BARCODES.ajaxurl, {
      action: 'posinv_barcode_search',
      nonce: POSINV_BARCODES.nonce,
      q: q,
      cat: cat,
      store: (window.POSINV && window.POSINV.store ? window.POSINV.store : ($("#posinvStore").val()||''))
    }, function(resp){
      if(resp && resp.success){
        renderCodeResults(resp.data || []);
      }else{
        $("#posinv_code_results").html('<div class="posinv-bc-hint">Error: ' + (resp && resp.data && resp.data.message ? resp.data.message : 'no se pudo buscar') + '</div>');
      }
    });
  }

  // Eventos de la pestaña Código
  $(document).on('click', '#posinv_code_btn_search', function(e){
    e.preventDefault();
    codeSearch();
  });
  // Búsqueda automática (tablet / pistola / teclado)
  var __codeSearchTimer = null;
  function _scheduleCodeSearch(){
    clearTimeout(__codeSearchTimer);
    __codeSearchTimer = setTimeout(function(){
      var q = String($("#posinv_code_search").val() || '').trim();
      // Si es escaneo numérico o ya hay 2+ chars, busca sin necesidad de botón
      if(q && (q.length >= 2 || /^\d{3,}$/.test(q))){
        codeSearch();
      }
    }, 220);
  }

  $(document).on('input', '#posinv_code_search', function(){
    _scheduleCodeSearch();
  });

  $(document).on('keydown', '#posinv_code_search', function(e){
    if(e.key === 'Enter'){
      e.preventDefault();
      codeSearch();
    }
  });

  function buildCatSelect(selectedId){
  var cats = (window.POSINV_BARCODES && POSINV_BARCODES.product_cats) ? POSINV_BARCODES.product_cats : [];
  var html = '<select class="posinv-bc-cat-select" style="max-width:220px; width:220px;">';
  html += '<option value="0">—</option>';
  for(var i=0;i<cats.length;i++){
    var c=cats[i];
    var sid = String(selectedId||'0');
    var sel = (String(c.id)===sid) ? ' selected' : '';
    html += '<option value="'+String(c.id)+'"'+sel+'>'+escapeHtml(c.name)+'</option>';
  }
  html += '</select>';
  return html;
}

  window.POSINV_BC_UTILS = {
    escapeHtml: escapeHtml,
    buildCatSelect: buildCatSelect
  };
})(jQuery);
