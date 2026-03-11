
(function($){
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

  function _bcAudit(eventName, payload){
    payload = payload || {};
    payload.action = 'posinv_audit_event';
    payload.nonce = POSINV_BARCODES.nonce;
    payload.event = eventName;
    $.post(POSINV_BARCODES.ajaxurl, payload);
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
    _bcAudit('labels_select', {product_id: pid, barcode: (barcode ? String(barcode).trim() : pid), qty: qty});
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
             + '<th style="width:90px;">Copias</th>'
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
              '<td class="posinv-bc-code" style="width:160px;"><input type="text" class="posinv-bc-barcode" data-id="'+pid+'" value="'+escapeHtml((p.barcode && String(p.barcode).trim()) ? String(p.barcode).trim() : pid)+'" style="width:120px;"><span class="posinv-bc-barcode-status" data-id="'+pid+'" style="margin-left:6px;"></span></td>'+
              '<td>'+safeName+'</td>'+
              '<td class="posinv-bc-cats" data-id="'+pid+'">'+buildCatSelect(p.category_id || 0)+'<span class="posinv-bc-cats-status" data-id="'+pid+'" style="margin-left:6px;"></span></td>'+
              '<td class="posinv-bc-price" style="text-align:right;"><input type="text" class="posinv-bc-price-input" data-id="'+pid+'" value="'+escapeHtml(p.price || '')+'" style="width:90px; text-align:right;"><span class="posinv-bc-price-status" data-id="'+pid+'" style="margin-left:6px;"></span></td>'+
              '<td class="posinv-bc-stock" data-id="'+pid+'" style="text-align:right; width:90px;"><span class="posinv-bc-stockval">'+String(stockVal)+'</span></td>'+
              '<td class="posinv-bc-adjust" style="width:170px;">'
                + '<div class="posinv-bc-adjust-wrap">'
                  + '<button type="button" class="button posinv-bc-minus" data-id="'+pid+'">-</button>'
                  + '<input type="number" min="1" step="1" class="posinv-bc-step" data-id="'+pid+'" value="1">'
                  + '<button type="button" class="button posinv-bc-plus" data-id="'+pid+'">+</button>'
                  + '<span class="posinv-bc-saving" data-id="'+pid+'"></span>'
                + '</div>'
              + '</td>'+

              '<td style="width:120px;"><button type="button" class="button posinv_bc_pick" data-id="'+pid+'" data-name="'+safeName+'" data-barcode="'+escapeHtml((p.barcode && String(p.barcode).trim()) ? String(p.barcode).trim() : pid)+'" onclick="POSINV_PICK_LABEL(this.dataset.id, this.dataset.name, this.dataset.barcode)">Seleccionar</button></td>'+
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

    $("#posinv_bc_results .posinv-bc-qty")
      .off('input change blur')
      // Mientras escribe: permite vacío para poder teclear 10, 20, etc.
      .on('input', function(){
        var id = _bcNormId(this.dataset.id);
        var raw = String(this.value || '').trim();
        if(raw === '') return; // permitir vacío temporal
        var qty = parseInt(raw, 10);
        if(isNaN(qty)) return;
        if(qty < 1) qty = 1;
        this.value = qty;
        if(POSINV_BC_QUEUE[id]){
          POSINV_BC_QUEUE[id].qty = qty;
          POSINV_BC_QUEUE[id].barcode = String($("#posinv_bc_results .posinv-bc-barcode[data-id='"+id+"']").val() || id).trim();
          _bcUpdateQueueUI();
        }
      })
      // Al salir / confirmar: asegurar mínimo 1
      .on('change blur', function(){
        var id = _bcNormId(this.dataset.id);
        var raw = String(this.value || '').trim();
        var qty = parseInt(raw, 10);
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
        refreshCodeSelectedFromField(id);
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

  var __labelsSearchState = { q:'', cat:'', offset:0, perPage:30, hasMore:false, loading:false, items:[] };

  function getLabelResponseItems(resp){
    if(resp && resp.success && resp.data){
      if(Array.isArray(resp.data)) return resp.data;
      if(Array.isArray(resp.data.items)) return resp.data.items;
    }
    if(resp && Array.isArray(resp.items)) return resp.items;
    if(Array.isArray(resp)) return resp;
    return [];
  }

  function renderLabelsLoadMore(){
    var $wrap = $("#posinv_bc_results .posinv-bc-more-wrap");
    if(!$wrap.length) return;
    if(__labelsSearchState.hasMore){
      var disabled = __labelsSearchState.loading ? ' disabled' : '';
      var label = __labelsSearchState.loading ? 'Cargando…' : 'Cargar más';
      $wrap.html('<button type="button" class="button button-secondary" id="posinv_bc_load_more"'+disabled+'>'+label+'</button>');
    }else{
      $wrap.html('');
    }
  }

  function ensureLabelsMoreWrap(){
    if($("#posinv_bc_results .posinv-bc-more-wrap").length===0){
      $("#posinv_bc_results").append('<div class="posinv-bc-more-wrap" style="margin-top:12px;text-align:center;"></div>');
    }
  }

  function doSearch(opts){
    opts = opts || {};
    var append = !!opts.append;
    var qTrim = String(opts.q != null ? opts.q : ($("#posinv_bc_search").val() || "")).trim();
    var cat = String(opts.cat != null ? opts.cat : ($('#posinv_bc_cat').val()||''));
    var shouldClear = /^\d{3,}$/.test(qTrim);
    var offset = append ? (__labelsSearchState.offset || 0) : 0;

    if(!qTrim && !cat){
      __labelsSearchState = { q:'', cat:'', offset:0, perPage:30, hasMore:false, loading:false, items:[] };
      $("#posinv_bc_results").html('<div class="posinv-bc-hint">Escribe algo o elige una categoría.</div>');
      return;
    }

    __labelsSearchState.q = qTrim;
    __labelsSearchState.cat = cat;
    __labelsSearchState.loading = true;
    if(!append){
      $("#posinv_bc_results").html('<div class="posinv-bc-hint">Buscando…</div>');
    }else{
      ensureLabelsMoreWrap();
      renderLabelsLoadMore();
    }

    return $.post(POSINV_BARCODES.ajaxurl, {
      action: 'posinv_barcode_search',
      nonce: POSINV_BARCODES.nonce,
      q: qTrim,
      cat: cat,
      store: (window.POSINV && window.POSINV.store ? window.POSINV.store : ($('#posinvStore').val()||'')),
      module: 'labels',
      per_page: __labelsSearchState.perPage,
      offset: offset
    }, function(resp){
      __labelsSearchState.loading = false;
      if(resp && resp.success){
        var payload = resp.data || {};
        var items = getLabelResponseItems(resp);
        __labelsSearchState.hasMore = !!(payload && payload.has_more);
        __labelsSearchState.offset = (payload && typeof payload.next_offset !== 'undefined') ? parseInt(payload.next_offset,10)||0 : (offset + items.length);
        __labelsSearchState.items = append ? __labelsSearchState.items.concat(items || []) : (items || []);
        renderResults(__labelsSearchState.items);
        ensureLabelsMoreWrap();
        renderLabelsLoadMore();
      }else{
        __labelsSearchState.hasMore = false;
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

  function _bcAuditPrint(labels, printMode, usedQueue){
    $.post(POSINV_BARCODES.ajaxurl, {
      action: 'posinv_audit_labels_print',
      nonce: POSINV_BARCODES.nonce,
      store: (window.POSINV && window.POSINV.store ? window.POSINV.store : ($('#posinvStore').val()||'')),
      labels: JSON.stringify(labels || []),
      print_mode: printMode || 'browser',
      used_queue: usedQueue ? 1 : 0
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

    var labels = [{id:String(p.id), barcode:String((p.barcode||p.id)), name:String(p.name), qty:copies}];
    _bcAuditPrint(labels, 'browser', false);

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
      w.document.write('<div class="label"><div class="barcode">'+document.getElementById("posinv_bc_svg_print").outerHTML+'</div><div class="name">'+escapeHtml(p.name)+'</div><div class="id">ID: '+p.id+'</div></div>');
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

  _bcAuditPrint(labels, 'android', keys.length > 0);
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


  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(m){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]);
    });
  }

  $(document).on("click", "#posinv_bc_btn_search", function(e){ e.preventDefault(); stopLabelsTopScanner(); doSearch(); });

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
    stopLabelsTopScanner();
    doSearch({ append:false, cat: ($(this).val()||''), q: ($("#posinv_bc_search").val()||'') });
  });
  $(document).on('click', '#posinv_bc_btn_scan', function(e){
    e.preventDefault();
    openLabelsTopScanner();
  });
  $(document).on('click', '#posinv_bc_topscan_close', function(e){
    e.preventDefault();
    stopLabelsTopScanner();
  });
  $(document).on('click', '#posinv_bc_load_more', function(e){
    e.preventDefault();
    if(__labelsSearchState.loading || !__labelsSearchState.hasMore) return;
    doSearch({ append:true, q:__labelsSearchState.q, cat:__labelsSearchState.cat });
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
    var _selectedBefore = Object.keys(POSINV_BC_QUEUE).length;
    POSINV_BC_QUEUE = {};
    $("#posinv_bc_results .posinv-bc-sel").prop('checked', false);
    _bcUpdateQueueUI();
    _bcAudit('labels_queue_clear', {selected_count: _selectedBefore});
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
      body: JSON.stringify({store: _bcCurrentStore(), module: 'labels', items: [{id: parseInt(pid,10), qty: delta}]})
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

  var POSINV_CODE_QUEUE = {};

  function _codeUpdateQueueUI(){
    var count = Object.keys(POSINV_CODE_QUEUE).length;
    var $info = $('#posinv_code_selected_info');
    if($info.length){ $info.text('Seleccionados: ' + count); }
    var $clear = $('#posinv_code_clear_selected');
    if($clear.length){ $clear.prop('disabled', count === 0); }
    var $btn = $('#posinv_code_btn_print_android');
    if($btn.length){
      $btn.text(count ? 'Imprimir seleccionados (App Android)' : 'Imprimir (App Android)');
    }
  }

  function _codeDefaultCopies(){
    return 1;
  }

  function _codeCurrentBarcode(id){
    id = _bcNormId(id);
    var $inp = $("#posinv_code_results .posinv-code-barcode[data-id='"+id+"']");
    var val = $inp.length ? String($inp.val() || '').trim() : '';
    return val || id;
  }

  function _codeUpdateSelectedInfo(){
    _codeUpdateQueueUI();
  }

  function setCodeSelected(product){
    product = product || {};
    var p = {
      id: String(product.id || ''),
      name: decodeEntities(String(product.name || '')),
      barcode: String(product.barcode || product.id || '')
    };
    window.POSINV_CODE_SELECTED = p;
    $('#posinv_code_name').text(p.name || '—');
    $('#posinv_code_id').text('ID: ' + (p.id || '—'));
    $('#posinv_code_name_print').text(p.name || '');
    $('#posinv_code_id_print').text('ID: ' + (p.id || ''));
    var svg = document.getElementById('posinv_code_svg');
    var svgPrint = document.getElementById('posinv_code_svg_print');
    if(svg) svgBarcode39(svg, (p.barcode || p.id), {height: 54, narrow: 2, wide: 6});
    if(svgPrint) svgBarcode39(svgPrint, (p.barcode || p.id), {height: 54, narrow: 2, wide: 6});
    _codeUpdateSelectedInfo();
  }

  function refreshCodeSelectedFromField(id){
    var p = window.POSINV_CODE_SELECTED || null;
    id = _bcNormId(id);
    if(POSINV_CODE_QUEUE[id]){
      POSINV_CODE_QUEUE[id].barcode = _codeCurrentBarcode(id);
    }
    if(!p || String(p.id) !== id) return;
    p.barcode = _codeCurrentBarcode(id);
    setCodeSelected(p);
  }

  function _codeCollectLabels(){
    var labels = [];
    var keys = Object.keys(POSINV_CODE_QUEUE);
    if(keys.length){
      keys.forEach(function(k){
        var it = POSINV_CODE_QUEUE[k];
        if(!it) return;
        labels.push({
          id: String(it.id),
          barcode: String(_codeCurrentBarcode(it.id) || it.barcode || it.id),
          name: String(it.name || ''),
          qty: Math.max(1, parseInt(it.qty,10) || 1)
        });
      });
      return labels;
    }
    var p = window.POSINV_CODE_SELECTED || null;
    if(!p){ return []; }
    labels.push({
      id: String(p.id),
      barcode: String(_codeCurrentBarcode(p.id) || p.barcode || p.id),
      name: String(p.name || ''),
      qty: 1
    });
    return labels;
  }

  function doCodePrint(){
    var labels = _codeCollectLabels();
    if(!labels.length){ alert('Primero selecciona un producto en Código.'); return; }
    _bcAuditPrint(labels, 'browser', Object.keys(POSINV_CODE_QUEUE).length > 0);
    var w = window.open('', 'posinv_print_code', 'width=500,height=700');
    var style = '\
      <style>\
        @page { size: 50mm 25mm; margin: 0; }\
        html, body { margin:0; padding:0; }\
        .label { width:50mm; height:25mm; box-sizing:border-box; padding:1.5mm 1.5mm 1mm 1.5mm; font-family: Arial, sans-serif; }\
        .barcode { width:100%; height:15mm; }\
        .name { font-size:8pt; line-height:1.05; text-align:center; margin-top:1mm; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }\
        .id { font-size:7pt; text-align:center; margin-top:0.5mm; }\
        svg { width:100%; height:100%; }\
      </style>\
    ';
    w.document.open();
    w.document.write('<html><head><title>Imprimir</title>'+style+'</head><body>');
    labels.forEach(function(it){
      var tmp = document.createElementNS('http://www.w3.org/2000/svg','svg');
      svgBarcode39(tmp, String(it.barcode || it.id), {height: 54, narrow: 2, wide: 6});
      var qty = Math.max(1, parseInt(it.qty,10) || 1);
      for(var i=0;i<qty;i++){
        w.document.write('<div class="label"><div class="barcode">'+tmp.outerHTML+'</div><div class="name">'+escapeHtml(it.name || '')+'</div><div class="id">ID: '+escapeHtml(String(it.id || ''))+'</div></div>');
      }
    });
    w.document.write('</body></html>');
    w.document.close();
    w.focus();
    setTimeout(function(){ w.print(); }, 300);
  }

  function doCodePrintAndroid(){
    var labels = _codeCollectLabels();
    if(!labels.length){ alert('Selecciona un producto en Código'); return; }
    _bcAuditPrint(labels, 'android', Object.keys(POSINV_CODE_QUEUE).length > 0);
    var payload = {mode:'labels', labels: labels};
    var url = 'posprinterbridge://print?text=' + encodeURIComponent(JSON.stringify(payload));
    try{
      if(window.top && window.top !== window){ window.top.location.href = url; }
      else { window.location.href = url; }
    }catch(e){ window.location.href = url; }
  }

  var __codeSearchState = { q:'', cat:'', offset:0, perPage:30, hasMore:false, loading:false };

  function getCodeResponseItems(resp){
    if(resp && Array.isArray(resp.items)) return resp.items;
    if(Array.isArray(resp)) return resp;
    return [];
  }

  function renderCodeResults(list, append){
    stopCodeScanner();
    list = Array.isArray(list) ? list : [];
    append = !!append;

    if(!append){
      if(!list.length){
        $("#posinv_code_results").html('<div class="posinv-bc-hint">Sin resultados.</div>');
        return;
      }

      var html = '';
      html += '<div class="posinv-bc-table-wrap"><table class="posinv-bc-table" style="width:100%;">';
      html += '<thead><tr>' +
        '<th style="width:54px; text-align:center;">Sel</th>' +
        '<th style="width:90px;">Copias</th>' +
        '<th style="width:84px;">Img</th>' +
        '<th style="width:90px;">ID</th>' +
        '<th style="width:64px; text-align:center;">📷</th>' +
        '<th style="width:180px;">Código</th>' +
        '<th>Producto</th>' +
        '</tr></thead><tbody id="posinv_code_tbody"></tbody></table></div>' +
        '<div class="posinv-code-more-wrap" style="margin-top:12px; text-align:center;"></div>';
      $("#posinv_code_results").html(html);
    }

    var rows = '';
    for(var i=0;i<list.length;i++){
      var p = list[i] || {};
      var pid = escapeHtml(String(p.id||''));
      var safeName = escapeHtml(decodeEntities(String(p.name||'')));
      var img = (p.img ? String(p.img) : (p.image_url ? String(p.image_url) : ''));
      var imgCell = img ? ('<img class="posinv-bc-thumb" src="'+escapeHtml(img)+'" alt="">') : '<div class="posinv-bc-thumb" style="display:flex;align-items:center;justify-content:center;color:#999;">—</div>';
      var bcVal = (p.barcode && String(p.barcode).trim()) ? String(p.barcode).trim() : String(p.id||'');
      var checked = POSINV_CODE_QUEUE[pid] ? ' checked' : '';
      var qtyVal = POSINV_CODE_QUEUE[pid] ? (POSINV_CODE_QUEUE[pid].qty || 1) : 1;
      rows += '<tr class="posinv-code-row" data-id="'+pid+'">' +
        '<td style="text-align:center;"><input type="checkbox" class="posinv-code-sel" data-id="'+pid+'" data-name="'+safeName+'"'+checked+'></td>' +
        '<td><input type="number" min="1" step="1" class="posinv-code-qty" data-id="'+pid+'" value="'+qtyVal+'" style="width:72px;"></td>' +
        '<td>'+imgCell+'</td>' +
        '<td>'+pid+'</td>' +
        '<td class="posinv-code-scan-cell"><button type="button" class="button posinv-code-scan-btn" data-id="'+pid+'" title="Escanear código con cámara">📷</button></td>' +
        '<td class="posinv-bc-code"><input type="text" class="posinv-code-barcode posinv-bc-barcode" data-id="'+pid+'" value="'+escapeHtml(bcVal)+'" style="width:150px;">' +
          '<span class="posinv-code-barcode-status posinv-bc-barcode-status" data-id="'+pid+'" style="margin-left:6px;"></span>' +
        '</td>' +
        '<td>'+safeName+'</td>' +
      '</tr>';
    }

    $("#posinv_code_tbody").append(rows);
    renderCodeLoadMore();
    wireCodeBarcodeSave();
  }

  function renderCodeLoadMore(){
    var $wrap = $("#posinv_code_results .posinv-code-more-wrap");
    if(!$wrap.length) return;
    if(__codeSearchState.hasMore){
      var disabled = __codeSearchState.loading ? ' disabled' : '';
      var label = __codeSearchState.loading ? 'Cargando…' : 'Cargar más';
      $wrap.html('<button type="button" class="button button-secondary" id="posinv_code_load_more"'+disabled+'>'+label+'</button>');
    }else{
      $wrap.html('');
    }
  }

  var __codeSaveTimer = {};
  var __codeScan = { stream:null, video:null, detector:null, raf:0, activeId:'', activeBtn:null, lastRaw:'', stableCount:0, startedAt:0, track:null, lastSeenAt:0 };
  var __labelsTopScan = { stream:null, video:null, detector:null, raf:0, active:false, lastRaw:'', stableCount:0, startedAt:0, track:null, lastSeenAt:0 };

  function stopLabelsTopScanner(){
    if(__labelsTopScan.raf){ cancelAnimationFrame(__labelsTopScan.raf); __labelsTopScan.raf = 0; }
    if(__labelsTopScan.stream && __labelsTopScan.stream.getTracks){ __labelsTopScan.stream.getTracks().forEach(function(t){ try{ t.stop(); }catch(_e){} }); }
    if(__labelsTopScan.video){ try{ __labelsTopScan.video.pause(); }catch(_e){} try{ __labelsTopScan.video.srcObject = null; }catch(_e){} }
    __labelsTopScan.stream = null;
    __labelsTopScan.video = null;
    __labelsTopScan.detector = null;
    __labelsTopScan.active = false;
    __labelsTopScan.lastRaw = '';
    __labelsTopScan.stableCount = 0;
    __labelsTopScan.startedAt = 0;
    __labelsTopScan.track = null;
    __labelsTopScan.lastSeenAt = 0;
    $('#posinv_bc_topscan').hide();
    $('#posinv_bc_topscan_video').empty();
  }

  async function labelsTopScannerTick(){
    if(!__labelsTopScan.detector || !__labelsTopScan.video) return;
    try{
      var detected = await __labelsTopScan.detector.detect(__labelsTopScan.video);
      if(detected && detected.length){
        var raw = '';
        for(var i=0; i<detected.length; i++){
          raw = String((detected[i] && detected[i].rawValue) || '').trim();
          if(raw) break;
        }
        if(raw){
          var nowTs = Date.now();
          if(raw === __labelsTopScan.lastRaw){
            if(!__labelsTopScan.lastSeenAt || (nowTs - __labelsTopScan.lastSeenAt) <= 1800){ __labelsTopScan.stableCount += 1; }
            else { __labelsTopScan.stableCount = 1; }
          }else{
            if(__labelsTopScan.lastRaw && __labelsTopScan.stableCount >= 1 && (nowTs - (__labelsTopScan.lastSeenAt || 0)) <= 900){
              $('#posinv_bc_topscan_status').text('Mantén estable el código… (' + __labelsTopScan.stableCount + '/2)');
              __labelsTopScan.lastSeenAt = nowTs;
              __labelsTopScan.raf = requestAnimationFrame(labelsTopScannerTick);
              return;
            }
            __labelsTopScan.lastRaw = raw;
            __labelsTopScan.stableCount = 1;
          }
          __labelsTopScan.lastSeenAt = nowTs;
          $('#posinv_bc_topscan_status').text(__labelsTopScan.stableCount >= 2 ? ('Código confirmado: ' + raw) : ('Enfocando… detectado ' + raw + ' (' + __labelsTopScan.stableCount + '/2)'));
          if(__labelsTopScan.stableCount >= 2){
            stopLabelsTopScanner();
            $('#posinv_bc_search').val(raw);
            doSearch({ append:false, q: raw, cat: ($('#posinv_bc_cat').val()||'') });
            return;
          }
        }
      }else{
        var nowMiss = Date.now();
        if(__labelsTopScan.lastSeenAt && (nowMiss - __labelsTopScan.lastSeenAt) > 2200){
          __labelsTopScan.lastRaw = '';
          __labelsTopScan.stableCount = 0;
          $('#posinv_bc_topscan_status').text('Acerca o aleja un poco la cámara para enfocar…');
        }
      }
    }catch(_e){}
    __labelsTopScan.raf = requestAnimationFrame(labelsTopScannerTick);
  }

  async function openLabelsTopScanner(){
    if(__labelsTopScan.active){ stopLabelsTopScanner(); return; }
    stopLabelsTopScanner();
    $('#posinv_bc_topscan').show();
    if(!('BarcodeDetector' in window)){
      $('#posinv_bc_topscan_status').text('Tu navegador no soporta escaneo nativo aquí. Prueba con Chrome en Android.');
      return;
    }
    try{
      __labelsTopScan.detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code'] });
    }catch(_e){
      try{ __labelsTopScan.detector = new BarcodeDetector(); }catch(_e2){ __labelsTopScan.detector = null; }
    }
    if(!__labelsTopScan.detector){
      $('#posinv_bc_topscan_status').text('No se pudo iniciar el lector.');
      return;
    }
    var box = document.getElementById('posinv_bc_topscan_video');
    if(!box){ stopLabelsTopScanner(); return; }
    var video = document.createElement('video');
    video.setAttribute('playsinline','');
    video.autoplay = true;
    video.muted = true;
    box.innerHTML = '';
    box.appendChild(video);
    var guide = document.createElement('div');
    guide.className = 'posinv-scan-guide';
    box.appendChild(guide);
    try{
      __labelsTopScan.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          focusMode: { ideal: 'continuous' }
        },
        audio:false
      });
      __labelsTopScan.video = video;
      __labelsTopScan.video.srcObject = __labelsTopScan.stream;
      await __labelsTopScan.video.play();
      __labelsTopScan.active = true;
      __labelsTopScan.startedAt = Date.now();
      __labelsTopScan.lastRaw = '';
      __labelsTopScan.stableCount = 0;
      __labelsTopScan.lastSeenAt = 0;
      __labelsTopScan.track = (__labelsTopScan.stream && __labelsTopScan.stream.getVideoTracks) ? (__labelsTopScan.stream.getVideoTracks()[0] || null) : null;
      if(__labelsTopScan.track && __labelsTopScan.track.applyConstraints){
        try{
          var caps = (__labelsTopScan.track.getCapabilities ? __labelsTopScan.track.getCapabilities() : {}) || {};
          var advanced = [];
          if(caps.focusMode && caps.focusMode.indexOf && caps.focusMode.indexOf('continuous') !== -1){ advanced.push({ focusMode: 'continuous' }); }
          if(caps.zoom){
            var z = 1;
            if(typeof caps.zoom === 'object'){
              var minZ = Number(caps.zoom.min || 1);
              var maxZ = Number(caps.zoom.max || minZ || 1);
              z = Math.max(minZ, Math.min(maxZ, 2));
            }
            if(z > 1){ advanced.push({ zoom: z }); }
          }
          if(advanced.length){ __labelsTopScan.track.applyConstraints({ advanced: advanced }).catch(function(){}); }
        }catch(_capsErr){}
      }
      $('#posinv_bc_topscan_status').text('Enfocando cámara…');
      __labelsTopScan.raf = requestAnimationFrame(labelsTopScannerTick);
    }catch(err){
      var msg = (err && err.message) ? err.message : 'No se pudo abrir la cámara.';
      $('#posinv_bc_topscan_status').text(msg);
    }
  }

  var __codeTopScan = { stream:null, video:null, detector:null, raf:0, active:false, lastRaw:'', stableCount:0, startedAt:0, track:null, lastSeenAt:0 };

  function saveCodeBarcodeValue(id, val, opts){
    opts = opts || {};
    id = _bcNormId(id);
    val = String(val || '').trim();
    var $inp = $("#posinv_code_results .posinv-code-barcode[data-id='"+id+"']");
    var $st = $("#posinv_code_results .posinv-code-barcode-status[data-id='"+id+"']");
    if(!$inp.length) return $.Deferred().reject().promise();
    var prev = String($inp.get(0).dataset.prev || $inp.val() || '').trim();
    if(opts.updateField !== false){
      $inp.val(val);
    }
    clearTimeout(__codeSaveTimer[id]);
    if($st.length){ $st.text('…'); }
    return $.post(POSINV_BARCODES.ajaxurl, {
      action: 'posinv_set_barcode',
      nonce: POSINV_BARCODES.nonce,
      product_id: id,
      barcode: val
    }).done(function(resp){
      if(resp && resp.success){
        $inp.get(0).dataset.prev = val;
        if($st.length){ $st.text('✓'); setTimeout(function(){ $st.text(''); }, 1200); }
      }else{
        var msg = (resp && resp.data && resp.data.message) ? resp.data.message : 'Error al guardar';
        if($st.length){ $st.text('!'); }
        $inp.val(prev);
        $inp.addClass('posinv-bc-input-error');
        setTimeout(function(){ $inp.removeClass('posinv-bc-input-error'); }, 1600);
        if(!opts.silent){ alert(msg); }
        throw new Error(msg);
      }
    }).fail(function(){
      if($st.length){ $st.text('!'); }
      $inp.val(prev);
      $inp.addClass('posinv-bc-input-error');
      setTimeout(function(){ $inp.removeClass('posinv-bc-input-error'); }, 1600);
      if(!opts.silent){ alert('Error al guardar'); }
    });
  }

  function stopCodeScanner(){
    if(__codeScan.raf){
      cancelAnimationFrame(__codeScan.raf);
      __codeScan.raf = 0;
    }
    if(__codeScan.stream && __codeScan.stream.getTracks){
      __codeScan.stream.getTracks().forEach(function(t){ try{ t.stop(); }catch(_e){} });
    }
    if(__codeScan.video){
      try{ __codeScan.video.pause(); }catch(_e){}
      try{ __codeScan.video.srcObject = null; }catch(_e){}
    }
    __codeScan.stream = null;
    __codeScan.video = null;
    __codeScan.detector = null;
    __codeScan.activeId = '';
    __codeScan.lastRaw = '';
    __codeScan.stableCount = 0;
    __codeScan.startedAt = 0;
    __codeScan.track = null;
    __codeScan.lastSeenAt = 0;
    if(__codeScan.activeBtn){
      $(__codeScan.activeBtn).removeClass('is-active');
      __codeScan.activeBtn = null;
    }
    $("#posinv_code_results .posinv-code-scan-row").remove();
  }

  async function codeScannerTick(){
    if(!__codeScan.detector || !__codeScan.video) return;
    try{
      if(__codeScan.video.readyState < 2){
        __codeScan.raf = requestAnimationFrame(codeScannerTick);
        return;
      }
      if(__codeScan.startedAt && (Date.now() - __codeScan.startedAt) < 450){
        __codeScan.raf = requestAnimationFrame(codeScannerTick);
        return;
      }
      var detected = await __codeScan.detector.detect(__codeScan.video);
      if(detected && detected.length){
        var raw = '';
        for(var i=0; i<detected.length; i++){
          raw = String((detected[i] && detected[i].rawValue) || '').trim();
          if(raw) break;
        }
        if(raw){
          var nowTs = Date.now();
          if(raw === __codeScan.lastRaw){
            if(!__codeScan.lastSeenAt || (nowTs - __codeScan.lastSeenAt) <= 1800){
              __codeScan.stableCount += 1;
            }else{
              __codeScan.stableCount = 1;
            }
          }else{
            if(__codeScan.lastRaw && __codeScan.stableCount >= 1 && (nowTs - (__codeScan.lastSeenAt || 0)) <= 900){
              // Si hubo una lectura buena muy reciente, no la tires por una lectura aislada distinta.
              var $statusKeep = $("#posinv_code_scan_status_" + __codeScan.activeId);
              if($statusKeep.length){
                $statusKeep.text('Mantén estable el código… (' + __codeScan.stableCount + '/2)');
              }
              __codeScan.lastSeenAt = nowTs;
              __codeScan.raf = requestAnimationFrame(codeScannerTick);
              return;
            }
            __codeScan.lastRaw = raw;
            __codeScan.stableCount = 1;
          }
          __codeScan.lastSeenAt = nowTs;
          var $status = $("#posinv_code_scan_status_" + __codeScan.activeId);
          if($status.length){
            $status.text(__codeScan.stableCount >= 2 ? 'Código confirmado: ' + raw : 'Enfocando… detectado ' + raw + ' (' + __codeScan.stableCount + '/2)');
          }
          if(__codeScan.stableCount >= 2){
            var activeId = __codeScan.activeId;
            stopCodeScanner();
            saveCodeBarcodeValue(activeId, raw, { updateField:true });
            return;
          }
        }
      }else{
        var nowMiss = Date.now();
        if(__codeScan.lastSeenAt && (nowMiss - __codeScan.lastSeenAt) > 2200){
          __codeScan.lastRaw = '';
          __codeScan.stableCount = 0;
          var $statusMiss = $("#posinv_code_scan_status_" + __codeScan.activeId);
          if($statusMiss.length){
            $statusMiss.text('Acerca o aleja un poco la cámara para enfocar…');
          }
        }
      }
    }catch(_e){}
    __codeScan.raf = requestAnimationFrame(codeScannerTick);
  }

  async function openCodeScanner(id, btnEl){
    id = _bcNormId(id);
    if(!id) return;
    if(__codeScan.activeId === id){
      stopCodeScanner();
      return;
    }
    stopCodeScanner();

    var $row = $("#posinv_code_results tr.posinv-code-row[data-id='"+id+"']");
    if(!$row.length) return;

    var scanRowHtml = '' +
      '<tr class="posinv-code-scan-row" data-id="'+escapeHtml(id)+'">' +
        '<td colspan="6">' +
          '<div class="posinv-code-scan-box">' +
            '<div class="posinv-code-scan-head">' +
              '<strong>Escanear nuevo código</strong>' +
              '<button type="button" class="button posinv-code-scan-close" data-id="'+escapeHtml(id)+'">Cerrar</button>' +
            '</div>' +
            '<div class="posinv-code-scan-help">Apunta la cámara trasera al código. Al detectarlo, se guardará en el recuadro morado y la cámara se cerrará sola.</div>' +
            '<div class="posinv-code-scan-video" id="posinv_code_scan_video_'+escapeHtml(id)+'"></div>' +
            '<div class="posinv-code-scan-status" id="posinv_code_scan_status_'+escapeHtml(id)+'">Abriendo cámara…</div>' +
          '</div>' +
        '</td>' +
      '</tr>';
    $row.after(scanRowHtml);

    if(!('BarcodeDetector' in window)){
      $("#posinv_code_scan_status_"+id).text('Tu navegador no soporta escaneo nativo aquí. Prueba con Chrome en Android.');
      return;
    }

    try{
      __codeScan.detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code'] });
    }catch(_e){
      try{ __codeScan.detector = new BarcodeDetector(); }catch(_e2){ __codeScan.detector = null; }
    }
    if(!__codeScan.detector){
      $("#posinv_code_scan_status_"+id).text('No se pudo iniciar el lector.');
      return;
    }

    var box = document.getElementById('posinv_code_scan_video_' + id);
    if(!box){
      stopCodeScanner();
      return;
    }

    var video = document.createElement('video');
    video.setAttribute('playsinline','');
    video.autoplay = true;
    video.muted = true;
    box.innerHTML = '';
    box.appendChild(video);
    var guide = document.createElement('div');
    guide.className = 'posinv-scan-guide';
    box.appendChild(guide);

    try{
      __codeScan.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          focusMode: { ideal: 'continuous' }
        },
        audio:false
      });
      __codeScan.video = video;
      __codeScan.video.srcObject = __codeScan.stream;
      await __codeScan.video.play();
      __codeScan.activeId = id;
      __codeScan.activeBtn = btnEl || null;
      __codeScan.startedAt = Date.now();
      __codeScan.lastRaw = '';
      __codeScan.stableCount = 0;
      __codeScan.lastSeenAt = 0;
      __codeScan.track = (__codeScan.stream && __codeScan.stream.getVideoTracks) ? (__codeScan.stream.getVideoTracks()[0] || null) : null;
      if(__codeScan.track && __codeScan.track.applyConstraints){
        try{
          var caps = (__codeScan.track.getCapabilities ? __codeScan.track.getCapabilities() : {}) || {};
          var advanced = [];
          if(caps.focusMode && caps.focusMode.indexOf && caps.focusMode.indexOf('continuous') !== -1){
            advanced.push({ focusMode: 'continuous' });
          }
          if(caps.zoom){
            var z = 1;
            if(typeof caps.zoom === 'object'){
              var minZ = Number(caps.zoom.min || 1);
              var maxZ = Number(caps.zoom.max || minZ || 1);
              z = Math.max(minZ, Math.min(maxZ, 2));
            }
            if(z > 1){ advanced.push({ zoom: z }); }
          }
          if(advanced.length){ __codeScan.track.applyConstraints({ advanced: advanced }).catch(function(){}); }
        }catch(_capsErr){}
      }
      if(btnEl){ $(btnEl).addClass('is-active'); }
      $("#posinv_code_scan_status_"+id).text('Enfocando cámara…');
      __codeScan.raf = requestAnimationFrame(codeScannerTick);
    }catch(err){
      var msg = (err && err.message) ? err.message : 'No se pudo abrir la cámara.';
      $("#posinv_code_scan_status_"+id).text(msg);
    }
  }

  function stopCodeTopScanner(){
    if(__codeTopScan.raf){ cancelAnimationFrame(__codeTopScan.raf); __codeTopScan.raf = 0; }
    if(__codeTopScan.stream && __codeTopScan.stream.getTracks){ __codeTopScan.stream.getTracks().forEach(function(t){ try{ t.stop(); }catch(_e){} }); }
    if(__codeTopScan.video){ try{ __codeTopScan.video.pause(); }catch(_e){} try{ __codeTopScan.video.srcObject = null; }catch(_e){} }
    __codeTopScan.stream = null;
    __codeTopScan.video = null;
    __codeTopScan.detector = null;
    __codeTopScan.active = false;
    __codeTopScan.lastRaw = '';
    __codeTopScan.stableCount = 0;
    __codeTopScan.startedAt = 0;
    __codeTopScan.track = null;
    __codeTopScan.lastSeenAt = 0;
    $('#posinv_code_topscan').hide();
    $('#posinv_code_topscan_video').empty();
  }

  async function codeTopScannerTick(){
    if(!__codeTopScan.detector || !__codeTopScan.video) return;
    try{
      var detected = await __codeTopScan.detector.detect(__codeTopScan.video);
      if(detected && detected.length){
        var raw = '';
        for(var i=0; i<detected.length; i++){
          raw = String((detected[i] && detected[i].rawValue) || '').trim();
          if(raw) break;
        }
        if(raw){
          var nowTs = Date.now();
          if(raw === __codeTopScan.lastRaw){
            if(!__codeTopScan.lastSeenAt || (nowTs - __codeTopScan.lastSeenAt) <= 1800){ __codeTopScan.stableCount += 1; }
            else { __codeTopScan.stableCount = 1; }
          }else{
            if(__codeTopScan.lastRaw && __codeTopScan.stableCount >= 1 && (nowTs - (__codeTopScan.lastSeenAt || 0)) <= 900){
              $('#posinv_code_topscan_status').text('Mantén estable el código… (' + __codeTopScan.stableCount + '/2)');
              __codeTopScan.lastSeenAt = nowTs;
              __codeTopScan.raf = requestAnimationFrame(codeTopScannerTick);
              return;
            }
            __codeTopScan.lastRaw = raw;
            __codeTopScan.stableCount = 1;
          }
          __codeTopScan.lastSeenAt = nowTs;
          $('#posinv_code_topscan_status').text(__codeTopScan.stableCount >= 2 ? ('Código confirmado: ' + raw) : ('Enfocando… detectado ' + raw + ' (' + __codeTopScan.stableCount + '/2)'));
          if(__codeTopScan.stableCount >= 2){
            stopCodeTopScanner();
            $('#posinv_code_search').val(raw);
            codeSearch({ append:false, q: raw, cat: ($('#posinv_code_cat').val()||'') });
            return;
          }
        }
      }else{
        var nowMiss = Date.now();
        if(__codeTopScan.lastSeenAt && (nowMiss - __codeTopScan.lastSeenAt) > 2200){
          __codeTopScan.lastRaw = '';
          __codeTopScan.stableCount = 0;
          $('#posinv_code_topscan_status').text('Acerca o aleja un poco la cámara para enfocar…');
        }
      }
    }catch(_e){}
    __codeTopScan.raf = requestAnimationFrame(codeTopScannerTick);
  }

  async function openCodeTopScanner(){
    if(__codeTopScan.active){ stopCodeTopScanner(); return; }
    stopCodeTopScanner();
    $('#posinv_code_topscan').show();
    if(!('BarcodeDetector' in window)){
      $('#posinv_code_topscan_status').text('Tu navegador no soporta escaneo nativo aquí. Prueba con Chrome en Android.');
      return;
    }
    try{
      __codeTopScan.detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code'] });
    }catch(_e){
      try{ __codeTopScan.detector = new BarcodeDetector(); }catch(_e2){ __codeTopScan.detector = null; }
    }
    if(!__codeTopScan.detector){
      $('#posinv_code_topscan_status').text('No se pudo iniciar el lector.');
      return;
    }
    var box = document.getElementById('posinv_code_topscan_video');
    if(!box){ stopCodeTopScanner(); return; }
    var video = document.createElement('video');
    video.setAttribute('playsinline','');
    video.autoplay = true;
    video.muted = true;
    box.innerHTML = '';
    box.appendChild(video);
    var guide = document.createElement('div');
    guide.className = 'posinv-scan-guide';
    box.appendChild(guide);
    try{
      __codeTopScan.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          focusMode: { ideal: 'continuous' }
        },
        audio:false
      });
      __codeTopScan.video = video;
      __codeTopScan.video.srcObject = __codeTopScan.stream;
      await __codeTopScan.video.play();
      __codeTopScan.active = true;
      __codeTopScan.startedAt = Date.now();
      __codeTopScan.lastRaw = '';
      __codeTopScan.stableCount = 0;
      __codeTopScan.lastSeenAt = 0;
      __codeTopScan.track = (__codeTopScan.stream && __codeTopScan.stream.getVideoTracks) ? (__codeTopScan.stream.getVideoTracks()[0] || null) : null;
      if(__codeTopScan.track && __codeTopScan.track.applyConstraints){
        try{
          var caps = (__codeTopScan.track.getCapabilities ? __codeTopScan.track.getCapabilities() : {}) || {};
          var advanced = [];
          if(caps.focusMode && caps.focusMode.indexOf && caps.focusMode.indexOf('continuous') !== -1){ advanced.push({ focusMode: 'continuous' }); }
          if(caps.zoom){
            var z = 1;
            if(typeof caps.zoom === 'object'){
              var minZ = Number(caps.zoom.min || 1);
              var maxZ = Number(caps.zoom.max || minZ || 1);
              z = Math.max(minZ, Math.min(maxZ, 2));
            }
            if(z > 1){ advanced.push({ zoom: z }); }
          }
          if(advanced.length){ __codeTopScan.track.applyConstraints({ advanced: advanced }).catch(function(){}); }
        }catch(_capsErr){}
      }
      $('#posinv_code_topscan_status').text('Enfocando cámara…');
      __codeTopScan.raf = requestAnimationFrame(codeTopScannerTick);
    }catch(err){
      var msg = (err && err.message) ? err.message : 'No se pudo abrir la cámara.';
      $('#posinv_code_topscan_status').text(msg);
    }
  }

  function wireCodeBarcodeSave(){
    $("#posinv_code_results .posinv-code-barcode").off('focus').on('focus', function(){
      this.dataset.prev = String(this.value || '').trim();
    });

    $("#posinv_code_results .posinv-code-barcode").off('input change').on('input change', function(){
      var id = _bcNormId(this.dataset.id);
      var val = String(this.value || '').trim();
      clearTimeout(__codeSaveTimer[id]);
      var $st = $("#posinv_code_results .posinv-code-barcode-status[data-id='"+id+"']");
      if($st.length){ $st.text('…'); }
      refreshCodeSelectedFromField(id);
      __codeSaveTimer[id] = setTimeout(function(){
        saveCodeBarcodeValue(id, val, { updateField:false });
      }, 450);
    });
  }

  function codeSearch(opts){
    opts = opts || {};
    var append = !!opts.append;
    var q = String(opts.q != null ? opts.q : ($("#posinv_code_search").val() || '')).trim();
    var cat = String(opts.cat != null ? opts.cat : ($("#posinv_code_cat").val() || ''));
    var offset = append ? (__codeSearchState.offset || 0) : 0;
    if(!q && !cat){
      __codeSearchState = { q:'', cat:'', offset:0, perPage:30, hasMore:false, loading:false };
      $("#posinv_code_results").html('<div class="posinv-bc-hint">Escribe algo o elige una categoría.</div>');
      return;
    }
    __codeSearchState.q = q;
    __codeSearchState.cat = cat;
    __codeSearchState.loading = true;
    renderCodeLoadMore();
    if(!append){
      $("#posinv_code_results").html('<div class="posinv-bc-hint">Buscando…</div>');
    }

    return $.post(POSINV_BARCODES.ajaxurl, {
      action: 'posinv_barcode_search',
      nonce: POSINV_BARCODES.nonce,
      q: q,
      cat: cat,
      module: 'codigo',
      per_page: __codeSearchState.perPage,
      offset: offset,
      store: (window.POSINV && window.POSINV.store ? window.POSINV.store : ($("#posinvStore").val()||''))
    }, function(resp){
      __codeSearchState.loading = false;
      if(resp && resp.success){
        var payload = resp.data || {};
        var items = getCodeResponseItems(payload);
        __codeSearchState.hasMore = !!(payload && payload.has_more);
        __codeSearchState.offset = (payload && typeof payload.next_offset !== 'undefined') ? parseInt(payload.next_offset,10)||0 : (offset + items.length);
        renderCodeResults(items, append);
      }else{
        __codeSearchState.hasMore = false;
        renderCodeLoadMore();
        $("#posinv_code_results").html('<div class="posinv-bc-hint">Error: ' + (resp && resp.data && resp.data.message ? resp.data.message : 'no se pudo buscar') + '</div>');
      }
    }).fail(function(){
      __codeSearchState.loading = false;
      __codeSearchState.hasMore = false;
      renderCodeLoadMore();
      $("#posinv_code_results").html('<div class="posinv-bc-hint">Error al buscar.</div>');
    });
  }

  // Eventos de la pestaña Código
  $(document).on('click', '#posinv_code_btn_scan', function(e){
    e.preventDefault();
    openCodeTopScanner();
  });

  $(document).on('click', '#posinv_code_topscan_close', function(e){
    e.preventDefault();
    stopCodeTopScanner();
  });

  $(document).on('click', '#posinv_code_btn_search', function(e){
    e.preventDefault();
    stopCodeTopScanner();
    codeSearch({ append:false });
  });
  $(document).on('change', '#posinv_code_cat', function(){
    codeSearch({ append:false, cat: ($(this).val()||''), q: ($("#posinv_code_search").val()||'') });
  });
  // Búsqueda automática (tablet / pistola / teclado)
  var __codeSearchTimer = null;
  function _scheduleCodeSearch(){
    clearTimeout(__codeSearchTimer);
    __codeSearchTimer = setTimeout(function(){
      var q = String($("#posinv_code_search").val() || '').trim();
      // Si es escaneo numérico o ya hay 2+ chars, busca sin necesidad de botón
      if(q && (q.length >= 2 || /^\d{3,}$/.test(q))){
        codeSearch({ append:false });
      }
    }, 220);
  }

  $(document).on('input', '#posinv_code_search', function(){
    _scheduleCodeSearch();
  });

  $(document).on('click', '#posinv_code_load_more', function(e){
    e.preventDefault();
    if(__codeSearchState.loading || !__codeSearchState.hasMore) return;
    codeSearch({ append:true, q:__codeSearchState.q, cat:__codeSearchState.cat });
  });

  $(document).on('change', '.posinv-code-sel', function(){
    var id = _bcNormId($(this).data('id'));
    var name = decodeEntities(String($(this).data('name') || ''));
    if(this.checked){
      var qty = parseInt($("#posinv_code_results .posinv-code-qty[data-id='"+id+"']").val(), 10) || 1;
      qty = Math.max(1, qty);
      POSINV_CODE_QUEUE[id] = {id:id, name:name, barcode:_codeCurrentBarcode(id), qty:qty};
      setCodeSelected({ id:id, name:name, barcode:_codeCurrentBarcode(id) });
    }else{
      delete POSINV_CODE_QUEUE[id];
      if(window.POSINV_CODE_SELECTED && String(window.POSINV_CODE_SELECTED.id) === id){
        window.POSINV_CODE_SELECTED = null;
      }
    }
    _codeUpdateQueueUI();
  });

  $(document)
    .on('focus click', '.posinv-code-qty', function(){
      try{ this.select(); }catch(e){}
    })
    .on('input', '.posinv-code-qty', function(){
      var id = _bcNormId($(this).data('id'));
      var raw = String($(this).val() || '').trim();
      if(raw === '') return; // permitir vacío temporal para reemplazar el 1
      var qty = parseInt(raw, 10);
      if(isNaN(qty)) return;
      if(qty < 1) qty = 1;
      $(this).val(qty);
      if(POSINV_CODE_QUEUE[id]){
        POSINV_CODE_QUEUE[id].qty = qty;
      }
    })
    .on('change blur', '.posinv-code-qty', function(){
      var id = _bcNormId($(this).data('id'));
      var raw = String($(this).val() || '').trim();
      var qty = parseInt(raw, 10);
      if(isNaN(qty) || qty < 1) qty = 1;
      $(this).val(qty);
      if(POSINV_CODE_QUEUE[id]){
        POSINV_CODE_QUEUE[id].qty = qty;
      }
    });

  $(document).on('click', '#posinv_code_clear_selected', function(e){
    e.preventDefault();
    POSINV_CODE_QUEUE = {};
    $('#posinv_code_results .posinv-code-sel').prop('checked', false);
    window.POSINV_CODE_SELECTED = null;
    _codeUpdateQueueUI();
  });

  $(document).on('click', '#posinv_code_btn_print', function(e){
    e.preventDefault();
    doCodePrint();
  });

  $(document).on('click', '#posinv_code_btn_print_android', function(e){
    e.preventDefault();
    doCodePrintAndroid();
  });

  $(document).on('click', '.posinv-code-scan-btn', function(e){
    e.preventDefault();
    openCodeScanner($(this).data('id'), this);
  });

  $(document).on('click', '.posinv-code-scan-close', function(e){
    e.preventDefault();
    stopCodeScanner();
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

})(jQuery);
