(function($){
  let frame = null;

  function setMsg(txt, ok){
    const $el = $('#posinvNuevoMsg');
    $el.text(txt || '');
    $el.css('color', ok ? 'green' : 'crimson');
  }

  function setPreview(url){
    if(!url){
      $('#posinvNuevoImgPreview').hide();
      $('#posinvNuevoImgPreviewTag').attr('src','');
      return;
    }
    $('#posinvNuevoImgPreviewTag').attr('src', url);
    $('#posinvNuevoImgPreview').show();
  }

  $(document).on('click', '#posinvNuevoPickImg', function(e){
    e.preventDefault();

    if(typeof wp === 'undefined' || !wp.media){
      setMsg('No se pudo cargar la librería de medios.', false);
      return;
    }

    if(frame){
      frame.open();
      return;
    }

    frame = wp.media({
      title: 'Selecciona una imagen',
      button: { text: 'Usar esta imagen' },
      multiple: false
    });

    frame.on('select', function(){
      const att = frame.state().get('selection').first().toJSON();
      $('#posinvNuevoImgId').val(att.id || '');
      setPreview(att.url || '');
      setMsg('', true);
    });

    frame.open();
  });

  $(document).on('click', '#posinvNuevoClearImg', function(e){
    e.preventDefault();
    $('#posinvNuevoImgId').val('');
    setPreview('');
    setMsg('Imagen quitada.', true);
  });

  $(document).on('click', '#posinvNuevoCreate', async function(e){
    e.preventDefault();

    const name = ($('#posinvNuevoName').val() || '').trim();
    const priceRaw = ($('#posinvNuevoPrice').val() || '').trim();
    const imageId = ($('#posinvNuevoImgId').val() || '').trim();

    if(!name){
      setMsg('El nombre es obligatorio.', false);
      return;
    }

    const payload = { name };
    if(priceRaw !== ''){
      payload.price = priceRaw;
    }
    if(imageId !== ''){
      payload.image_id = parseInt(imageId, 10);
    }

    setMsg('Creando...', true);

    try{
      const res = await fetch(POSINV_NUEVO.rest + '/create-product', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': POSINV_NUEVO.nonce
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if(!res.ok || data.ok !== true){
        throw new Error((data && (data.message || data.data)) ? (data.message || data.data) : 'Error al crear el producto.');
      }

      setMsg('Producto creado: #' + (data.id || ''), true);

      // reset
      $('#posinvNuevoName').val('');
      $('#posinvNuevoPrice').val('');
      $('#posinvNuevoImgId').val('');
      setPreview('');

    }catch(err){
      setMsg(err.message || 'Error inesperado.', false);
    }
  });

})(jQuery);
