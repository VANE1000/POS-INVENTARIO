(function($){
  // Pestaña: Etiquetas
  if(!document.getElementById('posinvLabelsView')) return;

  // Cola de etiquetas seleccionadas (multi-select)
  // id -> {id,name,qty}
  var POSINV_BC_QUEUE = {};

  function _bcNormId(id){
    return String(id || '').trim();
  }

  function _bcDefaultCopies(){
    var c = parseInt($('#posinv_bc_copies').val(), 10);
    return (!c || c < 1) ? 1 : c;
  }

  function _bcUpdateQueueUI(){
    var count = Object.keys(POSINV_BC_QUEUE).length;
    var $info = $('#posinv_bc_selected_info');
    if($info.length){
      $info.text('Seleccionados: ' + count);
    }
    var $clear = $('#posinv_bc_clear_selected');
    if($clear.length){
      $clear.prop('disabled', count === 0);
    }
    var $btn = $('#posinv_bc_btn_print_android');
    if($btn.length){
      $btn.text(count ? 'Imprimir seleccionados (App Android)' : 'Imprimir (App Android)');
    }
  }

  function decodeEntities(str){
    // Dataset puede venir con HTML entities
    return $('<textarea/>').html(String(str||'')).text();
  }
  function code39Patterns(){
    // n=1, w=3 (units). Pattern length 9, starting with bar.
    return {
      "0":"nnnwwnwnn",
      "1":"wnnwnnnnw",
      "2":"nnwwnnnnw",
      "3":"wnwwnnnnn",
      "4":"nnnwwnnnw",
      "5":"wnnwwnnnn",
      "6":"nnwwwnnnn",
      "7":"nnnwnnwnw",
      "8":"wnnwnnwnn",
      "9":"nnwwnnwnn",
      "*":"nwnnwnwnn" // start/stop
    };
  }

  function svgBarcode39(svgEl, value, opts){
    opts = opts || {};
    var patterns = code39Patterns();
    var text = String(value || "").trim();
    if(!/^\d+$/.test(text)) text = text.replace(/\D+/g,'');
    if(text.length===0) text = "0";
    var full = "*" + text + "*";

    var narrow = opts.narrow || 2; // px
    var wide   = opts.wide   || 6; // px
    var height = opts.height || 60; // px
    var gap    = opts.gap    || narrow; // inter-char gap (space)

    var x = 0;
    var y = 0;

    // clear
    while(svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

    // build bars
    for(var i=0;i<full.length;i++){
      var ch = full.charAt(i);
      var pat = patterns[ch];
      if(!pat) continue;

      for(var j=0;j<pat.length;j++){
        var isBar = (j % 2 === 0);
        var w = (pat.charAt(j)==='w') ? wide : narrow;

        if(isBar){
          var rect = document.createElementNS("http://www.w3.org/2000/svg","rect");
          rect.setAttribute("x", String(x));
          rect.setAttribute("y", String(y));
          rect.setAttribute("width", String(w));
          rect.setAttribute("height", String(height));
          rect.setAttribute("fill", "#000");
          svgEl.appendChild(rect);
        }
        x += w;
      }
      // inter-character gap (one narrow space)
      x += gap;
    }

    svgEl.setAttribute("viewBox", "0 0 " + (x>0?x:1) + " " + height);
    svgEl.setAttribute("width", "100%");
    svgEl.setAttribute("height", String(height));
    svgEl.setAttribute("preserveAspectRatio", "none");
  }

  function setSelected(product){
    window.POSINV_SELECTED = product;
    $("#posinv_bc_name").text(product.name);
    $("#posinv_bc_id").text("ID: " + product.id);
    svgBarcode39(document.getElementById("posinv_bc_svg"), (product.barcode||product.id), {height: 54, narrow: 2, wide: 6});

    // print mirror
    $("#posinv_bc_name_print").text(product.name);
    $("#posinv_bc_id_print").text("ID: " + product.id);
    svgBarcode39(document.getElementById("posinv_bc_svg_print"), (product.barcode||product.id), {height: 54, narrow: 2, wide: 6});
  }


  // Helper para Android: antes faltaba y rompía el flujo.
  function getSelected(){
    return window.POSINV_SELECTED || null;
  }

  // decodeEntities se define arriba (jQuery). Mantener solo una.

  // Respaldo: permite seleccionar aunque el handler delegado falle.
  window.POSINV_PICK_LABEL = function(id, name, barcode){
    var pid = _bcNormId(id);
    var pname = decodeEntities(String(name||""));
    setSelected({id:String(pid||""), name: pname, barcode: (barcode ? String(barcode).trim() : "")});

    // Al seleccionar, lo agregamos a la cola
    var qty = parseInt($("#posinv_bc_results .posinv-bc-qty[data-id='"+pid+"']").val(), 10) || _bcDefaultCopies();
    qty = Math.max(1, qty);
    POSINV_BC_QUEUE[pid] = {id: pid, barcode: (barcode ? String(barcode).trim() : pid), name: pname, qty: qty};
    $("#posinv_bc_results .posinv-bc-sel[data-id='"+pid+"']").prop('checked', true);
    _bcUpdateQueueUI();
  };


  
  function syncHScroll(){
    var $wrap = $('.posinv-bc-table-wrap');
    var $top  = $('.posinv-bc-hscroll-top');
    var $inner = $('.posinv-bc-hscroll-inner');
    if(!$wrap.length || !$top.length || !$inner.length) return;

    // Set inner width to match table scroll width
    var sw = $wrap.get(0).scrollWidth || 0;
    $inner.width(sw);

    // Avoid duplicate bindings
    if($wrap.data('posinvHsync')) return;
    $wrap.data('posinvHsync', 1);

    $wrap.on('scroll', function(){
      $top.scrollLeft($wrap.scrollLeft());
    });
    $top.on('scroll', function(){
      $wrap.scrollLeft($top.scrollLeft());
    });
  }

function renderResults(list){
    if(!list || !list.length){
      $("#posinv_bc_results").html('<div class="posinv-bc-hint">Sin resultados.</div>');
      return;
    }
    var html = '<div class="posinv-bc-hscroll-top"><div class="posinv-bc-hscroll-inner"></div></div><div class="posinv-bc-table-wrap"><table class="widefat striped posinv-bc-table"><thead><tr>'
             + '<th style="width:46px; text-align:center;">Sel</th>'
             + '<th class="posinv-bc-th-img">Img</th>'
             + '<th>ID</th>'
             + '<th style="width:120px;">Código</th>'
             + '<th>Producto</th>'
             + '<th style="width:220px;">Categoría</th>'
             + '<th style="width:110px; text-align:right;">Precio</th>'
             + '<th style="width:90px; text-align:right;">Stock</th>'
             + '<th style="width:140px;">Ajuste</th>'
             + '<th></th>'
             + '</tr></thead><tbody>';
    list.forEach(function(p){
      var safeName = $('<div/>').text(p.name).html();
      var safeImg  = $('<div/>').text(p.image_url || '').html();
      var imgCell  = safeImg ? ('<img class="posinv-bc-thumb" src="'+safeImg+'" alt="">') : '';
      var pid = _bcNormId(p.id);
      var stockVal = (p && (p.store_stock !== undefined) && (p.store_stock !== null)) ? parseInt(p.store_stock,10) : 0;
      if (isNaN(stockVal)) stockVal = 0;
      var checked = POSINV_BC_QUEUE[pid] ? ' checked' : '';
      var qtyVal = POSINV_BC_QUEUE[pid] ? (POSINV_BC_QUEUE[pid].qty || 1) : _bcDefaultCopies();
      html += '<tr>'+
              '<td style="text-align:center;">'
                + '<input type="checkbox" class="posinv-bc-sel" data-id="'+pid+'" data-name="'+safeName+'"'+checked+'>'
              + '</td>'+
              '<td style="width:90px;"><input type="number" min="1" step="1" class="posinv-bc-qty" data-id="'+pid+'" value="'+qtyVal+'" style="width:72px;"></td>'+
              '<td class="posinv-bc-img" style="width:64px;">'+imgCell+'</td>'+
              '<td style="width:90px;">'+pid+'</td>'+
              '<td class="posinv-bc-code" style="width:160px;"><input type="text" class="posinv-bc-barcode" data-id="'+pid+'" value="'+POSINV_BC_UTILS.escapeHtml((p.barcode && String(p.barcode).trim()) ? String(p.barcode).trim() : pid)+'" style="width:120px;"><span class="posinv-bc-barcode-status" data-id="'+pid+'" style="margin-left:6px;"></span></td>'+
              '<td>'+safeName+'</td>'+
              '<td class="posinv-bc-cats" data-id="'+pid+'">'+POSINV_BC_UTILS.buildCatSelect(p.category_id || 0)+'<span class="posinv-bc-cats-status" data-id="'+pid+'" style="margin-left:6px;"></span></td>'+
              '<td class="posinv-bc-price" style="text-align:right;"><input type="text" class="posinv-bc-price-input" data-id="'+pid+'" value="'+POSINV_BC_UTILS.escapeHtml(p.price || '')+'" style="width:90px; text-align:right;"><span class="posinv-bc-price-status" data-id="'+pid+'" style="margin-left:6px;"></span></td>'+
              '<td class="posinv-bc-stock" data-id="'+pid+'" style="text-align:right; width:90px;"><span class="posinv-bc-stockval">'+String(stockVal)+'</span></td>'+
              '<td class="posinv-bc-adjust" style="width:170px;">'
                + '<div class="posinv-bc-adjust-wrap">'
                  + '<button type="button" class="button posinv-bc-minus" data-id="'+pid+'">-</button>'
                  + '<input type="number" min="1" step="1" class="posinv-bc-step" data-id="'+pid+'" value="1">'
                  + '<button type="button" class="button posinv-bc-plus" data-id="'+pid+'">+</button>'
                  + '<span class="posinv-bc-saving" data-id="'+pid+'"></span>'
                + '</div>'
              + '</td>'+
              '<td style="width:90px;"><input type="number" min="1" step="1" class="posinv-bc-qty" data-id="'+pid+'" value="'+qtyVal+'" style="width:72px;"></td>'+
              '<td style="width:120px;"><button type="button" class="button posinv_bc_pick" data-id="'+pid+'" data-name="'+safeName+'" data-barcode="'+POSINV_BC_UTILS.escapeHtml((p.barcode && String(p.barcode).trim()) ? String(p.barcode).trim() : pid)+'" onclick="POSINV_PICK_LABEL(this.dataset.id, this.dataset.name, this.dataset.barcode)">Seleccionar</button></td>'+
              '</tr>';
    });
    html += '</tbody></table></div>';
    $("#posinv_bc_results").html(html);
    setTimeout(syncHScroll, 0);


    // Wire checkbox / qty events after render
    $("#posinv_bc_results .posinv-bc-sel").off('change').on('change', function(){
      var id = _bcNormId(this.dataset.id);
      var name = decodeEntities(String(this.dataset.name || ''));
      var qty = parseInt($("#posinv_bc_results .posinv-bc-qty[data-id='"+id+"']").val(), 10) || 1;
      qty = Math.max(1, qty);
      if(this.checked){
        var bc = String($("#posinv_bc_results .posinv-bc-barcode[data-id='"+id+"']").val() || id).trim();
        POSINV_BC_QUEUE[id] = {id:id, barcode: bc, name:name, qty:qty};
      } else {
        delete POSINV_BC_QUEUE[id];
      }
      _bcUpdateQueueUI();
    });

    // Copias: permitir borrar el "1" para escribir (ej. 10) sin que se resetee en cada tecla.
    // - En 'input' permitimos vacío y NO reescribimos el valor.
    // - En 'change'/'blur' validamos y aplicamos mínimo 1.
    $("#posinv_bc_results .posinv-bc-qty").off('input change blur')
      .on('input', function(){
        var id = _bcNormId(this.dataset.id);
        var v = String(this.value || '').trim();

        // Si está vacío, dejamos que el usuario escriba; no forzamos 1 aquí.
        if(v === ''){
          if(POSINV_BC_QUEUE[id]){
            POSINV_BC_QUEUE[id].qty = 1; // fallback interno
          }
          return;
        }

        var qty = parseInt(v, 10);
        if(isNaN(qty)) return; // no tocar mientras escribe algo inválido
        if(qty < 1) qty = 1;

        if(POSINV_BC_QUEUE[id]){
          POSINV_BC_QUEUE[id].qty = qty;
          POSINV_BC_QUEUE[id].barcode = String($("#posinv_bc_results .posinv-bc-barcode[data-id='"+id+"']").val() || id).trim();
          _bcUpdateQueueUI();
        }
      })
      .on('change blur', function(){
        var id = _bcNormId(this.dataset.id);
        var qty = parseInt(this.value, 10);
        if(isNaN(qty) || qty < 1) qty = 1;
        this.value = qty;

        if(POSINV_BC_QUEUE[id]){
          POSINV_BC_QUEUE[id].qty = qty;
          POSINV_BC_QUEUE[id].barcode = String($("#posinv_bc_results .posinv-bc-barcode[data-id='"+id+"']").val() || id).trim();
          _bcUpdateQueueUI();
        }
      });

    // Guardar código de barras (meta) desde Etiquetas
    var __bcSaveTimer = {};
    $("#posinv_bc_results .posinv-bc-barcode").off('focus').on('focus', function(){
      // guardar valor previo para poder revertir si hay error (duplicado)
      this.dataset.prev = String(this.value || '').trim();
    });
    $("#posinv_bc_results .posinv-bc-barcode").off('input change').on('input change', function(){
      var id = _bcNormId(this.dataset.id);
      var val = String(this.value || '').trim();
      clearTimeout(__bcSaveTimer[id]);
      var $st = $("#posinv_bc_results .posinv-bc-barcode-status[data-id='"+id+"']");
      if($st.length){ $st.text('…'); }
      __bcSaveTimer[id] = setTimeout(function(){
        $.post(POSINV_BARCODES.ajaxurl, {
          action: 'posinv_set_barcode',
          nonce: POSINV_BARCODES.nonce,
          product_id: id,
	          barcode: val,
	          module: 'labels'
        }, function(resp){
          if(resp && resp.success){
            if($st.length){ $st.text('✓'); setTimeout(function(){ $st.text(''); }, 1200); }
            $("#posinv_bc_results .posinv_bc_pick[data-id='"+id+"']").attr('data-barcode', val || id);
            if(POSINV_BC_QUEUE[id]){
              POSINV_BC_QUEUE[id].barcode = val || id;
            }
            if(window.POSINV_SELECTED && String(window.POSINV_SELECTED.id)===String(id)){
              window.POSINV_SELECTED.barcode = val || '';
              setSelected(window.POSINV_SELECTED);
            }
          } else {
            // error: por ejemplo duplicado
            var msg = (resp && resp.data && resp.data.message) ? String(resp.data.message) : 'Error al guardar';
            if($st.length){ $st.text('!').attr('title', msg); }
            var $inp = $("#posinv_bc_results .posinv-bc-barcode[data-id='"+id+"']");
            if($inp.length){
              var prev = String($inp[0].dataset.prev || '').trim();
              $inp.val(prev);
              $inp.addClass('posinv-bc-input-error');
              setTimeout(function(){ $inp.removeClass('posinv-bc-input-error'); }, 1500);
            }
            alert(msg);
          }
        }).fail(function(){
          if($st.length){ $st.text('!'); }
          var $inp = $("#posinv_bc_results .posinv-bc-barcode[data-id='"+id+"']");
          if($inp.length){
            var prev = String($inp[0].dataset.prev || '').trim();
            $inp.val(prev);
            $inp.addClass('posinv-bc-input-error');
            setTimeout(function(){ $inp.removeClass('posinv-bc-input-error'); }, 1500);
          }
          alert('Error al guardar el código.');
        });
      }, 500);
    });

    // Guardar categorías (product_cat) desde Etiquetas (dropdown)
    var __bcCatsTimer = {};
    $("#posinv_bc_results").off('change', '.posinv-bc-cat-select').on('change', '.posinv-bc-cat-select', function(){
      var $row = $(this).closest('td.posinv-bc-cats');
      var id = _bcNormId($row.data('id') || $row.attr('data-id') || '');
      var catId = String($(this).val() || '0');
      clearTimeout(__bcCatsTimer[id]);
      var $st = $("#posinv_bc_results .posinv-bc-cats-status[data-id='"+id+"']");
      if($st.length){ $st.text('…'); }
      __bcCatsTimer[id] = setTimeout(function(){
        $.post(POSINV_BARCODES.ajaxurl, {
          action: 'posinv_set_categories',
          nonce: POSINV_BARCODES.nonce,
          product_id: id,
	          category_ids: catId,
	          module: 'labels'
        }, function(resp){
          if(resp && resp.success){
            if($st.length){ $st.text('✓'); setTimeout(function(){ $st.text(''); }, 1200); }
          } else {
            if($st.length){ $st.text('!'); setTimeout(function(){ $st.text(''); }, 1600); }
            var msg = (resp && resp.data && resp.data.message) ? resp.data.message : 'Error al guardar la categoría.';
            alert(msg);
          }
        }).fail(function(){
          if($st.length){ $st.text('!'); setTimeout(function(){ $st.text(''); }, 1600); }
          alert('Error al guardar la categoría.');
        });
      }, 250);
    });

// Guardar precio (regular) desde Etiquetas
    var __bcPriceTimer = {};
    $("#posinv_bc_results .posinv-bc-price-input").off('focus').on('focus', function(){
      this.dataset.prev = String(this.value || '');
    });
    $("#posinv_bc_results .posinv-bc-price-input").off('input change').on('input change', function(){
      var id = _bcNormId(this.dataset.id);
      var val = String(this.value || '').trim();
      clearTimeout(__bcPriceTimer[id]);
      var $st = $("#posinv_bc_results .posinv-bc-price-status[data-id='"+id+"']");
      if($st.length){ $st.text('…'); }
      __bcPriceTimer[id] = setTimeout(function(){
        $.post(POSINV_BARCODES.ajaxurl, {
          action: 'posinv_set_price',
          nonce: POSINV_BARCODES.nonce,
          product_id: id,
	          price: val,
	          module: 'labels'
        }, function(resp){
          if(resp && resp.success){
            if($st.length){ $st.text('✓'); setTimeout(function(){ $st.text(''); }, 1200); }
            if(resp.data && resp.data.price !== undefined){
              $("#posinv_bc_results .posinv-bc-price-input[data-id='"+id+"']").val(resp.data.price);
            }
          }else{
            var msg = (resp && resp.data && resp.data.message) ? String(resp.data.message) : 'Error al guardar precio';
            if($st.length){ $st.text('!').attr('title', msg); }
            var $inp = $("#posinv_bc_results .posinv-bc-price-input[data-id='"+id+"']");
            if($inp.length){
              var prev = String($inp[0].dataset.prev || '');
              $inp.val(prev);
              $inp.addClass('posinv-bc-input-error');
              setTimeout(function(){ $inp.removeClass('posinv-bc-input-error'); }, 1500);
            }
            alert(msg);
          }
        }).fail(function(){
          if($st.length){ $st.text('!'); }
          var $inp = $("#posinv_bc_results .posinv-bc-price-input[data-id='"+id+"']");
          if($inp.length){
            var prev = String($inp[0].dataset.prev || '');
            $inp.val(prev);
            $inp.addClass('posinv-bc-input-error');
            setTimeout(function(){ $inp.removeClass('posinv-bc-input-error'); }, 1500);
          }
          alert('Error al guardar el precio.');
        });
      }, 500);
    });


    _bcUpdateQueueUI();
  }

  function doSearch(){
    var q = $("#posinv_bc_search").val() || "";
    var qTrim = String(q).trim();

    // Si viene de pistola/lector (código numérico), limpiamos el input al terminar la búsqueda
    var shouldClear = /^\d{3,}$/.test(qTrim);

    return $.post(POSINV_BARCODES.ajaxurl, {
      action: 'posinv_barcode_search',
      nonce: POSINV_BARCODES.nonce,
      q: qTrim,
      cat: ($('#posinv_bc_cat').val()||''),
      store: (window.POSINV && window.POSINV.store ? window.POSINV.store : ($('#posinvStore').val()||''))
    }, function(resp){
      if(resp && resp.success){
        renderResults(resp.data);
      }else{
        $("#posinv_bc_results").html('<div class="posinv-bc-hint">Error: ' + (resp && resp.data && resp.data.message ? resp.data.message : 'no se pudo buscar') + '</div>');
      }
    }).always(function(){
      if(shouldClear){
        __bcSuppressInput = true;
        $("#posinv_bc_search").val('');
        setTimeout(function(){
          __bcSuppressInput = false;
          var el = document.getElementById('posinv_bc_search');
          if(el){ el.focus(); }
        }, 30);
      }
    });
  }

  function doPrint(){
    var p = window.POSINV_SELECTED;
    if(!p){
      alert("Primero selecciona un producto.");
      return;
    }
    var copies = parseInt($("#posinv_bc_copies").val() || "1", 10);
    if(isNaN(copies) || copies < 1) copies = 1;
    if(copies > 200) copies = 200;

    // Construye una ventana de impresión con N etiquetas (una debajo de otra).
    var w = window.open("", "posinv_print", "width=500,height=700");
    var css = document.querySelector('link#posinv-barcodes-css') ? '' : '';
    var style = `
      <style>
        @page { size: 50mm 25mm; margin: 0; }
        html, body { margin:0; padding:0; }
        .label { width:50mm; height:25mm; box-sizing:border-box; padding:1.5mm 1.5mm 1mm 1.5mm; font-family: Arial, sans-serif; }
        .barcode { width:100%; height:15mm; }
        .name { font-size:8pt; line-height:1.05; text-align:center; margin-top:1mm; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
        .id { font-size:7pt; text-align:center; margin-top:0.5mm; }
        svg { width:100%; height:100%; }
      </style>
    `;
    w.document.open();
    w.document.write("<html><head><title>Imprimir</title>"+style+"</head><body>");
    for(var i=0;i<copies;i++){
      w.document.write('<div class="label"><div class="barcode">'+document.getElementById("posinv_bc_svg_print").outerHTML+'</div><div class="name">'+POSINV_BC_UTILS.escapeHtml(p.name)+'</div><div class="id">ID: '+p.id+'</div></div>');
    }
    w.document.write("</body></html>");
    w.document.close();
    w.focus();
    setTimeout(function(){ w.print(); }, 300);
  }


function doPrintAndroid(){
  var labels = [];
  var keys = Object.keys(POSINV_BC_QUEUE);

  if(keys.length){
    keys.forEach(function(k){
      var it = POSINV_BC_QUEUE[k];
      if(!it) return;
      labels.push({
        id: String(it.id),
        barcode: String(it.barcode || it.id),
        name: String(it.name || ''),
        qty: Math.max(1, parseInt(it.qty, 10) || 1)
      });
    });
  } else {
    var p = getSelected();
    if(!p){ alert("Selecciona un producto"); return; }
    var copies = parseInt($("#posinv_bc_copies").val()||"1",10);
    if(isNaN(copies)||copies<1) copies=1;
    labels = [{id:String(p.id), barcode:String((p.barcode||p.id)), name:String(p.name), qty:copies}];
  }

  // Auditoría (no bloqueante): registrar impresión
  try{
    $.post(POSINV_BARCODES.ajaxurl, {
      action: 'posinv_audit_labels_print',
      nonce: POSINV_BARCODES.nonce,
      store: _bcCurrentStore(),
      labels: JSON.stringify(labels||[])
    });
  }catch(e){}

  var payload = {mode:"labels", labels: labels};
  var url = "posprinterbridge://print?text=" + encodeURIComponent(JSON.stringify(payload));

  // Forzar apertura en Android (a veces window.location no dispara el intent dentro de iframes/webviews)
  try{
    if(window.top && window.top !== window){
      window.top.location.href = url;
    }else{
      window.location.href = url;
    }
  }catch(e){
    window.location.href = url;
  }
}


  function POSINV_BC_UTILS.escapeHtml(s){
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

  
})(jQuery);
