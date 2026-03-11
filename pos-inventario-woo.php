<?php
/**
 * Plugin Name: POS Inventario por Tienda (WooCommerce)
 * Description: Punto de venta interno (sin cobro) para registrar ventas, devoluciones y traspasos con inventario por tienda usando metas _op_qty_warehouse_1860 (San Mateo) y _op_qty_warehouse_1667 (Xaltocán).
 * Version: 0.1.1.124
 * Author: ChatGPT
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * License: GPLv2 or later
 */


// Devuelve el precio en texto plano (sin <span> de WooCommerce). Útil para reportes y tickets.
if (!function_exists('posinv_money_plain_global')) {
    function posinv_money_plain_global($amount) {
        if (!function_exists('wc_price')) {
            return (string) $amount;
        }
        $html = wc_price($amount);
        $txt  = wp_strip_all_tags($html);
        $txt  = html_entity_decode($txt, ENT_QUOTES, 'UTF-8');
        $txt  = str_replace(array("Â ", " "), ' ', $txt);
        $txt  = preg_replace('/\s+/u', ' ', $txt);
        return trim($txt);
    }
}
if (!defined('ABSPATH')) exit;

if (!class_exists("POS_Inventario_Woo")) {
final class POS_Inventario_Woo {
    const VERSION = "0.1.1.124";
    const NS = 'posinv/v1';
    const OPTION = 'posinv_settings';

    public static function init() {
        add_action('init', [__CLASS__, 'register_cpt']);
        add_action('init', [__CLASS__, 'register_shortcodes']);
        add_action('admin_menu', [__CLASS__, 'admin_menu']);
        add_action('admin_init', [__CLASS__, 'register_settings']);
        add_action('rest_api_init', [__CLASS__, 'register_rest']);

        add_action('wp_enqueue_scripts', [__CLASS__, 'register_assets']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'register_assets_admin']);
        add_action('admin_post_posinv_reports_print', [__CLASS__, 'handle_reports_print']);
	        add_action('admin_post_posinv_save_tab_perms', [__CLASS__, 'handle_save_tab_perms']);
        add_action('admin_head', [__CLASS__, 'admin_print_css']);

        add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue_barcodes_admin']);
        add_action('wp_ajax_posinv_barcode_search', [__CLASS__, 'ajax_barcode_search']);
        add_action('wp_ajax_posinv_set_barcode', [__CLASS__, 'ajax_set_barcode']);
        add_action('wp_ajax_posinv_set_price', [__CLASS__, 'ajax_set_price']);
        add_action('wp_ajax_posinv_set_categories', [__CLASS__, 'ajax_set_categories']);
        add_action('wp_ajax_posinv_audit_labels_print', [__CLASS__, 'ajax_audit_labels_print']);
        add_action('wp_ajax_posinv_audit_event', [__CLASS__, 'ajax_audit_event']);

// Inventario (conteo físico)
        add_action('wp_ajax_posinv_inventory_expected', [__CLASS__, 'ajax_inventory_expected']);
        add_action('wp_ajax_posinv_inventory_last_sale', [__CLASS__, 'ajax_inventory_last_sale']);
        add_action('wp_ajax_posinv_inventory_audit', [__CLASS__, 'ajax_inventory_audit']);

        // Bodega (multi-ubicación)
        add_action('wp_ajax_posinv_bodega_list', [__CLASS__, 'ajax_bodega_list']);
        add_action('wp_ajax_posinv_bodega_save', [__CLASS__, 'ajax_bodega_save']);
        add_action('wp_ajax_posinv_bodega_save_bulk', [__CLASS__, 'ajax_bodega_save_bulk']);
	    add_action('wp_ajax_posinv_bodega_delete', [__CLASS__, 'ajax_bodega_delete']);
	    add_action('wp_ajax_posinv_bodega_transfer_bulk', [__CLASS__, 'ajax_bodega_transfer_bulk']);
	        add_action('wp_ajax_posinv_bodega_locations_list', [__CLASS__, 'ajax_bodega_locations_list']);
	        add_action('wp_ajax_posinv_bodega_locations_add', [__CLASS__, 'ajax_bodega_locations_add']);
	        add_action('wp_ajax_posinv_bodega_location_view', [__CLASS__, 'ajax_bodega_location_view']);
	        add_action('wp_ajax_posinv_bodega_update_row', [__CLASS__, 'ajax_bodega_update_row']);
        // Existencias (vista consolidada)
        add_action('wp_ajax_posinv_existencias_search', [__CLASS__, 'ajax_existencias_search']);
        add_action('wp_ajax_posinv_traspaso_search', [__CLASS__, 'ajax_traspaso_search']);
        add_action('wp_ajax_posinv_traspaso_bodega_only', [__CLASS__, 'ajax_traspaso_bodega_only']);
        add_action('wp_ajax_posinv_traspaso_save', [__CLASS__, 'ajax_traspaso_save']);
        add_action('wp_ajax_posinv_traspaso_history', [__CLASS__, 'ajax_traspaso_history']);
        add_action('wp_ajax_posinv_traspaso_clear_history', [__CLASS__, 'ajax_traspaso_clear_history']);
        add_action('wp_ajax_posinv_traspaso_locations', [__CLASS__, 'ajax_traspaso_locations']);
        add_action('wp_ajax_posinv_existencias_bodega_only', [__CLASS__, 'ajax_existencias_bodega_only']);
        add_action('wp_ajax_posinv_existencias_transfer', [__CLASS__, 'ajax_existencias_transfer']);
        register_activation_hook(__FILE__, [__CLASS__, 'activate']);
        register_deactivation_hook(__FILE__, [__CLASS__, 'deactivate']);
    }

    public static function defaults() {
        return [
            'store1_name' => 'San Mateo',
            'store1_meta' => '_op_qty_warehouse_1860',
            'store2_name' => 'Xaltocán',
            'store2_meta' => '_op_qty_warehouse_1667',
            'cost_meta'   => '_pos_cost',
            'barcode_meta'=> '_op_barcode',
            'allow_negative_stock' => '1',
            // Módulos (el admin puede activar/desactivar)
            'enable_stock_in' => '1',
            'enable_create_product' => '1',
            // Panel empleadas + publicación de productos creados desde POS
            'enable_employee_panel' => '1',
            'auto_publish_products' => '1',
            'employees' => [],
            'ticket_paper_mm' => '80',
            'ticket_font_size' => '12',
        ];
    }

    public static function get_settings() {
        $s = get_option(self::OPTION, []);
        return array_merge(self::defaults(), is_array($s) ? $s : []);
    }

    

    // Back-compat alias (some modules call self::settings())
    public static function settings() {
        return self::get_settings();
    }
public static function get_employee_policy($user_id) {
    $s = self::get_settings();
    $panel = !empty($s['enable_employee_panel']);
    $emps = isset($s['employees']) && is_array($s['employees']) ? $s['employees'] : [];
    $row = isset($emps[$user_id]) && is_array($emps[$user_id]) ? $emps[$user_id] : [];

    $active = true;
    if ($panel && !empty($emps)) {
        $active = isset($row['active']) ? (bool) $row['active'] : false;
    }

    $create_status = '';
    if (!empty($row['create_product_status'])) $create_status = $row['create_product_status'];

    return [
        'active' => $active,
        'create_product_status' => $create_status,
    ];
}

public static function activate() {
        // Roles POS (si no existen). Importante: permitir subir archivos para poder tomar/foto desde cámara en la pestaña Nuevo.
        add_role('pos_san_mateo', 'POS - San Mateo', [
            'read' => true,
            'pos_use' => true,
            'upload_files' => true,
        ]);
        add_role('pos_xaltocan', 'POS - Xaltocán', [
            'read' => true,
            'pos_use' => true,
            'upload_files' => true,
        ]);

        // Si los roles ya existían en el sitio, add_role() no actualiza capacidades. Aseguramos upload_files.
        $r1 = get_role('pos_san_mateo');
        if ($r1) {
            $r1->add_cap('upload_files');
	        // Permisos finos Bodega
	        $r1->add_cap('pos_bodega_edit');
	        $r1->add_cap('pos_bodega_transfer');
        }
        $r2 = get_role('pos_xaltocan');
        if ($r2) {
            $r2->add_cap('upload_files');
	        // Permisos finos Bodega
	        $r2->add_cap('pos_bodega_edit');
	        $r2->add_cap('pos_bodega_transfer');
        }

        $admin = get_role('administrator');
        if ($admin) {
            $admin->add_cap('pos_use');
            $admin->add_cap('pos_view_reports');
            $admin->add_cap('pos_manage_settings');
	        // Permisos finos Bodega
	        $admin->add_cap('pos_bodega_edit');
	        $admin->add_cap('pos_bodega_delete');
	        $admin->add_cap('pos_bodega_transfer');
        }
        $sm = get_role('shop_manager');
        if ($sm) {
            $sm->add_cap('pos_use');
            $sm->add_cap('pos_view_reports');
	        // Permisos finos Bodega
	        $sm->add_cap('pos_bodega_edit');
	        $sm->add_cap('pos_bodega_delete');
	        $sm->add_cap('pos_bodega_transfer');
        }

        if (!get_option(self::OPTION)) {
            add_option(self::OPTION, self::defaults());
        }

        self::register_cpt();
        flush_rewrite_rules();
    }

    public static function deactivate() {
        flush_rewrite_rules();
    }

    public static function register_cpt() {
        register_post_type('pos_ticket', [
            'label' => 'Tickets POS',
            'public' => false,
            'show_ui' => false,
            'supports' => ['title', 'author'],
        ]);

        register_post_type('pos_shift', [
            'label' => 'POS Shifts',
            'public' => false,
            'show_ui' => false,
            'supports' => ['title', 'author'],
        ]);


        // Auditoría interna (eventos POS): cambios de precio, movimientos de stock, creación de producto, etc.
        register_post_type('pos_audit', [
            'label' => 'POS Audit',
            'public' => false,
            'show_ui' => false,
            'supports' => ['title', 'author'],
        ]);
    }

    /**
     * Auditoría interna para pruebas y control: guarda eventos como cambios de precio, ajustes de stock, etc.
     * No se muestra en WP por defecto (show_ui=false), pero se consulta desde la página de reportes.
     */
    private static function audit_add($event_type, array $data = []) {
        try {
            $user_id = get_current_user_id();
            $post_id = wp_insert_post([
                'post_type'   => 'pos_audit',
                'post_status' => 'publish',
                'post_title'  => sanitize_text_field($event_type),
                'post_author' => $user_id ? $user_id : 0,
            ], true);

            if (is_wp_error($post_id) || !$post_id) return;

            $payload = array_merge([
                'type' => (string)$event_type,
                'time' => current_time('mysql'),
                'user_id' => $user_id,
                'user' => $user_id ? (wp_get_current_user()->user_login ?? '') : '',
            ], $data);

            update_post_meta($post_id, '_posinv_audit', $payload);
            update_post_meta($post_id, '_posinv_audit_type', (string)$event_type);
        } catch (Throwable $e) {
            // silencio: no bloquear el POS por auditoría
        }
    }

    public static function register_shortcodes() {

        add_shortcode('posinv_visor', [__CLASS__, 'shortcode_visor']);        add_shortcode('pos_inventario', [__CLASS__, 'shortcode_pos']);
    }

    public static function register_assets() {
        $url = plugin_dir_url(__FILE__);
        wp_register_style('posinv_css', $url . 'assets/pos.css', [], self::VERSION);
        wp_register_script('posinv_html5qrcode', 'https://unpkg.com/html5-qrcode@2.3.8/minified/html5-qrcode.min.js', [], self::VERSION, true);
        wp_register_script('posinv_js', $url . 'assets/pos.js', ['posinv_html5qrcode'], self::VERSION, true);

        // Inventario: JS aislado (no toca la búsqueda global)
        wp_register_script('posinv_inventory_js', $url . 'assets/inventory.js', ['posinv_js'], self::VERSION, true);

	    // Bodega: ubicación/cantidad/observaciones por producto (multi-ubicación)
	    wp_register_script('posinv_bodega_js', $url . 'assets/bodega.js', ['posinv_js'], self::VERSION, true);

	    // Ingresos: aumentar stock por tienda (multi-producto)
	    wp_register_script('posinv_ingresos_js', $url . 'assets/ingresos.js', ['posinv_js'], self::VERSION, true);

        // Existencias: vista consolidada (tiendas + bodega)
        wp_register_script('posinv_existencias_js', $url . 'assets/existencias.js', ['posinv_js'], self::VERSION, true);

        // Traspaso: movimientos entre tiendas y bodega
        wp_register_script('posinv_traspaso_js', $url . 'assets/traspaso.js', ['posinv_js'], self::VERSION, true);
    }

    public static function register_assets_admin($hook) {
        self::register_assets();
    }

    public static function current_store_key() {
        $u = wp_get_current_user();
        if (!$u || empty($u->ID)) return null;
        if (in_array('pos_san_mateo', (array)$u->roles, true)) return 'store1';
        if (in_array('pos_xaltocan', (array)$u->roles, true)) return 'store2';
        return 'store1';
    }

    public static function store_meta_for_key($key) {
        $s = self::get_settings();
        if ($key === 'store1') return $s['store1_meta'];
        if ($key === 'store2') return $s['store2_meta'];
        return null;
    }

    /**
     * Compat: algunas partes usan store_meta_key().
     * El nombre “oficial” en este plugin siempre fue store_meta_for_key().
     */
    public static function store_meta_key($key) {
        return self::store_meta_for_key($key);
    }

    public static function store_name_for_key($key) {
        $s = self::get_settings();
        if ($key === 'store1') return $s['store1_name'];
        if ($key === 'store2') return $s['store2_name'];
        return '';
    }

    public static function can_use_pos() {
        return current_user_can('pos_use') || current_user_can('manage_options') || current_user_can('edit_posts');
    }

    // ------------------- Permisos finos: Bodega -------------------
    public static function can_bodega_view() {
        return self::can_use_pos() || current_user_can('pos_manage_settings');
    }
    public static function can_bodega_edit() {
        return current_user_can('pos_bodega_edit') || current_user_can('pos_manage_settings') || current_user_can('manage_options');
    }
    public static function can_bodega_delete() {
        return current_user_can('pos_bodega_delete') || current_user_can('pos_manage_settings') || current_user_can('manage_options');
    }
    public static function can_bodega_transfer() {
        return current_user_can('pos_bodega_transfer') || current_user_can('pos_manage_settings') || current_user_can('manage_options');
    }

    /**
     * Permisos por usuaria para pestañas (se guarda en user_meta: posinv_tabs_allowed).
     * Si no hay configuración, permite todo.
     */
    public static function user_allowed_tabs($user_id = 0) {
        $user_id = $user_id ? (int)$user_id : get_current_user_id();

        // Admin siempre ve todo.
        if (user_can($user_id, 'manage_options')) {
            return ['sale'=>1,'return'=>1,'traspaso'=>1,'ingresos'=>1,'existencias'=>1,'inventory'=>1,'labels'=>1,'codigo'=>1,'bodega'=>1,'nuevo'=>1];
        }

        $allowed = get_user_meta($user_id, 'posinv_tabs_allowed', true);
        // Si no hay configuración, por defecto NO se muestran pestañas sensibles.
        // (Así se habilitan solo para las empleadas seleccionadas.)
        if (!is_array($allowed) || empty($allowed)) {
            return ['sale'=>0,'return'=>0,'traspaso'=>0,'ingresos'=>0,'existencias'=>0,'inventory'=>0,'labels'=>0,'codigo'=>0,'bodega'=>0,'nuevo'=>0];
        }
        $out = ['sale'=>0,'return'=>0,'traspaso'=>0,'ingresos'=>0,'existencias'=>0,'inventory'=>0,'labels'=>0,'codigo'=>0,'bodega'=>0,'nuevo'=>0];
        foreach ($out as $k => $_) {
            $out[$k] = !empty($allowed[$k]) ? 1 : 0;
        }
        return $out;
    }

    public static function handle_save_tab_perms() {
        if (!current_user_can('pos_manage_settings')) wp_die('Sin permisos.');
        check_admin_referer('posinv_save_tab_perms');

        $uids = isset($_POST['uid']) && is_array($_POST['uid']) ? array_map('absint', $_POST['uid']) : [];
        $tabs = ['sale','return','traspaso','ingresos','existencias','inventory','labels','codigo','bodega','nuevo'];

        foreach ($uids as $uid) {
            $allowed = [];
            foreach ($tabs as $t) {
                $allowed[$t] = (isset($_POST['allow']) && isset($_POST['allow'][$uid]) && !empty($_POST['allow'][$uid][$t])) ? 1 : 0;
            }
            update_user_meta($uid, 'posinv_tabs_allowed', $allowed);
        }

        wp_redirect(add_query_arg(['page'=>'posinv-settings','updated'=>'1'], admin_url('admin.php')));
        exit;
    }

    public static function posinv_product_cats_string($product) {
        if (!$product) return '';
        $id = (int) $product->get_id();
        if (method_exists($product, 'is_type') && $product->is_type('variation') && method_exists($product, 'get_parent_id')) {
            $parent_id = (int) $product->get_parent_id();
            if ($parent_id) $id = $parent_id;
        }
        $names = wp_get_post_terms($id, 'product_cat', ['fields' => 'names']);
        if (is_wp_error($names) || empty($names)) return '';
        $names = array_map('sanitize_text_field', $names);
        return implode(', ', $names);
    }

    static function posinv_product_cat_ids($product) {
        if (!$product) return [];
        $id = (int) $product->get_id();
        if (method_exists($product, 'is_type') && $product->is_type('variation') && method_exists($product, 'get_parent_id')) {
            $parent_id = (int) $product->get_parent_id();
            if ($parent_id) $id = $parent_id;
        }
        $ids = wp_get_post_terms($id, 'product_cat', ['fields' => 'ids']);
        if (is_wp_error($ids) || empty($ids)) return [];
        return array_values(array_filter(array_map('intval', (array)$ids)));
    }

    static function posinv_product_primary_cat_id($product) {
        $ids = self::posinv_product_cat_ids($product);
        return !empty($ids) ? (int)$ids[0] : 0;
    }

    public static function posinv_product_price_string($product) {
        if (!$product) return '';
        // SOLO precio numérico (sin símbolo, sin entidades HTML) para UI de tabla.
        $price = $product->get_price();
        if ($price === '' || $price === null) return '';
        $price = wc_format_decimal($price, wc_get_price_decimals());
        return wc_format_localized_price($price);
    }


    public static function shortcode_pos($atts) {
        if (!is_user_logged_in()) {
            return '<div class="posinv-wrap"><p><strong>Inicia sesión</strong> para usar el POS.</p></div>';
        }
        if (!self::can_use_pos()) {
            return '<div class="posinv-wrap"><p>No tienes permisos para usar el POS.</p></div>';
        }

        $settings = self::get_settings();
        $store_key = self::current_store_key();

        wp_enqueue_style('posinv_css');
        wp_enqueue_script('posinv_js');
	    // Inventario (conteo físico) - JS aislado
	    wp_enqueue_script('posinv_inventory_js');
	    wp_localize_script('posinv_inventory_js', 'POSINV_INVENTORY', [
	        'ajaxurl' => admin_url('admin-ajax.php'),
	        'nonce'   => wp_create_nonce('posinv_inventory_nonce'),
	        'rest'    => esc_url_raw(rest_url(self::NS)),
	        'rest_nonce' => wp_create_nonce('wp_rest'),
	        'user_id' => get_current_user_id(),
	        'version' => self::VERSION,
	    ]);

	    // Bodega (multi-ubicación)
	    wp_enqueue_script('posinv_bodega_js');
	    wp_localize_script('posinv_bodega_js', 'POSINV_BODEGA', [
	        'ajaxurl' => admin_url('admin-ajax.php'),
	        'nonce'   => wp_create_nonce('posinv_bodega_nonce'),
	        'rest'    => esc_url_raw(rest_url(self::NS)),
	        'rest_nonce' => wp_create_nonce('wp_rest'),
	        'user_id' => get_current_user_id(),
	        'stores' => [
	            ['key' => 'store1', 'name' => self::store_name_for_key('store1')],
	            ['key' => 'store2', 'name' => self::store_name_for_key('store2')],
	        ],
	        'caps' => [
	            'edit' => self::can_bodega_edit() ? 1 : 0,
	            'delete' => self::can_bodega_delete() ? 1 : 0,
		        ],
	        'version' => self::VERSION,
	    ]);

	    // Ingresos (aumentar stock por tienda)
	    wp_enqueue_script('posinv_ingresos_js');
	    wp_localize_script('posinv_ingresos_js', 'POSINV_INGRESOS', [
	        'rest'    => esc_url_raw(rest_url(self::NS)),
	        'nonce'   => wp_create_nonce('wp_rest'),
	        'version' => self::VERSION,
	    ]);

	    // Existencias (vista consolidada tiendas + bodega)
	    wp_enqueue_script('posinv_existencias_js');
	    wp_localize_script('posinv_existencias_js', 'POSINV_EXISTENCIAS', [
	        'ajaxurl' => admin_url('admin-ajax.php'),
	        'nonce'   => wp_create_nonce('posinv_existencias_nonce'),
	        'version' => self::VERSION,
	    ]);

	    // Traspaso
	    wp_enqueue_script('posinv_traspaso_js');
	    wp_localize_script('posinv_traspaso_js', 'POSINV_TRASPASO', [
	        'ajaxurl' => admin_url('admin-ajax.php'),
	        'nonce'   => wp_create_nonce('posinv_traspaso_nonce'),
	        'stores' => [
	            ['key' => 'store1', 'name' => self::store_name_for_key('store1')],
	            ['key' => 'store2', 'name' => self::store_name_for_key('store2')],
	            ['key' => 'bodega', 'name' => 'Bodega'],
	        ],
	        'version' => self::VERSION,
	    ]);

        // Stock + (entrada) dentro del POS
        wp_enqueue_script('posinv-stockin', plugin_dir_url(__FILE__) . 'assets/stockin.js', ['jquery'], self::VERSION, true);
        wp_localize_script('posinv-stockin', 'POSINV_STOCKIN', [
            'rest'  => esc_url_raw(rest_url(self::NS)),
            'nonce' => wp_create_nonce('wp_rest'),
            'enable_create_product' => !empty($settings['enable_create_product']) ? 1 : 0,
            'version' => self::VERSION,
        ]);

        // Nuevo (crear producto) dentro del POS (pestaña Nuevo)
        if (!empty($settings['enable_create_product'])) {
            wp_enqueue_media();
            wp_enqueue_script('posinv-nuevo', plugin_dir_url(__FILE__) . 'assets/nuevo.js', ['jquery'], self::VERSION, true);
            wp_localize_script('posinv-nuevo', 'POSINV_NUEVO', [
                'rest'  => esc_url_raw(rest_url(self::NS)),
                'nonce' => wp_create_nonce('wp_rest'),
                'version' => self::VERSION,
            ]);
        }


        // Etiquetas (códigos de barras) dentro del POS
        wp_enqueue_style('posinv-barcodes', plugin_dir_url(__FILE__) . 'assets/barcodes.css', [], self::VERSION);

        wp_enqueue_script('posinv-barcodes', plugin_dir_url(__FILE__) . 'assets/barcodes.js', ['jquery'], self::VERSION, true);

        $terms = get_terms([
            'taxonomy' => 'product_cat',
            'hide_empty' => false,
        ]);
        $cats = [];
        if (!is_wp_error($terms)) {
            foreach ($terms as $t) {
                $cats[] = ['id' => (int)$t->term_id, 'name' => $t->name];
            }
        }

        wp_localize_script('posinv-barcodes', 'POSINV_BARCODES', [
            'ajaxurl' => admin_url('admin-ajax.php'),
            'nonce'   => wp_create_nonce('posinv_barcodes_nonce'),
            'product_cats' => $cats,
        ]);

        $data = [
            'rest' => esc_url_raw(rest_url(self::NS)),
            'nonce' => wp_create_nonce('wp_rest'),
            'settings' => [
                'store1_name' => $settings['store1_name'],
                'store2_name' => $settings['store2_name'],
                'role_store_locked' => (in_array('pos_san_mateo', wp_get_current_user()->roles, true) || in_array('pos_xaltocan', wp_get_current_user()->roles, true)),
                'default_store' => $store_key,
            ],
            'user' => [
                'id' => get_current_user_id(),
                'name' => wp_get_current_user()->display_name,
                'roles' => wp_get_current_user()->roles,
            ],
        ];
        wp_localize_script('posinv_js', 'POSINV', $data);

        ob_start();
	        $tabs_allowed = self::user_allowed_tabs(get_current_user_id());
        ?>
        <div class="posinv-wrap" data-version="<?php echo esc_attr(self::VERSION); ?>">
            <div class="posinv-topbar">
                <div class="posinv-title">
                    <strong>POS Inventario</strong> <span class="posinv-version">v<?php echo esc_html(self::VERSION); ?></span>
                    <span class="posinv-muted">sin cobro • ventas / devoluciones</span>
                </div>
                <div class="posinv-user">
                    <span class="posinv-pill"><?php echo esc_html(wp_get_current_user()->display_name); ?></span>
                    <a class="posinv-link" href="<?php echo esc_url(wp_logout_url(get_permalink())); ?>">Salir</a>
                </div>
            </div>

            <div class="posinv-controls">
                <div class="posinv-row">
                    <label>Tienda</label>
                    <select id="posinvStore"></select>
                    <button class="posinv-btn" id="posinvSyncBtn" type="button" title="Sincronizar operaciones pendientes (offline)">Sync</button>
                    <span id="posinvNet" class="posinv-muted"></span>
                </div>

	                <div class="posinv-tabs">
                    <?php
                    $tab_order = [
                        'sale' => ['label' => 'Caja', 'enabled' => true],
                        'return' => ['label' => 'Devolución', 'enabled' => true],
                        'traspaso' => ['label' => 'Traspaso', 'enabled' => true],
                        'nuevo' => ['label' => 'Nuevo', 'enabled' => !empty($settings['enable_create_product'])],
                        'ingresos' => ['label' => 'Ingresos', 'enabled' => true],
                        'existencias' => ['label' => 'Existencias', 'enabled' => true],
                        'inventory' => ['label' => 'Inventario', 'enabled' => true],
                        'labels' => ['label' => 'Etiquetas', 'enabled' => true],
                        'codigo' => ['label' => 'Código', 'enabled' => true],
                        'bodega' => ['label' => 'Bodega', 'enabled' => true],
                    ];
                    $first_tab = '';
                    foreach ($tab_order as $k => $t) {
                        if (!empty($t['enabled']) && !empty($tabs_allowed[$k])) { $first_tab = $k; break; }
                    }
                    if (empty($first_tab)) {
                        echo '<div class="posinv-muted" style="padding:10px 0;">No tienes pestañas habilitadas. Pide al administrador que te otorgue permisos en POS Inventario → Ajustes.</div>';
                    } else {
                        foreach ($tab_order as $k => $t) {
                            if (empty($t['enabled']) || empty($tabs_allowed[$k])) continue;
                            $cls = 'posinv-tab' . ($k === $first_tab ? ' is-active' : '');
                            echo '<button class="' . esc_attr($cls) . '" data-tab="' . esc_attr($k) . '" type="button">' . esc_html($t['label']) . '</button>';
                        }
                    }
                    ?>
                </div>
            </div>

            <div class="posinv-grid" id="posinvMainGrid">
                <div class="posinv-panel">
                    <div class="posinv-search">
                        <input id="posinvQuery" type="text" placeholder="Escanea / escribe SKU, nombre o código..." autocomplete="off"/>
                        <select id="posinvCat" class="posinv-cat">
    <option value="">Todas las categorías</option>
    <?php
    $terms = get_terms([
        'taxonomy' => 'product_cat',
        'hide_empty' => false,
    ]);
    if (!is_wp_error($terms)) {
        foreach ($terms as $t) {
            echo '<option value="' . esc_attr($t->term_id) . '">' . esc_html($t->name) . '</option>';
        }
    }
    ?>
</select>
                        <button class="posinv-btn" id="posinvSearchBtn" type="button">Buscar</button>
                        <button class="posinv-btn posinv-btn-ghost" id="posinvScanBtn" type="button" title="Escanear con cámara">📷 Escanear</button>
                    </div>

                    <div class="posinv-modal" id="posinvScanModal" aria-hidden="true">
                      <div class="posinv-modal-card">
                        <div class="posinv-modal-head">
                          <strong>Escanear código</strong>
                          <button class="posinv-btn posinv-btn-ghost" id="posinvScanClose" type="button">Cerrar</button>
                        </div>
                        <div id="posinvScanReader" class="posinv-scan-reader"></div>
                        <div class="posinv-muted">Cuando detecte un código, se llenará la búsqueda automáticamente.</div>
                      </div>
                    </div>

                    <div class="posinv-results" id="posinvResults">
                        <div class="posinv-muted">Busca productos para agregar.</div>
                    </div>
                </div>

                <div class="posinv-panel">
                    <div class="posinv-shift" id="posinvShiftBox" style="display:none;">
                      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                        <strong>Turno / Corte</strong>
                        <span class="posinv-muted" id="posinvShiftStatus"></span>
                      </div>
                      <div class="posinv-shift-grid">
                        <div>
                          <label class="posinv-muted">Fondo inicial</label>
                          <input id="posinvShiftOpenAmount" type="number" step="0.01" min="0" placeholder="0.00" />
                          <button class="posinv-btn posinv-btn-ghost" id="posinvShiftOpenBtn" type="button">Abrir turno</button>
                        </div>
                        <div>
                          <label class="posinv-muted">Retiros</label>
                          <input id="posinvShiftWithdrawAmount" type="number" step="0.01" min="0" placeholder="0.00" />
                          <button class="posinv-btn posinv-btn-ghost" id="posinvShiftWithdrawBtn" type="button">Registrar retiro</button>
                        </div>
                        <div>
                          <label class="posinv-muted">Cierre (efectivo contado)</label>
                          <input id="posinvShiftCloseAmount" type="number" step="0.01" min="0" placeholder="0.00" />
                          <button class="posinv-btn posinv-btn-ghost" id="posinvShiftCloseBtn" type="button">Cerrar turno</button>
                        </div>
                      </div>
                      <div class="posinv-shift-sum">
                        <span class="posinv-muted">Esperado efectivo:</span> <strong id="posinvShiftExpected">$0.00</strong>
                        <span class="posinv-muted" style="margin-left:10px;">Diferencia:</span> <strong id="posinvShiftDiff">$0.00</strong>
                      </div>
                      <div class="posinv-shift-sum posinv-shift-salesby">
                        <span class="posinv-muted">Ventas:</span> <strong id="posinvShiftSalesTotal">$0.00</strong>
                        <span class="posinv-muted" style="margin-left:10px;">Efectivo:</span> <strong id="posinvShiftSalesCash">$0.00</strong>
                        <span class="posinv-muted" style="margin-left:10px;">Transferencia:</span> <strong id="posinvShiftSalesTransfer">$0.00</strong>
                        <span class="posinv-muted" style="margin-left:10px;">Terminal:</span> <strong id="posinvShiftSalesCard">$0.00</strong>
                      </div>

                      <div class="posinv-modal" id="posinvShiftWithdrawModal" aria-hidden="true">
                        <div class="posinv-modal-card">
                          <div class="posinv-modal-head">
                            <strong>Registrar retiro</strong>
                            <button class="posinv-btn posinv-btn-ghost" id="posinvShiftWithdrawClose" type="button">Cerrar</button>
                          </div>
                          <div class="posinv-row">
                            <label>Monto</label>
                            <input id="posinvShiftWithdrawAmountMirror" type="number" step="0.01" min="0" placeholder="0.00" readonly />
                          </div>
                          <div class="posinv-row" style="margin-top:10px;">
                            <label>Concepto del retiro</label>
                            <input id="posinvShiftWithdrawConcept" type="text" placeholder="Escribe el motivo del retiro" />
                          </div>
                          <div class="posinv-cart-actions" style="margin-top:12px;justify-content:flex-end;">
                            <button class="posinv-btn posinv-btn-ghost" id="posinvShiftWithdrawCancel" type="button">Cancelar</button>
                            <button class="posinv-btn" id="posinvShiftWithdrawSave" type="button">Guardar retiro</button>
                          </div>
                        </div>
                      </div>

                      <div class="posinv-modal" id="posinvShiftReportModal" aria-hidden="true">
                        <div class="posinv-modal-card posinv-shift-report-card">
                          <div class="posinv-modal-head">
                            <strong>Informe de cierre</strong>
                            <button class="posinv-btn posinv-btn-ghost" id="posinvShiftReportClose" type="button">Cerrar</button>
                          </div>
                          <div id="posinvShiftReportBody" class="posinv-shift-report-body"></div>
                        </div>
                      </div>
                    </div>

                    <div class="posinv-cart-head">
                        <strong id="posinvModeTitle">Venta</strong>
                        <div class="posinv-cart-actions">
                            <button class="posinv-btn posinv-btn-ghost" id="posinvClear" type="button">Vaciar</button>
                            <button class="posinv-btn" id="posinvPrintLast" type="button">Imprimir último</button>
                            <button class="posinv-btn" id="posinvPrintLastAndroid" type="button">Imprimir último (App)</button>
                        </div>
                    </div>

                    <div class="posinv-cart" id="posinvCart"></div>

                    <div class="posinv-totals">

                    <div class="posinv-row" id="posinvDiscountBox" style="display:none !important;">
                      <label>Descuento al ticket</label>
                      <div class="posinv-discount-row">
                        <select id="posinvTicketDiscType">
                          <option value="none">Sin descuento</option>
                          <option value="percent">%</option>
                          <option value="amount">$</option>
                        </select>
                        <input id="posinvTicketDiscValue" type="number" step="0.01" min="0" value="0" />
                      </div>
                    </div>

                    <div class="posinv-row" id="posinvPayBox" style="display:none;">
                      <label>Método de pago</label>
                      <div class="posinv-pay-row">
                        <button class="posinv-btn posinv-btn-ghost posinv-pay-open" id="posinvPayOpen" type="button">Efectivo</button>
                        <input id="posinvPayMethod" type="hidden" value="cash" />
                      </div>
                      <div class="posinv-muted" id="posinvPaySummaryText" style="margin-top:6px;">Pago único: Efectivo</div>

                      <div class="posinv-modal" id="posinvPayModal" aria-hidden="true">
                        <div class="posinv-modal-card posinv-pay-modal-card">
                          <div class="posinv-modal-head">
                            <strong>Método de pago</strong>
                            <button class="posinv-btn posinv-btn-ghost" id="posinvPayClose" type="button">Cerrar</button>
                          </div>

                          <div class="posinv-row" style="margin-top:10px;">
                            <label>Selecciona cómo se pagó</label>
                            <div class="posinv-pay-options" id="posinvPayOptions">
                              <button class="posinv-btn posinv-btn-ghost posinv-pay-choice" data-pay-choice="cash" type="button">Efectivo</button>
                              <button class="posinv-btn posinv-btn-ghost posinv-pay-choice" data-pay-choice="transfer" type="button">Transferencia</button>
                              <button class="posinv-btn posinv-btn-ghost posinv-pay-choice" data-pay-choice="card" type="button">Terminal</button>
                              <button class="posinv-btn posinv-btn-ghost posinv-pay-choice" data-pay-choice="mixed2" type="button">2 formas de pago</button>
                              <button class="posinv-btn posinv-btn-ghost posinv-pay-choice" data-pay-choice="mixed3" type="button">3 formas de pago</button>
                            </div>
                            <input id="posinvPayMode" type="hidden" value="cash" />
                            <select id="posinvPayParts" style="display:none;">
                              <option value="1">1 pago</option>
                              <option value="2">2 pagos</option>
                              <option value="3">3 pagos</option>
                            </select>
                          </div>

                          <div class="posinv-pay-split-wrap">
                            <div class="posinv-pay-split-row" data-pay-row="1">
                              <select id="posinvPayMethod1">
                                <option value="cash">Efectivo</option>
                                <option value="transfer">Transferencia</option>
                                <option value="card">Tarjeta / terminal</option>
                              </select>
                              <input id="posinvPayAmount1" type="number" step="0.01" min="0" placeholder="Monto 1" />
                            </div>
                            <div class="posinv-pay-split-row" data-pay-row="2" style="display:none;">
                              <select id="posinvPayMethod2">
                                <option value="transfer">Transferencia</option>
                                <option value="cash">Efectivo</option>
                                <option value="card">Tarjeta / terminal</option>
                              </select>
                              <input id="posinvPayAmount2" type="number" step="0.01" min="0" placeholder="Monto 2" />
                            </div>
                            <div class="posinv-pay-split-row" data-pay-row="3" style="display:none;">
                              <select id="posinvPayMethod3">
                                <option value="card">Tarjeta / terminal</option>
                                <option value="cash">Efectivo</option>
                                <option value="transfer">Transferencia</option>
                              </select>
                              <input id="posinvPayAmount3" type="number" step="0.01" min="0" placeholder="Monto 3" />
                            </div>
                          </div>

                          <div class="posinv-muted" id="posinvPayMixedHint" style="margin-top:8px;"></div>

                          <div class="posinv-cart-actions" style="margin-top:12px;justify-content:flex-end;">
                            <button class="posinv-btn posinv-btn-ghost" id="posinvPayCancel" type="button">Cancelar</button>
                            <button class="posinv-btn" id="posinvPaySave" type="button">Guardar</button>
                          </div>
                        </div>
                      </div>
                    </div>


                    <div class="posinv-modal" id="posinvPriceModal" aria-hidden="true">
                      <div class="posinv-modal-card">
                        <div class="posinv-modal-head">
                          <strong>Cambiar precio</strong>
                          <button class="posinv-btn posinv-btn-ghost" id="posinvPriceClose" type="button">Cerrar</button>
                        </div>
                        <div class="posinv-row">
                          <label>Nuevo precio</label>
                          <input id="posinvPriceValue" type="number" step="0.01" min="0" placeholder="0.00" />
                        </div>
                        <div class="posinv-row" style="margin-top:10px;">
                          <label>Motivo del cambio</label>
                          <input id="posinvPriceReason" type="text" placeholder="Escribe la causa del cambio de precio" />
                        </div>
                        <div class="posinv-cart-actions" style="margin-top:12px;justify-content:flex-end;">
                          <button class="posinv-btn posinv-btn-ghost" id="posinvPriceCancel" type="button">No cambiar precio</button>
                          <button class="posinv-btn" id="posinvPriceSave" type="button">Guardar cambio</button>
                        </div>
                      </div>
                    </div>

                        <div class="posinv-muted" id="posinvLayawaySummary" style="display:none;margin:8px 0 10px;"></div>

                    <div class="posinv-modal" id="posinvLayawayModal" aria-hidden="true">
                      <div class="posinv-modal-card">
                        <div class="posinv-modal-head">
                          <strong>Registrar apartado</strong>
                          <button class="posinv-btn posinv-btn-ghost" id="posinvLayawayClose" type="button">Cerrar</button>
                        </div>
                        <div class="posinv-row">
                          <label>Anticipo / dinero que deja</label>
                          <input id="posinvLayawayDeposit" type="number" step="0.01" min="0" placeholder="0.00" />
                        </div>
                        <div class="posinv-cart-actions" style="margin-top:12px;justify-content:flex-end;">
                          <button class="posinv-btn posinv-btn-ghost" id="posinvLayawayCancel" type="button">Cancelar</button>
                          <button class="posinv-btn" id="posinvLayawaySave" type="button">Guardar apartado</button>
                        </div>
                      </div>
                    </div>

                    <div class="posinv-row" id="posinvCustomerBox">
                          <label>Cliente</label>
                          <div class="posinv-customer-row">
                            <input id="posinvCustomerDisplay" type="text" placeholder="Selecciona un cliente" readonly />
                            <button class="posinv-btn posinv-btn-ghost" id="posinvCustomerFind" type="button">Buscar</button>
                            <button class="posinv-btn posinv-btn-ghost" id="posinvCustomerQuick" type="button">Cliente rápido</button>
                            <button class="posinv-btn posinv-btn-ghost" id="posinvCustomerClear" type="button">Quitar</button>
                          </div>
                          <div class="posinv-customer-quick" id="posinvCustomerQuickBox" style="display:none;">
                            <input id="posinvCustomerQuickName" type="text" placeholder="Nombre" />
                            <input id="posinvCustomerQuickPhone" type="text" placeholder="Teléfono" />
                          </div>
                          <div class="posinv-modal" id="posinvCustomerModal" aria-hidden="true">
                            <div class="posinv-modal-card">
                              <div class="posinv-modal-head">
                                <strong>Buscar cliente</strong>
                                <button class="posinv-btn posinv-btn-ghost" id="posinvCustomerClose" type="button">Cerrar</button>
                              </div>
                              <div class="posinv-bc-toolbar" style="margin-top:6px;">
                                <input id="posinvCustomerQuery" type="text" placeholder="Nombre, correo o teléfono..." autocomplete="off" />
                                <button class="posinv-btn" id="posinvCustomerDoSearch" type="button">Buscar</button>
                              </div>
                              <div id="posinvCustomerResults" class="posinv-bc-results" style="margin-top:8px;max-height:50vh;overflow:auto;"></div>
                            </div>
                          </div>
                        
                        <div class="posinv-row" id="posinvReturnBox" style="display:none;">
                          <label>Devolución</label>
                          <div class="posinv-return-row">
                            <input id="posinvReturnRef" type="text" placeholder="Folio / QR / ID del ticket original" autocomplete="off" />
                            <button class="posinv-btn posinv-btn-ghost" id="posinvReturnFind" type="button">Buscar ticket</button>
                            <button class="posinv-btn posinv-btn-ghost" id="posinvReturnLoad" type="button" title="Cargar productos del ticket encontrado">Cargar productos</button>
                          </div>
                          <div class="posinv-return-summary" id="posinvReturnSummary"></div>

                          <div class="posinv-return-grid">
                            <div>
                              <label class="posinv-muted">Motivo</label>
                              <select id="posinvReturnReason">
                                <option value="defectuoso">Defectuoso</option>
                                <option value="cambio">Cambio</option>
                                <option value="error_cobro">Error de cobro</option>
                                <option value="no_lo_quiso">No lo quiso</option>
                                <option value="otro">Otro</option>
                              </select>
                              <input id="posinvReturnReasonOther" type="text" placeholder="Especifica el motivo..." style="display:none;margin-top:6px;" />
                            </div>
                            <div>
                              <label class="posinv-muted">Tipo</label>
                              <select id="posinvReturnType">
                                <option value="inventory">Regresa a inventario</option>
                                <option value="merma">Merma (NO vuelve a stock)</option>
                              </select>
                              <div class="posinv-muted" id="posinvReturnTypeHint" style="margin-top:6px;"></div>
                            </div>
                          </div>
                        </div>

</div>

                        <div class="posinv-row posinv-row-split">
                            <div>
                                <div class="posinv-muted">Subtotal</div>
                                <div id="posinvSubtotal" class="posinv-money">$0.00</div>
                            </div>
                            <div>
                                <div class="posinv-muted">Total</div>
                                <div id="posinvTotal" class="posinv-money">$0.00</div>
                            </div>
                        </div>
                        <div class="posinv-row">
                            <button class="posinv-btn posinv-btn-primary" id="posinvCommit" type="button">Registrar</button>
                        </div>
                        <div id="posinvMsg" class="posinv-msg"></div>

                    <div class="posinv-modal" id="posinvNoticeModal" aria-hidden="true">
                      <div class="posinv-modal-card posinv-notice-card">
                        <div class="posinv-modal-head">
                          <strong id="posinvNoticeTitle">Aviso</strong>
                          <button class="posinv-btn posinv-btn-ghost" id="posinvNoticeClose" type="button">Cerrar</button>
                        </div>
                        <div id="posinvNoticeBody" class="posinv-notice-body"></div>
                        <div class="posinv-cart-actions" style="margin-top:12px;justify-content:flex-end;">
                          <button class="posinv-btn" id="posinvNoticeOk" type="button">Entendido</button>
                        </div>
                      </div>
                    </div>
                    </div>
                </div>
            </div>


            <?php if (!empty($settings['enable_stock_in'])) : ?>
            <div class="posinv-stockin-view" id="posinvStockInView" style="display:none;">
    <div class="posinv-labels-head">
        <strong>Stock + (entrada)</strong>
        <span class="posinv-muted">• solo afecta a la tienda seleccionada</span>
    </div>

    <div class="posinv-bc-toolbar posinv-si-toolbar">
        <input type="text" id="posinv_si_search" placeholder="Escanea / escribe SKU, nombre o ID…" />
        <select id="posinv_si_category"><option value="">Todas las categorías</option></select>
        <button class="posinv-btn" id="posinv_si_btn_scan" type="button" title="Escanear con cámara">📷</button>
        <button class="posinv-btn" id="posinv_si_btn_search" type="button">Buscar</button>
    </div>

    <div class="posinv-si-split"><?php if (!empty($tabs_allowed['ingresos'])) : ?><?php if (!empty($tabs_allowed['existencias'])) : ?><?php if (!empty($tabs_allowed['bodega'])) : ?>



        <!-- Columna 1: aumentar stock -->
        <div class="posinv-si-stockbox">
            <div class="posinv-create-title" style="margin:6px 0 10px;">Aumentar stock de producto existente</div>

            <div class="posinv-bc-grid posinv-si-main posinv-si-grid">
                <div class="posinv-bc-results" id="posinv_si_results">
                    <div class="posinv-muted">Busca productos para agregar stock.</div>
                </div>

                <div class="posinv-bc-preview">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <strong>Cola</strong>
                        <button class="posinv-btn posinv-btn-ghost" id="posinv_si_clear" type="button">Vaciar</button>
                    </div>
                    <div id="posinv_si_cart" class="posinv-si-cart"><div class="posinv-muted">Sin productos.</div></div>

                    <div style="margin-top:10px;display:flex;gap:10px;">
                        <button class="posinv-btn posinv-btn-primary" id="posinv_si_commit" type="button">Agregar stock</button>
                    </div>
                </div>
            </div>
        </div>
<?php endif; ?>

<?php endif; ?>

<?php endif; ?>


        <!-- Columna 2: crear producto -->
        <?php if (true) : ?>
        <div class="posinv-si-createcol">
            <div class="posinv-create-title" style="margin:6px 0 10px;">Crear producto nuevo (para WooCommerce)</div>

            <label class="posinv-label">Nombre</label>
            <input class="posinv-input" id="posinv_si_new_name" type="text" placeholder="Nombre del producto" />

            <label class="posinv-label" style="margin-top:8px;">Precio</label>
            <input class="posinv-input" id="posinv_si_new_price" type="number" step="0.01" min="0" value="0.00" />

            <label class="posinv-label" style="margin-top:8px;">Categoría</label>
            <select class="posinv-select" id="posinv_si_new_cat"><option value="">— Selecciona —</option></select>

            <label class="posinv-label" style="margin-top:8px;">Stock inicial (solo tienda)</label>
            <input class="posinv-input" id="posinv_si_new_stock" type="number" step="1" min="0" value="0" />

            <label class="posinv-label" style="margin-top:8px;">Imagen</label>
            <div class="posinv-photo-row">
                <button type="button" id="posinv_si_new_take" class="posinv-btn posinv-btn-primary">Tomar foto</button>
                <button type="button" id="posinv_si_new_pick" class="posinv-btn posinv-btn-primary">Elegir de galería</button>
                <input id="posinv_si_new_file_cam" type="file" accept="image/*" capture="environment" style="display:none;" />
                <input id="posinv_si_new_file_gal" type="file" accept="image/*" style="display:none;" />
            </div>
            <div class="posinv-muted" style="margin-top:6px;">En celular normalmente aparecerá opción de tomar foto o elegir de galería.</div>

            <div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                <button class="posinv-btn posinv-btn-primary" id="posinv_si_create" type="button">Crear producto</button>
                <div id="posinv_si_create_status" class="posinv-muted"></div>
            </div>

            <div class="posinv-muted" style="margin-top:12px;font-size:12px;">El ID lo asigna WooCommerce automáticamente. El stock se guarda solo en la tienda seleccionada.</div>
        </div>
        <?php endif; ?>
    </div>
</div></div>
            <?php endif; ?>


            <div class="posinv-traspaso-view" id="posinvTraspasoView" style="display:none;">
                <div class="posinv-labels-head">
                    <strong>Traspaso</strong> <span class="posinv-version">v<?php echo esc_html(self::VERSION); ?></span>
                    <span class="posinv-muted">• mueve productos entre tiendas y bodega</span>
                </div>

                <div class="posinv-bc-toolbar" style="align-items:center;">
                    <input type="text" id="posinv_tras_search" placeholder="Busca por nombre, código, SKU o ID…" autocomplete="off" />
                    <select id="posinv_tras_cat" style="min-width:220px;"></select>
                    <button class="posinv-btn" id="posinv_tras_btn_search" type="button">Buscar</button>
                    <button class="button" id="posinv_tras_btn_scan" type="button" title="Escanear para buscar">📷</button>
                    <button class="posinv-btn posinv-btn-ghost" id="posinv_tras_btn_clear" type="button">Limpiar</button>
                    <button class="posinv-btn" id="posinv_tras_btn_bodega_only" type="button">Solo en bodega</button>
                    <span class="posinv-muted" id="posinv_tras_msg" style="margin-left:10px;"></span>
                </div>

                <div id="posinv_tras_topscan" class="posinv-code-topscan" style="display:none; margin-bottom:12px;">
                    <div class="posinv-code-scan-box">
                        <div class="posinv-code-scan-head">
                            <strong>Escanear para buscar</strong>
                            <button type="button" class="button" id="posinv_tras_topscan_close">Cerrar</button>
                        </div>
                        <div class="posinv-code-scan-help">Apunta la cámara al código. Cuando se confirme 2 veces, se buscará automáticamente.</div>
                        <div class="posinv-code-scan-video" id="posinv_tras_topscan_video"></div>
                        <div class="posinv-code-scan-status" id="posinv_tras_topscan_status">Abriendo cámara…</div>
                    </div>
                </div>

                <div class="posinv-bc-tablewrap" style="margin-top:16px; overflow-x:auto;">
                    <table class="posinv-bc-table" id="posinv_tras_table">
                        <thead>
                            <tr>
                                <th style="width:60px;">Img</th>
                                <th style="width:90px;">ID</th>
                                <th style="width:160px;">Código</th>
                                <th>Producto</th>
                                <th style="width:120px;">San Mateo</th>
                                <th style="width:120px;">Xaltocán</th>
                                <th style="width:120px;">Bodega</th>
                                <th style="width:280px;">Ubicación bodega</th>
                                <th style="width:120px;">Total</th>
                                <th style="width:130px;">Acción</th>
                            </tr>
                        </thead>
                        <tbody id="posinv_tras_tbody">
                            <tr><td colspan="10" class="posinv-muted">Busca un producto para preparar un traspaso…</td></tr>
                        </tbody>
                    </table>
                </div>
                <div class="posinv-loadmore-wrap" id="posinv_tras_loadmore_wrap" style="display:none; margin-top:14px; text-align:center;">
                    <button class="posinv-btn" id="posinv_tras_loadmore" type="button">Cargar más</button>
                </div>

                <div class="posinv-bc-results" id="posinv_tras_legacy_form" style="display:none; margin-top:16px;">
                    <div class="posinv-labels-head" style="margin-bottom:8px;">
                        <strong>Registrar traspaso</strong>
                        <span class="posinv-muted">• formulario legado oculto</span>
                    </div>
                    <div class="posinv-bc-toolbar" style="display:grid;grid-template-columns:1.2fr repeat(4,minmax(140px,1fr));gap:10px;align-items:end;">
                        <div>
                            <label class="posinv-muted">Producto</label>
                            <div id="posinv_tras_selected" class="posinv-muted">Ninguno seleccionado</div>
                            <input type="hidden" id="posinv_tras_product_id" />
                        </div>
                        <div>
                            <label class="posinv-muted">Origen</label>
                            <select id="posinv_tras_origin">
                                <option value="">— Selecciona —</option>
                                <option value="store1">San Mateo</option>
                                <option value="store2">Xaltocán</option>
                                <option value="bodega">Bodega</option>
                            </select>
                        </div>
                        <div>
                            <label class="posinv-muted">Destino</label>
                            <select id="posinv_tras_dest">
                                <option value="">— Selecciona —</option>
                                <option value="store1">San Mateo</option>
                                <option value="store2">Xaltocán</option>
                                <option value="bodega">Bodega</option>
                            </select>
                        </div>
                        <div>
                            <label class="posinv-muted">Cantidad</label>
                            <input id="posinv_tras_qty" type="number" min="1" step="1" placeholder="0" />
                        </div>
                        <div>
                            <label class="posinv-muted">Motivo / observaciones</label>
                            <input id="posinv_tras_note" type="text" placeholder="Obligatorio" />
                        </div>
                    </div>
                    <div class="posinv-bc-toolbar" style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;">
                        <div id="posinv_tras_origin_loc_wrap" style="display:none;">
                            <label class="posinv-muted">Ubicación origen (bodega)</label>
                            <select id="posinv_tras_origin_loc"><option value="">— Selecciona —</option></select>
                        </div>
                        <div id="posinv_tras_dest_loc_wrap" style="display:none;">
                            <label class="posinv-muted">Ubicación destino (bodega)</label>
                            <input id="posinv_tras_dest_loc" type="text" list="posinv_tras_loc_catalog" placeholder="Ej. A1" />
                            <datalist id="posinv_tras_loc_catalog"></datalist>
                        </div>
                        <div style="display:flex;justify-content:flex-end;align-items:end;gap:10px;">
                            <button class="posinv-btn posinv-btn-ghost" id="posinv_tras_btn_reset" type="button">Limpiar formulario</button>
                            <button class="posinv-btn posinv-btn-primary" id="posinv_tras_btn_save" type="button">Guardar traspaso</button>
                        </div>
                    </div>
                </div>

                <div class="posinv-bc-results" style="margin-top:16px;">
                    <div class="posinv-labels-head" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
                        <div>
                            <strong>Historial reciente</strong>
                            <span class="posinv-muted">• últimos traspasos registrados</span>
                        </div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                            <button class="posinv-btn posinv-btn-ghost" id="posinv_tras_hist_save" type="button">Guardar</button>
                            <button class="posinv-btn posinv-btn-ghost" id="posinv_tras_hist_print" type="button">Imprimir</button>
                            <button class="posinv-btn posinv-btn-ghost" id="posinv_tras_hist_clear" type="button">Limpiar todo</button>
                        </div>
                    </div>
                    <div class="posinv-bc-tablewrap" style="overflow-x:auto;">
                        <table class="posinv-bc-table" id="posinv_tras_history_table">
                            <thead>
                                <tr>
                                    <th style="width:140px;">Fecha</th>
                                    <th style="width:90px;">Folio</th>
                                    <th style="width:90px;">ID</th>
                                    <th style="width:160px;">Código</th>
                                    <th>Producto</th>
                                    <th style="width:140px;">Origen</th>
                                    <th style="width:140px;">Destino</th>
                                    <th style="width:100px;">Cantidad</th>
                                    <th style="width:160px;">Usuario</th>
                                    <th style="width:220px;">Motivo</th>
                                </tr>
                            </thead>
                            <tbody id="posinv_tras_history_tbody">
                                <tr><td colspan="10" class="posinv-muted">Sin traspasos registrados todavía.</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="posinv-modal" id="posinv_tras_notice" aria-hidden="true">
                  <div class="posinv-modal-card posinv-notice-card">
                    <div class="posinv-modal-head">
                      <strong id="posinv_tras_notice_title">Aviso</strong>
                      <button class="posinv-btn posinv-btn-ghost" id="posinv_tras_notice_close" type="button">Cerrar</button>
                    </div>
                    <div id="posinv_tras_notice_body" class="posinv-notice-body"></div>
                    <div class="posinv-cart-actions" style="margin-top:12px;justify-content:flex-end;">
                      <button class="posinv-btn" id="posinv_tras_notice_ok" type="button">Entendido</button>
                    </div>
                  </div>
                </div>
            </div>

            <div class="posinv-inventory-view" id="posinvInventoryView" style="display:none;">
                <div class="posinv-labels-head">
                    <strong>Inventario (conteo)</strong>
                    <span class="posinv-muted">• escanea códigos y genera reporte faltantes/sobrantes</span>
                </div>

                <div class="posinv-bc-toolbar" style="align-items:center;">
                    <input type="text" id="posinv_inv_scan" placeholder="Escanea / escribe código (_op_barcode), ID o nombre…" />
                    <button class="button" id="posinv_inv_btn_scan" type="button" title="Escanear para buscar">📷</button>
                    <button class="posinv-btn" id="posinv_inv_btn_new" type="button">Nuevo</button>
                    <button class="posinv-btn" id="posinv_inv_btn_pause" type="button">Pausar</button>
                    <button class="posinv-btn" id="posinv_inv_btn_resume" type="button" style="display:none;">Continuar</button>
                    <button class="posinv-btn" id="posinv_inv_btn_close" type="button">Cerrar &amp; Reporte</button>
                    <button class="posinv-btn posinv-btn-ghost" id="posinv_inv_btn_export" type="button">Exportar CSV</button>
                    <select id="posinv_inv_filter" style="min-width:170px;">
                        <option value="all">Todo</option>
                        <option value="missing">Solo faltantes</option>
                        <option value="extra">Solo sobrantes</option>
                    </select>
                </div>

                <div id="posinvInvMsg" class="posinv-msg" style="margin-top:8px;"></div>

                <div id="posinv_inv_topscan" class="posinv-code-topscan" style="display:none; margin-top:12px; margin-bottom:12px;">
                    <div class="posinv-code-scan-box">
                        <div class="posinv-code-scan-head">
                            <strong>Escanear para buscar</strong>
                            <button type="button" class="button" id="posinv_inv_topscan_close">Cerrar</button>
                        </div>
                        <div class="posinv-code-scan-help">Apunta la cámara al código. Cuando se confirme 2 veces, se buscará automáticamente.</div>
                        <div class="posinv-code-scan-video" id="posinv_inv_topscan_video"></div>
                        <div class="posinv-code-scan-status" id="posinv_inv_topscan_status">Abriendo cámara…</div>
                    </div>
                </div>

                <div class="posinv-bc-grid" style="margin-top:12px;">
                    <div class="posinv-bc-results" style="grid-column: 1 / -1;">
                        <div class="posinv-muted" id="posinv_inv_hint">Selecciona una tienda. Se cargan los productos con existencias; luego escanea para ir contando (cada escaneo suma 1).</div>
                        <!-- Scroll horizontal arriba (útil en tablet) -->
                        <div class="posinv-hscroll-top" id="posinv_inv_hscroll_top" style="overflow-x:auto; overflow-y:hidden; height:14px; margin-top:10px;">
                            <div id="posinv_inv_hscroll_top_inner" style="height:1px;"></div>
                        </div>

                        <div class="posinv-bc-tablewrap" id="posinv_inv_tablewrap" style="margin-top:6px; overflow-x:auto;">
                            <table class="posinv-bc-table" id="posinv_inv_table">
                                <thead>
                                    <tr>
                                        <th style="width:60px;">Img</th>
                                        <th style="width:90px;">ID</th>
                                        <th style="width:160px;">Código</th>
                                        <th>Producto</th>
                                        <th style="width:110px;">Existencias</th>
                                        <th style="width:140px;">Contado</th>
                                        <th style="width:140px;">Diferencia</th>
                                        <th style="width:220px;">Últ. venta (si faltó)</th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="posinv-muted" style="margin-top:10px;font-size:12px;">
                    Consejo: si te equivocas, edita el conteo en la columna “Contado”.
                </div>
            </div>

	            <!-- Bodega (multi-ubicación) -->
	            <div class="posinv-bodega-view" id="posinvBodegaView" style="display:none;">
	                <div class="posinv-labels-head">
	                    <strong>Bodega</strong> <span class="posinv-version">v<?php echo esc_html(self::VERSION); ?></span>
	                    <span class="posinv-muted">• asigna ubicación, cantidad y observaciones por producto (multi-ubicación)</span>
	                </div>

	                <div class="posinv-bc-toolbar" style="align-items:center; gap:10px; flex-wrap:wrap;">
	                    <span class="posinv-muted" style="min-width:90px;">Ubicación:</span>
	                    <select id="posinv_bodega_loc_select" style="min-width:240px;">
	                        <option value="">— Selecciona ubicación —</option>
	                    </select>
	                    <button class="posinv-btn posinv-btn-ghost" id="posinv_bodega_loc_add" type="button">Nueva ubicación</button>
	                    <button class="posinv-btn posinv-btn-ghost" id="posinv_bodega_loc_view" type="button">Ver ubicación</button>
	                    <span class="posinv-muted" id="posinv_bodega_loc_hint">Primero elige la ubicación, después escanea productos.</span>
	                </div>

	                <div id="posinv_bodega_loc_panel" style="display:none;">
	                    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
	                        <strong>Contenido de ubicación:</strong>
	                        <span class="posinv-muted" id="posinv_bodega_loc_panel_title"></span>
	                        <button type="button" class="posinv-btn posinv-btn-ghost" id="posinv_bodega_loc_panel_close">Cerrar</button>
	                        <span class="posinv-muted" id="posinv_bodega_loc_panel_msg"></span>
	                    </div>
	                    <div class="posinv-bc-tablewrap" style="overflow-x:auto;">
	                        <table class="posinv-bc-table" id="posinv_bodega_loc_table" style="margin:0;">
	                            <thead>
	                                <tr>
	                                    <th style="width:60px;">Img</th>
	                                    <th style="width:90px;">ID</th>
	                                    <th style="width:160px;">Código</th>
	                                    <th>Producto</th>
	                                    <th style="width:140px;">Total bodega</th>
	                                <th style="width:120px;">En ubicación</th>
	                                    <th style="width:260px;">Observaciones</th>
	                                    <th style="width:160px;">Guardado</th>
	                                    <th style="width:160px;"></th>
	                                </tr>
	                            </thead>
	                            <tbody>
	                                <tr><td colspan="9" class="posinv-muted">Selecciona una ubicación y presiona “Ver ubicación”.</td></tr>
	                            </tbody>
	                        </table>
	                    </div>
	                </div>

	                <div class="posinv-bc-toolbar" style="align-items:center;">
	                    <input type="text" id="posinv_bodega_search" placeholder="Escanea / escribe código (_op_barcode), ID o nombre…" autocomplete="off" />
	                    <select id="posinv_bodega_cat" style="min-width:220px;">
	                        <option value="">Todas las categorías</option>
	                        <?php
	                        $terms = get_terms(['taxonomy'=>'product_cat','hide_empty'=>false]);
	                        if (!is_wp_error($terms)) {
	                            foreach ($terms as $t) {
	                                echo '<option value="' . esc_attr($t->term_id) . '">' . esc_html($t->name) . '</option>';
	                            }
	                        }
	                        ?>
	                    </select>
	                    <button class="posinv-btn" id="posinv_bodega_btn_search" type="button">Buscar</button>
                    <button class="button" id="posinv_bodega_btn_scan" type="button" title="Escanear para buscar">📷</button>
				    <button class="posinv-btn posinv-btn-ghost" id="posinv_bodega_btn_saveall" type="button">Guardar todo</button>
				    <span class="posinv-muted" style="margin-left:8px;">Traspasos:</span>
				    <select id="posinv_bodega_transfer_store" style="min-width:220px;"></select>
				    <button class="posinv-btn" id="posinv_bodega_btn_send_store" type="button">Enviar a tienda</button>
				    <button class="posinv-btn posinv-btn-ghost" id="posinv_bodega_btn_recv_store" type="button">Recibir de tienda</button>
	                    <span class="posinv-muted" id="posinv_bodega_msg" style="margin-left:10px;"></span>
	                </div>

	                <div class="posinv-muted" style="margin-top:8px;font-size:12px;">
	                    Tip: puedes escanear con pistola/cámara; al guardar se registra fecha/hora automáticamente.
	                </div>

	                
                <div id="posinv_bodega_topscan" class="posinv-code-topscan" style="display:none; margin-bottom:12px;">
                    <div class="posinv-code-scan-box">
                        <div class="posinv-code-scan-head">
                            <strong>Escanear para buscar</strong>
                            <button type="button" class="button" id="posinv_bodega_topscan_close">Cerrar</button>
                        </div>
                        <div class="posinv-code-scan-help">Apunta la cámara al código. Cuando se confirme 2 veces, se buscará automáticamente.</div>
                        <div class="posinv-code-scan-video" id="posinv_bodega_topscan_video"></div>
                        <div class="posinv-code-scan-status" id="posinv_bodega_topscan_status">Abriendo cámara…</div>
                    </div>
                </div>

                <div id="posinv_bodega_results" style="margin-top:10px;"></div>

	                <div class="posinv-hscroll-top" id="posinv_bodega_hscroll_top" style="overflow-x:auto; overflow-y:hidden; height:14px; margin-top:10px;">
	                    <div id="posinv_bodega_hscroll_top_inner" style="height:1px;"></div>
	                </div>

	                <div class="posinv-bc-tablewrap" id="posinv_bodega_tablewrap" style="margin-top:16px; overflow-x:auto;">
	                    <table class="posinv-bc-table" id="posinv_bodega_table">
	                        <thead>
	                            <tr>
	                                <th style="width:60px;">Img</th>
	                                <th style="width:90px;">ID</th>
	                                <th style="width:160px;">Código</th>
	                                <th>Producto</th>
	                                <th style="width:180px;">Ubicación</th>
	                                <th style="width:120px;">Cantidad</th>
	                                <th style="width:260px;">Observaciones</th>
	                                <th style="width:160px;">Guardado</th>
	                                <th style="width:160px;"></th>
	                            </tr>
	                        </thead>
	                        <tbody>
	                            <tr><td colspan="9" class="posinv-muted">Selecciona una ubicación para comenzar…</td></tr>
	                        </tbody>
	                    </table>
	                </div>
	            </div>

	            <!-- Ingresos (aumentar stock por tienda) -->
	            <div class="posinv-ingresos-view" id="posinvIngressView" style="display:none;">
	                <div class="posinv-labels-head">
	                    <strong>Ingresos</strong>
	                    <span class="posinv-muted">• aumenta stock en tienda (por escaneo/búsqueda)</span>
	                </div>

	                <div class="posinv-bc-toolbar" style="align-items:center; gap:10px; flex-wrap:wrap;">
	                    <span class="posinv-muted" style="min-width:70px;">Tienda:</span>
	                    <select id="posinv_ing_store" style="min-width:220px;"></select>
	                    <span class="posinv-muted" id="posinv_ing_store_hint">Escaneando en: —</span>
	                </div>

	                <div class="posinv-bc-toolbar" style="align-items:center;">
	                    <input type="text" id="posinv_ing_search" placeholder="Escanea / escribe código (_op_barcode), ID o nombre…" autocomplete="off" />
	                    <select id="posinv_ing_cat" style="min-width:220px;"></select>
	                    <button class="posinv-btn" id="posinv_ing_btn_search" type="button">Buscar</button>
	                    <button class="button" id="posinv_ing_btn_scan" type="button" title="Escanear para buscar">📷</button>
	                    <button class="posinv-btn posinv-btn-ghost" id="posinv_ing_btn_saveall" type="button">Guardar todo</button>
	                    <button class="posinv-btn posinv-btn-ghost" id="posinv_ing_btn_clear" type="button">Limpiar</button>
	                    <span class="posinv-muted" id="posinv_ing_msg" style="margin-left:10px;"></span>
	                </div>

	                

	                <div id="posinv_ing_topscan" class="posinv-code-topscan" style="display:none; margin-bottom:12px;">
	                    <div class="posinv-code-scan-box">
	                        <div class="posinv-code-scan-head">
	                            <strong>Escanear para buscar</strong>
	                            <button type="button" class="button" id="posinv_ing_topscan_close">Cerrar</button>
	                        </div>
	                        <div class="posinv-code-scan-help">Apunta la cámara al código. Cuando se confirme 2 veces, se buscará automáticamente.</div>
	                        <div class="posinv-code-scan-video" id="posinv_ing_topscan_video"></div>
	                        <div class="posinv-code-scan-status" id="posinv_ing_topscan_status">Abriendo cámara…</div>
	                    </div>
	                </div>

	                <div id="posinv_ing_results" style="margin-top:10px;"></div>

	                <div class="posinv-hscroll-top" id="posinv_ing_hscroll_top" style="overflow-x:auto; overflow-y:hidden; height:14px; margin-top:10px;">
	                    <div id="posinv_ing_hscroll_top_inner" style="height:1px;"></div>
	                </div>

	                <div class="posinv-bc-tablewrap" id="posinv_ing_tablewrap" style="margin-top:16px; overflow-x:auto;">
	                    <table class="posinv-bc-table" id="posinv_ing_table">
	                        <thead>
	                            <tr>
	                                <th style="width:60px;">Img</th>
	                                <th style="width:90px;">ID</th>
	                                <th style="width:160px;">Código</th>
	                                <th>Producto</th>
	                                <th style="width:140px;">Total bodega</th>
	                                <th style="width:120px;">En ubicación</th>
	                                <th style="width:260px;">Observaciones</th>
	                                <th style="width:160px;">Guardado</th>
	                                <th style="width:160px;"></th>
	                            </tr>
	                        </thead>
	                        <tbody>
	                            <tr><td colspan="10" class="posinv-muted">Escanea o busca para agregar productos a los ingresos…</td></tr>
	                        </tbody>
	                    </table>
	                </div>
	            </div>


            
            <?php if (!empty($settings['enable_create_product'])) : ?>
            <div class="posinv-nuevo-view" id="posinvNuevoView" style="display:none;">
                <div class="posinv-labels-head">
                    <strong>Nuevo producto</strong>
                    <span class="posinv-muted">• crea un producto en WooCommerce (nombre obligatorio)</span>
                </div>

                <div class="posinv-card" style="max-width:720px;">
                    <div class="posinv-grid" style="display:grid;grid-template-columns:1fr;gap:10px;">
                        <label class="posinv-muted" style="font-weight:700;">Nombre (obligatorio)</label>
                        <input type="text" id="posinvNuevoName" placeholder="Ej. Agua 1 L" />

                        <label class="posinv-muted" style="font-weight:700;">Precio (opcional)</label>
                        <input type="number" id="posinvNuevoPrice" placeholder="Ej. 25" step="0.01" min="0" />

                        <label class="posinv-muted" style="font-weight:700;">Imagen (opcional)</label>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;">
                            <button type="button" class="posinv-btn" id="posinvNuevoPickImg">Elegir / Subir</button>
                            <button type="button" class="posinv-btn posinv-btn-ghost" id="posinvNuevoClearImg">Quitar</button>
                            <input type="hidden" id="posinvNuevoImgId" value="" />
                        </div>

                        <div id="posinvNuevoImgPreview" style="display:none;margin-top:6px;">
                            <img id="posinvNuevoImgPreviewTag" src="" style="max-width:240px;border-radius:14px;border:1px solid #ddd;" />
                        </div>

                        <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                            <button type="button" class="posinv-btn" id="posinvNuevoCreate">Crear producto</button>
                            <span id="posinvNuevoMsg" class="posinv-muted"></span>
                        </div>
                    </div>
                </div>
            </div>
            <?php endif; ?>

<div class="posinv-labels-view" id="posinvLabelsView" style="display:none;">
                <div class="posinv-labels-head">
                    <strong>Etiquetas (50 × 25 mm)</strong>
                    <span class="posinv-muted">• código = ID de WooCommerce</span>
                </div>

                <div class="posinv-bc-toolbar posinv-bc-toolbar-labels">
                    <input type="text" id="posinv_bc_search" placeholder="Buscar producto por nombre o ID…" />
                    <select id="posinv_bc_cat" style="min-width:220px;">
                        <option value="">Todas las categorías</option>
                        <?php
                        $terms = get_terms(['taxonomy'=>'product_cat','hide_empty'=>false]);
                        if (!is_wp_error($terms)) {
                            foreach ($terms as $t) {
                                echo '<option value="' . esc_attr($t->term_id) . '">' . esc_html($t->name) . '</option>';
                            }
                        }
                        ?>
                    </select>
                    <button class="button" id="posinv_bc_btn_scan" type="button" title="Escanear para buscar">📷</button>
                    <button class="posinv-btn" id="posinv_bc_btn_search" type="button">Buscar</button>
                    <span class="posinv-muted">Copias</span>
                    <input type="number" id="posinv_bc_copies" min="1" max="200" value="1" />
                    <button class="posinv-btn posinv-btn-primary" id="posinv_bc_btn_print" type="button">Imprimir etiqueta(s)</button>
                    <button class="posinv-btn" id="posinv_bc_btn_print_android" type="button">Imprimir (App Android)</button>
                    <span class="posinv-muted" id="posinv_bc_selected_info" style="margin-left:10px;">Seleccionados: 0</span>
                    <button class="posinv-btn" id="posinv_bc_clear_selected" type="button" disabled style="margin-left:6px;">Limpiar selección</button>
                </div>

                <div id="posinv_bc_topscan" class="posinv-code-topscan" style="display:none; margin-bottom:12px;">
                    <div class="posinv-code-scan-box">
                        <div class="posinv-code-scan-head">
                            <strong>Escanear para buscar</strong>
                            <button type="button" class="button" id="posinv_bc_topscan_close">Cerrar</button>
                        </div>
                        <div class="posinv-code-scan-help">Apunta la cámara al código. Cuando se confirme 2 veces, se buscará automáticamente.</div>
                        <div class="posinv-code-scan-video" id="posinv_bc_topscan_video"></div>
                        <div class="posinv-code-scan-status" id="posinv_bc_topscan_status">Abriendo cámara…</div>
                    </div>
                </div>

                <div class="posinv-bc-grid" style="display:block;">
                    <div class="posinv-bc-results" id="posinv_bc_results">
                        <div class="posinv-bc-hint">Busca un producto para generar su etiqueta.</div>
                    </div>

                    <div id="posinv_bc_preview" style="margin-top:14px; max-width:520px;">
                        <div class="posinv-label posinv-label-print">
                            <div class="posinv-label-barcode"><svg id="posinv_bc_svg"></svg></div>
                            <div class="posinv-label-name" id="posinv_bc_name">—</div>
                            <div class="posinv-label-id" id="posinv_bc_id">ID: —</div>
                        </div>

                        <!-- espejo para impresión (lo usa barcodes.js para clonar SVG) -->
                        <div style="position:absolute; left:-9999px; top:-9999px; width:0; height:0; overflow:hidden;">
                            <svg id="posinv_bc_svg_print"></svg>
                            <div id="posinv_bc_name_print"></div>
                            <div id="posinv_bc_id_print"></div>
                        </div>

                        <div class="posinv-bc-note">
                            Tip: selecciona un producto, ajusta copias y presiona “Imprimir”. En 58mm imprime perfecto en etiqueta 50×25.
                        </div>
                    </div>
                </div>
<div class="posinv-footer posinv-muted">
                Tip: con lector Bluetooth funciona como teclado. Con cámara del celular también se puede (V2).
            </div>
        </div>
            <!-- Existencias (consolidado: tiendas + bodega) -->
            <div class="posinv-existencias-view" id="posinvExistenciasView" style="display:none;">
                <div class="posinv-labels-head">
                    <strong>Existencias</strong>
                    <span class="posinv-muted">• totales en tiendas y bodega (incluye ubicación)</span>
                </div>

                <div class="posinv-bc-toolbar" style="align-items:center;">
                    <input type="text" id="posinv_exi_search" placeholder="Busca por código (_op_barcode), SKU, ID o nombre…" autocomplete="off" />
                    <select id="posinv_exi_cat" style="min-width:220px;"></select>
                    <button class="posinv-btn" id="posinv_exi_btn_search" type="button">Buscar</button>
                    <button class="button" id="posinv_exi_btn_scan" type="button" title="Escanear para buscar">📷</button>
                    <button class="posinv-btn posinv-btn-ghost" id="posinv_exi_btn_clear" type="button">Limpiar</button>
                                        <div class="posinv-exi-pager" style="display:flex;align-items:center;gap:8px;margin-left:8px;">
                        <button class="posinv-btn posinv-btn-ghost" id="posinv_exi_prev" type="button">‹</button>
                        <span class="posinv-muted" id="posinv_exi_page" style="min-width:120px;text-align:center;"></span>
                        <button class="posinv-btn posinv-btn-ghost" id="posinv_exi_next" type="button">›</button>
                    </div>
                    <span class="posinv-muted" id="posinv_exi_msg" style="margin-left:10px;"></span>
                </div>

                <div id="posinv_exi_topscan" class="posinv-code-topscan" style="display:none; margin-bottom:12px;">
                    <div class="posinv-code-scan-box">
                        <div class="posinv-code-scan-head">
                            <strong>Escanear para buscar</strong>
                            <button type="button" class="button" id="posinv_exi_topscan_close">Cerrar</button>
                        </div>
                        <div class="posinv-code-scan-help">Apunta la cámara al código. Cuando se confirme 2 veces, se buscará automáticamente.</div>
                        <div class="posinv-code-scan-video" id="posinv_exi_topscan_video"></div>
                        <div class="posinv-code-scan-status" id="posinv_exi_topscan_status">Abriendo cámara…</div>
                    </div>
                </div>

                <div class="posinv-bc-tablewrap" style="margin-top:16px; overflow-x:auto;">
                    <table class="posinv-bc-table" id="posinv_exi_table">
                        <thead>
                            <tr>
                                <th style="width:60px;">Img</th>
                                <th style="width:90px;">ID</th>
                                <th style="width:160px;">Código</th>
                                <th>Producto</th>
                                <th style="width:120px;">San Mateo</th>
                                <th style="width:120px;">Xaltocán</th>
                                <th style="width:120px;">Bodega</th>
                                <th style="width:280px;">Ubicación</th>
                                                                <th style="width:120px;">Total</th>
                            </tr>
                        </thead>
                        <tbody id="posinv_exi_tbody">
                            <tr><td colspan="9" class="posinv-muted">Busca un producto para ver existencias…</td></tr>
                        </tbody>
                    </table>
                </div>
                <div class="posinv-loadmore-wrap" id="posinv_exi_loadmore_wrap" style="display:none; margin-top:14px; text-align:center;">
                    <button class="posinv-btn" id="posinv_exi_loadmore" type="button">Cargar más</button>
                </div>
            </div>
            <div class="posinv-code-view" id="posinvCodeView" style="display:none;">
                <div class="posinv-labels-head">
                    <strong>Códigos</strong>
                    <span class="posinv-muted">• edita el Meta: _op_barcode</span>
                </div>

                <div class="posinv-bc-toolbar">
                    <input type="text" id="posinv_code_search" placeholder="Buscar producto por nombre, ID o código…" />
                    <select id="posinv_code_cat" style="min-width:220px;">
                        <option value="">Todas las categorías</option>
                        <?php
                        $terms = get_terms(['taxonomy'=>'product_cat','hide_empty'=>false]);
                        if (!is_wp_error($terms)) {
                            foreach ($terms as $t) {
                                echo '<option value="' . esc_attr($t->term_id) . '">' . esc_html($t->name) . '</option>';
                            }
                        }
                        ?>
                    </select>
                    <button class="button" id="posinv_code_btn_scan" type="button" title="Escanear para buscar">📷</button>
                    <button class="button button-primary" id="posinv_code_btn_search" type="button">Buscar</button>
                    <button class="posinv-btn posinv-btn-primary" id="posinv_code_btn_print" type="button">Imprimir etiqueta(s)</button>
                    <button class="posinv-btn" id="posinv_code_btn_print_android" type="button">Imprimir (App Android)</button>
                    <span class="posinv-muted" id="posinv_code_selected_info" style="margin-left:10px;">Seleccionados: 0</span>
                    <button class="posinv-btn" id="posinv_code_clear_selected" type="button" disabled style="margin-left:6px;">Limpiar selección</button>
                </div>

                <div id="posinv_code_topscan" class="posinv-code-topscan" style="display:none;">
                    <div class="posinv-code-scan-box">
                        <div class="posinv-code-scan-head">
                            <strong>Escanear para buscar</strong>
                            <button type="button" class="button" id="posinv_code_topscan_close">Cerrar</button>
                        </div>
                        <div class="posinv-code-scan-help">Apunta la cámara al código. Cuando se confirme 2 veces, se buscará automáticamente.</div>
                        <div class="posinv-code-scan-video" id="posinv_code_topscan_video"></div>
                        <div class="posinv-code-scan-status" id="posinv_code_topscan_status">Abriendo cámara…</div>
                    </div>
                </div>

                <div class="posinv-bc-results" id="posinv_code_results">
                    <div class="posinv-bc-hint">Busca un producto para editar su código.</div>
                </div>

                <div id="posinv_code_preview" style="margin-top:14px; max-width:520px;">
                    <div class="posinv-label posinv-label-print">
                        <div class="posinv-label-barcode"><svg id="posinv_code_svg"></svg></div>
                        <div class="posinv-label-name" id="posinv_code_name">—</div>
                        <div class="posinv-label-id" id="posinv_code_id">ID: —</div>
                    </div>

                    <div style="position:absolute; left:-9999px; top:-9999px; width:0; height:0; overflow:hidden;">
                        <svg id="posinv_code_svg_print"></svg>
                        <div id="posinv_code_name_print"></div>
                        <div id="posinv_code_id_print"></div>
                    </div>

                    <div class="posinv-bc-note">
                        Tip: en Código puedes seleccionar un producto y también imprimir su etiqueta con el código actual.
                    </div>
                </div>
            </div>

        <?php
        return ob_get_clean();
    }

    public static function admin_menu() {
        add_menu_page(
            'POS Inventario',
            'POS Inventario',
            'pos_manage_settings',
            'posinv',
            [__CLASS__, 'page_settings'],
            'dashicons-clipboard',
            56
        );
        add_submenu_page('posinv', 'Abrir POS', 'Abrir POS', 'pos_use', 'posinv-open', [__CLASS__, 'page_open']);
        add_submenu_page('posinv', 'Reportes', 'Reportes', 'pos_view_reports', 'posinv-reports', [__CLASS__, 'page_reports']);
        add_submenu_page('posinv', 'Ajustes', 'Ajustes', 'pos_manage_settings', 'posinv-settings', [__CLASS__, 'page_settings']);
        add_submenu_page('posinv', 'Etiquetas', 'Etiquetas', 'pos_use', 'posinv-barcodes', [__CLASS__, 'page_barcodes']);
        add_submenu_page('posinv', 'Apartados', 'Apartados', 'pos_view_reports', 'posinv-layaways', [__CLASS__, 'page_layaways']);
    }

    public static function page_layaways() {
        if (!current_user_can('pos_view_reports')) wp_die('Sin permisos.');
        $q = isset($_GET['q']) ? sanitize_text_field(wp_unslash($_GET['q'])) : '';
        $tickets = get_posts([
            'post_type' => 'pos_ticket',
            'post_status' => 'publish',
            'posts_per_page' => 200,
            'orderby' => 'date',
            'order' => 'DESC',
        ]);
        echo '<div class="wrap"><h1>Apartados</h1>';
        echo '<form method="get" style="margin:12px 0;display:flex;gap:8px;align-items:center;">';
        echo '<input type="hidden" name="page" value="posinv-layaways" />';
        echo '<input type="search" name="q" value="' . esc_attr($q) . '" placeholder="Cliente o teléfono" class="regular-text" />';
        echo '<button class="button button-primary" type="submit">Buscar</button>';
        echo '</form>';
        echo '<table class="widefat striped"><thead><tr><th>Ticket</th><th>Fecha</th><th>Cliente</th><th>Teléfono</th><th>Total</th><th>Pagado</th><th>Resta</th><th>Estado</th></tr></thead><tbody>';
        $found = 0;
        foreach ($tickets as $t) {
            $meta = get_post_meta($t->ID, '_posinv', true);
            if (!is_array($meta) || (($meta['type'] ?? '') !== 'layaway')) continue;
            $lay = is_array($meta['layaway'] ?? null) ? $meta['layaway'] : [];
            $cust = is_array($meta['customer_obj'] ?? null) ? $meta['customer_obj'] : [];
            $name = trim((string)($cust['name'] ?? ($meta['customer'] ?? '')));
            $phone = trim((string)($cust['phone'] ?? ''));
            $total = (float)(($meta['totals']['total'] ?? 0));
            $deposit = (float)($lay['deposit'] ?? 0);
            $remaining = isset($lay['remaining']) ? (float)$lay['remaining'] : max(0, $total - $deposit);
            $status = $remaining > 0.009 ? 'Pendiente' : 'Liquidado';
            if ($q !== '') {
                $hay = function_exists('mb_strtolower') ? mb_strtolower($name . ' ' . $phone) : strtolower($name . ' ' . $phone);
                $needle = function_exists('mb_strtolower') ? mb_strtolower($q) : strtolower($q);
                if (strpos($hay, $needle) === false) continue;
            }
            $found++;
            echo '<tr>';
            echo '<td><a href="' . esc_url(add_query_arg(['posinv_print'=>1,'ticket_id'=>$t->ID], home_url('/'))) . '" target="_blank">#' . (int)$t->ID . '</a></td>';
            echo '<td>' . esc_html(get_the_date('Y-m-d H:i', $t)) . '</td>';
            echo '<td>' . esc_html($name ?: '—') . '</td>';
            echo '<td>' . esc_html($phone ?: '—') . '</td>';
            echo '<td>' . esc_html(posinv_money_plain_global($total)) . '</td>';
            echo '<td>' . esc_html(posinv_money_plain_global($deposit)) . '</td>';
            echo '<td>' . esc_html(posinv_money_plain_global($remaining)) . '</td>';
            echo '<td>' . esc_html($status) . '</td>';
            echo '</tr>';
        }
        if (!$found) echo '<tr><td colspan="8">No hay apartados registrados.</td></tr>';
        echo '</tbody></table></div>';
    }

    public static function page_open() {
        echo '<div class="wrap"><h1>Abrir POS</h1>';
        echo '<p>Coloca el shortcode <code>[pos_inventario]</code> en una página privada y ábrela en tu dispositivo de caja.</p>';
        echo '<p><a class="button button-primary" href="' . esc_url(admin_url('post-new.php?post_type=page')) . '">Crear página</a></p>';
        echo '</div>';
    }

    public static function register_settings() {
        register_setting('posinv', self::OPTION, [
            'type' => 'array',
            'sanitize_callback' => [__CLASS__, 'sanitize_settings'],
            'default' => self::defaults(),
        ]);
    }

    public static function sanitize_settings($in) {
        $d = self::defaults();
        $out = [];
        foreach ($d as $k => $v) {
            $out[$k] = isset($in[$k]) ? sanitize_text_field($in[$k]) : $v;
        }
        return $out;
    }

    public static function page_settings() {
        if (!current_user_can('pos_manage_settings')) wp_die('Sin permisos.');
        $s = self::get_settings();
        ?>
        <div class="wrap">
            <h1>POS Inventario — Ajustes</h1>
            <form method="post" action="options.php">
                <?php settings_fields('posinv'); ?>
                <table class="form-table" role="presentation">
                    <tr><th scope="row">Tienda 1 (nombre)</th><td><input name="<?php echo esc_attr(self::OPTION); ?>[store1_name]" value="<?php echo esc_attr($s['store1_name']); ?>" class="regular-text" /></td></tr>
                    <tr><th scope="row">Tienda 1 (meta stock)</th><td><input name="<?php echo esc_attr(self::OPTION); ?>[store1_meta]" value="<?php echo esc_attr($s['store1_meta']); ?>" class="regular-text" /></td></tr>
                    <tr><th scope="row">Tienda 2 (nombre)</th><td><input name="<?php echo esc_attr(self::OPTION); ?>[store2_name]" value="<?php echo esc_attr($s['store2_name']); ?>" class="regular-text" /></td></tr>
                    <tr><th scope="row">Tienda 2 (meta stock)</th><td><input name="<?php echo esc_attr(self::OPTION); ?>[store2_meta]" value="<?php echo esc_attr($s['store2_meta']); ?>" class="regular-text" /></td></tr>
                    <tr><th scope="row">Meta de costo (para ganancias)</th><td><input name="<?php echo esc_attr(self::OPTION); ?>[cost_meta]" value="<?php echo esc_attr($s['cost_meta']); ?>" class="regular-text" /><p class="description">Si no tienes costo aún, puedes agregarlo en productos como meta.</p></td></tr>
                    <tr><th scope="row">Meta de código de barras (opcional)</th><td><input name="<?php echo esc_attr(self::OPTION); ?>[barcode_meta]" value="<?php echo esc_attr($s['barcode_meta']); ?>" class="regular-text" /><p class="description">Si el producto no tiene este meta, el POS usa el SKU como “código”.</p></td></tr>
                    <tr><th scope="row">Stock negativo permitido</th>
                        <td>
                            <label>
                                <input type="checkbox" name="<?php echo esc_attr(self::OPTION); ?>[allow_negative_stock]" value="1" <?php checked(!empty($s['allow_negative_stock'])); ?> />
                                Permitir que una venta o traspaso deje el inventario en negativo.
                            </label>
                        </td>
                    </tr>

                    <tr><th scope="row">Módulos del POS</th>
                        <td>
                            <label style="display:block;margin-bottom:6px;">
                                <input type="checkbox" name="<?php echo esc_attr(self::OPTION); ?>[enable_stock_in]" value="1" <?php checked(!empty($s['enable_stock_in'])); ?> />
                                Habilitar pestaña <strong>Stock +</strong> (entrada / aumento de inventario)
                            </label>
                            <label style="display:block;">
                                <input type="checkbox" name="<?php echo esc_attr(self::OPTION); ?>[enable_create_product]" value="1" <?php checked(!empty($s['enable_create_product'])); ?> />
                                Permitir <strong>Crear producto</strong> desde el POS (solo WooCommerce)
                            </label>
                            <p class="description">Puedes activar o desactivar estos módulos en cualquier momento.</p>
                        </td>
                    </tr>

	                    <tr><th scope="row">Pestañas por empleada</th>
	                        <td>
	                            <p class="description">Al final de esta página encontrarás una tabla para activar/desactivar por empleada: <strong>Caja</strong>, <strong>Devolución</strong>, <strong>Stock+</strong>, <strong>Ingresos</strong>, <strong>Existencias</strong>, <strong>Inventario</strong>, <strong>Etiquetas</strong>, <strong>Código</strong> y <strong>Bodega</strong>.</p>
	                        </td>
	                    </tr>
                    <tr><th scope="row">Ticket: ancho de papel (mm)</th>
                        <td>
                            <input name="<?php echo esc_attr(self::OPTION); ?>[ticket_paper_mm]" value="<?php echo esc_attr($s['ticket_paper_mm']); ?>" class="small-text" />
                            <p class="description">Normalmente 58 u 80. Se usa para @page size.</p>
                        </td>
                    </tr>
                    <tr><th scope="row">Ticket: tamaño de letra (px)</th>
                        <td>
                            <input name="<?php echo esc_attr(self::OPTION); ?>[ticket_font_size]" value="<?php echo esc_attr($s['ticket_font_size']); ?>" class="small-text" />
                            <p class="description">Recomendado 10–14 para impresora térmica.</p>
                        </td>
                    </tr>

                </table>
                <?php submit_button('Guardar'); ?>
            </form>

	            <hr />
	            <h2>Pestañas por empleada</h2>
	            <p>Selecciona quién puede ver y usar cada pestaña. El administrador siempre tiene acceso. Si no seleccionas a nadie en una pestaña, solo el administrador la verá.</p>
	            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-top:10px;">
	                <input type="hidden" name="action" value="posinv_save_tab_perms" />
	                <?php wp_nonce_field('posinv_save_tab_perms'); ?>
	                <?php
	                $users = get_users(['orderby' => 'display_name', 'order' => 'ASC']);
	                $pos_users = [];
	                foreach ($users as $u) {
	                    if (!user_can($u, 'pos_use') && !user_can($u, 'manage_options')) continue;
	                    if (user_can($u, 'manage_options')) continue; // admin no necesita aparecer
	                    $pos_users[] = $u;
	                }
	                if (empty($pos_users)) {
	                    echo '<p><em>No se encontraron usuarias con permiso del POS.</em></p>';
	                } else {
	                    // necesitamos uid[] para el handler
	                    foreach ($pos_users as $u) {
	                        echo '<input type="hidden" name="uid[]" value="' . esc_attr($u->ID) . '" />';
	                    }
	                }
	
	                $blocks = [
    'sale' => 'Caja',
    'return' => 'Devolución',
    'nuevo' => 'Nuevo',
    'ingresos' => 'Ingresos',
    'existencias' => 'Existencias',
    'inventory' => 'Inventario',
    'labels' => 'Etiquetas',
    'codigo' => 'Código',
    'bodega' => 'Bodega',
];
	                foreach ($blocks as $tab_key => $label) {
	                    echo '<div style="background:#fff;border:1px solid #ccd0d4;border-radius:6px;padding:12px 14px;margin:10px 0;max-width:900px;">';
	                    echo '<div style="font-weight:700;margin-bottom:6px;">Permitir ' . esc_html($label) . ' por empleada</div>';
	                    echo '<div style="display:flex;flex-wrap:wrap;gap:14px;">';
	                    if (empty($pos_users)) {
	                        echo '<span style="color:#666;">(sin usuarias del POS)</span>';
	                    } else {
	                        foreach ($pos_users as $u) {
	                            $a = self::user_allowed_tabs($u->ID);
	                            $checked = !empty($a[$tab_key]);
	                            echo '<label style="display:inline-flex;align-items:center;gap:6px;min-width:220px;">';
	                            echo '<input type="checkbox" name="allow[' . esc_attr($u->ID) . '][' . esc_attr($tab_key) . ']" value="1" ' . checked($checked, true, false) . ' />';
	                            echo esc_html($u->display_name);
	                            echo '</label>';
	                        }
	                    }
	                    echo '</div>';
	                    echo '</div>';
	                }
	                ?>
	                <p style="margin-top:10px;"><button class="button button-primary" type="submit">Guardar permisos por empleada</button></p>
	            </form>

            <?php
            // Tickets (últimos 100) para pruebas: permitir borrar líneas puntuales o vaciar
            $from = isset($_GET['from']) ? sanitize_text_field(wp_unslash($_GET['from'])) : '2000-01-01';
            $to   = isset($_GET['to']) ? sanitize_text_field(wp_unslash($_GET['to'])) : current_time('Y-m-d');
            $tickets_q = new WP_Query([
                'post_type' => 'pos_ticket',
                'posts_per_page' => 100,
                'orderby' => 'date',
                'order' => 'DESC',
                'date_query' => [
                    ['after' => $from . ' 00:00:00', 'before' => $to . ' 23:59:59', 'inclusive' => true],
                ],
            ]);
            ?>

            <h3 style="margin-top:22px;">Tickets (para pruebas)</h3>
            <form method="post" style="margin-top:10px;">
                <?php wp_nonce_field('posinv_reports_actions'); ?>
                <div style="margin:10px 0;">
                    <button class="button" type="submit" name="posinv_reports_action" value="delete_tickets_selected" onclick="return confirm('¿Eliminar los tickets seleccionados?');">Eliminar seleccionados (tickets)</button>
                    <button class="button button-secondary" type="submit" name="posinv_reports_action" value="delete_tickets_all" onclick="return confirm('¿Vaciar TODOS los tickets?');">Vaciar tickets</button>
                </div>
                <table class="widefat striped">
                    <thead>
                        <tr>
                            <th style="width:30px;"><input type="checkbox" onclick="document.querySelectorAll('input[name=\'ticket_ids[]\']').forEach(cb=>cb.checked=this.checked);" /></th>
                            <th>Fecha</th>
                            <th>Tipo</th>
                            <th>Tienda</th>
                            <th>Empleado</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                    <?php if ($tickets_q->have_posts()): while($tickets_q->have_posts()): $tickets_q->the_post();
                        $tid = get_the_ID();
                        $p = get_post_meta($tid, '_posinv', true);
                        $tipo = is_array($p) ? ($p['type'] ?? '') : '';
                        $st = is_array($p) ? ($p['store'] ?? '') : '';
                        $emp = is_array($p) ? ($p['employee_name'] ?? '') : '';
                        $tot = is_array($p) ? ($p['total'] ?? '') : '';
                        $dt = get_the_date('Y-m-d H:i:s');
                    ?>
                        <tr>
                            <td><input type="checkbox" name="ticket_ids[]" value="<?php echo esc_attr($tid); ?>" /></td>
                            <td><?php echo esc_html($dt); ?></td>
                            <td><?php echo esc_html($tipo); ?></td>
                            <td><?php echo esc_html($st); ?></td>
                            <td><?php echo esc_html($emp); ?></td>
                            <td><?php echo esc_html($tot); ?></td>
                        </tr>
                    <?php endwhile; wp_reset_postdata(); else: ?>
                        <tr><td colspan="6">Sin tickets en el rango.</td></tr>
                    <?php endif; ?>
                    </tbody>
                </table>
            </form>

            <hr/>
            <h2>Crear usuarias POS</h2>
            <p>Crea usuarias desde <a href="<?php echo esc_url(admin_url('user-new.php')); ?>">Usuarios → Añadir nuevo</a> y asigna rol <strong>POS - San Mateo</strong> o <strong>POS - Xaltocán</strong>.</p>
        </div>
        <?php
    }

	/**
	 * Elimina tickets pos_ticket filtrando por rango/tienda y (opcional) tipos.
	 * Tipos: sale, refund/return, transfer.
	 */
	private static function delete_tickets_filtered($from, $to, $store, $types = []) {
		$from = $from ?: date('Y-m-01');
		$to   = $to   ?: date('Y-m-d');
		$types = array_filter(array_map('sanitize_text_field', (array)$types));

		$posts = get_posts([
			'post_type'      => 'pos_ticket',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'date_query'     => [
				['after' => $from . ' 00:00:00', 'before' => $to . ' 23:59:59', 'inclusive' => true],
			],
		]);

		$deleted = 0;
		foreach ($posts as $id) {
			$meta = get_post_meta($id, '_posinv', true);
			if (!is_array($meta)) continue;
			$tipo = isset($meta['type']) ? (string)$meta['type'] : '';
			$st   = isset($meta['store']) ? (string)$meta['store'] : '';
			if ($store !== 'all' && $st !== $store) continue;
			if (!empty($types)) {
				$ok = false;
				foreach ($types as $t) {
					if ($t === 'refund') {
						if ($tipo === 'refund' || $tipo === 'return') $ok = true;
					} else {
						if ($tipo === $t) $ok = true;
					}
				}
				if (!$ok) continue;
			}
			wp_delete_post(absint($id), true);
			$deleted++;
		}
		return $deleted;
	}

    public static function page_reports() {
        if (!current_user_can('pos_view_reports')) wp_die('Sin permisos.');

        // ---------------- Acciones (borrar reportes) ----------------
        if (!empty($_POST['posinv_reports_action'])) {
            check_admin_referer('posinv_reports_actions');
            $action = sanitize_text_field($_POST['posinv_reports_action']);
			$pf_from  = isset($_POST['from']) ? sanitize_text_field(wp_unslash($_POST['from'])) : '';
			$pf_to    = isset($_POST['to']) ? sanitize_text_field(wp_unslash($_POST['to'])) : '';
			$pf_store = isset($_POST['store']) ? sanitize_text_field(wp_unslash($_POST['store'])) : 'all';
			$pf_view  = isset($_POST['view']) ? sanitize_text_field(wp_unslash($_POST['view'])) : '';

            if ($action === 'delete_tickets_selected' && !empty($_POST['ticket_ids']) && is_array($_POST['ticket_ids'])) {
                foreach ($_POST['ticket_ids'] as $id) {
                    wp_delete_post(absint($id), true);
                }
                add_settings_error('posinv_reports', 'deleted', 'Tickets seleccionados eliminados.', 'updated');
            }
            if ($action === 'delete_tickets_all') {
                $all = get_posts(['post_type'=>'pos_ticket','posts_per_page'=>-1,'fields'=>'ids']);
                foreach ($all as $id) wp_delete_post(absint($id), true);
                add_settings_error('posinv_reports', 'deletedall', 'Todos los tickets fueron eliminados.', 'updated');
            }

			// Vaciar por pestaña (según filtros de fecha/tienda)
			if ($action === 'delete_view_sales') {
				$n = self::delete_tickets_filtered($pf_from, $pf_to, $pf_store, ['sale']);
				add_settings_error('posinv_reports', 'deletedviewsales', 'Se eliminaron ' . intval($n) . ' tickets de ventas (según filtros).', 'updated');
			}
			if ($action === 'delete_view_refunds') {
				$n = self::delete_tickets_filtered($pf_from, $pf_to, $pf_store, ['refund']);
				add_settings_error('posinv_reports', 'deletedviewrefunds', 'Se eliminaron ' . intval($n) . ' tickets de devoluciones (según filtros).', 'updated');
			}
			if ($action === 'delete_view_transfers') {
				$n = self::delete_tickets_filtered($pf_from, $pf_to, $pf_store, ['transfer']);
				add_settings_error('posinv_reports', 'deletedviewtransfers', 'Se eliminaron ' . intval($n) . ' tickets de traspasos (según filtros).', 'updated');
			}
			if ($action === 'delete_view_movements') {
				// Movimientos = todo lo que se refleja como ticket: sale, refund/return, transfer
				$n = self::delete_tickets_filtered($pf_from, $pf_to, $pf_store, ['sale','refund','transfer']);
				add_settings_error('posinv_reports', 'deletedviewmov', 'Se eliminaron ' . intval($n) . ' tickets de movimientos (según filtros).', 'updated');
			}
			if ($action === 'delete_view_summary' || $action === 'delete_view_employee') {
				// Resumen/Por empleada dependen de tickets, así que se ofrece vaciar “movimientos”
				$n = self::delete_tickets_filtered($pf_from, $pf_to, $pf_store, ['sale','refund','transfer']);
				add_settings_error('posinv_reports', 'deletedviewagg', 'Se eliminaron ' . intval($n) . ' tickets (según filtros) para limpiar ' . esc_html($pf_view ?: 'reportes') . '.', 'updated');
			}

            if ($action === 'delete_audit_selected' && !empty($_POST['audit_ids']) && is_array($_POST['audit_ids'])) {
                foreach ($_POST['audit_ids'] as $id) {
                    wp_delete_post(absint($id), true);
                }
                add_settings_error('posinv_reports', 'auditdeleted', 'Registros de auditoría seleccionados eliminados.', 'updated');
            }
            if ($action === 'delete_audit_all') {
                $all = get_posts(['post_type'=>'pos_audit','posts_per_page'=>-1,'fields'=>'ids']);
                foreach ($all as $id) wp_delete_post(absint($id), true);
                add_settings_error('posinv_reports', 'auditdeletedall', 'Se vació la auditoría.', 'updated');
            }
        }

        $from  = isset($_GET['from']) ? sanitize_text_field($_GET['from']) : date('Y-m-01');
        $to    = isset($_GET['to']) ? sanitize_text_field($_GET['to']) : date('Y-m-d');
        $store = isset($_GET['store']) ? sanitize_text_field($_GET['store']) : 'all';
        $view  = isset($_GET['view']) ? sanitize_text_field($_GET['view']) : 'sales';
        $print = isset($_GET['print']) ? (int) $_GET['print'] : 0;

        $s = self::get_settings();
        $cost_meta = $s['cost_meta'];

        $tickets = get_posts([
            'post_type'      => 'pos_ticket',
            'posts_per_page' => -1,
            'date_query'     => [
                ['after' => $from . ' 00:00:00', 'before' => $to . ' 23:59:59', 'inclusive' => true],
            ],
        ]);

        // Helpers
        $store_ok = function($meta) use ($store) {
            if ($store === 'all') return true;
            if (!is_array($meta)) return false;
            return isset($meta['store']) && $meta['store'] === $store;
        };

        $sum = [
            'sales' => 0.0,
            'refunds' => 0.0,
            'profit' => 0.0,
            'count_sales' => 0,
            'count_refunds' => 0,
            'count_transfers' => 0,
        ];

        $rows_sales = [];
        $rows_refunds = [];
        $rows_transfers = [];
        $rows_movements = [];
        $per_employee = []; // id => aggregates

        foreach ($tickets as $t) {
            $meta = get_post_meta($t->ID, '_posinv', true);
            if (!is_array($meta) || empty($meta['type'])) continue;
            if (!$store_ok($meta)) continue;

            $type = $meta['type'];
            $author_id = (int) $t->post_author;
            $author_name = get_the_author_meta('display_name', $author_id);
            $fecha = get_post_time('Y-m-d H:i', false, $t->ID);
            $store_name = self::store_name_for_key($meta['store']);

            // Build ticket totals (sum of line totals)
            $ticket_total = 0.0;
            $ticket_profit = 0.0;
            $items = isset($meta['items']) && is_array($meta['items']) ? $meta['items'] : [];

            foreach ($items as $it) {
                // Para reportes: precio original (Woo) y motivo de cambio (si aplica)
                // Se guardan en el ticket al momento de crear la venta: wc_price + price_reason.
                $precio_original = '';
                if (isset($it['wc_price']) && $it['wc_price'] !== '' && $it['wc_price'] !== null) {
                    $precio_original = (float)$it['wc_price'];
                }
                // Fallback para tickets viejos: toma el precio actual del producto.
                if ($precio_original === '' && (isset($it['product_id']) || isset($it['pid']))) {
                    $tmp_pid = isset($it['product_id']) ? (int)$it['product_id'] : (int)$it['pid'];
                    if ($tmp_pid > 0) {
                        $tmp_p = wc_get_product($tmp_pid);
                        if ($tmp_p) {
                            $precio_original = (float)$tmp_p->get_price();
                        }
                    }
                }

                $motivo_show = '';
                if (isset($it['price_reason'])) {
                    $motivo_show = sanitize_text_field((string)$it['price_reason']);
                }

                $pid = 0;
                if (isset($it['product_id'])) { $pid = (int) $it['product_id']; }
                elseif (isset($it['pid'])) { $pid = (int) $it['pid']; }

                $qty = isset($it['qty']) ? (float) $it['qty'] : 0;
                $price = isset($it['price']) ? (float) $it['price'] : 0;
                $line_total = $price * $qty;

                $cost = (float) get_post_meta($pid, $cost_meta, true);
                $profit = ($price - $cost) * $qty;

                $ticket_total += $line_total;
                $ticket_profit += $profit;

                // Detailed line rows for sales/refunds
                $base_row = [
                    'ticket_id' => $t->ID,
                    'fecha' => $fecha,
                    'tienda' => $store_name,
                    'empleada' => $author_name,
                    'author_id' => $author_id,
                    'id' => $pid,
                    'producto' => get_the_title($pid),
                    'qty' => $qty,
                    'precio' => $price,
                    'precio_original' => $precio_original,
                    'motivo' => $motivo_show,
                    'total' => $line_total,
                    'ganancia' => $profit,
                ];

                if ($type === 'sale' || $type === 'layaway') {
                    $rows_sales[] = $base_row;
                } elseif ($type === 'refund' || $type === 'return') {
                    $rows_refunds[] = $base_row;
                }
            }

            // Ticket-level movement row
            $rows_movements[] = [
                'ticket_id' => $t->ID,
                'fecha' => $fecha,
                'tienda' => $store_name,
                'tipo' => $type,
                'empleada' => $author_name,
                'author_id' => $author_id,
                'total' => $ticket_total,
                'ganancia' => $ticket_profit,
                'to_store' => isset($meta['to_store']) ? $meta['to_store'] : '',
            ];

            // Per employee aggregates
            if (!isset($per_employee[$author_id])) {
                $per_employee[$author_id] = [
                    'empleada' => $author_name,
                    'sales' => 0.0,
                    'refunds' => 0.0,
                    'profit' => 0.0,
                    'count_sales' => 0,
                    'count_refunds' => 0,
                    'count_transfers' => 0,
                ];
            }

            if ($type === 'sale') {
                $sum['sales'] += $ticket_total;
                $sum['profit'] += $ticket_profit;
                $sum['count_sales']++;
                $per_employee[$author_id]['sales'] += $ticket_total;
                $per_employee[$author_id]['profit'] += $ticket_profit;
                $per_employee[$author_id]['count_sales']++;
            } elseif ($type === 'refund' || $type === 'return') {
                $sum['refunds'] += $ticket_total;
                $sum['count_refunds']++;
                $per_employee[$author_id]['refunds'] += $ticket_total;
                $per_employee[$author_id]['count_refunds']++;
            } elseif ($type === 'transfer') {
                $sum['count_transfers']++;
                $per_employee[$author_id]['count_transfers']++;
                $to_store_key = isset($meta['to_store']) ? $meta['to_store'] : '';
                $to_store_name = $to_store_key ? self::store_name_for_key($to_store_key) : '';
                // items summary
                $lines = [];
                foreach ($items as $it) {
                                   $pid = 0;
                if (isset($it['product_id'])) { $pid = (int) $it['product_id']; }
                elseif (isset($it['pid'])) { $pid = (int) $it['pid']; }

                    $qty = isset($it['qty']) ? (float) $it['qty'] : 0;
                    $lines[] = sprintf('%s x%s', get_the_title($pid), rtrim(rtrim(number_format($qty, 2, '.', ''), '0'), '.'));
                }
                $rows_transfers[] = [
                    'ticket_id' => $t->ID,
                    'fecha' => $fecha,
                    'de' => $store_name,
                    'a' => $to_store_name,
                    'empleada' => $author_name,
                    'items' => implode(' | ', $lines),
                ];
            }
        }

        // Sort employee by sales desc
        uasort($per_employee, function($a,$b){
            return ($b['sales'] <=> $a['sales']);
        });
        // Print view se maneja vía admin-post.php?action=posinv_reports_print (para no imprimir el menú lateral).

        // Admin page (tabs)
        $base_args = ['page' => 'posinv-reports', 'from' => $from, 'to' => $to, 'store' => $store];
        ?>
        <div class="wrap">
            <h1>Reportes POS</h1>
            <?php settings_errors('posinv_reports'); ?>

            <form method="get" style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; margin-bottom:12px;">
                <input type="hidden" name="page" value="posinv-reports"/>
                <input type="hidden" name="view" value="<?php echo esc_attr($view); ?>"/>
                <div><label>Desde</label><br/><input type="date" name="from" value="<?php echo esc_attr($from); ?>"/></div>
                <div><label>Hasta</label><br/><input type="date" name="to" value="<?php echo esc_attr($to); ?>"/></div>
                <div><label>Tienda</label><br/>
                    <select name="store">
                        <option value="all" <?php selected($store,'all'); ?>>Todas</option>
                        <option value="store1" <?php selected($store,'store1'); ?>><?php echo esc_html($s['store1_name']); ?></option>
                        <option value="store2" <?php selected($store,'store2'); ?>><?php echo esc_html($s['store2_name']); ?></option>
                    </select>
                </div>
                <div><button class="button button-primary">Ver</button></div>
                <div>
                    <?php
	                        // Preservar filtros adicionales por vista (ej. Bodega)
	                        $extra = self::reports_extra_query_args();
	                        $print_url = add_query_arg(array_merge($base_args, ['view'=>$view,'emp'=>(isset($_GET['emp'])?sanitize_text_field(wp_unslash($_GET['emp'])):'all')], $extra), admin_url('admin-post.php?action=posinv_reports_print'));
                    ?>
                    <a class="button" href="<?php echo esc_url($print_url); ?>" target="_blank">Imprimir / Guardar PDF</a>
                </div>
            </form>

            <h2 class="nav-tab-wrapper">
                <?php
                $tabs = [
                    'sales' => 'Ventas',
                    'refunds' => 'Devoluciones',
                    'transfers' => 'Traspasos',
                    'employee' => 'Por empleada',
                    'movements' => 'Movimientos',
                    'summary' => 'Resumen',
                    'ingresos' => 'Ingresos',
                    'inventory_audit' => 'Inventario',
                    'labels_audit' => 'Etiquetas',
                    'codigo_audit' => 'Código',
                    'bodega_audit' => 'Bodega',
                ];
                foreach ($tabs as $k=>$label){
                    $url = add_query_arg(array_merge($base_args, ['view'=>$k]), admin_url('admin.php'));
                    $cls = 'nav-tab' . ($view===$k ? ' nav-tab-active' : '');
                    echo '<a class="'.esc_attr($cls).'" href="'.esc_url($url).'">'.esc_html($label).'</a>';
                }
                ?>
            </h2>

	            <!-- Acciones rápidas: vaciar reportes por pestaña -->
	            <form method="post" style="margin:12px 0; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
	                <?php wp_nonce_field('posinv_reports_actions'); ?>
	                <input type="hidden" name="from" value="<?php echo esc_attr($from); ?>" />
	                <input type="hidden" name="to" value="<?php echo esc_attr($to); ?>" />
	                <input type="hidden" name="store" value="<?php echo esc_attr($store); ?>" />
	                <input type="hidden" name="view" value="<?php echo esc_attr($view); ?>" />
	                <?php
	                    $btn_label = '';
	                    $btn_action = '';
	                    if ($view === 'sales') { $btn_label = 'Vaciar Ventas (según filtros)'; $btn_action = 'delete_view_sales'; }
	                    elseif ($view === 'refunds') { $btn_label = 'Vaciar Devoluciones (según filtros)'; $btn_action = 'delete_view_refunds'; }
	                    elseif ($view === 'transfers') { $btn_label = 'Vaciar Traspasos (según filtros)'; $btn_action = 'delete_view_transfers'; }
	                    elseif ($view === 'movements') { $btn_label = 'Vaciar Movimientos (según filtros)'; $btn_action = 'delete_view_movements'; }
	                    elseif ($view === 'summary') { $btn_label = 'Vaciar Tickets del Resumen (según filtros)'; $btn_action = 'delete_view_summary'; }
	                    elseif ($view === 'employee') { $btn_label = 'Vaciar Tickets Por empleada (según filtros)'; $btn_action = 'delete_view_employee'; }
	                ?>
	                <?php if ($btn_action): ?>
	                    <button class="button" type="submit" name="posinv_reports_action" value="<?php echo esc_attr($btn_action); ?>" onclick="return confirm('¿Seguro que quieres borrar este reporte (según los filtros actuales)?');">
	                        <?php echo esc_html($btn_label); ?>
	                    </button>
	                <?php endif; ?>
	                <span style="color:#666;">Tip: esto borra tickets del rango/tienda seleccionados. La Auditoría se borra más abajo.</span>
	            </form>

            <?php self::render_reports_view($view, $sum, $rows_sales, $rows_refunds, $rows_transfers, $rows_movements, $per_employee, $cost_meta, $from, $to, $store, $s); ?>

            <hr />
            <h2>Auditoría y pruebas (más específico)</h2>
            <p style="max-width:900px;">Aquí se registran acciones sensibles: overrides de precio en POS, ajustes de stock (Stock+), creación de productos, etc. Sirve para auditoría y también para poder limpiar datos cuando haces pruebas.</p>

            <?php
            // Auditoría (últimos 200 en rango)
            $audit_q = new WP_Query([
                'post_type' => 'pos_audit',
                'posts_per_page' => 200,
                'orderby' => 'date',
                'order' => 'DESC',
                'date_query' => [
                    ['after' => $from . ' 00:00:00', 'before' => $to . ' 23:59:59', 'inclusive' => true],
                ],
            ]);
            ?>

            <form method="post" style="margin-top:10px;">
                <?php wp_nonce_field('posinv_reports_actions'); ?>
                <div style="margin:10px 0;">
                    <button class="button" type="submit" name="posinv_reports_action" value="delete_audit_selected" onclick="return confirm('¿Eliminar los registros seleccionados de auditoría?');">Eliminar seleccionados (auditoría)</button>
                    <button class="button button-secondary" type="submit" name="posinv_reports_action" value="delete_audit_all" onclick="return confirm('¿Vaciar TODA la auditoría?');">Vaciar auditoría</button>
                </div>

                <table class="widefat striped">
                    <thead>
                        <tr>
                            <th style="width:30px;"><input type="checkbox" onclick="document.querySelectorAll('input[name=\'audit_ids[]\']').forEach(cb=>cb.checked=this.checked);" /></th>
                            <th>Fecha</th>
                            <th>Evento</th>
                            <th>Usuario</th>
                            <th>Tienda</th>
                            <th>Detalle</th>
                        </tr>
                    </thead>
                    <tbody>
                    <?php if ($audit_q->have_posts()): while($audit_q->have_posts()): $audit_q->the_post();
                        $id = get_the_ID();
                        $a = get_post_meta($id, '_posinv_audit', true);
                        $evt = is_array($a) ? ($a['type'] ?? get_the_title()) : get_the_title();
                        $time = is_array($a) ? ($a['time'] ?? get_the_date('Y-m-d H:i:s')) : get_the_date('Y-m-d H:i:s');
                        $user = is_array($a) ? ($a['user'] ?? '') : '';
                        $store = is_array($a) ? ($a['store'] ?? '') : '';
                        // resumen corto
                        $detail = '';
                        if (is_array($a)) {
                            if ($evt === 'price_override') {
                                $detail = sprintf('%s (ID %d) WC: %s → POS: %s (x%s)%s',
                                    $a['product'] ?? '',
                                    intval($a['product_id'] ?? 0),
                                    $a['wc_price'] ?? '',
                                    $a['pos_price'] ?? '',
                                    $a['qty'] ?? '',
                                    (!empty($a['reason']) ? (' | Motivo: ' . $a['reason']) : '')
                                );
                            } elseif ($evt === 'stock_adjust') {
                                $detail = sprintf('%s (ID %d) %s → %s (Δ %s)',
                                    $a['product'] ?? '',
                                    intval($a['product_id'] ?? 0),
                                    $a['old_stock'] ?? '',
                                    $a['new_stock'] ?? '',
                                    $a['delta'] ?? ''
                                );
                            } elseif ($evt === 'create_product') {
                                $detail = sprintf('%s (ID %d) $%s stock %s (%s)',
                                    $a['product'] ?? '',
                                    intval($a['product_id'] ?? 0),
                                    $a['price'] ?? '',
                                    $a['initial_stock'] ?? '',
                                    $a['status'] ?? ''
                                );
                            } else {
                                $detail = wp_json_encode($a);
                            }
                        }
                    ?>
                        <tr>
                            <td><input type="checkbox" name="audit_ids[]" value="<?php echo esc_attr($id); ?>" /></td>
                            <td><?php echo esc_html($time); ?></td>
                            <td><?php echo esc_html($evt); ?></td>
                            <td><?php echo esc_html($user); ?></td>
                            <td><?php echo esc_html($store); ?></td>
                            <td style="max-width:520px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><?php echo esc_html($detail); ?></td>
                        </tr>
                    <?php endwhile; wp_reset_postdata(); else: ?>
                        <tr><td colspan="6">Sin registros de auditoría en el rango.</td></tr>
                    <?php endif; ?>
                    </tbody>
                </table>
            </form>
        </div>
        <?php
    }

    // CSS para imprimir solo el reporte (oculta barra lateral y cabecera del admin).
    public static function admin_print_css() {
        $page = isset($_GET['page']) ? sanitize_text_field(wp_unslash($_GET['page'])) : '';
        if ($page !== 'posinv-reports') return;
        ?>
        <style>
            @media print{
                #wpadminbar, #adminmenumain, #adminmenuwrap, #adminmenu, #wpfooter, #screen-meta, .update-nag, .notice, .wrap > form{ display:none !important; }
                #wpcontent{ margin-left:0 !important; }
                #wpbody-content{ padding-bottom:0 !important; }
            }
        </style>
        <?php
    }

    // Impresión / Guardar PDF sin el "chrome" del admin (se llama desde admin-post.php).
    public static function handle_reports_print() {
        if (!current_user_can('pos_view_reports')) wp_die('Sin permisos.');

        $s = self::get_settings();
        $cost_meta = $s['cost_meta'] ?: '_pos_cost';

        $from  = isset($_GET['from']) ? sanitize_text_field(wp_unslash($_GET['from'])) : date('Y-m-01');
        $to    = isset($_GET['to']) ? sanitize_text_field(wp_unslash($_GET['to'])) : date('Y-m-d');
        $store = isset($_GET['store']) ? sanitize_text_field(wp_unslash($_GET['store'])) : 'all';
        $view  = isset($_GET['view']) ? sanitize_text_field(wp_unslash($_GET['view'])) : 'sales';
        $emp   = isset($_GET['emp']) ? sanitize_text_field(wp_unslash($_GET['emp'])) : 'all';

        // Query tickets (pos_ticket) by date range
        $q = new WP_Query([
            'post_type' => 'pos_ticket',
            'post_status' => 'publish',
            'posts_per_page' => -1,
            'date_query' => [[
                'after' => $from . ' 00:00:00',
                'before' => $to . ' 23:59:59',
                'inclusive' => true,
            ]],
        ]);
        $tickets = $q->posts;

        $store_ok = function($meta) use ($store) {
            if ($store === 'all') return true;
            if (!is_array($meta)) return false;
            return isset($meta['store']) && $meta['store'] === $store;
        };

        $sum = [
            'sales' => 0.0,
            'refunds' => 0.0,
            'profit' => 0.0,
            'count_sales' => 0,
            'count_refunds' => 0,
            'count_transfers' => 0,
        ];
        $rows_sales = [];
        $rows_refunds = [];
        $rows_transfers = [];
        $rows_movements = [];
        $per_employee = [];

        foreach ($tickets as $t) {
            $meta = get_post_meta($t->ID, '_posinv', true);
            if (!is_array($meta) || empty($meta['type'])) continue;
            if (!$store_ok($meta)) continue;

            $type = $meta['type'];
            $author_id = (int) $t->post_author;
            $author_name = get_the_author_meta('display_name', $author_id);
            $fecha = get_post_time('Y-m-d H:i', false, $t->ID);
            $store_name = self::store_name_for_key($meta['store']);

            $ticket_total = 0.0;
            $ticket_profit = 0.0;
            $items = isset($meta['items']) && is_array($meta['items']) ? $meta['items'] : [];

            $items_summary = [];
            foreach ($items as $it) {
                $pid = 0;
                if (isset($it['product_id'])) { $pid = (int) $it['product_id']; }
                elseif (isset($it['pid'])) { $pid = (int) $it['pid']; }

                $qty = isset($it['qty']) ? (float) $it['qty'] : 0;
                $price = isset($it['price']) ? (float) $it['price'] : 0;

                $line_total = $price * $qty;
                $cost = (float) get_post_meta($pid, $cost_meta, true);
                $profit = ($price - $cost) * $qty;

                $ticket_total += $line_total;
                $ticket_profit += $profit;

                $items_summary[] = trim(get_the_title($pid)) . ' x' . $qty;

                $base_row = [
                    'ticket_id' => $t->ID,
                    'fecha' => $fecha,
                    'tienda' => $store_name,
                    'empleada' => $author_name,
                    'author_id' => $author_id,
                    'id' => $pid,
                    'producto' => get_the_title($pid),
                    'qty' => $qty,
                    'precio' => $price,
                    'total' => $line_total,
                    'ganancia' => $profit,
                ];

                if ($type === 'sale') {
                    $rows_sales[] = $base_row;
                } elseif ($type === 'refund' || $type === 'return') {
                    $rows_refunds[] = $base_row;
                }
            }

            $rows_movements[] = [
                'ticket_id' => $t->ID,
                'fecha' => $fecha,
                'tienda' => $store_name,
                'tipo' => $type,
                'empleada' => $author_name,
                'author_id' => $author_id,
                'total' => $ticket_total,
                'ganancia' => $ticket_profit,
                'to_store' => isset($meta['to_store']) ? $meta['to_store'] : '',
            ];

            if (!isset($per_employee[$author_id])) {
                $per_employee[$author_id] = [
                    'empleada' => $author_name,
                    'sales' => 0.0,
                    'refunds' => 0.0,
                    'profit' => 0.0,
                    'count_sales' => 0,
                    'count_refunds' => 0,
                    'count_transfers' => 0,
                ];
            }

            if ($type === 'sale') {
                $sum['sales'] += $ticket_total;
                $sum['profit'] += $ticket_profit;
                $sum['count_sales']++;
                $per_employee[$author_id]['sales'] += $ticket_total;
                $per_employee[$author_id]['profit'] += $ticket_profit;
                $per_employee[$author_id]['count_sales']++;
            } elseif ($type === 'refund' || $type === 'return') {
                $sum['refunds'] += $ticket_total;
                $sum['count_refunds']++;
                $per_employee[$author_id]['refunds'] += $ticket_total;
                $per_employee[$author_id]['count_refunds']++;
            } elseif ($type === 'transfer') {
                $sum['count_transfers']++;
                $per_employee[$author_id]['count_transfers']++;

                $to_store_key = isset($meta['to_store']) ? $meta['to_store'] : '';
                $from_store_key = isset($meta['store']) ? $meta['store'] : '';
                $rows_transfers[] = [
                    'ticket_id' => $t->ID,
                    'fecha' => $fecha,
                    'de' => self::store_name_for_key($from_store_key),
                    'a' => $to_store_key ? self::store_name_for_key($to_store_key) : '',
                    'empleada' => $author_name,
                    'items' => implode(' | ', array_slice($items_summary, 0, 8)) . (count($items_summary) > 8 ? '…' : ''),
                ];
            }
        }

        ?>
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8"/>
            <title>Reportes POS</title>
            <style>
                body{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size:12px; margin:12px;}
                h1,h2,h3{margin:0 0 8px 0;}
                .meta{margin:0 0 12px 0;}
                table{width:100%; border-collapse:collapse;}
                th,td{border:1px solid #999; padding:6px; vertical-align:top;}
                th{background:#f2f2f2;}
                @page { size: A4; margin: 12mm; }
                @media print { a{color:#000; text-decoration:none;} }
            </style>
        </head>
        <body onload="window.print()">
            <h1>Reportes POS</h1>
            <p class="meta">Rango: <?php echo esc_html($from); ?> a <?php echo esc_html($to); ?> | Tienda: <?php echo esc_html($store==='all'?'Todas':self::store_name_for_key($store)); ?> | Vista: <?php echo esc_html($view); ?></p>
            <?php
                // Reusa la misma función de renderizado para imprimir
                self::render_reports_view($view, $sum, $rows_sales, $rows_refunds, $rows_transfers, $rows_movements, $per_employee, $cost_meta, $from, $to, $store, $s);
            ?>
        </body></html>
        <?php
        exit;
    }

private static function audit_rows_for_reports($from, $to, $store, array $type_allow, array $module_allow = []) {
    $rows = [];
    $q = new WP_Query([
        'post_type' => 'pos_audit',
        'posts_per_page' => 500,
        'orderby' => 'date',
        'order' => 'DESC',
        'date_query' => [
            ['after' => $from . ' 00:00:00', 'before' => $to . ' 23:59:59', 'inclusive' => true],
        ],
    ]);
    if (!$q->have_posts()) return $rows;

    $store = $store ?: 'all';
    while ($q->have_posts()) { $q->the_post();
        $id = get_the_ID();
        $a = get_post_meta($id, '_posinv_audit', true);
        if (!is_array($a)) continue;

        $type = (string)($a['type'] ?? get_the_title($id));
        if (!in_array($type, $type_allow, true)) continue;

        $module = (string)($a['module'] ?? '');
        if (!empty($module_allow) && !in_array($module, $module_allow, true)) continue;

        $ev_store = (string)($a['store'] ?? '');
        if ($store !== 'all' && $ev_store && $ev_store !== $store) continue;

        $user = (string)($a['user'] ?? '');
        $time = (string)($a['time'] ?? get_the_date('Y-m-d H:i:s', $id));
        $pid  = isset($a['product_id']) ? (int)$a['product_id'] : 0;
        $pname= (string)($a['product'] ?? ($pid ? get_the_title($pid) : ''));

        $detail = '';
        if ($type === 'ingresos_add') {
            $detail = 'Ingreso tienda: +' . (string)($a['delta'] ?? '') . ' (antes ' . (string)($a['before'] ?? '') . ' → ahora ' . (string)($a['after'] ?? '') . ')';
            if (!empty($a['obs'])) $detail .= ' | Obs: ' . (string)$a['obs'];
        } elseif ($type === 'stock_adjust') {
            $before = isset($a['before']) ? $a['before'] : (isset($a['old_stock']) ? $a['old_stock'] : '');
            $after  = isset($a['after']) ? $a['after'] : (isset($a['new_stock']) ? $a['new_stock'] : '');
            $detail = 'Ajuste stock: ' . (string)($a['mode'] ?? '') . ' ' . (string)($a['delta'] ?? '') . ' (antes ' . (string)$before . ' → ' . (string)$after . ')';
            if (!empty($a['note'])) $detail .= ' | ' . (string)$a['note'];
            if (!empty($a['reason'])) $detail .= ' | Motivo: ' . (string)$a['reason'];
        } elseif ($type === 'inventory_report') {
            $detail = 'Conteo: ' . (string)($a['counted_items'] ?? '') . ' items | Diff ' . (string)($a['diff_total'] ?? '');
        } elseif ($type === 'labels_print') {
            $detail = 'Impresión etiquetas: ' . (string)($a['count_items'] ?? '') . ' productos | ' . (string)($a['total_qty'] ?? '') . ' etiquetas';
        } elseif ($type === 'barcode_change') {
            $detail = 'Código: ' . (string)($a['old'] ?? '') . ' → ' . (string)($a['new'] ?? '');
        } elseif ($type === 'price_change') {
            $detail = 'Precio: ' . (string)($a['old'] ?? '') . ' → ' . (string)($a['new'] ?? '');
        } elseif ($type === 'category_change') {
            $detail = 'Categorías: ' . implode(', ', (array)($a['categories'] ?? []));
        } elseif (strpos($type, 'bodega_') === 0) {
            $detail = (string)($a['action'] ?? $type);
            if (!empty($a['loc'])) $detail .= ' | ' . (string)$a['loc'];
            if (!empty($a['row'])) $detail .= ' | ' . (string)$a['row'];
        } else {
            $detail = wp_json_encode($a);
        }

        $rows[] = [
            'fecha' => $time,
            'tienda' => $ev_store,
            'empleada' => $user,
            'evento' => $type,
            'producto' => $pname,
            'id' => $pid,
            'detalle' => $detail,
        ];
    }
    wp_reset_postdata();
    return $rows;
}

// Preserva filtros extra en Reportes (para que también funcionen en Imprimir/PDF)
private static function reports_extra_query_args() {
    $keys = ['q','cat','loc','only','selected','lq','lact'];
    $out = [];
    foreach ($keys as $k) {
        if (!isset($_GET[$k])) continue;
        $v = wp_unslash($_GET[$k]);
        if ($k === 'cat') {
            $out[$k] = (string)absint($v);
        } elseif ($k === 'only') {
            // checkbox
            $out[$k] = $v ? '1' : '0';
        } else {
            $out[$k] = sanitize_text_field((string)$v);
        }
    }
    return $out;
}

// === Reporte especial de Bodega: listado de productos, ubicaciones y totales ===
private static function render_bodega_stock_report($from, $to, $store, $settings) {
    // Filtros
    $q   = isset($_GET['q']) ? sanitize_text_field(wp_unslash($_GET['q'])) : '';
    $cat = isset($_GET['cat']) ? absint($_GET['cat']) : 0;
    $loc = isset($_GET['loc']) ? sanitize_text_field(wp_unslash($_GET['loc'])) : '';
    $only = isset($_GET['only']) && (string)wp_unslash($_GET['only']) === '1';
    $selected = isset($_GET['selected']) ? sanitize_text_field(wp_unslash($_GET['selected'])) : '';
    $selected_ids = [];
    if ($selected !== '') {
        foreach (explode(',', $selected) as $p) {
            $pid = absint(trim($p));
            if ($pid) $selected_ids[$pid] = true;
        }
    }

    // Categorías (dropdown)
    $cats = get_terms(['taxonomy'=>'product_cat','hide_empty'=>false]);

    // Obtener productos con meta de bodega
    $meta_key = self::bodega_meta_key();
    $barcode_meta = !empty($settings['barcode_meta']) ? $settings['barcode_meta'] : '_op_barcode';

    $ids = get_posts([
        'post_type'      => 'product',
        'post_status'    => ['publish'],
        'fields'         => 'ids',
        'posts_per_page' => -1,
        'meta_query'     => [
            [
                'key'     => $meta_key,
                'compare' => 'EXISTS',
            ],
        ],
    ]);

    $rows = [];
    foreach ((array)$ids as $pid) {
        $pid = (int)$pid;
        if (!$pid) continue;
        if (!empty($selected_ids) && !isset($selected_ids[$pid])) continue;

        // Categoría
        if ($cat && !has_term($cat, 'product_cat', $pid)) continue;

        $p = wc_get_product($pid);
        if (!$p) continue;

        // Búsqueda
        if ($q !== '') {
            $ok = false;
            if (ctype_digit($q) && (int)$q === $pid) {
                $ok = true;
            }
            if (!$ok) {
                $title = (string)$p->get_name();
                if ($title !== '' && stripos($title, $q) !== false) $ok = true;
            }
            if (!$ok) {
                $bc = (string)get_post_meta($pid, $barcode_meta, true);
                if ($bc !== '' && $bc === $q) $ok = true;
            }
            if (!$ok) {
                $sku = (string)$p->get_sku();
                if ($sku !== '' && $sku === $q) $ok = true;
            }
            if (!$ok) continue;
        }

        $b = self::bodega_sum_and_locations_array($pid);
        $total = (int)($b['qty'] ?? 0);
        $locmap = is_array($b['map'] ?? null) ? $b['map'] : [];

        if ($only && $total <= 0) continue;

        // filtro por ubicación (substring)
        if ($loc !== '') {
            $found = false;
            foreach ($locmap as $lname => $lqty) {
                if ($lname !== '' && stripos($lname, $loc) !== false) { $found = true; break; }
            }
            if (!$found) continue;
        }

        $code = (string)get_post_meta($pid, $barcode_meta, true);
        if ($code === '') $code = (string)$p->get_sku();

        $locs_list = array_keys($locmap);
        sort($locs_list, SORT_NATURAL | SORT_FLAG_CASE);
        $locs_str = implode(', ', $locs_list);

        $per_loc_parts = [];
        foreach ($locmap as $lname => $lqty) {
            $per_loc_parts[] = $lname . ': ' . (int)$lqty;
        }
        $per_loc_str = implode(' | ', $per_loc_parts);

        $rows[] = [
            'id' => $pid,
            'code' => $code,
            'product' => (string)$p->get_name(),
            'total' => $total,
            'locs' => $locs_str,
            'per_loc' => $per_loc_str,
        ];
    }

    // Orden por producto
    usort($rows, function($a,$b){
        return strcasecmp((string)$a['product'], (string)$b['product']);
    });

    // UI
    $base_args = [
        'page' => 'posinv-reports',
        'view' => 'bodega_audit',
        'from' => $from,
        'to'   => $to,
        'store'=> $store,
    ];
    $print_base = add_query_arg(array_merge($base_args, ['q'=>$q,'cat'=>$cat,'loc'=>$loc,'only'=>($only?'1':'0')]), admin_url('admin-post.php?action=posinv_reports_print'));
    ?>
    <h2>Bodega — Existencias y ubicaciones</h2>
    <p class="description">Aquí se listan <strong>todos los productos con datos de Bodega</strong>, mostrando el total y el detalle por ubicación. Usa filtros para imprimir solo lo que necesites.</p>

    <form method="get" style="margin:10px 0 14px 0; display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
        <input type="hidden" name="page" value="posinv-reports"/>
        <input type="hidden" name="view" value="bodega_audit"/>
        <input type="hidden" name="from" value="<?php echo esc_attr($from); ?>"/>
        <input type="hidden" name="to" value="<?php echo esc_attr($to); ?>"/>
        <input type="hidden" name="store" value="<?php echo esc_attr($store); ?>"/>

        <div>
            <label><strong>Buscar</strong></label><br/>
            <input type="text" name="q" value="<?php echo esc_attr($q); ?>" placeholder="ID / nombre / código / SKU" style="min-width:220px;"/>
        </div>

        <div>
            <label><strong>Categoría</strong></label><br/>
            <select name="cat">
                <option value="0">Todas</option>
                <?php foreach ((array)$cats as $t): if (!is_object($t)) continue; ?>
                    <option value="<?php echo esc_attr((string)$t->term_id); ?>" <?php selected($cat,(int)$t->term_id); ?>><?php echo esc_html($t->name); ?></option>
                <?php endforeach; ?>
            </select>
        </div>

        <div>
            <label><strong>Ubicación contiene</strong></label><br/>
            <input type="text" name="loc" value="<?php echo esc_attr($loc); ?>" placeholder="Ej. PASILLO 2" style="min-width:180px;"/>
        </div>

        <label style="display:flex; gap:6px; align-items:center; margin-bottom:2px;">
            <input type="checkbox" name="only" value="1" <?php checked($only); ?> />
            <span>Solo con stock &gt; 0</span>
        </label>

        <div><button class="button button-primary">Filtrar</button></div>
        <div><a class="button" href="<?php echo esc_url($print_base); ?>" target="_blank">Imprimir (según filtros)</a></div>
        <div>
            <button class="button" type="button" id="posinvBodegaPrintSelected">Imprimir seleccionados</button>
        </div>
    </form>

    <script>
    (function(){
        var btn = document.getElementById('posinvBodegaPrintSelected');
        if(!btn) return;
        btn.addEventListener('click', function(){
            var ids = [];
            document.querySelectorAll('input.posinv-bodega-pick:checked').forEach(function(cb){
                ids.push(cb.value);
            });
            if(ids.length===0){ alert('Selecciona al menos un producto.'); return; }
            var url = <?php echo wp_json_encode($print_base); ?> + '&selected=' + encodeURIComponent(ids.join(','));
            window.open(url, '_blank');
        });
    })();
    </script>

    <table class="widefat striped">
        <thead>
            <tr>
                <th style="width:30px;"><input type="checkbox" onclick="document.querySelectorAll('input.posinv-bodega-pick').forEach(cb=>cb.checked=this.checked);"/></th>
                <th>ID</th>
                <th>Código</th>
                <th>Producto</th>
                <th style="width:120px;">Total Bodega</th>
                <th>Ubicaciones</th>
                <th>Por ubicación</th>
            </tr>
        </thead>
        <tbody>
        <?php if (empty($rows)): ?>
            <tr><td colspan="7">Sin productos en Bodega con los filtros actuales.</td></tr>
        <?php else: foreach ($rows as $r): ?>
            <tr>
                <td><input class="posinv-bodega-pick" type="checkbox" value="<?php echo esc_attr((string)$r['id']); ?>"/></td>
                <td><?php echo esc_html((string)$r['id']); ?></td>
                <td><?php echo esc_html((string)$r['code']); ?></td>
                <td><?php echo esc_html((string)$r['product']); ?></td>
                <td><?php echo esc_html((string)$r['total']); ?></td>
                <td><?php echo esc_html((string)$r['locs']); ?></td>
                <td><?php echo esc_html((string)$r['per_loc']); ?></td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>
    <?php
}

// Devuelve sumatoria + mapa por ubicación (consolida ubicaciones repetidas)
private static function bodega_sum_and_locations_array($product_id) {
    $rows = self::bodega_get_locations($product_id);
    if (empty($rows)) return ['qty'=>0,'map'=>[]];
    $sum = 0;
    $map = [];
    foreach ($rows as $r) {
        $lname = isset($r['loc']) ? trim((string)$r['loc']) : '';
        $qty = isset($r['qty']) ? (float)$r['qty'] : 0;
        $sum += $qty;
        if ($lname === '') continue;
        if (!isset($map[$lname])) $map[$lname] = 0;
        $map[$lname] += (int)$qty;
    }
    // quitar ceros
    foreach ($map as $k=>$v) {
        if ((int)$v === 0) unset($map[$k]);
    }
    // ordenar natural
    uksort($map, function($a,$b){ return strcasecmp($a,$b); });
    return ['qty'=>(int)$sum,'map'=>$map];
}

private static function render_labels_audit_report($from, $to, $store, $settings) {
    $q = isset($_GET['lq']) ? sanitize_text_field(wp_unslash($_GET['lq'])) : '';
    $action_filter = isset($_GET['lact']) ? sanitize_text_field(wp_unslash($_GET['lact'])) : 'all';
    $allowed_types = ['labels_print','labels_select','labels_search','labels_queue_clear','price_change','category_change','barcode_change','stock_adjust'];

    $audit_q = new WP_Query([
        'post_type' => 'pos_audit',
        'posts_per_page' => 500,
        'orderby' => 'date',
        'order' => 'DESC',
        'date_query' => [
            ['after' => $from . ' 00:00:00', 'before' => $to . ' 23:59:59', 'inclusive' => true],
        ],
    ]);

    $rows = [];
    $summary = [
        'events' => 0,
        'print_jobs' => 0,
        'labels_total' => 0,
        'selected' => 0,
        'searches' => 0,
        'clears' => 0,
        'barcode_changes' => 0,
        'price_changes' => 0,
        'category_changes' => 0,
        'stock_moves' => 0,
        'stock_delta' => 0,
    ];

    if ($audit_q->have_posts()) {
        while ($audit_q->have_posts()) { $audit_q->the_post();
            $id = get_the_ID();
            $a = get_post_meta($id, '_posinv_audit', true);
            if (!is_array($a)) continue;

            $type = (string)($a['type'] ?? get_the_title($id));
            if (!in_array($type, $allowed_types, true)) continue;

            $module = (string)($a['module'] ?? '');
            if ($type === 'stock_adjust') {
                $source = (string)($a['source_module'] ?? '');
                if ($module !== 'labels' && $source !== 'labels') continue;
            } else {
                if ($module !== 'labels') continue;
            }

            $ev_store = (string)($a['store'] ?? '');
            if ($store !== 'all' && $ev_store && $ev_store !== $store) continue;

            $pid = isset($a['product_id']) ? (int)$a['product_id'] : 0;
            $product = (string)($a['product'] ?? ($pid ? get_the_title($pid) : ''));
            $detail_text = '';
            $before = '';
            $change = '';
            $after = '';
            $items_print = '';

            if ($type === 'labels_print') {
                $summary['print_jobs']++;
                $summary['labels_total'] += (int)($a['total_qty'] ?? 0);
                $change = (string)(int)($a['total_qty'] ?? 0) . ' etiqueta(s)';
                $detail_text = 'Impresión ' . ((string)($a['print_mode'] ?? '') === 'android' ? 'App Android' : 'Navegador');
                $detail_text .= ' | ' . (string)(int)($a['count_items'] ?? 0) . ' producto(s)';
                $detail_text .= ' | Cola: ' . (!empty($a['used_queue']) ? 'sí' : 'no');
                $items = isset($a['items']) && is_array($a['items']) ? $a['items'] : [];
                $parts = [];
                foreach ($items as $it) {
                    $it_id = isset($it['id']) ? (int)$it['id'] : 0;
                    $it_qty = isset($it['qty']) ? (int)$it['qty'] : 0;
                    $it_name = $it_id ? get_the_title($it_id) : '';
                    $parts[] = '#' . $it_id . ' ' . trim($it_name) . ' × ' . $it_qty;
                }
                $items_print = implode(' | ', $parts);
            } elseif ($type === 'labels_select') {
                $summary['selected']++;
                $change = 'Seleccionado';
                $detail_text = 'Producto enviado al panel de etiqueta';
            } elseif ($type === 'labels_search') {
                $summary['searches']++;
                $change = (string)(int)($a['results_count'] ?? 0) . ' resultado(s)';
                $detail_text = 'Búsqueda: "' . (string)($a['query'] ?? '') . '"';
                if (!empty($a['category'])) $detail_text .= ' | Categoría: ' . (string)$a['category'];
            } elseif ($type === 'labels_queue_clear') {
                $summary['clears']++;
                $change = 'Limpió cola';
                $detail_text = 'Seleccionados antes de limpiar: ' . (string)(int)($a['selected_count'] ?? 0);
            } elseif ($type === 'barcode_change') {
                $summary['barcode_changes']++;
                $before = (string)($a['old'] ?? '');
                $after = (string)($a['new'] ?? '');
                $change = 'Código';
                $detail_text = 'Cambio de código de barras';
            } elseif ($type === 'price_change') {
                $summary['price_changes']++;
                $before = (string)($a['old'] ?? '');
                $after = (string)($a['new'] ?? '');
                $change = 'Precio';
                $detail_text = 'Cambio de precio';
            } elseif ($type === 'category_change') {
                $summary['category_changes']++;
                $before = (string)($a['old_categories_text'] ?? '');
                $after = (string)($a['new_categories_text'] ?? implode(', ', (array)($a['categories'] ?? [])));
                $change = 'Categorías';
                $detail_text = 'Cambio de categoría';
            } elseif ($type === 'stock_adjust') {
                $summary['stock_moves']++;
                $summary['stock_delta'] += abs((int)($a['delta'] ?? 0));
                $before = (string)($a['old_stock'] ?? '');
                $after = (string)($a['new_stock'] ?? '');
                $change = ((int)($a['delta'] ?? 0) > 0 ? '+' : '') . (string)($a['delta'] ?? 0);
                $detail_text = 'Ajuste de stock desde Etiquetas';
                if (!empty($a['reason'])) $detail_text .= ' | Motivo: ' . (string)$a['reason'];
            }

            $row_action = $type;
            if ($action_filter !== 'all' && $row_action !== $action_filter) continue;

            if ($q !== '') {
                $haystack = strtolower($product . ' ' . $pid . ' ' . $detail_text . ' ' . $items_print . ' ' . (string)($a['query'] ?? ''));
                if (strpos($haystack, strtolower($q)) === false) continue;
            }

            $summary['events']++;
            $rows[] = [
                'fecha' => (string)($a['time'] ?? get_the_date('Y-m-d H:i:s', $id)),
                'tienda' => $ev_store,
                'empleada' => (string)($a['user'] ?? ''),
                'accion' => $row_action,
                'id' => $pid,
                'producto' => $product,
                'before' => $before,
                'change' => $change,
                'after' => $after,
                'detalle' => $detail_text,
                'items' => $items_print,
            ];
        }
        wp_reset_postdata();
    }

    $base_args = ['page' => 'posinv-reports', 'view' => 'labels_audit', 'from' => $from, 'to' => $to, 'store' => $store];
    $print_url = add_query_arg(array_merge($base_args, ['lq' => $q, 'lact' => $action_filter]), admin_url('admin-post.php?action=posinv_reports_print'));
    $actions = [
        'all' => 'Todas',
        'labels_print' => 'Impresiones',
        'labels_select' => 'Selecciones',
        'labels_search' => 'Búsquedas',
        'labels_queue_clear' => 'Limpiar cola',
        'price_change' => 'Precios',
        'category_change' => 'Categorías',
        'barcode_change' => 'Códigos',
        'stock_adjust' => 'Ajustes stock',
    ];
    ?>
    <h2>Etiquetas — Auditoría completa</h2>
    <p style="max-width:980px;">Este reporte muestra lo que se hace en la pestaña <strong>Etiquetas</strong>: búsquedas, selecciones, impresiones, cambios de precio, categorías, código y ajustes de stock hechos desde esa misma pestaña.</p>

    <form method="get" style="margin:10px 0 14px 0; display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
        <input type="hidden" name="page" value="posinv-reports"/>
        <input type="hidden" name="view" value="labels_audit"/>
        <input type="hidden" name="from" value="<?php echo esc_attr($from); ?>"/>
        <input type="hidden" name="to" value="<?php echo esc_attr($to); ?>"/>
        <input type="hidden" name="store" value="<?php echo esc_attr($store); ?>"/>

        <div>
            <label><strong>Buscar</strong></label><br/>
            <input type="text" name="lq" value="<?php echo esc_attr($q); ?>" placeholder="Producto, ID, texto del detalle…" style="min-width:260px;"/>
        </div>
        <div>
            <label><strong>Acción</strong></label><br/>
            <select name="lact">
                <?php foreach ($actions as $k => $label): ?>
                    <option value="<?php echo esc_attr($k); ?>" <?php selected($action_filter, $k); ?>><?php echo esc_html($label); ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <div><button class="button button-primary">Filtrar</button></div>
        <div><a class="button" target="_blank" href="<?php echo esc_url($print_url); ?>">Imprimir (según filtros)</a></div>
    </form>

    <table class="widefat striped" style="max-width:1100px; margin-bottom:16px;">
        <thead>
            <tr>
                <th>Eventos</th>
                <th>Impresiones</th>
                <th>Total etiquetas</th>
                <th>Selecciones</th>
                <th>Búsquedas</th>
                <th>Cambios precio</th>
                <th>Cambios código</th>
                <th>Cambios categoría</th>
                <th>Ajustes stock</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td><?php echo esc_html((string)$summary['events']); ?></td>
                <td><?php echo esc_html((string)$summary['print_jobs']); ?></td>
                <td><?php echo esc_html((string)$summary['labels_total']); ?></td>
                <td><?php echo esc_html((string)$summary['selected']); ?></td>
                <td><?php echo esc_html((string)$summary['searches']); ?></td>
                <td><?php echo esc_html((string)$summary['price_changes']); ?></td>
                <td><?php echo esc_html((string)$summary['barcode_changes']); ?></td>
                <td><?php echo esc_html((string)$summary['category_changes']); ?></td>
                <td><?php echo esc_html((string)$summary['stock_moves'] . ' | piezas movidas: ' . (string)$summary['stock_delta']); ?></td>
            </tr>
        </tbody>
    </table>

    <table class="widefat striped">
        <thead>
            <tr>
                <th>Fecha</th>
                <th>Tienda</th>
                <th>Empleada</th>
                <th>Acción</th>
                <th>ID</th>
                <th>Producto</th>
                <th>Antes</th>
                <th>Cambio</th>
                <th>Después</th>
                <th>Detalle</th>
                <th>Items impresión</th>
            </tr>
        </thead>
        <tbody>
        <?php if (empty($rows)): ?>
            <tr><td colspan="11">Sin registros en el rango con esos filtros.</td></tr>
        <?php else: foreach ($rows as $r): ?>
            <tr>
                <td><?php echo esc_html($r['fecha']); ?></td>
                <td><?php echo esc_html($r['tienda']); ?></td>
                <td><?php echo esc_html($r['empleada']); ?></td>
                <td><?php echo esc_html($r['accion']); ?></td>
                <td><?php echo esc_html((string)$r['id']); ?></td>
                <td><?php echo esc_html($r['producto']); ?></td>
                <td><?php echo esc_html($r['before']); ?></td>
                <td><?php echo esc_html($r['change']); ?></td>
                <td><?php echo esc_html($r['after']); ?></td>
                <td><?php echo esc_html($r['detalle']); ?></td>
                <td><?php echo esc_html($r['items']); ?></td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>
    <?php
}

public static function render_reports_view($view, $sum, $rows_sales, $rows_refunds, $rows_transfers, $rows_movements, $per_employee, $cost_meta, $from, $to, $store, $settings) {
// === Nuevos reportes (auditoría por módulos) ===
if ($view === 'bodega_audit') {
    self::render_bodega_stock_report($from, $to, $store, $settings);
    return;
}

if ($view === 'labels_audit') {
    self::render_labels_audit_report($from, $to, $store, $settings);
    return;
}

if ($view === 'ingresos' || $view === 'inventory_audit' || $view === 'codigo_audit') {
    $types = [];
    $modules = [];
    $title = '';
    if ($view === 'ingresos') { $types = ['ingresos_add']; $title = 'Ingresos (aumento de stock en tienda)'; }
    elseif ($view === 'inventory_audit') { $types = ['inventory_report']; $title = 'Inventario (conteo físico)'; }
    elseif ($view === 'codigo_audit') { $types = ['barcode_change']; $modules = ['codigo']; $title = 'Código (cambios de código de barras)'; }

    $rows = self::audit_rows_for_reports($from, $to, $store, $types, $modules);

    ?>
    <h2><?php echo esc_html($title); ?></h2>
    <table class="widefat striped">
        <thead>
            <tr>
                <th>Fecha</th><th>Tienda</th><th>Empleada</th><th>Evento</th><th>ID</th><th>Producto</th><th>Detalle</th>
            </tr>
        </thead>
        <tbody>
        <?php if (empty($rows)): ?>
            <tr><td colspan="7">Sin registros en el rango.</td></tr>
        <?php else: foreach ($rows as $r): ?>
            <tr>
                <td><?php echo esc_html($r['fecha']); ?></td>
                <td><?php echo esc_html($r['tienda']); ?></td>
                <td><?php echo esc_html($r['empleada']); ?></td>
                <td><?php echo esc_html($r['evento']); ?></td>
                <td><?php echo esc_html((string)$r['id']); ?></td>
                <td><?php echo esc_html($r['producto']); ?></td>
                <td><?php echo esc_html($r['detalle']); ?></td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>
    <?php
    return;
}


        if ($view === 'refunds') {
            ?>
            <h2>Totales devoluciones</h2>
            <p><strong>Devoluciones:</strong> <?php echo esc_html(posinv_money_plain_global($sum['refunds'])); ?> &nbsp; | &nbsp;
               <strong># tickets:</strong> <?php echo esc_html((string)$sum['count_refunds']); ?>
            </p>
            <table class="widefat striped">
                <thead>
                    <tr>
                        <th>Fecha</th><th>Tienda</th><th>Empleada</th><th>ID</th><th>Producto</th><th>Cant</th><th>Precio</th><th>Total</th>
                    </tr>
                </thead>
                <tbody>
                <?php if (empty($rows_refunds)): ?>
                    <tr><td colspan="8">Sin devoluciones en el rango.</td></tr>
                <?php else: foreach ($rows_refunds as $r): ?>
                    <tr>
                        <td><?php echo esc_html($r['fecha']); ?></td>
                        <td><?php echo esc_html($r['tienda']); ?></td>
                        <td><?php echo esc_html($r['empleada']); ?></td>
                        <td><?php echo esc_html((string)$r['id']); ?></td>
                        <td><?php echo esc_html($r['producto']); ?></td>
                        <td><?php echo esc_html((string)$r['qty']); ?></td>
                        <td><?php echo esc_html(posinv_money_plain_global($r['precio'])); ?></td>
                        <td><?php echo esc_html(posinv_money_plain_global($r['total'])); ?></td>
                    </tr>
                <?php endforeach; endif; ?>
                </tbody>
            </table>
            <?php
            return;
        }

        if ($view === 'transfers') {
            ?>
            <h2>Traspasos</h2>
            <p><strong># traspasos:</strong> <?php echo esc_html((string)$sum['count_transfers']); ?></p>
            <table class="widefat striped">
                <thead>
                    <tr>
                        <th>Fecha</th><th>De</th><th>A</th><th>Empleada</th><th>Ticket</th><th>Productos</th>
                    </tr>
                </thead>
                <tbody>
                <?php if (empty($rows_transfers)): ?>
                    <tr><td colspan="6">Sin traspasos en el rango.</td></tr>
                <?php else: foreach ($rows_transfers as $r): ?>
                    <tr>
                        <td><?php echo esc_html($r['fecha']); ?></td>
                        <td><?php echo esc_html($r['de']); ?></td>
                        <td><?php echo esc_html($r['a']); ?></td>
                        <td><?php echo esc_html($r['empleada']); ?></td>
                        <td>#<?php echo esc_html((string)$r['ticket_id']); ?></td>
                        <td><?php echo esc_html($r['items']); ?></td>
                    </tr>
                <?php endforeach; endif; ?>
                </tbody>
            </table>
            <?php
            return;
        }

        if ($view === 'employee') {
            $emp = isset($_GET['emp']) ? sanitize_text_field(wp_unslash($_GET['emp'])) : 'all';
            if ($emp === '' ) { $emp = 'all'; }
            // Build employee options from $per_employee keys
            $emp_options = [];
            foreach ($per_employee as $uid => $e) { $emp_options[(string)$uid] = $e['empleada']; }

            ?>
            <h2>Movimientos por empleada</h2>
            <p class="description">Elige una empleada para ver el detalle de movimientos (ventas / devoluciones / traspasos). La ganancia usa el meta de costo: <code><?php echo esc_html($cost_meta); ?></code>.</p>

            <form method="get" style="margin: 10px 0 14px 0; display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
                <input type="hidden" name="page" value="posinv-reports"/>
                <input type="hidden" name="view" value="employee"/>
                <input type="hidden" name="from" value="<?php echo esc_attr(isset($_GET['from'])?sanitize_text_field(wp_unslash($_GET['from'])):''); ?>"/>
                <input type="hidden" name="to" value="<?php echo esc_attr(isset($_GET['to'])?sanitize_text_field(wp_unslash($_GET['to'])):''); ?>"/>
                <input type="hidden" name="store" value="<?php echo esc_attr(isset($_GET['store'])?sanitize_text_field(wp_unslash($_GET['store'])):'all'); ?>"/>

                <div>
                    <label><strong>Empleada</strong></label><br/>
                    <select name="emp">
                        <option value="all" <?php selected($emp,'all'); ?>>Todas (solo totales)</option>
                        <?php foreach ($emp_options as $uid => $name): ?>
                            <option value="<?php echo esc_attr($uid); ?>" <?php selected($emp,$uid); ?>><?php echo esc_html($name); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div><button class="button button-primary">Ver</button></div>
            </form>

            <?php if ($emp === 'all'): ?>
                <table class="widefat striped">
                    <thead>
                        <tr>
                            <th>Empleada</th><th># Ventas</th><th>Ventas</th><th># Devol.</th><th>Devoluciones</th><th>Ganancia est.</th><th># Traspasos</th>
                        </tr>
                    </thead>
                    <tbody>
                    <?php if (empty($per_employee)): ?>
                        <tr><td colspan="7">Sin movimientos en el rango.</td></tr>
                    <?php else: foreach ($per_employee as $e): ?>
                        <tr>
                            <td><?php echo esc_html($e['empleada']); ?></td>
                            <td><?php echo esc_html((string)$e['count_sales']); ?></td>
                            <td><?php echo esc_html(posinv_money_plain_global($e['sales'])); ?></td>
                            <td><?php echo esc_html((string)$e['count_refunds']); ?></td>
                            <td><?php echo esc_html(posinv_money_plain_global($e['refunds'])); ?></td>
                            <td><?php echo esc_html(posinv_money_plain_global($e['profit'])); ?></td>
                            <td><?php echo esc_html((string)$e['count_transfers']); ?></td>
                        </tr>
                    <?php endforeach; endif; ?>
                    </tbody>
                </table>
            <?php else:
                $uid = (int) $emp;
                $label = isset($per_employee[$uid]) ? $per_employee[$uid]['empleada'] : ('ID ' . $uid);
                $agg = isset($per_employee[$uid]) ? $per_employee[$uid] : ['sales'=>0,'refunds'=>0,'profit'=>0,'count_sales'=>0,'count_refunds'=>0,'count_transfers'=>0];
            ?>
                <h3 style="margin-top:8px;"><?php echo esc_html($label); ?></h3>
                <p>
                    <strong>Ventas:</strong> <?php echo esc_html(posinv_money_plain_global($agg['sales'])); ?> (<?php echo esc_html((string)$agg['count_sales']); ?>) &nbsp; | &nbsp;
                    <strong>Devoluciones:</strong> <?php echo esc_html(posinv_money_plain_global($agg['refunds'])); ?> (<?php echo esc_html((string)$agg['count_refunds']); ?>) &nbsp; | &nbsp;
                    <strong>Ganancia est.:</strong> <?php echo esc_html(posinv_money_plain_global($agg['profit'])); ?> &nbsp; | &nbsp;
                    <strong>Traspasos:</strong> <?php echo esc_html((string)$agg['count_transfers']); ?>
                </p>

                <table class="widefat striped">
                    <thead>
                        <tr>
                            <th>Fecha</th><th>Tienda</th><th>Tipo</th><th>Ticket</th><th>Total</th><th>Ganancia est.</th><th>Hacia</th>
                        </tr>
                    </thead>
                    <tbody>
                    <?php
                        $any = false;
                        foreach ($rows_movements as $r):
                            if ((int)$r['author_id'] !== $uid) continue;
                            $any = true;
                    ?>
                        <tr>
                            <td><?php echo esc_html($r['fecha']); ?></td>
                            <td><?php echo esc_html($r['tienda']); ?></td>
                            <td><?php echo esc_html($r['tipo']); ?></td>
                            <td>#<?php echo esc_html((string)$r['ticket_id']); ?></td>
                            <td><?php echo esc_html(posinv_money_plain_global($r['total'])); ?></td>
                            <td><?php echo esc_html(posinv_money_plain_global($r['ganancia'])); ?></td>
                            <td><?php echo esc_html($r['tipo']==='transfer' && $r['to_store'] ? self::store_name_for_key($r['to_store']) : ''); ?></td>
                        </tr>
                    <?php endforeach;
                        if (!$any):
                    ?>
                        <tr><td colspan="7">Sin movimientos para esta empleada en el rango.</td></tr>
                    <?php endif; ?>
                    </tbody>
                </table>
            <?php endif; ?>
            <?php
            return;
        }

        if ($view === 'movements') {
            ?>
            <h2>Movimientos</h2>
            <p class="description">Lista de tickets (venta / devolución / traspaso).</p>
            <table class="widefat striped">
                <thead>
                    <tr>
                        <th>Fecha</th><th>Tienda</th><th>Tipo</th><th>Empleada</th><th>Ticket</th><th>Total</th><th>Ganancia est.</th><th>Hacia</th>
                    </tr>
                </thead>
                <tbody>
                <?php if (empty($rows_movements)): ?>
                    <tr><td colspan="8">Sin movimientos en el rango.</td></tr>
                <?php else: foreach ($rows_movements as $r): ?>
                    <tr>
                        <td><?php echo esc_html($r['fecha']); ?></td>
                        <td><?php echo esc_html($r['tienda']); ?></td>
                        <td><?php echo esc_html($r['tipo']); ?></td>
                        <td><?php echo esc_html($r['empleada']); ?></td>
                        <td>#<?php echo esc_html((string)$r['ticket_id']); ?></td>
                        <td><?php echo esc_html(posinv_money_plain_global($r['total'])); ?></td>
                        <td><?php echo esc_html(posinv_money_plain_global($r['ganancia'])); ?></td>
                        <td><?php echo esc_html($r['tipo']==='transfer' && $r['to_store'] ? self::store_name_for_key($r['to_store']) : ''); ?></td>
                    </tr>
                <?php endforeach; endif; ?>
                </tbody>
            </table>

	            <hr />
	            <h2>Movimientos en módulos (Stock+, Etiquetas, Código, Inventario)</h2>
	            <p class="description">Aquí aparecen acciones hechas desde esas pestañas: ajuste de stock, cambios de precio/categoría/código y cierres de inventario.</p>
	            <?php
	            $audit_types = ['stock_adjust','price_change','category_change','barcode_change','inventory_report'];
	            $store_q = isset($_GET['store']) ? sanitize_text_field(wp_unslash($_GET['store'])) : '';
	            $aq = [
	                'post_type'      => 'pos_audit',
	                'post_status'    => 'publish',
	                'posts_per_page' => 200,
	                'orderby'        => 'date',
	                'order'          => 'DESC',
	                'date_query'     => [[
	                    'after'     => $from,
	                    'before'    => $to,
	                    'inclusive' => true,
	                ]],
	                'meta_query'     => [
	                    [
	                        'key'     => '_posinv_audit',
	                        'compare' => 'EXISTS',
	                    ],
	                ],
	            ];
	            if ($store_q) {
	                // meta serializado, usamos LIKE simple
	                $aq['meta_query'][] = [
	                    'key'     => '_posinv_audit',
	                    'value'   => '"store";s:' . strlen($store_q) . ':"' . $store_q . '"',
	                    'compare' => 'LIKE',
	                ];
	            }
	            $audit_posts = get_posts($aq);
	            $audit_rows = [];
	            foreach ((array)$audit_posts as $p) {
	                $a = get_post_meta($p->ID, '_posinv_audit', true);
	                if (!is_array($a)) continue;
	                $type = (string)($a['type'] ?? '');
	                if (!in_array($type, $audit_types, true)) continue;
	                $data = is_array($a['data'] ?? null) ? $a['data'] : [];
	                $audit_rows[] = [
	                    'date' => get_the_date('Y-m-d H:i:s', $p),
	                    'user_id' => (int)($a['user_id'] ?? 0),
	                    'type' => $type,
	                    'module' => (string)($data['module'] ?? ''),
	                    'store' => (string)($data['store'] ?? ''),
	                    'product_id' => (int)($data['product_id'] ?? 0),
	                    'product' => (string)($data['product'] ?? ''),
	                    'data' => $data,
	                ];
	            }

	            if (!$audit_rows) {
	                echo '<p><em>Sin movimientos en módulos en el rango.</em></p>';
	            } else {
	                echo '<table class="widefat striped"><thead><tr>';
	                echo '<th>Fecha</th><th>Tienda</th><th>Módulo</th><th>Empleada</th><th>Acción</th><th>Producto</th><th>Detalle</th>';
	                echo '</tr></thead><tbody>';
	                foreach ($audit_rows as $r) {
	                    $u = $r['user_id'] ? get_userdata($r['user_id']) : null;
	                    $uname = $u ? $u->display_name : ('UID ' . (int)$r['user_id']);
	                    $store_label = $r['store'] ? self::store_name_for_key($r['store']) : '';
	                    $action = $r['type'];
	                    if ($action === 'stock_adjust') $action = 'Ajuste stock';
	                    if ($action === 'price_change') $action = 'Cambio precio';
	                    if ($action === 'category_change') $action = 'Cambio categoría';
	                    if ($action === 'barcode_change') $action = 'Cambio código';
	                    if ($action === 'inventory_report') $action = 'Cierre inventario';

	                    $prodTxt = $r['product_id'] ? ('#' . (int)$r['product_id'] . ' ' . esc_html($r['product'])) : '';
	                    $d = (array)$r['data'];
	                    $detail = '';
	                    if ($r['type'] === 'stock_adjust') {
	                        $detail = 'Δ ' . (string)($d['delta'] ?? '') . ' (antes ' . (string)($d['before'] ?? '') . ', después ' . (string)($d['after'] ?? '') . ')';
	                    } elseif ($r['type'] === 'price_change') {
	                        $detail = (string)($d['old'] ?? '') . ' → ' . (string)($d['new'] ?? '');
	                    } elseif ($r['type'] === 'barcode_change') {
	                        $detail = (string)($d['old'] ?? '') . ' → ' . (string)($d['new'] ?? '');
	                    } elseif ($r['type'] === 'category_change') {
	                        $detail = (string)($d['categories'] ?? '');
	                    } elseif ($r['type'] === 'inventory_report') {
	                        $detail = 'Sesión ' . (string)($d['session_id'] ?? '') . ' | Contados: ' . (string)($d['counted_items'] ?? '') . ' | Dif.: ' . (string)($d['diff_rows'] ?? '') . ' (falt: ' . (string)($d['missing_rows'] ?? '') . ', sobr: ' . (string)($d['extra_rows'] ?? '') . ')';
	                    }

	                    echo '<tr>';
	                    echo '<td>' . esc_html($r['date']) . '</td>';
	                    echo '<td>' . esc_html($store_label) . '</td>';
	                    echo '<td>' . esc_html($r['module']) . '</td>';
	                    echo '<td>' . esc_html($uname) . '</td>';
	                    echo '<td>' . esc_html($action) . '</td>';
	                    echo '<td>' . $prodTxt . '</td>';
	                    echo '<td>' . esc_html($detail) . '</td>';
	                    echo '</tr>';
	                }
	                echo '</tbody></table>';
	            }
	            ?>
            <?php
            return;
        }

        if ($view === 'summary') {
            ?>
            <h2>Resumen</h2>
            <table class="widefat striped">
                <tbody>
                    <tr><th>Ventas</th><td><?php echo esc_html(posinv_money_plain_global($sum['sales'])); ?></td><th># Tickets</th><td><?php echo esc_html((string)$sum['count_sales']); ?></td></tr>
                    <tr><th>Devoluciones</th><td><?php echo esc_html(posinv_money_plain_global($sum['refunds'])); ?></td><th># Tickets</th><td><?php echo esc_html((string)$sum['count_refunds']); ?></td></tr>
                    <tr><th>Ganancia estimada (ventas)</th><td><?php echo esc_html(posinv_money_plain_global($sum['profit'])); ?></td><th># Traspasos</th><td><?php echo esc_html((string)$sum['count_transfers']); ?></td></tr>
                </tbody>
            </table>
            <?php
            return;
        }

        // Default: Sales
        ?>
        <h2>Totales ventas</h2>
        <p><strong>Ventas:</strong> <?php echo esc_html(posinv_money_plain_global($sum['sales'])); ?> &nbsp; | &nbsp;
           <strong>Ganancia estimada:</strong> <?php echo esc_html(posinv_money_plain_global($sum['profit'])); ?> &nbsp; | &nbsp;
           <strong># tickets:</strong> <?php echo esc_html((string)$sum['count_sales']); ?>
        </p>
        <p class="description">La ganancia usa el meta de costo: <code><?php echo esc_html($cost_meta); ?></code>.</p>

        <h2>Detalle</h2>
        <table class="widefat striped">
            <thead>
                <tr>
                    <th>Fecha</th><th>Tienda</th><th>Empleada</th><th>ID</th><th>Producto</th><th>Cant</th><th>Precio</th><th>Precio original</th><th>Motivo</th><th>Total</th><th>Ganancia</th>
                </tr>
            </thead>
            <tbody>
            <?php if (empty($rows_sales)): ?>
                <tr><td colspan="11">Sin ventas en el rango.</td></tr>
            <?php else: foreach ($rows_sales as $r): ?>
                <tr>
                    <td><?php echo esc_html($r['fecha']); ?></td>
                    <td><?php echo esc_html($r['tienda']); ?></td>
                    <td><?php echo esc_html($r['empleada']); ?></td>
                    <td><?php echo esc_html((string)$r['id']); ?></td>
                    <td><?php echo esc_html($r['producto']); ?></td>
                    <td><?php echo esc_html((string)$r['qty']); ?></td>
                    <td><?php echo esc_html(posinv_money_plain_global($r['precio'])); ?></td>
                    <td><?php echo ($r['precio_original'] === '' ? '' : esc_html(posinv_money_plain_global($r['precio_original']))); ?></td>
                    <td><?php echo esc_html((string)($r['motivo'] ?? '')); ?></td>
                    <td><?php echo esc_html(posinv_money_plain_global($r['total'])); ?></td>
                    <td><?php echo esc_html(posinv_money_plain_global($r['ganancia'])); ?></td>
                </tr>
            <?php endforeach; endif; ?>
            </tbody>
        </table>
        <?php
    }

    public static function register_rest() {
        register_rest_route(self::NS, '/products', [
            'methods' => 'GET',
            'permission_callback' => [__CLASS__, 'rest_perm_pos'],
            'callback' => [__CLASS__, 'rest_products'],
            'args' => [
                'q' => ['required' => false],
                'store' => ['required' => true],
                'cat' => ['required' => false],
                'limit' => ['required' => false],
            ]
        ]);

        register_rest_route(self::NS, '/ticket', [
            'methods' => 'POST',
            'permission_callback' => [__CLASS__, 'rest_perm_pos'],
            'callback' => [__CLASS__, 'rest_create_ticket'],
        ]);

        register_rest_route(self::NS, '/ticket/find', [
            'methods' => 'GET',
            'permission_callback' => [__CLASS__, 'rest_perm_pos'],
            'callback' => [__CLASS__, 'rest_find_ticket'],
        ]);

        
        // Deshacer ticket (último inmediato) - solo si no se ha deshecho antes
        register_rest_route(self::NS, '/ticket/undo', [
            'methods' => 'POST',
            'permission_callback' => [__CLASS__, 'rest_perm_pos'],
            'callback' => [__CLASS__, 'rest_undo_ticket'],
        ]);

        // Clientes: buscar usuarios existentes (no crea usuarios)
        register_rest_route(self::NS, '/customers', [
            'methods' => 'GET',
            'permission_callback' => [__CLASS__, 'rest_perm_pos'],
            'callback' => [__CLASS__, 'rest_customers_search'],
            'args' => [
                'q' => ['required' => false],
                'limit' => ['required' => false],
            ]
        ]);

        // Corte de caja / turnos
        register_rest_route(self::NS, '/shift/current', [
            'methods' => 'GET',
            'permission_callback' => [__CLASS__, 'rest_perm_pos'],
            'callback' => [__CLASS__, 'rest_shift_current'],
        ]);
        register_rest_route(self::NS, '/shift/open', [
            'methods' => 'POST',
            'permission_callback' => [__CLASS__, 'rest_perm_pos'],
            'callback' => [__CLASS__, 'rest_shift_open'],
        ]);
        register_rest_route(self::NS, '/shift/withdraw', [
            'methods' => 'POST',
            'permission_callback' => [__CLASS__, 'rest_perm_pos'],
            'callback' => [__CLASS__, 'rest_shift_withdraw'],
        ]);
        register_rest_route(self::NS, '/shift/close', [
            'methods' => 'POST',
            'permission_callback' => [__CLASS__, 'rest_perm_pos'],
            'callback' => [__CLASS__, 'rest_shift_close'],
        ]);

        // Entrada / aumento de stock (cola)
        register_rest_route(self::NS, '/stockin', [
            'methods' => 'POST',
            'permission_callback' => [__CLASS__, 'rest_perm_pos'],
            'callback' => [__CLASS__, 'rest_stockin'],
        ]);

	        // Ingresos: aumentar stock por tienda (multi-producto)
	        register_rest_route(self::NS, '/ingresos', [
	            'methods' => 'POST',
	            'permission_callback' => [__CLASS__, 'rest_perm_pos'],
	            'callback' => [__CLASS__, 'rest_ingresos'],
	        ]);

        // Crear producto desde POS
        register_rest_route(self::NS, '/create-product', [
            'methods' => 'POST',
            'permission_callback' => [__CLASS__, 'rest_perm_pos'],
            'callback' => [__CLASS__, 'rest_create_product'],
        ]);
    }

    public static function rest_perm_pos() {
        return is_user_logged_in() && self::can_use_pos();
    }

    public static function rest_products(WP_REST_Request $req) {
        if (!class_exists('WooCommerce')) return new WP_Error('no_wc', 'WooCommerce no está activo', ['status'=>400]);

        $q = sanitize_text_field($req->get_param('q'));
        $store = sanitize_text_field($req->get_param('store'));
        $cat = intval($req->get_param('cat') ?: 0);

        $limit = intval($req->get_param('limit') ?: 20);
        $limit = max(1, min(50, $limit));

        $role_store = self::current_store_key();
        $u = wp_get_current_user();
        $locked = (in_array('pos_san_mateo', (array)$u->roles, true) || in_array('pos_xaltocan', (array)$u->roles, true));
        if ($locked) $store = $role_store;

        $stock_meta = self::store_meta_for_key($store);
        if (!$stock_meta) return new WP_Error('bad_store', 'Tienda inválida', ['status'=>400]);

        $s = self::get_settings();
        $barcode_meta = $s['barcode_meta'];

        $q = trim($q);
        if ($q === '' && $cat <= 0) {
            return rest_ensure_response(['items' => []]);
        }

        // 1) Búsqueda principal: WP_Query con filtro por categoría (term_id) y/o texto
        $wpq_args = [
            'post_type'      => 'product',
            'post_status'    => ['publish','private'],
            'posts_per_page' => $limit,
            'fields'         => 'ids',
            'orderby'        => 'title',
            'order'          => 'ASC',
            'no_found_rows'  => true,
        ];
        if ($q !== '') $wpq_args['s'] = $q;
        if ($cat > 0) {
            $wpq_args['tax_query'] = [[
                'taxonomy' => 'product_cat',
                'field'    => 'term_id',
                'terms'    => [$cat],
            ]];
        }

        $ids = (new WP_Query($wpq_args))->posts;

        // 2) Si faltan resultados y tenemos query, intenta match exacto por ID / SKU / barcode
        if ($q !== '' && count($ids) < $limit) {
            global $wpdb;

            $extra_ids = [];
            // Si q es numérico, prueba ID exacto
            if (ctype_digit($q)) {
                $pid = intval($q);
                if ($pid > 0) $extra_ids[] = $pid;
            }

            // Match exacto en SKU o barcode meta
            $meta_sql = $wpdb->prepare("
                SELECT p.ID
                FROM {$wpdb->posts} p
                INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID
                WHERE p.post_type = 'product'
                  AND p.post_status IN ('publish','private')
                  AND ((pm.meta_key = '_sku' AND pm.meta_value = %s) OR (pm.meta_key = %s AND pm.meta_value = %s))
                LIMIT %d
            ", $q, $barcode_meta, $q, $limit);

            $found = $wpdb->get_col($meta_sql);
            if ($found) $extra_ids = array_merge($extra_ids, array_map('intval', $found));

            // Si hay filtro de categoría, filtra extra_ids por esa categoría
            if ($cat > 0 && $extra_ids) {
                $filtered = [];
                foreach (array_unique($extra_ids) as $pid) {
                    if (has_term($cat, 'product_cat', $pid)) $filtered[] = $pid;
                }
                $extra_ids = $filtered;
            } else {
                $extra_ids = array_unique($extra_ids);
            }

            // Mezclar al inicio para que el exact match aparezca primero
            foreach ($extra_ids as $pid) {
                if (!in_array($pid, $ids, true)) array_unshift($ids, $pid);
            }

            // recortar al límite
            $ids = array_slice($ids, 0, $limit);
        }
foreach ($ids as $id) {
            $p = wc_get_product($id);
            if (!$p) continue;
            $pid = $p->get_id();
            $img = wp_get_attachment_image_url($p->get_image_id(), 'thumbnail');
            if (!$img) $img = wc_placeholder_img_src('thumbnail');

            $sku = $p->get_sku();
            $barcode = get_post_meta($pid, $barcode_meta, true);
            if (!$barcode) $barcode = $sku;

            $stock = get_post_meta($pid, $stock_meta, true);
            $stock = is_numeric($stock) ? (float)$stock : 0.0;

            $out[] = [
                'id' => $pid,
                'type' => $p->get_type(),
                'name' => $p->get_name(),
                'sku' => $sku,
                'barcode' => $barcode,
                'price' => (float)$p->get_price(),
                'image' => $img,
                'stock' => $stock,
            ];
        }

        return rest_ensure_response([
            'store' => $store,
            'stock_meta' => $stock_meta,
            'results' => $out,
        ]);
    }

    private static function update_stock($product_id, $store_key, $delta, $allow_negative = false) {
        $meta = self::store_meta_for_key($store_key);
        if (!$meta) return new WP_Error('bad_store', 'Tienda inválida', ['status'=>400]);
        $cur = get_post_meta($product_id, $meta, true);
        $cur = is_numeric($cur) ? (float)$cur : 0.0;
        $new = $cur + (float)$delta;

        // Por defecto NO permite negativos. Se puede habilitar en Ajustes.
        if ($new < 0 && !$allow_negative) {
            return new WP_Error('no_stock', 'Stock insuficiente', ['status'=>409, 'current'=>$cur]);
        }

        // If negative stock is allowed, log for audit.
        if ($new < 0 && $allow_negative) {
            $ctx = [
                'source' => 'pos-inventario-woo_native',
                'product_id' => (int)$product_id,
                'store' => (string)$store_key,
                'delta' => (float)$delta,
                'from'  => (float)$cur,
                'to'    => (float)$new,
                'user_id' => (int)get_current_user_id(),
            ];
            if (function_exists('wc_get_logger')) {
                wc_get_logger()->warning('POS allowed negative stock.', $ctx);
            } else {
                error_log('POS allowed negative stock: ' . wp_json_encode($ctx));
            }
        }

        update_post_meta($product_id, $meta, (string)$new);
        return $new;
    }

    // Set absoluto del stock (solo tienda)
    private static function set_stock_value($product_id, $store_key, $value) {
        $meta = self::store_meta_key($store_key);
        if (!$meta) return new WP_Error('bad_store', 'Tienda inválida', ['status'=>400]);
        $v = (float)$value;
        update_post_meta($product_id, $meta, (string)$v);
        return $v;
    }

    
    // =========================
    // Tickets: buscar ticket previo (para devoluciones)
    // =========================
    public static function rest_find_ticket(WP_REST_Request $req) {
        $q = sanitize_text_field((string)($req->get_param('q') ?? ''));
        $q = trim($q);
        if ($q === '') return new WP_Error('no_q', 'Sin búsqueda', ['status'=>400]);

        // Normaliza: si viene algo como "TICKET-123" o QR con texto, extrae el primer número.
        $id = 0;
        if (ctype_digit($q)) {
            $id = (int)$q;
        } else {
            if (preg_match('/(\d{3,})/', $q, $mm)) {
                $id = (int)$mm[1];
            }
        }
        if ($id <= 0) return new WP_Error('bad_ticket', 'Ticket inválido', ['status'=>400]);

        $p = get_post($id);
        if (!$p || $p->post_type !== 'pos_ticket') {
            return new WP_Error('not_found', 'No existe ese ticket', ['status'=>404]);
        }

        $payload = get_post_meta($id, '_posinv', true);
        if (!is_array($payload)) $payload = [];

        $undone = (int) get_post_meta($id, '_posinv_undone', true);

        // Resumen amigable
        $created = '';
        if (!empty($payload['created'])) $created = (string)$payload['created'];
        if (!$created && !empty($p->post_date_gmt)) $created = get_date_from_gmt($p->post_date_gmt, 'c');

        return rest_ensure_response([
            'ok' => true,
            'ticket_id' => (int)$id,
            'undone' => $undone ? 1 : 0,
            'created' => $created,
            'meta' => $payload,
        ]);
    }

public static function rest_create_ticket(WP_REST_Request $req) {
        if (!class_exists('WooCommerce')) return new WP_Error('no_wc', 'WooCommerce no está activo', ['status'=>400]);

        $body = $req->get_json_params();
        if (!is_array($body)) $body = [];

        $type = sanitize_text_field($body['type'] ?? 'sale');
        $store = sanitize_text_field($body['store'] ?? self::current_store_key());
        $to_store = sanitize_text_field($body['to_store'] ?? '');
        // Devolución: vínculo a ticket original / motivo / tipo
        $return_in = $body['return'] ?? [];
        $return = [
            'original_ticket_id' => 0,
            'reason' => '',
            'return_type' => 'inventory', // inventory | merma
        ];
        if (is_array($return_in)) {
            $return['original_ticket_id'] = intval($return_in['original_ticket_id'] ?? 0);
            $return['reason'] = sanitize_text_field($return_in['reason'] ?? '');
            $rt = sanitize_text_field($return_in['return_type'] ?? 'inventory');
            if (!in_array($rt, ['inventory','merma'], true)) $rt = 'inventory';
            $return['return_type'] = $rt;
        }


        // Cliente (nuevo): objeto estructurado (no crea usuario)
        $customer_obj_in = $body['customer_obj'] ?? null;
        $customer_obj = ['type' => 'none'];
        $customer = '';
        if (is_array($customer_obj_in)) {
            $ctype = sanitize_text_field($customer_obj_in['type'] ?? 'none');
            if ($ctype === 'user') {
                $uid = intval($customer_obj_in['user_id'] ?? 0);
                $name = sanitize_text_field($customer_obj_in['name'] ?? '');
                $phone = sanitize_text_field($customer_obj_in['phone'] ?? '');
                $email = sanitize_text_field($customer_obj_in['email'] ?? '');
                if ($uid > 0) {
                    $customer_obj = ['type'=>'user','user_id'=>$uid,'name'=>$name,'phone'=>$phone,'email'=>$email];
                    $customer = $name ? $name : ('Usuario #' . $uid);
                }
            } elseif ($ctype === 'quick') {
                $name = sanitize_text_field($customer_obj_in['name'] ?? '');
                $phone = sanitize_text_field($customer_obj_in['phone'] ?? '');
                if ($name !== '' || $phone !== '') {
                    $customer_obj = ['type'=>'quick','name'=>$name,'phone'=>$phone];
                    $customer = trim($name . ($phone ? (' ' . $phone) : ''));
                }
            }
        }
        if ($customer === '') $customer = sanitize_text_field($body['customer'] ?? ''); // compat
        // Pago / descuentos ticket
        $payment_in = $body['payment'] ?? [];
        $payment = ['method'=>'none','cash'=>0.0,'transfer'=>0.0,'card'=>0.0];
        if (is_array($payment_in)) {
            $m = sanitize_text_field($payment_in['method'] ?? 'none');
            $payment['method'] = $m;
            $payment['cash'] = isset($payment_in['cash']) ? (float)$payment_in['cash'] : 0.0;
            $payment['transfer'] = isset($payment_in['transfer']) ? (float)$payment_in['transfer'] : 0.0;
            $payment['card'] = isset($payment_in['card']) ? (float)$payment_in['card'] : 0.0;
        }
        $layaway_in = $body['layaway'] ?? null;
        $layaway = ['deposit' => 0.0, 'remaining' => 0.0];
        if (is_array($layaway_in)) {
            $layaway['deposit'] = isset($layaway_in['deposit']) ? (float)$layaway_in['deposit'] : 0.0;
            $layaway['remaining'] = isset($layaway_in['remaining']) ? (float)$layaway_in['remaining'] : 0.0;
        }
        $ticket_discount = $body['ticket_discount'] ?? ['type'=>'none','value'=>0];
        $ticket_discount_type = is_array($ticket_discount) ? sanitize_text_field($ticket_discount['type'] ?? 'none') : 'none';
        $ticket_discount_value = is_array($ticket_discount) ? (float)($ticket_discount['value'] ?? 0) : 0.0;

        $items = $body['items'] ?? [];

        // Permitir inventario negativo (si está activado en ajustes del plugin)
        $settings = self::get_settings();
        $allow_negative = (($settings["allow_negative_stock"] ?? "0") === "1");

        if (!in_array($type, ['sale','return','layaway'], true)) {
            return new WP_Error('bad_type', 'Tipo inválido', ['status'=>400]);
        }

        $role_store = self::current_store_key();
        $u = wp_get_current_user();
        $locked = (in_array('pos_san_mateo', (array)$u->roles, true) || in_array('pos_xaltocan', (array)$u->roles, true));
        if ($locked) $store = $role_store;

        if (!$items || !is_array($items)) return new WP_Error('no_items', 'Sin productos', ['status'=>400]);

        $norm_items = [];
        $price_overrides = [];
        foreach ($items as $it) {
            $pid = intval($it['product_id'] ?? 0);
            $qty = isset($it['qty']) ? (float)$it['qty'] : 0.0;
            $price = isset($it['price']) ? (float)$it['price'] : null;
            $price_reason = sanitize_text_field($it['price_reason'] ?? '');
            $discount_type = sanitize_text_field($it['discount_type'] ?? 'none');
            if (!in_array($discount_type, ['none','percent','amount'], true)) $discount_type = 'none';
            $discount_value = isset($it['discount_value']) ? (float)$it['discount_value'] : 0.0;
            if ($discount_value < 0) $discount_value = 0.0;

            if ($pid <= 0 || $qty <= 0) continue;

            $p = wc_get_product($pid);
            if (!$p) continue;

            $wc_price = (float)$p->get_price();
            if ($price === null || $price < 0) $price = $wc_price;

            // Auditoría: si POS trae precio distinto al de WooCommerce, dejar registro.
            if (abs($wc_price - (float)$price) > 0.001) {
                $price_overrides[] = [
                    'product_id' => $pid,
                    'name' => $p->get_name(),
                    'wc_price' => $wc_price,
                    'pos_price' => (float)$price,
                    'qty' => $qty,
                    'reason' => $price_reason,
                ];
            }

            $norm_items[] = [
                'product_id' => $pid,
                'qty' => $qty,
                'price' => $price,
                'wc_price' => $wc_price,
                'price_reason' => $price_reason,
                'discount_type' => $discount_type,
                'discount_value' => (float)$discount_value,
                'sku' => $p->get_sku(),
                'name' => $p->get_name(),
            ];
        }
        if (empty($norm_items)) return new WP_Error('no_items', 'Sin productos válidos', ['status'=>400]);

        if ($type === 'transfer') {
            if (!$to_store || !in_array($to_store, ['store1','store2'], true) || $to_store === $store) {
                return new WP_Error('bad_transfer', 'Traspaso inválido', ['status'=>400]);
            }
        }

        
        // Totales (servidor): aplica descuentos por producto y por ticket
        $subtotal = 0.0;
        $disc_lines = 0.0;
        foreach ($norm_items as $itx) {
            $line_base = (float)$itx['price'] * (float)$itx['qty'];
            $d = 0.0;
            if (($itx['discount_type'] ?? 'none') === 'percent') {
                $d = $line_base * ((float)($itx['discount_value'] ?? 0) / 100.0);
            } elseif (($itx['discount_type'] ?? 'none') === 'amount') {
                $d = (float)($itx['discount_value'] ?? 0);
            }
            if ($d < 0) $d = 0.0;
            if ($d > $line_base) $d = $line_base;
            $disc_lines += $d;
            $subtotal += max(0.0, $line_base - $d);
        }
        $disc_ticket = 0.0;
        if ($ticket_discount_type === 'percent') {
            $disc_ticket = $subtotal * ($ticket_discount_value / 100.0);
        } elseif ($ticket_discount_type === 'amount') {
            $disc_ticket = $ticket_discount_value;
        }
        if ($disc_ticket < 0) $disc_ticket = 0.0;
        if ($disc_ticket > $subtotal) $disc_ticket = $subtotal;
        $total = max(0.0, $subtotal - $disc_ticket);

        $totals = [
            'subtotal' => (float)$subtotal,
            'total' => (float)$total,
            'disc_lines' => (float)$disc_lines,
            'disc_ticket' => (float)$disc_ticket,
            'ticket_discount' => ['type' => $ticket_discount_type, 'value' => (float)$ticket_discount_value],
        ];

        // Validación simple de pagos para venta / apartado
        if ($type === 'sale' || $type === 'layaway') {
            $sum = (float)($payment['cash'] ?? 0) + (float)($payment['transfer'] ?? 0) + (float)($payment['card'] ?? 0);
            if ($type === 'sale' && abs($sum - $total) > 0.05) {
                return new WP_Error('bad_payment', 'El pago no cuadra con el total.', ['status'=>400, 'total'=>$total, 'sum'=>$sum]);
            }
            if ($type === 'layaway') {
                $deposit = (float)($layaway['deposit'] ?? 0);
                if ($deposit <= 0 || $deposit - $total > 0.05) {
                    return new WP_Error('bad_layaway', 'El anticipo del apartado es inválido.', ['status'=>400, 'detail'=>'El anticipo debe ser mayor que 0 y no mayor al total del ticket.']);
                }
                if (abs($sum - $deposit) > 0.05) {
                    return new WP_Error('bad_payment', 'El pago no cuadra con el anticipo del apartado.', ['status'=>400, 'total'=>$deposit, 'sum'=>$sum]);
                }
                $cname = trim((string)($customer_obj['name'] ?? ''));
                $cphone = trim((string)($customer_obj['phone'] ?? ''));
                if ($cname === '' || $cphone === '') {
                    return new WP_Error('layaway_customer', 'Falta nombre o celular del cliente para el apartado.', ['status'=>400]);
                }
                $layaway['remaining'] = max(0.0, $total - $deposit);
            }
            if ($type === 'sale') {
                $sid_check = self::shift_find_open($store, get_current_user_id());
                if (!$sid_check) return new WP_Error('no_shift', 'Primero abre turno antes de registrar ventas.', ['status'=>409]);
            }
        }
$applied = [];
        foreach ($norm_items as $it) {
            $pid = $it['product_id'];
            $qty = $it['qty'];
            if ($type === 'sale') {
                $res = self::update_stock($pid, $store, -$qty, $allow_negative);
                if (is_wp_error($res)) { self::rollback($applied); return $res; }
                $applied[] = [$pid, $store, +$qty];
            } elseif ($type === 'return') {
                // Si es merma, NO vuelve a stock (solo queda registrado el ticket de devolución).
                if (($return['return_type'] ?? 'inventory') !== 'merma') {
                    $res = self::update_stock($pid, $store, +$qty);
                    if (is_wp_error($res)) { self::rollback($applied); return $res; }
                    $applied[] = [$pid, $store, -$qty];
                }
            } elseif ($type === 'transfer') {
                $res1 = self::update_stock($pid, $store, -$qty, $allow_negative);
                if (is_wp_error($res1)) { self::rollback($applied); return $res1; }
                $applied[] = [$pid, $store, +$qty];

                $res2 = self::update_stock($pid, $to_store, +$qty);
                if (is_wp_error($res2)) { self::rollback($applied); return $res2; }
                $applied[] = [$pid, $to_store, -$qty];
            }
        }

        $title = strtoupper($type) . ' - ' . self::store_name_for_key($store) . ' - ' . current_time('Y-m-d H:i');
        $ticket_id = wp_insert_post([
            'post_type' => 'pos_ticket',
            'post_status' => 'publish',
            'post_title' => $title,
            'post_author' => get_current_user_id(),
        ], true);
        if (is_wp_error($ticket_id)) {
            self::rollback($applied);
            return $ticket_id;
        }

        $payload = [
            'type' => $type,
            'store' => $store,
            'to_store' => $to_store,
            'return' => ($type === 'return' ? $return : null),
            'customer' => $customer,
            'customer_obj' => $customer_obj,
            'payment' => $payment,
            'layaway' => ($type === 'layaway' ? $layaway : null),
            'totals' => $totals,
            'items' => $norm_items,
            'created' => current_time('c'),
        ];
        update_post_meta($ticket_id, '_posinv', $payload);
        // Auditoría: devolución vinculada / motivo / tipo
        if ($type === 'return') {
            self::audit_add('return', [
                'ticket_id' => (int)$ticket_id,
                'store' => $store,
                'original_ticket_id' => (int)($return['original_ticket_id'] ?? 0),
                'reason' => (string)($return['reason'] ?? ''),
                'return_type' => (string)($return['return_type'] ?? 'inventory'),
            ]);
        }


        // Turno: acumular ventas para corte de caja
        if ($type === 'sale' || $type === 'layaway') {
            self::shift_apply_sale($store, $ticket_id, $totals, $payment);
        }


        // Auditoría: overrides de precio
        if (!empty($price_overrides)) {
            foreach ($price_overrides as $ov) {
                self::audit_add('price_override', [
                    'ticket_id' => $ticket_id,
                    'type' => $type,
                    'store' => $store,
                    'product_id' => $ov['product_id'],
                    'product' => $ov['name'],
                    'wc_price' => $ov['wc_price'],
                    'pos_price' => $ov['pos_price'],
                    'qty' => $ov['qty'],
                    'reason' => $ov['reason'] ?? '',
                ]);
            }
        }

        $print_url = add_query_arg([
            'posinv_print' => 1,
            'ticket_id' => $ticket_id,
        ], home_url('/'));

        return rest_ensure_response([
            'ok' => true,
            'ticket_id' => $ticket_id,
            'print_url' => $print_url,
            'meta' => $payload,
        ]);
    }

    private static function rollback($applied) {
        foreach (array_reverse($applied) as $a) {
            [$pid, $store, $delta] = $a;
            self::update_stock($pid, $store, $delta);
        }
    }
    // ====== BARCODES / ETIQUETAS (50x25mm) ======

    public static function enqueue_barcodes_admin($hook) {
        // Solo cargar en nuestra página: POS Inventario -> Etiquetas
        if ($hook !== 'pos-inventario_page_posinv-barcodes' && $hook !== 'toplevel_page_posinv-barcodes') {
            // Dependiendo de WP, el $hook suele ser: 'pos-inventario_page_posinv-barcodes' o 'posinv_page_posinv-barcodes'
            // Mejor: validar también por parámetro GET
            $page = isset($_GET['page']) ? sanitize_key($_GET['page']) : '';
            if ($page !== 'posinv-barcodes') return;
        }

        // Permisos: admin y empleadas (pos_use)
        if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
            return;
        }

        wp_enqueue_style('posinv-barcodes', plugin_dir_url(__FILE__) . 'assets/barcodes.css', [], self::VERSION);
        wp_enqueue_script('posinv-barcodes', plugin_dir_url(__FILE__) . 'assets/barcodes.js', ['jquery'], self::VERSION, true);

        
        $terms = get_terms([
            'taxonomy' => 'product_cat',
            'hide_empty' => false,
        ]);
        $cats = [];
        if (!is_wp_error($terms)) {
            foreach ($terms as $t) {
                $cats[] = ['id' => (int)$t->term_id, 'name' => $t->name];
            }
        }

        wp_localize_script('posinv-barcodes', 'POSINV_BARCODES', [
            'ajaxurl' => admin_url('admin-ajax.php'),
            'nonce'   => wp_create_nonce('posinv_barcodes_nonce'),
            'product_cats' => $cats,
        ]);
    }

    public static function ajax_barcode_search() {
        if (!check_ajax_referer('posinv_barcodes_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }

        $s = self::get_settings();
        $barcode_meta = !empty($s['barcode_meta']) ? $s['barcode_meta'] : '_op_barcode';

        $q = isset($_POST['q']) ? sanitize_text_field(wp_unslash($_POST['q'])) : '';
        $cat = isset($_POST['cat']) ? absint($_POST['cat']) : 0;
        $module = isset($_POST['module']) ? sanitize_text_field(wp_unslash($_POST['module'])) : '';
        $store = isset($_POST['store']) ? sanitize_text_field(wp_unslash($_POST['store'])) : self::current_store_key();
        $meta_key = self::store_meta_for_key($store);
        $default_limit = 30;
        $per_page = isset($_POST['per_page']) ? absint($_POST['per_page']) : $default_limit;
        if ($per_page < 1) $per_page = $default_limit;
        if ($per_page > 200) $per_page = 200;
        $offset = isset($_POST['offset']) ? absint($_POST['offset']) : 0;
        $limit = $per_page;
        $args = [
            'post_type'      => 'product',
            'post_status'    => ['publish', 'private', 'draft'],
            'posts_per_page' => $limit,
            'fields'         => 'ids',
            'no_found_rows'  => true,
        ];

        $paged_modules = ['codigo', 'labels', 'bodega', 'ingresos'];
        $wrap_response = in_array($module, $paged_modules, true) || isset($_POST['per_page']) || isset($_POST['offset']);
        if ($wrap_response) {
            $args['orderby'] = 'date';
            $args['order'] = 'DESC';
            $args['offset'] = $offset;
        } else {
            $args['orderby'] = 'date';
            $args['order'] = 'DESC';
        }

        if ($cat > 0) {
            $args['tax_query'] = [[
                'taxonomy' => 'product_cat',
                'field'    => 'term_id',
                'terms'    => [$cat],
            ]];
        }

        $q = trim($q);
        // 1) Reunir coincidencias exactas por ID / SKU / barcode
        $exact_ids = [];
        if ($q !== '' && ctype_digit($q)) {
            $prod = wc_get_product((int)$q);
            if ($prod) {
                $exact_ids[] = (int) $prod->get_id();
            }
        }

        if ($q !== '') {
            global $wpdb;
            $sql = $wpdb->prepare("
                SELECT DISTINCT p.ID
                FROM {$wpdb->posts} p
                INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID
                WHERE p.post_type IN ('product','product_variation')
                  AND p.post_status IN ('publish','private','draft')
                  AND (
                        (pm.meta_key = '_sku' AND pm.meta_value = %s)
                     OR (pm.meta_key = %s AND pm.meta_value = %s)
                  )
                LIMIT %d
            ", $q, $barcode_meta, $q, $limit);
            $found = $wpdb->get_col($sql);
            if (!empty($found)) {
                foreach (array_unique(array_map('intval', $found)) as $pid) {
                    $p = wc_get_product($pid);
                    if (!$p) continue;
                    $exact_ids[] = (int) $p->get_id();
                }
            }
        }
        $exact_ids = array_values(array_unique(array_filter(array_map('intval', $exact_ids))));

        if ($cat > 0 && !empty($exact_ids)) {
            $filtered_exact = [];
            foreach ($exact_ids as $pid) {
                $p = wc_get_product($pid);
                if (!$p) continue;
                $check_id = $p->get_id();
                if ($p->is_type('variation') && method_exists($p, 'get_parent_id')) {
                    $check_id = (int) $p->get_parent_id();
                }
                if ($check_id && has_term($cat, 'product_cat', $check_id)) {
                    $filtered_exact[] = $check_id;
                }
            }
            $exact_ids = array_values(array_unique($filtered_exact));
        }

        // 2) Búsqueda normal por nombre (igual que Caja usa WP_Query / s)
        if ($q !== '') {
            $args['s'] = $q;
        }

        $ids = (new WP_Query($args))->posts;
        if (!is_array($ids)) $ids = [];

        // Mezclar al inicio coincidencias exactas, igual que Caja
        foreach (array_reverse($exact_ids) as $pid) {
            if (!in_array($pid, $ids, true)) {
                array_unshift($ids, $pid);
            }
        }
        $ids = array_slice(array_values(array_unique(array_map('intval', $ids))), 0, $limit);

        $out = [];
        foreach ($ids as $pid) {
            $p = wc_get_product($pid);
            if (!$p) continue;
            $img_id = method_exists($p, 'get_image_id') ? (int) $p->get_image_id() : 0;
            $img_url = $img_id ? wp_get_attachment_image_url($img_id, 'thumbnail') : '';
            if (!$img_url && function_exists('wc_placeholder_img_src')) {
                $img_url = wc_placeholder_img_src('thumbnail');
            }
            $out[] = [
                'id'   => $p->get_id(),
                'name' => $p->get_name(),
                'image_url' => $img_url,
                'barcode' => (string) get_post_meta($p->get_id(), $barcode_meta, true),
                'store_stock' => $meta_key ? intval(get_post_meta($p->get_id(), $meta_key, true)) : 0,
                'categories' => self::posinv_product_cats_string($p),
                'category_ids' => self::posinv_product_cat_ids($p),
                'category_id'  => self::posinv_product_primary_cat_id($p),
                'price' => self::posinv_product_price_string($p),
            ];
        }

        if ($module === 'labels'  && $q !== '') {
            $term = $cat ? get_term($cat, 'product_cat') : null;
            self::audit_add('labels_search', ['module'=>'labels','store'=>$store,'query'=>$q,'results_count'=>count($out),'category'=>($term && !is_wp_error($term) ? $term->name : '')]);
        }
        if ($wrap_response) {
            $next_args = $args;
            $next_args['posts_per_page'] = 1;
            $next_args['offset'] = $offset + count($out);
            $next_ids = (new WP_Query($next_args))->posts;
            $has_more = !empty($next_ids);
            wp_send_json_success([
                'items' => $out,
                'has_more' => $has_more,
                'next_offset' => $offset + count($out),
            ]);
        }
        wp_send_json_success($out);
    }


    /**
     * Existencias (vista consolidada): devuelve stocks de store1, store2 y bodega (sumatoria de ubicaciones),
     * y una cadena de ubicaciones de bodega con cantidades.
     * Solo afecta la pestaña "Existencias".
     */
    public static function ajax_traspaso_locations() {
        if (!check_ajax_referer('posinv_traspaso_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!self::can_use_pos()) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }
        $product_id = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
        $catalog = self::bodega_locations_catalog_get();
        $rows = $product_id ? self::bodega_get_locations($product_id) : [];
        $out_rows = [];
        foreach ($rows as $r) {
            $qty = (float)($r['qty'] ?? 0);
            if ($qty <= 0) continue;
            $out_rows[] = ['loc' => (string)($r['loc'] ?? ''), 'qty' => $qty];
        }
        wp_send_json_success(['catalog' => $catalog, 'rows' => $out_rows]);
    }

    public static function ajax_traspaso_search() {
        if (!check_ajax_referer('posinv_traspaso_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!self::can_use_pos()) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }
        $s = self::get_settings();
        $barcode_meta = !empty($s['barcode_meta']) ? $s['barcode_meta'] : '_op_barcode';
        $q   = isset($_POST['q']) ? sanitize_text_field(wp_unslash($_POST['q'])) : '';
        $cat = isset($_POST['cat']) ? absint($_POST['cat']) : 0;
        $page = isset($_POST['page']) ? max(1, absint($_POST['page'])) : 1;
        $limit = 50;
        $offset = ($page - 1) * $limit;
        $ids = self::product_search_ids_precise($q, $cat, $limit, $offset, false, $barcode_meta);
        $items = [];
        foreach ($ids as $pid) {
            $p = wc_get_product($pid);
            if ($p) $items[] = self::traspaso_product_payload($p, $barcode_meta);
        }
        wp_send_json_success(['items' => $items, 'has_more' => count($ids) === $limit]);
    }

    public static function ajax_traspaso_bodega_only() {
        if (!check_ajax_referer('posinv_traspaso_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!self::can_use_pos()) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }
        $s = self::get_settings();
        $barcode_meta = !empty($s['barcode_meta']) ? $s['barcode_meta'] : '_op_barcode';
        $cat = isset($_POST['cat']) ? absint($_POST['cat']) : 0;
        $page = isset($_POST['page']) ? max(1, absint($_POST['page'])) : 1;
        $limit = 50;
        $offset = ($page - 1) * $limit;
        $ids = self::product_search_ids_precise('', $cat, $limit, $offset, true, $barcode_meta);
        $items = [];
        foreach ($ids as $pid) {
            $p = wc_get_product($pid);
            if ($p) $items[] = self::traspaso_product_payload($p, $barcode_meta);
        }
        wp_send_json_success(['items' => $items, 'has_more' => count($ids) === $limit]);
    }

    public static function ajax_traspaso_save() {
        if (!check_ajax_referer('posinv_traspaso_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!self::can_use_pos()) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }
        $product_id = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
        $origin = isset($_POST['origin']) ? sanitize_text_field(wp_unslash($_POST['origin'])) : '';
        $destination = isset($_POST['destination']) ? sanitize_text_field(wp_unslash($_POST['destination'])) : '';
        $qty = isset($_POST['qty']) ? (float) wp_unslash($_POST['qty']) : 0;
        $note = isset($_POST['note']) ? sanitize_text_field(wp_unslash($_POST['note'])) : '';
        $origin_loc = isset($_POST['origin_loc']) ? self::bodega_normalize_location(wp_unslash($_POST['origin_loc'])) : '';
        $dest_loc = isset($_POST['dest_loc']) ? self::bodega_normalize_location(wp_unslash($_POST['dest_loc'])) : '';
        $client_txid = isset($_POST['client_txid']) ? sanitize_key(wp_unslash($_POST['client_txid'])) : '';
        if ($client_txid !== '') {
            $cached = get_transient('posinv_traspaso_' . $client_txid);
            if (is_array($cached)) {
                while (ob_get_level()) { @ob_end_clean(); }
                wp_send_json_success($cached);
            }
        }

        if (!$product_id) wp_send_json_error(['message' => 'Selecciona un producto.'], 400);
        if (!$origin || !$destination) wp_send_json_error(['message' => 'Elige origen y destino.'], 400);
        if ($origin === $destination) wp_send_json_error(['message' => 'El origen no puede ser igual al destino.'], 400);
        if ($qty <= 0) wp_send_json_error(['message' => 'La cantidad debe ser mayor que 0.'], 400);
        if ($origin === 'bodega' && $origin_loc === '') wp_send_json_error(['message' => 'Selecciona la ubicación de origen en bodega.'], 400);
        if ($destination === 'bodega' && $dest_loc === '') wp_send_json_error(['message' => 'Captura la ubicación destino en bodega.'], 400);

        $p = wc_get_product($product_id);
        if (!$p) wp_send_json_error(['message' => 'Producto no válido.'], 404);

        $store1_meta = self::store_meta_for_key('store1');
        $store2_meta = self::store_meta_for_key('store2');
        $qty_i = (int) round($qty);
        $origin_label = $origin === 'store1' ? self::store_name_for_key('store1') : ($origin === 'store2' ? self::store_name_for_key('store2') : 'Bodega');
        $dest_label = $destination === 'store1' ? self::store_name_for_key('store1') : ($destination === 'store2' ? self::store_name_for_key('store2') : 'Bodega');
        if ($origin === 'bodega') $origin_label .= ' [' . $origin_loc . ']';
        if ($destination === 'bodega') $dest_label .= ' [' . $dest_loc . ']';

        // Validar disponibilidad y aplicar origen
        if ($origin === 'store1') {
            $current = (int) get_post_meta($product_id, $store1_meta, true);
            if ($current < $qty_i) wp_send_json_error(['message' => 'No hay suficiente stock disponible en San Mateo.'], 400);
            update_post_meta($product_id, $store1_meta, $current - $qty_i);
        } elseif ($origin === 'store2') {
            $current = (int) get_post_meta($product_id, $store2_meta, true);
            if ($current < $qty_i) wp_send_json_error(['message' => 'No hay suficiente stock disponible en Xaltocán.'], 400);
            update_post_meta($product_id, $store2_meta, $current - $qty_i);
        } else {
            $res = self::bodega_consume_from_location($product_id, $origin_loc, $qty_i);
            if (!$res['ok']) wp_send_json_error(['message' => $res['message']], 400);
            self::bodega_save_locations($product_id, $res['rows']);
        }

        // Aplicar destino
        if ($destination === 'store1') {
            $current = (int) get_post_meta($product_id, $store1_meta, true);
            update_post_meta($product_id, $store1_meta, $current + $qty_i);
        } elseif ($destination === 'store2') {
            $current = (int) get_post_meta($product_id, $store2_meta, true);
            update_post_meta($product_id, $store2_meta, $current + $qty_i);
        } else {
            // Si la ubicación destino en bodega es nueva, agregarla también al catálogo global
            if ($dest_loc !== '') {
                self::bodega_locations_catalog_add($dest_loc);
            }
            self::bodega_add_to_location($product_id, $dest_loc, $qty_i, $note);
        }

        $s = self::get_settings();
        $barcode_meta = !empty($s['barcode_meta']) ? $s['barcode_meta'] : '_op_barcode';
        $code = (string) get_post_meta($product_id, $barcode_meta, true);
        if ($code === '') $code = (string) $p->get_sku();

        $ticket_id = wp_insert_post([
            'post_type' => 'pos_ticket',
            'post_status' => 'publish',
            'post_author' => get_current_user_id(),
            'post_title' => 'Traspaso #' . current_time('Ymd-His') . ' ' . $p->get_name(),
        ]);
        if (!$ticket_id || is_wp_error($ticket_id)) {
            wp_send_json_error(['message' => 'No se pudo guardar el historial del traspaso.'], 500);
        }
        $payload = [
            'type' => 'transfer',
            'store' => $origin,
            'to_store' => $destination,
            'items' => [[
                'product_id' => $product_id,
                'name' => $p->get_name(),
                'qty' => $qty_i,
                'price' => 0,
                'orig_price' => 0,
                'sku' => (string)$p->get_sku(),
                'code' => $code,
            ]],
            'payment' => ['method'=>'none','cash'=>0,'transfer'=>0,'card'=>0],
            'totals' => ['subtotal'=>0,'total'=>0,'disc_lines'=>0,'disc_ticket'=>0],
            'transfer_data' => [
                'origin' => $origin,
                'destination' => $destination,
                'origin_loc' => $origin_loc,
                'dest_loc' => $dest_loc,
                'origin_label' => $origin_label,
                'destination_label' => $dest_label,
                'note' => $note,
            ],
        ];
        update_post_meta($ticket_id, '_posinv', $payload);
        update_post_meta($ticket_id, '_posinv_store', $origin);
        update_post_meta($ticket_id, '_posinv_to_store', $destination);
        update_post_meta($ticket_id, '_posinv_created_at', current_time('mysql'));

        self::audit_add('transfer', [
            'module' => 'traspaso',
            'product_id' => $product_id,
            'origin' => $origin,
            'destination' => $destination,
            'qty' => $qty_i,
            'note' => $note,
            'origin_loc' => $origin_loc,
            'dest_loc' => $dest_loc,
            'ticket_id' => (int)$ticket_id,
        ]);

        $resp = [
            'message' => 'Traspaso guardado correctamente.',
            'folio' => 'TR-' . (int)$ticket_id,
            'item' => self::traspaso_product_payload($p, $barcode_meta),
            'history' => self::traspaso_history_row_from_ticket($ticket_id),
            'catalog' => self::bodega_locations_catalog_get(),
        ];
        if ($client_txid !== '') {
            set_transient('posinv_traspaso_' . $client_txid, $resp, 10 * MINUTE_IN_SECONDS);
        }
        while (ob_get_level()) { @ob_end_clean(); }
        wp_send_json_success($resp);
    }

    public static function ajax_traspaso_history() {
        if (!check_ajax_referer('posinv_traspaso_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!self::can_use_pos()) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }
        $posts = get_posts([
            'post_type' => 'pos_ticket',
            'post_status' => 'publish',
            'posts_per_page' => 20,
            'orderby' => 'date',
            'order' => 'DESC',
            'meta_query' => [[
                'key' => '_posinv',
                'compare' => 'EXISTS',
            ]],
        ]);
        $items = [];
        foreach ($posts as $post) {
            $row = self::traspaso_history_row_from_ticket($post->ID);
            if ($row) $items[] = $row;
        }
        wp_send_json_success(['items' => $items]);
    }

    public static function ajax_traspaso_clear_history() {
        if (!check_ajax_referer('posinv_traspaso_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!current_user_can('pos_manage_settings') && !current_user_can('manage_options')) {
            wp_send_json_error(['message' => 'Sin permiso para limpiar el historial.'], 403);
        }
        $posts = get_posts([
            'post_type' => 'pos_ticket',
            'post_status' => 'publish',
            'posts_per_page' => -1,
            'orderby' => 'date',
            'order' => 'DESC',
            'meta_query' => [[
                'key' => '_posinv',
                'compare' => 'EXISTS',
            ]],
            'fields' => 'ids',
        ]);
        $deleted = 0;
        foreach ($posts as $ticket_id) {
            $row = self::traspaso_history_row_from_ticket((int)$ticket_id);
            if (!$row) continue;
            $ok = wp_delete_post((int)$ticket_id, true);
            if ($ok) $deleted++;
        }
        wp_send_json_success(['message' => 'Historial limpiado correctamente.', 'deleted' => $deleted]);
    }

    public static function ajax_existencias_search() {
        if (!check_ajax_referer('posinv_existencias_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }

        global $wpdb;

        $s = self::get_settings();
        $barcode_meta = !empty($s['barcode_meta']) ? $s['barcode_meta'] : '_op_barcode';
        $q   = isset($_POST['q']) ? sanitize_text_field(wp_unslash($_POST['q'])) : '';
        $cat = isset($_POST['cat']) ? absint($_POST['cat']) : 0;
        $page = isset($_POST['page']) ? max(1, absint($_POST['page'])) : 1;
        $q   = trim($q);
        $limit = 50;
        $offset = ($page - 1) * $limit;

        $where = ["p.post_type = 'product'", "p.post_status IN ('publish','private','draft')"];
        $params = [];
        $joins = "";

        if ($cat) {
            $joins .= " INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID";
            $joins .= " INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_cat'";
            $where[] = 'tt.term_id = %d';
            $params[] = $cat;
        }

        if ($q !== '') {
            $like = '%' . $wpdb->esc_like($q) . '%';
            if (ctype_digit($q)) {
                $where[] = "(p.ID = %d OR p.post_title LIKE %s OR EXISTS (
                    SELECT 1 FROM {$wpdb->postmeta} pm1
                    WHERE pm1.post_id = p.ID AND pm1.meta_key = '_sku' AND pm1.meta_value LIKE %s
                ) OR EXISTS (
                    SELECT 1 FROM {$wpdb->postmeta} pm2
                    WHERE pm2.post_id = p.ID AND pm2.meta_key = %s AND pm2.meta_value LIKE %s
                ))";
                $params[] = (int) $q;
                $params[] = $like;
                $params[] = $like;
                $params[] = $barcode_meta;
                $params[] = $like;
            } else {
                $where[] = "(p.post_title LIKE %s OR EXISTS (
                    SELECT 1 FROM {$wpdb->postmeta} pm1
                    WHERE pm1.post_id = p.ID AND pm1.meta_key = '_sku' AND pm1.meta_value LIKE %s
                ) OR EXISTS (
                    SELECT 1 FROM {$wpdb->postmeta} pm2
                    WHERE pm2.post_id = p.ID AND pm2.meta_key = %s AND pm2.meta_value LIKE %s
                ))";
                $params[] = $like;
                $params[] = $like;
                $params[] = $barcode_meta;
                $params[] = $like;
            }
        }

        $sql = "SELECT DISTINCT p.ID
                FROM {$wpdb->posts} p
                {$joins}
                WHERE " . implode(' AND ', $where) . "
                ORDER BY p.post_date DESC
                LIMIT %d OFFSET %d";
        $params[] = $limit;
        $params[] = $offset;
        $prepared = $wpdb->prepare($sql, $params);
        $ids = $wpdb->get_col($prepared);

        $out = [];
        foreach ($ids as $pid) {
            $product = wc_get_product((int) $pid);
            if ($product) {
                $out[] = self::existencias_product_payload($product, $barcode_meta);
            }
        }

        wp_send_json_success([
            'items' => $out,
            'has_more' => count($ids) === $limit,
            'page' => $page,
        ]);
    }


    public static function ajax_existencias_bodega_only() {
        if (!check_ajax_referer('posinv_existencias_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }

        $s = self::get_settings();
        $barcode_meta = !empty($s['barcode_meta']) ? $s['barcode_meta'] : '_op_barcode';

        $cat = isset($_POST['cat']) ? absint($_POST['cat']) : 0;
        $page = isset($_POST['page']) ? max(1, absint($_POST['page'])) : 1;
        $per_page = isset($_POST['per_page']) ? max(1, min(50, absint($_POST['per_page']))) : 10;

        $store1_meta = self::store_meta_for_key('store1');
        $store2_meta = self::store_meta_for_key('store2');

        $meta_query = [
            'relation' => 'AND',
            [
                'key'     => self::bodega_total_meta_key(),
                'value'   => 0,
                'compare' => '>',
                'type'    => 'NUMERIC',
            ],
        ];

        // Tiendas en 0: (NOT EXISTS OR = 0)
        if ($store1_meta) {
            $meta_query[] = [
                'relation' => 'OR',
                [
                    'key'     => $store1_meta,
                    'compare' => 'NOT EXISTS',
                ],
                [
                    'key'     => $store1_meta,
                    'value'   => 0,
                    'compare' => '=',
                    'type'    => 'NUMERIC',
                ],
            ];
        }
        if ($store2_meta) {
            $meta_query[] = [
                'relation' => 'OR',
                [
                    'key'     => $store2_meta,
                    'compare' => 'NOT EXISTS',
                ],
                [
                    'key'     => $store2_meta,
                    'value'   => 0,
                    'compare' => '=',
                    'type'    => 'NUMERIC',
                ],
            ];
        }

        $args = [
            'post_type'      => 'product',
            'post_status'    => ['publish','private','draft'],
            'fields'         => 'ids',
            'posts_per_page' => $per_page,
            'paged'          => $page,
            'meta_query'     => $meta_query,
        ];

        if ($cat) {
            $args['tax_query'] = [[
                'taxonomy' => 'product_cat',
                'field'    => 'term_id',
                'terms'    => [$cat],
            ]];
        }

        $q = new WP_Query($args);
        $out = [];
        foreach ($q->posts as $pid) {
            $p = wc_get_product($pid);
            if ($p) $out[] = self::existencias_product_payload($p, $barcode_meta);
        }

        wp_send_json_success([
            'items' => $out,
            'page'  => $page,
            'per_page' => $per_page,
            'total' => (int)$q->found_posts,
            'total_pages' => (int)$q->max_num_pages,
        ]);
    }

    public static function ajax_existencias_transfer() {
        if (!check_ajax_referer('posinv_existencias_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!self::can_bodega_transfer()) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }

        $pid = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
        $qty = isset($_POST['qty']) ? (float) $_POST['qty'] : 0;
        $store_key = isset($_POST['store']) ? sanitize_text_field(wp_unslash($_POST['store'])) : '';

        if (!$pid || $qty <= 0) {
            wp_send_json_error(['message' => 'Producto o cantidad inválida'], 400);
        }
        $store_meta = self::store_meta_for_key($store_key);
        if (!$store_meta) {
            wp_send_json_error(['message' => 'Tienda inválida'], 400);
        }

        $res = self::bodega_consume_any_location($pid, $qty);
        if (!$res['ok']) {
            wp_send_json_error(['message' => $res['message']], 400);
        }

        self::bodega_save_locations($pid, $res['rows']);

        $current = (int) get_post_meta($pid, $store_meta, true);
        $new = $current + (int) round($qty);
        update_post_meta($pid, $store_meta, $new);

        self::audit_add('bodega_transfer', [
            'module'  => 'existencias',
            'action'  => 'bodega_to_store',
            'product_id' => $pid,
            'qty'     => (float)$qty,
            'store'   => $store_key,
            'user_id' => get_current_user_id(),
            'ts'      => current_time('mysql'),
        ]);

        $p = wc_get_product($pid);
        $s = self::get_settings();
        $barcode_meta = !empty($s['barcode_meta']) ? $s['barcode_meta'] : '_op_barcode';

        wp_send_json_success([
            'message' => 'Transferido',
            'item' => $p ? self::existencias_product_payload($p, $barcode_meta) : null,
        ]);
    }

    private static function bodega_consume_any_location($product_id, $qty) {
        $qty = (float)$qty;
        if ($qty <= 0) return ['ok'=>false, 'message'=>'Cantidad inválida', 'rows'=>[]];

        $rows = self::bodega_get_locations($product_id);
        // Ordenar por ubicación para consistencia
        usort($rows, function($a,$b){
            return strcmp((string)($a['loc'] ?? ''), (string)($b['loc'] ?? ''));
        });

        $remain = $qty;
        $out = [];
        foreach ($rows as $r) {
            $rqty = (float)($r['qty'] ?? 0);
            if ($rqty <= 0) continue;

            if ($remain <= 0) {
                $out[] = $r;
                continue;
            }

            $take = min($rqty, $remain);
            $rqty2 = $rqty - $take;
            $remain -= $take;

            if ($rqty2 > 0) {
                $r['qty'] = $rqty2;
                $out[] = $r;
            }
            // si queda en 0, se elimina la fila
        }

        if ($remain > 0.00001) {
            return ['ok'=>false, 'message'=>'No hay suficiente stock en bodega', 'rows'=>$rows];
        }

        return ['ok'=>true, 'message'=>'', 'rows'=>$out];
    }



    private static function product_search_ids_precise($q, $cat = 0, $limit = 50, $offset = 0, $bodega_only = false, $barcode_meta = '_op_barcode') {
        global $wpdb;
        $q = trim((string)$q);
        $limit = max(1, (int)$limit);
        $offset = max(0, (int)$offset);
        $where = ["p.post_type = 'product'", "p.post_status IN ('publish','private','draft')"];
        $joins = '';
        $params = [];

        if ($cat) {
            $joins .= " INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID";
            $joins .= " INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_cat'";
            $where[] = 'tt.term_id = %d';
            $params[] = (int)$cat;
        }

        $store1_meta = self::store_meta_for_key('store1');
        $store2_meta = self::store_meta_for_key('store2');
        if ($bodega_only) {
            $where[] = "CAST(COALESCE((SELECT pm.meta_value FROM {$wpdb->postmeta} pm WHERE pm.post_id = p.ID AND pm.meta_key = '_posinv_bodega_total' LIMIT 1), '0') AS DECIMAL(20,4)) > 0";
            if ($store1_meta) {
                $where[] = $wpdb->prepare("CAST(COALESCE((SELECT pm.meta_value FROM {$wpdb->postmeta} pm WHERE pm.post_id = p.ID AND pm.meta_key = %s LIMIT 1), '0') AS DECIMAL(20,4)) <= 0", $store1_meta);
            }
            if ($store2_meta) {
                $where[] = $wpdb->prepare("CAST(COALESCE((SELECT pm.meta_value FROM {$wpdb->postmeta} pm WHERE pm.post_id = p.ID AND pm.meta_key = %s LIMIT 1), '0') AS DECIMAL(20,4)) <= 0", $store2_meta);
            }
        }

        if ($q !== '') {
            $like = '%' . $wpdb->esc_like($q) . '%';
            if (ctype_digit($q)) {
                $where[] = "(p.ID = %d OR p.post_title LIKE %s OR EXISTS (SELECT 1 FROM {$wpdb->postmeta} pm1 WHERE pm1.post_id = p.ID AND pm1.meta_key = '_sku' AND pm1.meta_value LIKE %s) OR EXISTS (SELECT 1 FROM {$wpdb->postmeta} pm2 WHERE pm2.post_id = p.ID AND pm2.meta_key = %s AND pm2.meta_value LIKE %s))";
                $params[] = (int)$q;
                $params[] = $like;
                $params[] = $like;
                $params[] = $barcode_meta;
                $params[] = $like;
            } else {
                $where[] = "(p.post_title LIKE %s OR EXISTS (SELECT 1 FROM {$wpdb->postmeta} pm1 WHERE pm1.post_id = p.ID AND pm1.meta_key = '_sku' AND pm1.meta_value LIKE %s) OR EXISTS (SELECT 1 FROM {$wpdb->postmeta} pm2 WHERE pm2.post_id = p.ID AND pm2.meta_key = %s AND pm2.meta_value LIKE %s))";
                $params[] = $like;
                $params[] = $like;
                $params[] = $barcode_meta;
                $params[] = $like;
            }
        }

        $sql = "SELECT DISTINCT p.ID FROM {$wpdb->posts} p {$joins} WHERE " . implode(' AND ', $where) . " ORDER BY p.post_date DESC LIMIT %d OFFSET %d";
        $params[] = $limit;
        $params[] = $offset;
        return array_map('intval', (array)$wpdb->get_col($wpdb->prepare($sql, $params)));
    }

    private static function traspaso_product_payload($p, $barcode_meta) {
        $payload = self::existencias_product_payload($p, $barcode_meta);
        $rows = self::bodega_get_locations($p->get_id());
        $payload['bodega_rows'] = [];
        foreach ($rows as $r) {
            $qty = (float)($r['qty'] ?? 0);
            if ($qty <= 0) continue;
            $payload['bodega_rows'][] = [
                'loc' => (string)($r['loc'] ?? ''),
                'qty' => $qty,
            ];
        }
        return $payload;
    }

    private static function traspaso_history_row_from_ticket($ticket_id) {
        $meta = get_post_meta($ticket_id, '_posinv', true);
        if (!is_array($meta) || (($meta['type'] ?? '') !== 'transfer')) return null;
        $td = is_array($meta['transfer_data'] ?? null) ? $meta['transfer_data'] : [];
        $item = !empty($meta['items'][0]) && is_array($meta['items'][0]) ? $meta['items'][0] : [];
        $author_id = (int) get_post_field('post_author', $ticket_id);
        $user = $author_id ? get_userdata($author_id) : null;
        return [
            'date' => get_the_date('Y-m-d H:i', $ticket_id),
            'folio' => 'TR-' . (int)$ticket_id,
            'product_id' => (int)($item['product_id'] ?? 0),
            'code' => (string)($item['code'] ?? ''),
            'name' => (string)($item['name'] ?? ''),
            'origin' => (string)($td['origin_label'] ?? ''),
            'destination' => (string)($td['destination_label'] ?? ''),
            'qty' => (float)($item['qty'] ?? 0),
            'user' => $user ? $user->display_name : '',
            'note' => (string)($td['note'] ?? ''),
        ];
    }

    private static function existencias_product_payload($p, $barcode_meta) {
        $id = $p->get_id();

        $img_id  = method_exists($p, 'get_image_id') ? (int) $p->get_image_id() : 0;
        $img_url = $img_id ? wp_get_attachment_image_url($img_id, 'thumbnail') : '';
        if (!$img_url && function_exists('wc_placeholder_img_src')) {
            $img_url = wc_placeholder_img_src('thumbnail');
        }

        $store1_meta = self::store_meta_for_key('store1');
        $store2_meta = self::store_meta_for_key('store2');

        $s1 = $store1_meta ? (int) get_post_meta($id, $store1_meta, true) : 0;
        $s2 = $store2_meta ? (int) get_post_meta($id, $store2_meta, true) : 0;

        // Bodega: sumatoria de ubicaciones y cadena "LOC(qty), ..."
        $bodega = self::bodega_sum_and_locations_string($id);
        $bqty = (int) $bodega['qty'];
        $bloc = (string) $bodega['locs'];

        $code = (string) get_post_meta($id, $barcode_meta, true);
        if ($code === '') $code = (string) $p->get_sku();

        return [
            'id'    => $id,
            'name'  => $p->get_name(),
            'image_url' => $img_url,
            'code'  => $code,
            'store1_stock' => $s1,
            'store2_stock' => $s2,
            'bodega_stock' => $bqty,
            'bodega_locs'  => $bloc,
            'total' => ($s1 + $s2 + $bqty),
        ];
    }

    private static function bodega_sum_and_locations_string($product_id) {
        $data = self::bodega_sum_and_locations_array($product_id);
        $parts = [];
        foreach (($data['map'] ?? []) as $loc => $qty) {
            $parts[] = $loc . '(' . (int)$qty . ')';
        }
        return [
            'qty'  => (int)($data['qty'] ?? 0),
            'locs' => implode(', ', $parts),
        ];
    }


    public static function ajax_set_barcode() {
        if (!check_ajax_referer('posinv_barcodes_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }

		$product_id = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
		$barcode = isset($_POST['barcode']) ? sanitize_text_field(wp_unslash($_POST['barcode'])) : '';
		$module = isset($_POST['module']) ? sanitize_text_field(wp_unslash($_POST['module'])) : '';

        if (!$product_id) {
            wp_send_json_error(['message' => 'Producto inválido'], 400);
        }

        // Guardar SIEMPRE en el meta estándar de tu sitio
        $meta = '_op_barcode';
        // Normaliza (trim). Permitimos números y letras; no forzamos dígitos aquí.
        $barcode = trim($barcode);

        
        // Evitar duplicados: si el código ya lo tiene otro producto/variación, marcar error
        if ($barcode !== '') {
            $dup = get_posts([
                'post_type'      => ['product', 'product_variation'],
                'post_status'    => 'any',
                'numberposts'    => 1,
                'fields'         => 'ids',
                'exclude'        => [$product_id],
                'meta_query'     => [[
                    'key'     => $meta,
                    'value'   => $barcode,
                    'compare' => '='
                ]],
            ]);

            if (!empty($dup)) {
                $dup_id = (int) $dup[0];
                $dup_title = get_the_title($dup_id);
                if (!$dup_title) { $dup_title = 'Producto #' . $dup_id; }
                wp_send_json_error([
                    'message' => 'Código duplicado. Ya existe en: ' . $dup_title . ' (ID ' . $dup_id . ')',
                    'dup_id'  => $dup_id,
                ], 409);
            }
        }

		$old_barcode = (string) get_post_meta($product_id, $meta, true);
		update_post_meta($product_id, $meta, $barcode);

		// Auditoría: cambio de código
		$prod = wc_get_product($product_id);
		self::audit_add('barcode_change', [
			'module' => $module ?: 'unknown',
			'store' => self::current_store_key(),
			'product_id' => $product_id,
			'product' => $prod ? $prod->get_name() : '',
			'old' => $old_barcode,
			'new' => $barcode,
		]);

		wp_send_json_success(['product_id' => $product_id, 'barcode' => $barcode]);
    }

    /**
     * Guardar precio (regular) de producto/variación desde pestaña Etiquetas.
     * Guarda en WooCommerce (regular_price y price) y audita el cambio.
     */
    public static function ajax_set_price() {
        if (!check_ajax_referer('posinv_barcodes_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }

		$product_id = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
		$price_raw  = isset($_POST['price']) ? sanitize_text_field(wp_unslash($_POST['price'])) : '';
		$module = isset($_POST['module']) ? sanitize_text_field(wp_unslash($_POST['module'])) : '';

        if (!$product_id) {
            wp_send_json_error(['message' => 'Producto inválido'], 400);
        }

        $product = wc_get_product($product_id);
        if (!$product) {
            wp_send_json_error(['message' => 'Producto no encontrado'], 404);
        }

        // Normaliza: permitir coma o punto.
        $price_raw = trim(str_replace([' ', ','], ['', '.'], $price_raw));
        if ($price_raw === '') {
            wp_send_json_error(['message' => 'Precio vacío'], 400);
        }
        if (!is_numeric($price_raw)) {
            wp_send_json_error(['message' => 'Precio inválido'], 400);
        }

        $price = wc_format_decimal($price_raw, wc_get_price_decimals());

        $old = $product->get_regular_price();
        $product->set_regular_price($price);
        $product->set_price($price);
        // Si tenía oferta, no la tocamos aquí (pero el price ya cambia). Si quieres, luego añadimos regular/sale separados.
        $product->save();

		self::audit_add('price_change', [
			'module' => $module ?: 'labels',
			'store' => self::current_store_key(),
			'product_id' => $product_id,
			'product' => $product ? $product->get_name() : '',
			'old' => (string)$old,
			'new' => (string)$price,
		]);

        wp_send_json_success([
            'product_id' => $product_id,
            'price' => wc_format_localized_price($price),
        ]);
    }

    /**
     * Guardar categorías (product_cat) desde pestaña Etiquetas.
     * Recibe string separado por comas. Crea términos si no existen.
     */
    public static function ajax_set_categories() {
        if (!check_ajax_referer('posinv_barcodes_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }

		$product_id = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
        $cats_raw   = isset($_POST['categories']) ? sanitize_text_field(wp_unslash($_POST['categories'])) : '';
        $cat_ids_raw = isset($_POST['category_ids']) ? sanitize_text_field(wp_unslash($_POST['category_ids'])) : '';
		$module = isset($_POST['module']) ? sanitize_text_field(wp_unslash($_POST['module'])) : '';

        if (!$product_id) {
            wp_send_json_error(['message' => 'Producto inválido'], 400);
        }

        $product = wc_get_product($product_id);
        if (!$product) {
            wp_send_json_error(['message' => 'Producto no encontrado'], 404);
        }

        // Para variaciones, las categorías pertenecen al padre.
        $target_id = $product_id;
        if ($product->is_type('variation') && method_exists($product, 'get_parent_id')) {
            $pid = (int) $product->get_parent_id();
            if ($pid) $target_id = $pid;
        }

        $old_names = wp_get_post_terms($target_id, 'product_cat', ['fields' => 'names']);
        if (is_wp_error($old_names)) $old_names = [];

        // Si recibimos IDs (desde dropdown), usar esos directamente
        $cat_ids = [];
        if ($cat_ids_raw !== '') {
            $cat_ids = array_filter(array_map('absint', preg_split('/\s*,\s*/', $cat_ids_raw)));
        } elseif ($cats_raw !== '' && preg_match('/^[0-9\s,]+$/', $cats_raw)) {
            $cat_ids = array_filter(array_map('absint', preg_split('/\s*,\s*/', $cats_raw)));
        }
        if (!empty($cat_ids)) {
            $r = wp_set_object_terms($target_id, $cat_ids, 'product_cat', false);
            if (is_wp_error($r)) {
                wp_send_json_error(['message' => $r->get_error_message()], 500);
            }
            $names_out = [];
            foreach ($cat_ids as $tid) {
                $tt = get_term($tid, 'product_cat');
                if ($tt && !is_wp_error($tt)) $names_out[] = $tt->name;
            }

            self::audit_add('category_change', [
                'module' => $module ?: 'labels',
                'store' => self::current_store_key(),
                'product_id' => $target_id,
                'product' => get_the_title($target_id),
                'old_categories' => array_values((array)$old_names),
                'old_categories_text' => implode(', ', array_map('sanitize_text_field', (array)$old_names)),
                'categories' => array_values($names_out),
                'new_categories_text' => implode(', ', array_map('sanitize_text_field', (array)$names_out)),
            ]);

            wp_send_json_success(['categories' => implode(', ', $names_out)]);
        }

        $names = array_filter(array_map('trim', preg_split('/\s*,\s*/', (string)$cats_raw)));
        if (empty($names)) {
            // Permitir limpiar categorías
            wp_set_object_terms($target_id, [], 'product_cat', false);
            wp_send_json_success(['product_id' => $product_id, 'categories' => '']);
        }

        $term_ids = [];
        foreach ($names as $name) {
            $t = get_term_by('name', $name, 'product_cat');
            if ($t && !is_wp_error($t)) {
                $term_ids[] = (int)$t->term_id;
                continue;
            }
            // intentar por slug
            $slug = sanitize_title($name);
            $t2 = get_term_by('slug', $slug, 'product_cat');
            if ($t2 && !is_wp_error($t2)) {
                $term_ids[] = (int)$t2->term_id;
                continue;
            }
            $created = wp_insert_term($name, 'product_cat');
            if (!is_wp_error($created) && !empty($created['term_id'])) {
                $term_ids[] = (int)$created['term_id'];
            }
        }

        $term_ids = array_values(array_unique(array_filter($term_ids)));
        wp_set_object_terms($target_id, $term_ids, 'product_cat', false);

        $updated_names = wp_get_post_terms($target_id, 'product_cat', ['fields' => 'names']);
        if (is_wp_error($updated_names)) $updated_names = [];

		self::audit_add('category_change', [
			'module' => $module ?: 'labels',
			'store' => self::current_store_key(),
			'product_id' => $target_id,
			'product' => get_the_title($target_id),
            'old_categories' => array_values((array)$old_names),
            'old_categories_text' => implode(', ', array_map('sanitize_text_field', (array)$old_names)),
			'categories' => $updated_names,
            'new_categories_text' => implode(', ', array_map('sanitize_text_field', (array)$updated_names)),
		]);

        wp_send_json_success([
            'product_id' => $product_id,
            'categories' => implode(', ', array_map('sanitize_text_field', (array)$updated_names)),
        ]);
    }

public static function ajax_audit_event() {
    if (!check_ajax_referer('posinv_barcodes_nonce', 'nonce', false)) {
        wp_send_json_error(['message' => 'Nonce inválido'], 403);
    }
    if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
        wp_send_json_error(['message' => 'Sin permiso'], 403);
    }

    $event = isset($_POST['event']) ? sanitize_text_field(wp_unslash($_POST['event'])) : '';
    $allowed = ['labels_search','labels_select','labels_queue_clear'];
    if (!in_array($event, $allowed, true)) {
        wp_send_json_error(['message' => 'Evento inválido'], 400);
    }

    $payload = [
        'module' => 'labels',
        'store'  => self::current_store_key(),
    ];

    if ($event === 'labels_search') {
        $payload['query'] = isset($_POST['query']) ? sanitize_text_field(wp_unslash($_POST['query'])) : '';
        $payload['results_count'] = isset($_POST['results_count']) ? absint($_POST['results_count']) : 0;
        $payload['category'] = isset($_POST['category']) ? sanitize_text_field(wp_unslash($_POST['category'])) : '';
    } elseif ($event === 'labels_select') {
        $payload['product_id'] = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
        $payload['product'] = $payload['product_id'] ? get_the_title($payload['product_id']) : '';
        $payload['barcode'] = isset($_POST['barcode']) ? sanitize_text_field(wp_unslash($_POST['barcode'])) : '';
        $payload['qty'] = isset($_POST['qty']) ? absint($_POST['qty']) : 1;
    } elseif ($event === 'labels_queue_clear') {
        $payload['selected_count'] = isset($_POST['selected_count']) ? absint($_POST['selected_count']) : 0;
    }

    self::audit_add($event, $payload);
    wp_send_json_success(['ok' => true]);
}

public static function ajax_audit_labels_print() {
    if (!check_ajax_referer('posinv_barcodes_nonce', 'nonce', false)) {
        wp_send_json_error(['message' => 'Nonce inválido'], 403);
    }
    if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
        wp_send_json_error(['msg'=>'Sin permisos'], 403);
    }
    $store = isset($_POST['store']) ? sanitize_text_field(wp_unslash($_POST['store'])) : self::current_store_key();
    $labels_json = isset($_POST['labels']) ? wp_unslash($_POST['labels']) : '[]';
    $labels = json_decode($labels_json, true);
    if (!is_array($labels)) $labels = [];
    $items = [];
    $total_qty = 0;
    foreach ($labels as $it) {
        $pid = isset($it['id']) ? absint($it['id']) : 0;
        if (!$pid) continue;
        $qty = isset($it['qty']) ? absint($it['qty']) : 1;
        if ($qty < 1) $qty = 1;
        $items[] = ['id'=>$pid, 'qty'=>$qty];
        $total_qty += $qty;
        if (count($items) >= 50) break;
    }
    self::audit_add('labels_print', [
        'module' => 'labels',
        'store' => $store,
        'count_items' => count($items),
        'total_qty' => $total_qty,
        'items' => $items,
        'print_mode' => isset($_POST['print_mode']) ? sanitize_text_field(wp_unslash($_POST['print_mode'])) : 'browser',
        'used_queue' => !empty($_POST['used_queue']) ? 1 : 0,
    ]);
    wp_send_json_success(['ok'=>true]);
}



    /**
     * Inventario: devuelve el inventario esperado por tienda (solo productos con stock > 0 en esa tienda)
     * Paginado para no saturar.
     */
    public static function ajax_inventory_expected() {
        // IMPORTANTE: este endpoint debe responder SIEMPRE JSON.
        // Cualquier warning/fatal rompe el parseo en JS y se ve como "respuesta no-JSON".
        try {
            if (!check_ajax_referer('posinv_inventory_nonce', 'nonce', false)) {
                wp_send_json_error(['message' => 'Nonce inválido'], 403);
            }
            if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
                wp_send_json_error(['message' => 'Sin permiso'], 403);
            }

            $store = isset($_POST['store']) ? sanitize_text_field(wp_unslash($_POST['store'])) : self::current_store_key();
            $meta  = self::store_meta_key($store);
            if (!$meta) {
                wp_send_json_error(['message' => 'Tienda inválida'], 400);
            }

            $page = isset($_POST['page']) ? max(1, absint($_POST['page'])) : 1;
            $per  = isset($_POST['per_page']) ? max(50, min(500, absint($_POST['per_page']))) : 200;

            $q = new WP_Query([
                'post_type' => ['product','product_variation'],
                'post_status' => 'publish',
                'posts_per_page' => $per,
                'paged' => $page,
                'fields' => 'ids',
                'meta_query' => [
                    [
                        'key' => $meta,
                        'value' => 0,
                        'compare' => '>',
                        'type' => 'NUMERIC',
                    ]
                ],
            ]);

            $rows = [];
            // Usar el meta configurado en Ajustes (por defecto: _op_barcode)
            $s = self::settings();
            $barcode_meta = !empty($s['barcode_meta']) ? $s['barcode_meta'] : '_op_barcode';

            foreach ((array)$q->posts as $pid) {
                $p = wc_get_product($pid);
                if (!$p) {
                    continue;
                }
                $barcode = (string) get_post_meta($pid, $barcode_meta, true);
                if ($barcode === '') {
                    $barcode = (string) $p->get_sku();
                }
                $img = wp_get_attachment_image_url($p->get_image_id(), 'thumbnail');
                if (!$img) {
                    // En algunas instalaciones wc_placeholder_img_src no acepta parámetro.
                    $img = function_exists('wc_placeholder_img_src') ? wc_placeholder_img_src() : '';
                }
                $rows[] = [
                    'id' => (int) $pid,
                    'name' => $p->get_name(),
                    'image' => $img,
                    'code' => $barcode,
                    'stock' => (float) get_post_meta($pid, $meta, true),
                ];
            }

            wp_send_json_success([
                'page' => $page,
                'per_page' => $per,
                'total_pages' => (int) $q->max_num_pages,
                'items' => $rows,
            ]);
        } catch (Throwable $e) {
            // Asegurar JSON incluso en error.
            wp_send_json_error([
                'message' => 'Error del servidor (Inventario): ' . $e->getMessage(),
                'line' => (int) $e->getLine(),
            ], 500);
        }
    }

    /**
     * Inventario: último ticket de venta donde apareció el producto (solo para mostrar “cuándo se vendió”).
     */
    public static function ajax_inventory_last_sale() {
        if (!check_ajax_referer('posinv_inventory_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }

        $product_id = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
        $store = isset($_POST['store']) ? sanitize_text_field(wp_unslash($_POST['store'])) : self::current_store_key();
        if (!$product_id) {
            wp_send_json_error(['message' => 'Producto inválido'], 400);
        }

        // Buscar tickets recientes y encontrar el último donde aparezca el producto.
        // Nota: se usa LIKE sobre el meta serializado (array) para evitar escanear todo el histórico.
        $like = '"product_id";i:' . $product_id; // para arrays serializados
        $q = new WP_Query([
            'post_type' => 'pos_ticket',
            'post_status' => 'publish',
            'posts_per_page' => 50,
            'orderby' => 'date',
            'order' => 'DESC',
            'meta_query' => [
                [
                    'key' => '_posinv',
                    'value' => $like,
                    'compare' => 'LIKE',
                ]
            ],
        ]);

        $found = null;
        foreach ((array)$q->posts as $post) {
            $payload = get_post_meta($post->ID, '_posinv', true);
            if (!is_array($payload)) continue;
            if (($payload['type'] ?? '') !== 'sale') continue;
            if (($payload['store'] ?? '') !== $store) continue;
            $items = $payload['items'] ?? [];
            foreach ((array)$items as $it) {
                if ((int)($it['product_id'] ?? 0) === $product_id) {
                    $found = [
                        'ticket_id' => (int)$post->ID,
                        'date' => get_the_date('Y-m-d H:i:s', $post),
                        'qty' => (float)($it['qty'] ?? 0),
                    ];
                    break 2;
                }
            }
        }

        wp_send_json_success(['last_sale' => $found]);
    }

    /**
     * Auditoría: cuando se cierra un conteo (Inventario) guardar un resumen en pos_audit.
     * Se usa para verlo en Reportes -> Movimientos.
     */
    public static function ajax_inventory_audit() {
        if (!check_ajax_referer('posinv_inventory_nonce', 'nonce', false)) {
            wp_send_json_error(['message' => 'Nonce inválido'], 403);
        }
        if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
            wp_send_json_error(['message' => 'Sin permiso'], 403);
        }

        $store = isset($_POST['store']) ? sanitize_text_field(wp_unslash($_POST['store'])) : self::current_store_key();
        $session_id = isset($_POST['session_id']) ? sanitize_text_field(wp_unslash($_POST['session_id'])) : '';
        $counted = isset($_POST['counted']) ? absint($_POST['counted']) : 0;
        $diff_rows = isset($_POST['diff_rows']) ? absint($_POST['diff_rows']) : 0;
        $missing = isset($_POST['missing']) ? absint($_POST['missing']) : 0;
        $extra = isset($_POST['extra']) ? absint($_POST['extra']) : 0;

        self::audit_add('inventory_report', [
            'module' => 'inventory',
            'store' => $store,
            'session_id' => $session_id,
            'counted_items' => $counted,
            'diff_rows' => $diff_rows,
            'missing_rows' => $missing,
            'extra_rows' => $extra,
        ]);

        wp_send_json_success(['ok' => true]);
    }

	    // ---------------------------------------------------------------------
	    // BODEGA (multi-ubicación por producto)
	    // ---------------------------------------------------------------------
	    private static function bodega_locations_option_key() {
	        return 'posinv_bodega_locations_catalog';
	    }

	    private static function bodega_locations_catalog_get() {
	        $raw = get_option(self::bodega_locations_option_key(), []);
	        if (!is_array($raw)) return [];
	        $out = [];
	        foreach ($raw as $name) {
	            $name = sanitize_text_field($name);
	            $name = self::bodega_normalize_location($name);
	            if ($name !== '') $out[] = $name;
	        }
	        $out = array_values(array_unique($out));
	        sort($out, SORT_NATURAL | SORT_FLAG_CASE);
	        return $out;
	    }

	    // Normaliza ubicaciones para evitar duplicados tipo "A1" vs "a1" vs "A-1".
	    private static function bodega_normalize_location($loc) {
	        $loc = strtoupper(trim((string)$loc));
	        $loc = preg_replace('/[^A-Z0-9]+/', '', $loc);
	        return $loc ? $loc : '';
	    }

	    private static function bodega_locations_catalog_add($name) {
	        $name = trim(sanitize_text_field($name));
	        $name = self::bodega_normalize_location($name);
	        if ($name === '') return self::bodega_locations_catalog_get();
	        $list = self::bodega_locations_catalog_get();
	        $list[] = $name;
	        $list = array_values(array_unique($list));
	        sort($list, SORT_NATURAL | SORT_FLAG_CASE);
	        update_option(self::bodega_locations_option_key(), $list, false);
	        return $list;
	    }

	    private static function bodega_total_meta_key() {
	        return '_posinv_bodega_total';
	    }

	    private static function bodega_meta_key() {
	        return '_posinv_bodega_locations';
	    }

	    public static function ajax_bodega_locations_list() {
	        if (!check_ajax_referer('posinv_bodega_nonce', 'nonce', false)) {
	            wp_send_json_error(['message' => 'Nonce inválido'], 403);
	        }
	        if (!self::can_bodega_view()) {
	            wp_send_json_error(['message' => 'Sin permiso'], 403);
	        }
	        $items = self::bodega_locations_catalog_get();
	        wp_send_json_success(['items' => $items]);
	    }

	    public static function ajax_bodega_locations_add() {
	        if (!check_ajax_referer('posinv_bodega_nonce', 'nonce', false)) {
	            wp_send_json_error(['message' => 'Nonce inválido'], 403);
	        }
	        if (!self::can_bodega_edit()) {
	            wp_send_json_error(['message' => 'Sin permiso'], 403);
	        }
	        $name = isset($_POST['name']) ? sanitize_text_field(wp_unslash($_POST['name'])) : '';
	        $norm = self::bodega_normalize_location($name);
	        if ($norm === '') {
	            wp_send_json_error(['message' => 'Nombre inválido'], 400);
	        }
	        $items = self::bodega_locations_catalog_add($norm);
	        self::audit_add('bodega_location_add', [
	            'module' => 'bodega',
	            'action' => 'add_location',
	            'name' => $norm,
	        ]);
	        wp_send_json_success(['items' => $items, 'normalized' => $norm]);
	    }

	    private static function bodega_consolidate_rows($rows) {
        if (!is_array($rows)) return [];
        $map = [];
        foreach ($rows as $row) {
            if (!is_array($row)) continue;
            $loc = isset($row['loc']) ? self::bodega_normalize_location($row['loc']) : '';
            if ($loc === '') continue;
            $qty = isset($row['qty']) ? (float)$row['qty'] : 0;
            $obs = isset($row['obs']) ? sanitize_text_field($row['obs']) : '';
            $ts  = isset($row['ts']) ? sanitize_text_field($row['ts']) : '';
            $uid = isset($row['uid']) ? absint($row['uid']) : 0;
            $id  = isset($row['id']) ? sanitize_text_field($row['id']) : '';
            if (!isset($map[$loc])) {
                $map[$loc] = [
                    'id'  => $id !== '' ? $id : ('b' . wp_generate_password(10, false, false)),
                    'loc' => $loc,
                    'qty' => 0,
                    'obs' => $obs,
                    'ts'  => $ts,
                    'uid' => $uid,
                ];
            }
            $map[$loc]['qty'] += $qty;
            $prev_ts = (string)($map[$loc]['ts'] ?? '');
            if ($ts !== '' && ($prev_ts === '' || strcmp($ts, $prev_ts) >= 0)) {
                $map[$loc]['ts'] = $ts;
                $map[$loc]['obs'] = $obs;
                $map[$loc]['uid'] = $uid;
                if ($id !== '') $map[$loc]['id'] = $id;
            }
        }
        foreach ($map as $loc => $row) {
            if (abs((float)($row['qty'] ?? 0)) < 1e-9) {
                unset($map[$loc]);
            } else {
                $map[$loc]['qty'] = (float)$row['qty'];
            }
        }
        uksort($map, function($a, $b){ return strcasecmp((string)$a, (string)$b); });
        return array_values($map);
    }

    private static function bodega_get_locations($product_id) {
	        $raw = get_post_meta($product_id, self::bodega_meta_key(), true);
	        if (!is_array($raw)) return [];
	        // Normalizar
	        $out = [];
	        foreach ($raw as $row) {
	            if (!is_array($row)) continue;
	            $loc = isset($row['loc']) ? sanitize_text_field($row['loc']) : '';
	            $loc = self::bodega_normalize_location($loc);
	            $out[] = [
	                'id'   => isset($row['id']) ? sanitize_text_field($row['id']) : '',
	                'loc'  => $loc,
	                'qty'  => isset($row['qty']) ? (float)$row['qty'] : 0,
	                'obs'  => isset($row['obs']) ? sanitize_text_field($row['obs']) : '',
	                'ts'   => isset($row['ts']) ? sanitize_text_field($row['ts']) : '',
	                'uid'  => isset($row['uid']) ? absint($row['uid']) : 0,
	            ];
	        }
	        return $out;
	    }

	    private static function bodega_save_locations($product_id, $rows) {
	        // Asegurar ubicaciones normalizadas y recalcular total.
	        $clean = [];
	        if (is_array($rows)) {
	            foreach ($rows as $r) {
	                if (!is_array($r)) continue;
	                $loc = isset($r['loc']) ? self::bodega_normalize_location($r['loc']) : '';
	                if ($loc === '') continue;
	                $clean[] = [
	                    'id'  => isset($r['id']) ? sanitize_text_field($r['id']) : '',
	                    'loc' => $loc,
	                    'qty' => isset($r['qty']) ? (float)$r['qty'] : 0,
	                    'obs' => isset($r['obs']) ? sanitize_text_field($r['obs']) : '',
	                    'ts'  => isset($r['ts']) ? sanitize_text_field($r['ts']) : '',
	                    'uid' => isset($r['uid']) ? absint($r['uid']) : 0,
	                ];
	            }
	        }
	        update_post_meta($product_id, self::bodega_meta_key(), $clean);
	        self::bodega_recalc_total($product_id, $clean);
	    }

	    private static function bodega_recalc_total($product_id, $rows = null) {
	        if ($rows === null) $rows = self::bodega_get_locations($product_id);
	        $total = 0;
	        foreach ((array)$rows as $r) {
	            $total += (float)($r['qty'] ?? 0);
	        }
	        // Guardar como número (float). Para columnas/búsquedas rápidas.
	        update_post_meta($product_id, self::bodega_total_meta_key(), $total);
	        return $total;
	    }

	    /**
	     * Upsert (sin duplicados) por producto+ubicación.
	     * - Si ya existe una fila para la ubicación, actualiza esa fila.
	     * - Si existen varias filas duplicadas para la misma ubicación, las consolida en 1.
	     * - Si qty == 0, elimina la ubicación (todas sus filas).
	     */
	    private static function bodega_upsert_location_row(array $rows, $loc, $qty, $obs, $uid, $ts) {
	        $loc = self::bodega_normalize_location($loc);
	        $qty = (float)$qty;
	        $obs = (string)$obs;
	        $uid = (int)$uid;
	        $ts  = (string)$ts;
	        if ($loc === '') return $rows;

	        // Encontrar duplicados
	        $idx = [];
	        foreach ($rows as $i => $r) {
	            if (!is_array($r)) continue;
	            $rLoc = isset($r['loc']) ? self::bodega_normalize_location($r['loc']) : '';
	            if ($rLoc === $loc) $idx[] = $i;
	        }

	        // Si qty==0, borrar todas las filas para esa ubicación.
	        if (abs($qty) < 1e-12) {
	            if (!empty($idx)) {
	                foreach (array_reverse($idx) as $i) unset($rows[$i]);
	                $rows = array_values($rows);
	            }
	            return $rows;
	        }

	        if (empty($idx)) {
	            // Crear nueva
	            $new_id = 'b' . wp_generate_password(10, false, false);
	            $rows[] = [
	                'id' => $new_id,
	                'loc' => $loc,
	                'qty' => $qty,
	                'obs' => $obs,
	                'ts' => $ts,
	                'uid' => $uid,
	            ];
	            return $rows;
	        }

	        // Mantener la primera fila y eliminar el resto (consolidación)
	        $keep = $idx[0];
	        $keep_id = isset($rows[$keep]['id']) ? sanitize_text_field($rows[$keep]['id']) : '';
	        if ($keep_id === '') {
	            $keep_id = 'b' . wp_generate_password(10, false, false);
	        }
	        $rows[$keep] = [
	            'id' => $keep_id,
	            'loc' => $loc,
	            'qty' => $qty,
	            'obs' => $obs,
	            'ts' => $ts,
	            'uid' => $uid,
	        ];
	        if (count($idx) > 1) {
	            foreach (array_slice($idx, 1) as $i) unset($rows[$i]);
	            $rows = array_values($rows);
	        }
	        return $rows;
	    }

	    /**
	     * Reduce cantidad en una ubicación (consumiendo de filas existentes).
	     * Devuelve [ok(bool), rows(array), consumed(float), message(string)]
	     */
	    private static function bodega_consume_from_location($product_id, $loc, $qty_to_consume) {
	        $loc = self::bodega_normalize_location($loc);
	        $qty_to_consume = (float)$qty_to_consume;
	        if ($loc === '' || $qty_to_consume <= 0) {
	            return ['ok'=>false, 'rows'=>[], 'consumed'=>0, 'message'=>'Datos inválidos'];
	        }
	        $rows = self::bodega_get_locations($product_id);
	        // Ordenar: más reciente primero para consumir primero lo último guardado.
	        usort($rows, function($a, $b){
	            return strcmp((string)($b['ts'] ?? ''), (string)($a['ts'] ?? ''));
	        });
	        $available = 0;
	        foreach ($rows as $r) {
	            if (($r['loc'] ?? '') === $loc) $available += (float)($r['qty'] ?? 0);
	        }
	        if ($available + 1e-9 < $qty_to_consume) {
	            return ['ok'=>false, 'rows'=>$rows, 'consumed'=>0, 'message'=>'No hay suficiente stock en esa ubicación (bodega)'];
	        }
	        $left = $qty_to_consume;
	        $uid = get_current_user_id();
	        $ts = current_time('mysql');
	        foreach ($rows as &$r) {
	            if ($left <= 0) break;
	            if (($r['loc'] ?? '') !== $loc) continue;
	            $q = (float)($r['qty'] ?? 0);
	            if ($q <= 0) continue;
	            $take = min($q, $left);
	            $r['qty'] = $q - $take;
	            $r['ts'] = $ts;
	            $r['uid'] = $uid;
	            $left -= $take;
	        }
	        unset($r);
	        // Limpiar filas con qty=0
	        $rows = array_values(array_filter($rows, function($r){
	            return (float)($r['qty'] ?? 0) != 0;
	        }));
	        return ['ok'=>true, 'rows'=>$rows, 'consumed'=>$qty_to_consume, 'message'=>''];
	    }

	    private static function bodega_add_to_location($product_id, $loc, $qty_to_add, $obs = '') {
	        $loc = self::bodega_normalize_location($loc);
	        $qty_to_add = (float)$qty_to_add;
	        if ($loc === '' || $qty_to_add == 0) return;
	        $rows = self::bodega_get_locations($product_id);
	        $ts = current_time('mysql');
	        $uid = get_current_user_id();
	        // Si ya existe la ubicación, suma; si no existe, crea.
	        $current = 0;
	        foreach ($rows as $r) {
	            if (($r['loc'] ?? '') === $loc) $current += (float)($r['qty'] ?? 0);
	        }
	        $rows = self::bodega_upsert_location_row($rows, $loc, $current + $qty_to_add, $obs, $uid, $ts);
	        self::bodega_save_locations($product_id, $rows);
	    }

	    public static function ajax_bodega_list() {
	        if (!check_ajax_referer('posinv_bodega_nonce', 'nonce', false)) {
	            wp_send_json_error(['message' => 'Nonce inválido'], 403);
	        }
	        if (!self::can_bodega_view()) {
	            wp_send_json_error(['message' => 'Sin permiso'], 403);
	        }
	        $product_id = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
	        if (!$product_id) {
	            wp_send_json_error(['message' => 'Producto inválido'], 400);
	        }
	        $rows = self::bodega_get_locations($product_id);
	        wp_send_json_success(['items' => $rows]);
	    }

	    public static function ajax_bodega_save() {
	        if (!check_ajax_referer('posinv_bodega_nonce', 'nonce', false)) {
	            wp_send_json_error(['message' => 'Nonce inválido'], 403);
	        }
	        if (!self::can_bodega_edit()) {
	            wp_send_json_error(['message' => 'Sin permiso'], 403);
	        }
	        $product_id = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
	        $loc = isset($_POST['loc']) ? sanitize_text_field(wp_unslash($_POST['loc'])) : '';
	        $loc = self::bodega_normalize_location($loc);
	        $qty = isset($_POST['qty']) ? (float) wp_unslash($_POST['qty']) : 0;
	        $obs = isset($_POST['obs']) ? sanitize_text_field(wp_unslash($_POST['obs'])) : '';
	        if (!$product_id || $loc === '') {
	            wp_send_json_error(['message' => 'Falta producto o ubicación'], 400);
	        }
	        // timestamp default
	        $ts = current_time('mysql');
	        $uid = get_current_user_id();
	        $rows = self::bodega_get_locations($product_id);
	        // Upsert por ubicación (evita duplicados)
	        // Sumar a la cantidad existente en esa ubicación (modo "ingreso"): evita duplicados y NO pisa lo anterior.
        $current = 0;
        foreach ($rows as $r) {
            $rLoc = isset($r['loc']) ? self::bodega_normalize_location($r['loc']) : '';
            if ($rLoc === $loc) $current += (float)($r['qty'] ?? 0);
        }
        $new_qty = $current + (float)$qty;
        $rows = self::bodega_upsert_location_row($rows, $loc, $new_qty, $obs, $uid, $ts);
	        self::bodega_save_locations($product_id, $rows);

	        // Auditoría
	        self::audit_add('bodega_save', [
	            'module' => 'bodega',
	            'action' => 'save',
	            'product_id' => $product_id,
	            'loc' => $loc,
	            'qty' => $qty,
	            'obs' => $obs,
	            'ts'  => $ts,
	        ]);

	        wp_send_json_success(['ts' => $ts, 'items' => $rows]);
	    }

	    /**
	     * Bodega: guardar varias filas de golpe (por rapidez).
	     * Recibe rows (JSON): [{product_id, loc, qty, obs}, ...]
	     */
	    public static function ajax_bodega_save_bulk() {
	        if (!check_ajax_referer('posinv_bodega_nonce', 'nonce', false)) {
	            wp_send_json_error(['message' => 'Nonce inválido'], 403);
	        }
	        if (!self::can_bodega_edit()) {
	            wp_send_json_error(['message' => 'Sin permiso'], 403);
	        }
	        $raw = isset($_POST['rows']) ? wp_unslash($_POST['rows']) : '';
	        $arr = json_decode($raw, true);
	        if (!is_array($arr) || empty($arr)) {
	            wp_send_json_error(['message' => 'Sin datos para guardar'], 400);
	        }
	        $uid = get_current_user_id();
	        $saved = [];

	        // Agrupar por producto para hacer 1 update_post_meta por producto.
	        $by_product = [];
	        foreach ($arr as $row) {
	            $pid = isset($row['product_id']) ? absint($row['product_id']) : 0;
	            $loc = isset($row['loc']) ? sanitize_text_field($row['loc']) : '';
	            $loc = self::bodega_normalize_location($loc);
	            $qty = isset($row['qty']) ? (float)$row['qty'] : 0;
	            $obs = isset($row['obs']) ? sanitize_text_field($row['obs']) : '';
	            if (!$pid || $loc === '') continue;
	            if (!isset($by_product[$pid])) $by_product[$pid] = [];
	            $by_product[$pid][] = ['loc'=>$loc, 'qty'=>$qty, 'obs'=>$obs];
	        }
	        if (empty($by_product)) {
	            wp_send_json_error(['message' => 'Datos inválidos'], 400);
	        }

	        foreach ($by_product as $product_id => $rows_to_set) {
	            $existing = self::bodega_get_locations($product_id);
	            foreach ($rows_to_set as $r) {
	                $ts = current_time('mysql');
	                // Upsert por ubicación (evita duplicados). Aquí la qty es el INGRESO actual: se suma a lo existente.
                $current = 0;
                foreach ($existing as $er) {
                    $erLoc = isset($er['loc']) ? self::bodega_normalize_location($er['loc']) : '';
                    if ($erLoc === $r['loc']) $current += (float)($er['qty'] ?? 0);
                }
                $new_qty = $current + (float)$r['qty'];
                $existing = self::bodega_upsert_location_row($existing, $r['loc'], $new_qty, $r['obs'], $uid, $ts);
	                $saved[(string)$product_id] = $ts;

	                self::audit_add('bodega_save', [
	                    'module' => 'bodega',
	                    'action' => 'save',
	                    'product_id' => (int)$product_id,
	                    'loc' => $r['loc'],
	                    'qty' => $r['qty'],
	                    'obs' => $r['obs'],
	                    'ts'  => $ts,
	                ]);
	            }
	            self::bodega_save_locations($product_id, $existing);
	        }

	        wp_send_json_success(['saved' => $saved]);
	    }

	    public static function ajax_bodega_delete() {
	        if (!check_ajax_referer('posinv_bodega_nonce', 'nonce', false)) {
	            wp_send_json_error(['message' => 'Nonce inválido'], 403);
	        }
	        if (!self::can_bodega_delete()) {
	            wp_send_json_error(['message' => 'Sin permiso'], 403);
	        }
	        $product_id = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
	        $row_id = isset($_POST['row_id']) ? sanitize_text_field(wp_unslash($_POST['row_id'])) : '';
	        if (!$product_id || $row_id === '') {
	            wp_send_json_error(['message' => 'Datos inválidos'], 400);
	        }
	        $rows = self::bodega_get_locations($product_id);
	        $before = count($rows);
	        $rows = array_values(array_filter($rows, function($r) use ($row_id) {
	            return (string)($r['id'] ?? '') !== $row_id;
	        }));
	        if (count($rows) === $before) {
	            wp_send_json_error(['message' => 'No encontrado'], 404);
	        }
	        self::bodega_save_locations($product_id, $rows);
	        self::audit_add('bodega_delete', [
	            'module' => 'bodega',
	            'action' => 'delete',
	            'product_id' => $product_id,
	            'row_id' => $row_id,
	        ]);
	        wp_send_json_success(['ok' => true, 'items' => $rows]);
	    }

	    /**
	     * Traspaso operativo entre Bodega y Tienda (solo desde la pestaña Bodega).
	     * direction:
	     *  - bodega_to_store: consume qty de la ubicación actual (loc) y suma a la tienda
	     *  - store_to_bodega: resta qty de la tienda y agrega una fila a la ubicación (loc)
	     * Recibe items (JSON): [{product_id, qty, obs}, ...]
	     */
	    public static function ajax_bodega_transfer_bulk() {
	        if (!check_ajax_referer('posinv_bodega_nonce', 'nonce', false)) {
	            wp_send_json_error(['message' => 'Nonce inválido'], 403);
	        }
	        if (!self::can_bodega_transfer()) {
	            wp_send_json_error(['message' => 'Sin permiso'], 403);
	        }
	        $direction = isset($_POST['direction']) ? sanitize_text_field(wp_unslash($_POST['direction'])) : '';
	        $store_key = isset($_POST['store']) ? sanitize_text_field(wp_unslash($_POST['store'])) : '';
	        $loc = isset($_POST['loc']) ? sanitize_text_field(wp_unslash($_POST['loc'])) : '';
	        $loc = self::bodega_normalize_location($loc);
	        $raw = isset($_POST['items']) ? wp_unslash($_POST['items']) : '';
	        $items = json_decode($raw, true);

	        if (!in_array($direction, ['bodega_to_store','store_to_bodega'], true)) {
	            wp_send_json_error(['message' => 'Dirección inválida'], 400);
	        }
	        if ($loc === '' || !$store_key) {
	            wp_send_json_error(['message' => 'Falta ubicación o tienda'], 400);
	        }
	        if (!is_array($items) || empty($items)) {
	            wp_send_json_error(['message' => 'Sin items'], 400);
	        }

	        $store_meta = self::store_meta_for_key($store_key);
	        if (!$store_meta) {
	            wp_send_json_error(['message' => 'Tienda inválida'], 400);
	        }

	        $done = [];
	        foreach ($items as $it) {
	            $pid = isset($it['product_id']) ? absint($it['product_id']) : 0;
	            $qty = isset($it['qty']) ? (float)$it['qty'] : 0;
	            $obs = isset($it['obs']) ? sanitize_text_field($it['obs']) : '';
	            if (!$pid || $qty <= 0) continue;
	
	            if ($direction === 'bodega_to_store') {
	                $res = self::bodega_consume_from_location($pid, $loc, $qty);
	                if (!$res['ok']) {
	                    $done[] = ['product_id'=>$pid, 'ok'=>false, 'message'=>$res['message']];
	                    continue;
	                }
	                // Guardar bodega y actualizar total
	                self::bodega_save_locations($pid, $res['rows']);
	
	                $current = (int) get_post_meta($pid, $store_meta, true);
	                $new = $current + (int)round($qty);
	                update_post_meta($pid, $store_meta, $new);

	                self::audit_add('bodega_transfer', [
	                    'module' => 'bodega',
	                    'action' => 'bodega_to_store',
	                    'product_id' => $pid,
	                    'loc' => $loc,
	                    'store' => $store_key,
	                    'qty' => $qty,
	                    'obs' => $obs,
	                    'store_old' => $current,
	                    'store_new' => $new,
	                ]);
	                $done[] = ['product_id'=>$pid, 'ok'=>true];
	            } else {
	                // store_to_bodega
	                $current = (int) get_post_meta($pid, $store_meta, true);
	                if ($current < (int)round($qty)) {
	                    $done[] = ['product_id'=>$pid, 'ok'=>false, 'message'=>'No hay suficiente stock en tienda para traspasar'];
	                    continue;
	                }
	                $new = $current - (int)round($qty);
	                update_post_meta($pid, $store_meta, $new);
	
	                $note = trim($obs);
	                if ($note === '') $note = 'Traspaso desde ' . self::store_name_for_key($store_key);
	                self::bodega_add_to_location($pid, $loc, $qty, $note);

	                self::audit_add('bodega_transfer', [
	                    'module' => 'bodega',
	                    'action' => 'store_to_bodega',
	                    'product_id' => $pid,
	                    'loc' => $loc,
	                    'store' => $store_key,
	                    'qty' => $qty,
	                    'obs' => $note,
	                    'store_old' => $current,
	                    'store_new' => $new,
	                ]);
	                $done[] = ['product_id'=>$pid, 'ok'=>true];
	            }
	        }
	
	        wp_send_json_success(['ok'=>true, 'done'=>$done]);
	    }

	    /**
	     * Bodega: ver todo lo guardado en una ubicación (para editar rápido).
	     * Devuelve filas "aplanadas": una por (producto, fila de ubicación).
	     */
	    public static function ajax_bodega_location_view() {
	        if (!check_ajax_referer('posinv_bodega_nonce', 'nonce', false)) {
	            wp_send_json_error(['message' => 'Nonce inválido'], 403);
	        }
	        if (!self::can_bodega_view()) {
	            wp_send_json_error(['message' => 'Sin permiso'], 403);
	        }
	        $loc = isset($_POST['loc']) ? sanitize_text_field(wp_unslash($_POST['loc'])) : '';
	        $loc = self::bodega_normalize_location($loc);
	        if ($loc === '') {
	            wp_send_json_error(['message' => 'Ubicación inválida'], 400);
	        }

	        // Buscar productos que tengan el meta serializado conteniendo el texto "LOC".
	        // (No es perfecto, pero funciona bien para un catálogo normal.)
	        $needle = '"' . $loc . '"';
	        $q = new WP_Query([
	            'post_type'      => 'product',
	            'post_status'    => ['publish', 'private', 'draft'],
	            'posts_per_page' => -1,
	            'fields'         => 'ids',
	            'no_found_rows'  => true,
	            'meta_query'     => [
	                [
	                    'key'     => self::bodega_meta_key(),
	                    'value'   => $needle,
	                    'compare' => 'LIKE',
	                ]
	            ],
	        ]);

	        $s = self::get_settings();
	        $barcode_meta = !empty($s['barcode_meta']) ? $s['barcode_meta'] : '_op_barcode';
	
	        // Consolidar por producto dentro de la ubicación (evita mostrar duplicados viejos)
	        $items_map = [];
	        foreach (($q->posts ?? []) as $pid) {
	            $rows = self::bodega_get_locations((int)$pid);
	            foreach ($rows as $r) {
	                if (self::bodega_normalize_location($r['loc'] ?? '') !== $loc) continue;
	                $thumb = get_post_thumbnail_id((int)$pid);
	                $img = $thumb ? wp_get_attachment_image_url($thumb, 'thumbnail') : '';
	                $code = get_post_meta((int)$pid, $barcode_meta, true);
	                $code = is_string($code) ? trim($code) : '';
	                if ($code === '') $code = (string)(int)$pid;
	                $bodega_total = (float) get_post_meta((int)$pid, self::bodega_total_meta_key(), true);
	                $s = self::get_settings();
	                $store1_stock = isset($s['store1_meta']) ? (int) get_post_meta((int)$pid, $s['store1_meta'], true) : 0;
	                $store2_stock = isset($s['store2_meta']) ? (int) get_post_meta((int)$pid, $s['store2_meta'], true) : 0;
	                $k = (string)(int)$pid;
	                $r_ts = (string)($r['ts'] ?? '');
	                $r_qty = (float)($r['qty'] ?? 0);
	                if (!isset($items_map[$k])) {
	                    $items_map[$k] = [
	                        'product_id' => (int)$pid,
	                        'row_id'     => (string)($r['id'] ?? ''),
	                        'loc'        => $loc,
	                        'qty'        => (string)$r_qty,
	                        'obs'        => (string)($r['obs'] ?? ''),
	                        'ts'         => $r_ts,
	                        'name'       => get_the_title((int)$pid),
	                        'code'       => $code,
	                        'image'      => $img,
	                        'bodega_total' => $bodega_total,
	                        'store1_stock' => $store1_stock,
	                        'store2_stock' => $store2_stock,
	                    ];
	                } else {
	                    // Sumar cantidades si hay duplicados
	                    $prev_qty = (float)($items_map[$k]['qty'] ?? 0);
	                    $items_map[$k]['qty'] = (string)($prev_qty + $r_qty);
	                    // Mantener la info más reciente
	                    if ($r_ts !== '' && strcmp($r_ts, (string)($items_map[$k]['ts'] ?? '')) > 0) {
	                        $items_map[$k]['ts'] = $r_ts;
	                        $items_map[$k]['obs'] = (string)($r['obs'] ?? '');
	                        $items_map[$k]['row_id'] = (string)($r['id'] ?? '');
	                    }
	                }
	            }
	        }

	        $items = array_values($items_map);

	        // Orden: más reciente primero.
	        usort($items, function($a, $b){
	            return strcmp((string)($b['ts'] ?? ''), (string)($a['ts'] ?? ''));
	        });

	        wp_send_json_success(['items' => $items]);
	    }

	    /**
	     * Bodega: actualizar cantidad/observaciones de una fila existente (por row_id).
	     */
	    public static function ajax_bodega_update_row() {
	        if (!check_ajax_referer('posinv_bodega_nonce', 'nonce', false)) {
	            wp_send_json_error(['message' => 'Nonce inválido'], 403);
	        }
	        if (!self::can_bodega_edit()) {
	            wp_send_json_error(['message' => 'Sin permiso'], 403);
	        }
	        $product_id = isset($_POST['product_id']) ? absint($_POST['product_id']) : 0;
	        $row_id = isset($_POST['row_id']) ? sanitize_text_field(wp_unslash($_POST['row_id'])) : '';
	        $qty = isset($_POST['qty']) ? (float) wp_unslash($_POST['qty']) : 0;
	        $obs = isset($_POST['obs']) ? sanitize_text_field(wp_unslash($_POST['obs'])) : '';
	        if (!$product_id || $row_id === '') {
	            wp_send_json_error(['message' => 'Datos inválidos'], 400);
	        }
	
	        $rows = self::bodega_get_locations($product_id);
	        $found = false;
	        $ts = current_time('mysql');
	        $uid = get_current_user_id();
	        foreach ($rows as &$r) {
	            if ((string)($r['id'] ?? '') === $row_id) {
	                $r['qty'] = $qty;
	                $r['obs'] = $obs;
	                $r['ts']  = $ts;
	                $r['uid'] = $uid;
	                $found = true;
	                break;
	            }
	        }
	        unset($r);
	        if (!$found) {
	            wp_send_json_error(['message' => 'No encontrado'], 404);
	        }
	        self::bodega_save_locations($product_id, $rows);
	
	        self::audit_add('bodega_update', [
	            'module' => 'bodega',
	            'action' => 'update',
	            'product_id' => $product_id,
	            'row_id' => $row_id,
	            'qty' => $qty,
	            'obs' => $obs,
	            'ts'  => $ts,
	        ]);
	
	        wp_send_json_success(['ok' => true, 'ts' => $ts]);
	    }


    public static function page_barcodes() {
        if (!current_user_can('pos_use') && !current_user_can('pos_manage_settings')) {
            wp_die('Sin permisos.');
        }
        ?>
        <div class="wrap posinv-barcodes-wrap">
            <h1>Etiquetas (Código de barras) - 50 x 25 mm</h1>

            <div class="posinv-bc-toolbar">
                <input type="text" id="posinv_bc_search" placeholder="Buscar por nombre, ID o código de barras..." />
                <select id="posinv_bc_cat" style="min-width:220px;">
                    <option value="">Todas las categorías</option>
                    <?php
                    $terms = get_terms(['taxonomy'=>'product_cat','hide_empty'=>false]);
                    if (!is_wp_error($terms)) {
                        foreach ($terms as $t) {
                            echo '<option value="' . esc_attr($t->term_id) . '">' . esc_html($t->name) . '</option>';
                        }
                    }
                    ?>
                </select>
                <button class="button button-primary" id="posinv_bc_btn_search">Buscar</button>

                <label class="posinv-bc-inline">
                    Cantidad:
                    <input type="number" id="posinv_bc_copies" value="1" min="1" max="200" />
                </label>

                <button class="button" id="posinv_bc_btn_print">Imprimir etiqueta</button>
            </div>

            <div class="posinv-bc-grid">
                <div class="posinv-bc-left">
                    <h2>Resultados</h2>
                    <div id="posinv_bc_results" class="posinv-bc-results">
                        <div class="posinv-bc-hint">Escribe y presiona Buscar. Puedes usar el <b>ID</b> del producto.</div>
                    </div>
                </div>

                <div class="posinv-bc-right">
                    <h2>Vista previa</h2>

                    <!-- ÁREA DE ETIQUETA: 50mm x 25mm -->
                    <div id="posinv_label" class="posinv-label">
                        <div class="posinv-label-barcode">
                            <svg id="posinv_bc_svg" xmlns="http://www.w3.org/2000/svg"></svg>
                        </div>
                        <div id="posinv_bc_name" class="posinv-label-name">Nombre del producto</div>
                        <div id="posinv_bc_id" class="posinv-label-id">ID: 0</div>
                    </div>

                    <div class="posinv-bc-note">
                        * El código de barras usa <b>CODE39</b> con el <b>ID</b> (por compatibilidad de escáner).<br>
                        * Si tu lector requiere CODE128, se puede cambiar, pero CODE39 suele funcionar en todos.
                    </div>
                </div>
            </div>

            <!-- SOLO PARA IMPRESIÓN -->
            <div id="posinv_print_area" class="posinv-print-area" aria-hidden="true">
                <div class="posinv-label posinv-label-print">
                    <div class="posinv-label-barcode">
                        <svg id="posinv_bc_svg_print" xmlns="http://www.w3.org/2000/svg"></svg>
                    </div>
                    <div id="posinv_bc_name_print" class="posinv-label-name">Nombre del producto</div>
                    <div id="posinv_bc_id_print" class="posinv-label-id">ID: 0</div>
                </div>
            </div>

        </div>
        <?php
    }


// ------------------- REST: Stock In (entrada / aumento) -------------------
public static function rest_stockin_permissions($request) {
    if (!self::can_use_pos()) return false;
    $s = self::get_settings();
    return !empty($s['enable_stock_in']);
}

public static function rest_stockin($request) {
    if (!self::rest_stockin_permissions($request)) {
        return new WP_Error('forbidden', 'Sin permisos', ['status' => 403]);
    }

    $params = $request->get_json_params();
    $store_key = isset($params['store']) ? sanitize_text_field($params['store']) : '';
    $items = isset($params['items']) && is_array($params['items']) ? $params['items'] : [];
    $source_module = isset($params['module']) ? sanitize_text_field($params['module']) : '';

    if (!$store_key || empty($items)) {
        return new WP_Error('bad_request', 'Faltan datos', ['status' => 400]);
    }

    $meta_key = self::store_meta_for_key($store_key);
    if (!$meta_key) {
        return new WP_Error('bad_request', 'Tienda inválida', ['status' => 400]);
    }

    $changed = [];
    foreach ($items as $it) {
        $pid = isset($it['id']) ? absint($it['id']) : 0;
        $qty = isset($it['qty']) ? intval($it['qty']) : 0; // puede ser + o -
        if (!$pid || $qty === 0) continue;

        $current = intval(get_post_meta($pid, $meta_key, true));
        $new = $current + $qty;
        update_post_meta($pid, $meta_key, $new);

        $changed[] = ['id' => $pid, 'old' => $current, 'new' => $new, 'qty' => $qty];

        // Auditoría de stock (entrada/ajuste)
        $prod = wc_get_product($pid);
        self::audit_add('stock_adjust', [
            'module' => $source_module ?: 'stockin',
            'source_module' => $source_module ?: 'stockin',
            'store' => $store_key,
            'product_id' => $pid,
            'product' => $prod ? $prod->get_name() : '',
            'old_stock' => $current,
            'delta' => $qty,
            'new_stock' => $new,
            'reason' => $source_module === 'labels' ? 'Ajuste desde pestaña Etiquetas' : '',
        ]);
    }

    return rest_ensure_response(['ok' => true, 'changed' => $changed]);
}

	// ------------------- REST: Ingresos (aumentar stock por tienda) -------------------
	public static function rest_ingresos($request) {
	    if (!self::can_use_pos()) {
	        return new WP_Error('forbidden', 'Sin permisos', ['status' => 403]);
	    }

	    $params = $request->get_json_params();
	    $store_key = isset($params['store']) ? sanitize_text_field($params['store']) : '';
	    $items = isset($params['items']) && is_array($params['items']) ? $params['items'] : [];

	    if (!$store_key || empty($items)) {
	        return new WP_Error('bad_request', 'Faltan datos', ['status' => 400]);
	    }

	    $meta_key = self::store_meta_for_key($store_key);
	    if (!$meta_key) {
	        return new WP_Error('bad_request', 'Tienda inválida', ['status' => 400]);
	    }

	    $changed = [];
	    foreach ($items as $it) {
	        $pid = isset($it['id']) ? absint($it['id']) : 0;
	        $qty = isset($it['qty']) ? intval($it['qty']) : 0;
	        $obs = isset($it['obs']) ? sanitize_textarea_field($it['obs']) : '';
	        if (!$pid || $qty === 0) continue;

	        $current = intval(get_post_meta($pid, $meta_key, true));
	        $new = $current + $qty;
	        update_post_meta($pid, $meta_key, $new);

	        $prod = function_exists('wc_get_product') ? wc_get_product($pid) : null;
	        self::audit_add('ingresos_add', [
	            'store' => $store_key,
	            'product_id' => $pid,
	            'product' => $prod ? $prod->get_name() : '',
	            'old_stock' => $current,
	            'delta' => $qty,
	            'new_stock' => $new,
	            'obs' => $obs,
	        ]);

	        $changed[] = ['id' => $pid, 'old' => $current, 'new' => $new, 'qty' => $qty];
	    }

	    return rest_ensure_response(['ok' => true, 'changed' => $changed]);
	}

// ------------------- REST: Crear producto desde POS -------------------
public static function resolve_pos_created_product_status() {
    $s = self::get_settings();
    $policy = self::get_employee_policy(get_current_user_id());

    if ($policy['create_product_status'] === 'pending') return 'pending';
    if ($policy['create_product_status'] === 'publish') return 'publish';

    return !empty($s['auto_publish_products']) ? 'publish' : 'pending';
}

public static function rest_create_product_permissions($request) {
    if (!self::can_use_pos()) return false;
    $s = self::get_settings();
    return !empty($s['enable_create_product']);
}

public static function rest_create_product($request) {
    if (!self::rest_create_product_permissions($request)) {
        return new WP_Error('forbidden', 'Sin permisos', ['status' => 403]);
    }

    $params = $request->get_json_params();
    $name = isset($params['name']) ? sanitize_text_field($params['name']) : '';
    $has_price = array_key_exists('price', $params);
    $price = $has_price ? floatval($params['price']) : null;
    $cat_id = isset($params['category_id']) ? absint($params['category_id']) : 0;
    $store_key = isset($params['store']) ? sanitize_text_field($params['store']) : '';
    $stock = isset($params['stock']) ? intval($params['stock']) : 0;
    $image_b64 = isset($params['image_base64']) ? (string) $params['image_base64'] : '';
    $image_id = isset($params['image_id']) ? absint($params['image_id']) : 0;

    if (!$name) {
        return new WP_Error('bad_request', 'Falta nombre', ['status' => 400]);
    }

    $post_id = wp_insert_post([
        'post_title'  => $name,
        'post_type'   => 'product',
        'post_status' => self::resolve_pos_created_product_status(),
    ], true);

    if (is_wp_error($post_id)) return $post_id;

    wp_set_object_terms($post_id, 'simple', 'product_type');
    if ($cat_id) wp_set_object_terms($post_id, [$cat_id], 'product_cat', false);

    if ($has_price && $price !== null) {
        update_post_meta($post_id, '_regular_price', (string) $price);
        update_post_meta($post_id, '_price', (string) $price);
    }

    if ($store_key) {
        $meta_key = self::store_meta_for_key($store_key);
        if ($meta_key) update_post_meta($post_id, $meta_key, max(0, $stock));
    }

    if ($image_id && get_post($image_id) && wp_attachment_is_image($image_id)) {
        set_post_thumbnail($post_id, $image_id);
    } elseif ($image_b64) {
        $image_b64 = preg_replace('#^data:image/\w+;base64,#i', '', $image_b64);
        $bytes = base64_decode($image_b64);
        if ($bytes) {
            $upload = wp_upload_bits('pos_product_' . $post_id . '.jpg', null, $bytes);
            if (empty($upload['error'])) {
                $filetype = wp_check_filetype($upload['file'], null);
                $attachment_id = wp_insert_attachment([
                    'post_mime_type' => $filetype['type'],
                    'post_title'     => $name,
                    'post_content'   => '',
                    'post_status'    => 'inherit',
                ], $upload['file'], $post_id);
                require_once ABSPATH . 'wp-admin/includes/image.php';
                $attach_data = wp_generate_attachment_metadata($attachment_id, $upload['file']);
                wp_update_attachment_metadata($attachment_id, $attach_data);
                set_post_thumbnail($post_id, $attachment_id);
            }
        }
    }

    // Auditoría creación de producto desde POS
    self::audit_add('create_product', [
        'product_id' => $post_id,
        'product' => $name,
        'store' => $store_key,
        'price' => $price,
        'initial_stock' => $stock,
        'status' => get_post_status($post_id),
    ]);

    return rest_ensure_response([
        'ok' => true,
        'id' => $post_id,
        'status' => get_post_status($post_id),
    ]);
}
    private static function visor_find_product_id($code, $barcode_meta) {
        $code = trim((string)$code);
        if ($code === '') return 0;

        $ids = [];

        // 1) ID exacto
        if (ctype_digit($code)) {
            $pid = (int)$code;
            $p = $pid > 0 ? wc_get_product($pid) : false;
            if ($p && in_array(get_post_status($pid), ['publish','private'], true)) {
                $ids[] = (int) $p->get_id();
            }
        }

        // 2) SKU o meta de código exacto (producto o variación)
        global $wpdb;
        $sql = $wpdb->prepare("
            SELECT p.ID
            FROM {$wpdb->posts} p
            INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID
            WHERE p.post_type IN ('product','product_variation')
              AND p.post_status IN ('publish','private')
              AND ((pm.meta_key = '_sku' AND pm.meta_value = %s) OR (pm.meta_key = %s AND pm.meta_value = %s))
            ORDER BY p.ID DESC
            LIMIT 20
        ", $code, $barcode_meta, $code);
        $found = $wpdb->get_col($sql);
        if (!empty($found)) {
            foreach (array_unique(array_map('intval', $found)) as $fid) {
                $p = wc_get_product($fid);
                if (!$p) continue;
                $ids[] = (int) $p->get_id();
            }
        }

        // 3) Nombre exacto o parecido, igual que Caja
        $name_ids = (new WP_Query([
            'post_type'      => 'product',
            'post_status'    => ['publish','private'],
            'posts_per_page' => 10,
            'fields'         => 'ids',
            's'              => $code,
            'orderby'        => 'date',
            'order'          => 'DESC',
            'no_found_rows'  => true,
        ]))->posts;
        if (!empty($name_ids)) {
            $ids = array_merge($ids, array_map('intval', $name_ids));
        }

        $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
        return !empty($ids) ? (int)$ids[0] : 0;
    }

    private static function render_visor_search_ui($notice = '', $prefill = '') {
        ob_start(); ?>
        <style>
        .posinv-visor{padding:14px;}
        .posinv-scan-card{max-width:720px;margin:0 auto;background:#fff;border:1px solid #e6e6e6;border-radius:18px;overflow:hidden;padding:14px;}
        .posinv-scan-alert{margin:0 0 12px;padding:10px 12px;border-radius:12px;background:#fff4f4;border:1px solid #f3caca;color:#b42318;font-weight:600;}
        .posinv-scan-title{margin:0 0 8px;font-size:22px;line-height:1.2;}
        .posinv-scan-muted{opacity:.8;margin:0 0 12px;}
        #posinvScanBox{width:100%;max-width:300px;margin:12px auto;border-radius:16px;overflow:hidden;display:none;background:#111;}
        #posinvScanBox video{display:block;width:100%;height:auto;border-radius:16px;}
        .posinv-scan-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:10px;}
        .posinv-scan-actions .button{border-radius:12px;padding:10px 14px;font-weight:600;}
        .posinv-scan-input{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:12px;}
        .posinv-scan-input input{width:min(420px,100%);padding:10px 12px;border:1px solid #dcdcdc;border-radius:12px;}
        .posinv-scan-msg{margin-top:10px;text-align:center;font-weight:600;}
        </style>
        <div class="posinv-visor">
          <div class="posinv-scan-card">
            <?php if ($notice !== '') : ?>
              <div class="posinv-scan-alert"><?php echo esc_html($notice); ?></div>
            <?php endif; ?>
            <h2 class="posinv-scan-title">Escanear producto <span class="posinv-version">v<?php echo esc_html(self::VERSION); ?></span></h2>
            <p class="posinv-scan-muted">Apunta la cámara al código (barcode o QR). Cuando el mismo código se confirme 2 veces, se abrirá el producto.</p>

            <div id="posinvScanBox"></div>

            <div class="posinv-scan-actions">
              <button type="button" class="button button-primary" id="posinvStartScan">Activar cámara</button>
              <button type="button" class="button" id="posinvStopScan" style="display:none;">Detener</button>
            </div>

            <div class="posinv-scan-input">
              <input type="text" id="posinvManualCode" placeholder="O escribe el código aquí (ej. 750...)" inputmode="numeric" value="<?php echo esc_attr($prefill); ?>" />
              <button type="button" class="button" id="posinvGoManual">Ver</button>
            </div>

            <div class="posinv-scan-msg" id="posinvScanMsg"></div>
          </div>
        </div>

        <script>
        (function(){
          var startBtn = document.getElementById('posinvStartScan');
          var stopBtn  = document.getElementById('posinvStopScan');
          var msgEl    = document.getElementById('posinvScanMsg');
          var manualIn = document.getElementById('posinvManualCode');
          var goBtn    = document.getElementById('posinvGoManual');
          var box      = document.getElementById('posinvScanBox');

          var state = { stream:null, video:null, detector:null, rafId:null, lastRaw:'', stableCount:0, startedAt:0, lastSeenAt:0, track:null };

          function setMsg(t, tone){
            if(!msgEl) return;
            msgEl.textContent = t || '';
            if(tone === 'ok'){ msgEl.style.color = 'green'; }
            else if(tone === 'bad'){ msgEl.style.color = 'crimson'; }
            else { msgEl.style.color = '#555'; }
          }

          function openCode(code){
            code = (code || '').trim();
            if(!code) { setMsg('Código vacío.', 'bad'); return; }
            var url = new URL(window.location.href);
            url.searchParams.set('code', code);
            window.location.href = url.toString();
          }

          if(goBtn){
            goBtn.addEventListener('click', function(){
              openCode(manualIn ? manualIn.value : '');
            });
          }
          if(manualIn){
            manualIn.addEventListener('keydown', function(e){
              if(e.key === 'Enter'){ e.preventDefault(); openCode(manualIn.value); }
            });
          }

          async function stopScan(keepMsg){
            try{
              if(state.rafId) cancelAnimationFrame(state.rafId);
              state.rafId = null;
              if(state.stream){ state.stream.getTracks().forEach(function(t){ t.stop(); }); }
              state.stream = null;
              if(state.video){ state.video.pause(); state.video.srcObject = null; }
              state.video = null;
              state.detector = null;
              state.track = null;
              state.lastRaw = '';
              state.stableCount = 0;
              state.lastSeenAt = 0;
              if(box){ box.innerHTML = ''; box.style.display = 'none'; }
              if(!keepMsg){ setMsg('Escaneo detenido.', 'ok'); }
            }catch(e){}
            if(stopBtn) stopBtn.style.display = 'none';
            if(startBtn) startBtn.style.display = 'inline-flex';
          }

          async function tick(){
            if(!state.detector || !state.video) return;
            try{
              var barcodes = await state.detector.detect(state.video);
              if(barcodes && barcodes.length){
                var raw = String(barcodes[0].rawValue || '').trim();
                if(raw){
                  state.lastSeenAt = Date.now();
                  if((Date.now() - state.startedAt) < 500){
                    setMsg('Enfocando cámara…', 'soft');
                  }else{
                    if(raw === state.lastRaw){
                      state.stableCount = Math.min(state.stableCount + 1, 2);
                    }else{
                      state.lastRaw = raw;
                      state.stableCount = 1;
                    }
                    setMsg(state.stableCount >= 2 ? ('Código confirmado: ' + raw) : ('Código detectado: ' + raw + ' (1/2)'), state.stableCount >= 2 ? 'ok' : 'soft');
                    if(state.stableCount >= 2){
                      await stopScan(true);
                      openCode(raw);
                      return;
                    }
                  }
                }
              }else if(state.lastSeenAt && (Date.now() - state.lastSeenAt) > 2200){
                state.lastRaw = '';
                state.stableCount = 0;
                setMsg('Acerca o aleja un poco la cámara para enfocar…', 'soft');
              }
            }catch(e){}
            state.rafId = requestAnimationFrame(tick);
          }

          async function startScan(){
            if(!('BarcodeDetector' in window)){
              setMsg('Tu navegador no soporta escaneo directo aquí. Usa el campo para escribir el código.', 'bad');
              return;
            }

            try{
              try{
                state.detector = new BarcodeDetector({ formats: ['qr_code','ean_13','ean_8','code_128','code_39','upc_a','upc_e'] });
              }catch(_e){
                state.detector = new BarcodeDetector();
              }

              if(box){ box.innerHTML = ''; box.style.display = 'block'; }
              state.video = document.createElement('video');
              state.video.setAttribute('playsinline','');
              state.video.autoplay = true;
              state.video.muted = true;
              if(box) box.appendChild(state.video);

              state.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                  facingMode: { ideal: 'environment' },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                  focusMode: { ideal: 'continuous' }
                },
                audio:false
              });
              state.video.srcObject = state.stream;
              await state.video.play();

              state.startedAt = Date.now();
              state.lastRaw = '';
              state.stableCount = 0;
              state.lastSeenAt = 0;
              state.track = (state.stream && state.stream.getVideoTracks) ? (state.stream.getVideoTracks()[0] || null) : null;
              if(state.track && state.track.applyConstraints){
                try{
                  var caps = (state.track.getCapabilities ? state.track.getCapabilities() : {}) || {};
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
                  if(advanced.length){ state.track.applyConstraints({ advanced: advanced }).catch(function(){}); }
                }catch(_capsErr){}
              }

              if(startBtn) startBtn.style.display = 'none';
              if(stopBtn) stopBtn.style.display = 'inline-flex';

              setMsg('Enfocando cámara…', 'soft');
              state.rafId = requestAnimationFrame(tick);
            }catch(e){
              setMsg('No se pudo abrir la cámara. Revisa permisos del navegador.', 'bad');
              await stopScan(true);
            }
          }

          if(startBtn){ startBtn.addEventListener('click', function(){ startScan(); }); }
          if(stopBtn){ stopBtn.addEventListener('click', function(){ stopScan(); }); }
        })();
        </script>
        <?php
        return ob_get_clean();
    }

    // =========================
    // VISOR POR CÓDIGO DE BARRAS (Opción B)
    // Página con shortcode [posinv_visor] y parámetro ?code=XXXXXXXX
    // =========================
    public static function shortcode_visor($atts = []) {
        // Visor público para clientes (sin login)


        $settings = self::get_settings();
        $barcode_meta = !empty($settings['barcode_meta']) ? $settings['barcode_meta'] : '_op_barcode';

        $code = isset($_GET['code']) ? sanitize_text_field(wp_unslash($_GET['code'])) : '';
        $code = trim($code);
        if ($code === '') {
            return self::render_visor_search_ui('', '');
        }

        // Buscar producto por meta de código de barras
        $product_id = self::visor_find_product_id($code, $barcode_meta);

        if ($product_id <= 0) {
            return self::render_visor_search_ui('No encontrado: ' . $code, $code);
        }
        $product = wc_get_product($product_id);
        if (!$product) {
            return '<div class="posinv-visor"><p>Error al cargar el producto.</p></div>';
        }

        $name  = $product->get_name();
        $price = $product->get_price();
        $price_html = $product->get_price_html();
        $short = $product->get_short_description();

        $img_id = $product->get_image_id();
        $img_url = $img_id ? wp_get_attachment_image_url($img_id, 'large') : '';
        if (!$img_url) {
            $img_url = wc_placeholder_img_src('large');
        }

        ob_start(); ?>
        <style>
.posinv-visor{padding:14px;}
.posinv-visor-topbar{max-width:720px;margin:0 auto 12px;background:#fff;border:1px solid #e6e6e6;border-radius:18px;padding:10px 12px;}
.posinv-visor-topbar-row{display:flex;gap:10px;align-items:center;flex-wrap:nowrap;}
.posinv-visor-topbar .button{border-radius:12px;padding:10px 14px;font-weight:600;white-space:nowrap;}
.posinv-visor-topbar input{flex:1 1 auto;min-width:0;padding:10px 12px;border:1px solid #dcdcdc;border-radius:12px;}
#posinvScanBoxInline{max-width:300px;margin:0 auto 12px;border-radius:16px;overflow:hidden;display:none;background:#fff;}
#posinvScanBoxInline video{display:block;width:100%;border-radius:16px;}
.posinv-visor-scan-msg{max-width:720px;margin:0 auto 12px;text-align:center;font-weight:600;}
.posinv-visor-card{max-width:720px;margin:0 auto;background:#fff;border:1px solid #e6e6e6;border-radius:18px;overflow:hidden;}
.posinv-visor-img img{width:100%;height:auto;display:block;}
.posinv-visor-info{padding:14px;}
.posinv-visor-title{margin:0 0 8px;font-size:24px;line-height:1.2;}
.posinv-visor-price{font-size:22px;font-weight:700;margin-bottom:10px;}
.posinv-visor-short{font-size:15px;opacity:.9;}
@media (max-width:640px){
  .posinv-visor-title{font-size:20px}
  .posinv-visor-price{font-size:20px}
  .posinv-visor-topbar-row{gap:8px}
  .posinv-visor-topbar .button{padding:9px 12px}
}
</style>
        <div class="posinv-visor">
            <div class="posinv-visor-topbar"><div class="posinv-version">v<?php echo esc_html(self::VERSION); ?></div>
                <div class="posinv-visor-topbar-row">
                    <button type="button" class="button button-primary" id="posinvStartScanInline">📷</button>
                    <button type="button" class="button" id="posinvStopScanInline" style="display:none;">Detener</button>
                    <input type="text" id="posinvManualCodeInline" placeholder="Código de barras o QR" inputmode="numeric" value="" />
                    <button type="button" class="button button-primary" id="posinvGoManualInline">Ver</button>
                </div>
            </div>
            <div id="posinvScanBoxInline"></div>
            <div class="posinv-visor-scan-msg" id="posinvScanMsgInline"></div>
            <div class="posinv-visor-card">
                <div class="posinv-visor-img">
                    <img src="<?php echo esc_url($img_url); ?>" alt="<?php echo esc_attr($name); ?>">
                </div>
                <div class="posinv-visor-info">
                    <h2 class="posinv-visor-title"><?php echo esc_html($name); ?></h2>
                    <div class="posinv-visor-price"><?php echo wp_kses_post($price_html); ?></div>
                    <?php if (!empty($short)) : ?>
                        <div class="posinv-visor-short"><?php echo wp_kses_post(wpautop($short)); ?></div>
                    <?php endif; ?>
                </div>
            </div>
        </div>
        <script>
        (function(){
          var startBtn = document.getElementById('posinvStartScanInline');
          var stopBtn  = document.getElementById('posinvStopScanInline');
          var msgEl    = document.getElementById('posinvScanMsgInline');
          var manualIn = document.getElementById('posinvManualCodeInline');
          var goBtn    = document.getElementById('posinvGoManualInline');
          var box      = document.getElementById('posinvScanBoxInline');
          var state    = { stream:null, video:null, detector:null, rafId:null, lastRaw:'', stableCount:0, startedAt:0, lastSeenAt:0, track:null };

          function setMsg(t, tone){
            if(!msgEl) return;
            msgEl.textContent = t || '';
            if(tone === 'ok'){ msgEl.style.color = 'green'; }
            else if(tone === 'bad'){ msgEl.style.color = 'crimson'; }
            else { msgEl.style.color = '#555'; }
          }
          function openCode(code){
            code = (code || '').trim();
            if(!code){ setMsg('Código vacío.', 'bad'); return; }
            var url = new URL(window.location.href);
            url.searchParams.set('code', code);
            window.location.href = url.toString();
          }
          if(goBtn){ goBtn.addEventListener('click', function(){ openCode(manualIn ? manualIn.value : ''); }); }
          if(manualIn){ manualIn.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); openCode(manualIn.value); } }); }

          async function stopScan(keepMsg){
            try{
              if(state.rafId) cancelAnimationFrame(state.rafId);
              state.rafId = null;
              if(state.stream){ state.stream.getTracks().forEach(function(t){ t.stop(); }); }
              state.stream = null;
              if(state.video){ state.video.pause(); state.video.srcObject = null; }
              state.video = null;
              state.detector = null;
              state.track = null;
              state.lastRaw = '';
              state.stableCount = 0;
              state.lastSeenAt = 0;
              if(box){ box.innerHTML = ''; box.style.display = 'none'; }
              if(!keepMsg){ setMsg('', 'soft'); }
            }catch(e){}
            if(stopBtn) stopBtn.style.display = 'none';
            if(startBtn) startBtn.style.display = 'inline-flex';
          }
          async function tick(){
            if(!state.detector || !state.video) return;
            try{
              var barcodes = await state.detector.detect(state.video);
              if(barcodes && barcodes.length){
                var raw = String(barcodes[0].rawValue || '').trim();
                if(raw){
                  state.lastSeenAt = Date.now();
                  if((Date.now() - state.startedAt) < 500){
                    setMsg('Enfocando cámara…', 'soft');
                  }else{
                    if(raw === state.lastRaw){
                      state.stableCount = Math.min(state.stableCount + 1, 2);
                    }else{
                      state.lastRaw = raw;
                      state.stableCount = 1;
                    }
                    setMsg(state.stableCount >= 2 ? ('Código confirmado: ' + raw) : ('Código detectado: ' + raw + ' (1/2)'), state.stableCount >= 2 ? 'ok' : 'soft');
                    if(state.stableCount >= 2){
                      await stopScan(true);
                      openCode(raw);
                      return;
                    }
                  }
                }
              }else if(state.lastSeenAt && (Date.now() - state.lastSeenAt) > 2200){
                state.lastRaw = '';
                state.stableCount = 0;
                setMsg('Acerca o aleja un poco la cámara para enfocar…', 'soft');
              }
            }catch(e){}
            state.rafId = requestAnimationFrame(tick);
          }
          async function startScan(){
            if(!('BarcodeDetector' in window)){
              setMsg('Tu navegador no soporta escaneo directo aquí.', 'bad');
              return;
            }
            try{
              try{
                state.detector = new BarcodeDetector({ formats: ['qr_code','ean_13','ean_8','code_128','code_39','upc_a','upc_e'] });
              }catch(_e){
                state.detector = new BarcodeDetector();
              }
              if(box){ box.innerHTML = ''; box.style.display = 'block'; }
              state.video = document.createElement('video');
              state.video.setAttribute('playsinline','');
              state.video.autoplay = true;
              state.video.muted = true;
              if(box) box.appendChild(state.video);
              state.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                  facingMode: { ideal: 'environment' },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                  focusMode: { ideal: 'continuous' }
                },
                audio:false
              });
              state.video.srcObject = state.stream;
              await state.video.play();
              state.startedAt = Date.now();
              state.lastRaw = '';
              state.stableCount = 0;
              state.lastSeenAt = 0;
              state.track = (state.stream && state.stream.getVideoTracks) ? (state.stream.getVideoTracks()[0] || null) : null;
              if(state.track && state.track.applyConstraints){
                try{
                  var caps = (state.track.getCapabilities ? state.track.getCapabilities() : {}) || {};
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
                  if(advanced.length){ state.track.applyConstraints({ advanced: advanced }).catch(function(){}); }
                }catch(_capsErr){}
              }
              if(startBtn) startBtn.style.display = 'none';
              if(stopBtn) stopBtn.style.display = 'inline-flex';
              setMsg('Enfocando cámara…', 'soft');
              state.rafId = requestAnimationFrame(tick);
            }catch(e){
              setMsg('No se pudo abrir la cámara. Revisa permisos del navegador.', 'bad');
              await stopScan(true);
            }
          }
          if(startBtn){ startBtn.addEventListener('click', function(){ startScan(); }); }
          if(stopBtn){ stopBtn.addEventListener('click', function(){ stopScan(); }); }
        })();
        </script>
        <?php
        return ob_get_clean();
    }

    // =========================
    // Caja: Clientes (buscar usuarios)
    // =========================
    public static function rest_customers_search(WP_REST_Request $req) {
        $q = sanitize_text_field($req->get_param('q') ?: '');
        $limit = intval($req->get_param('limit') ?: 20);
        $limit = max(1, min(50, $limit));

        if ($q === '') {
            return rest_ensure_response(['items' => []]);
        }

        // Buscar por display_name, user_login o email
        $args = [
            'number' => $limit,
            'search' => '*' . $q . '*',
            'search_columns' => ['user_login','user_nicename','user_email','display_name'],
            'fields' => ['ID','display_name','user_email'],
        ];
        $users = get_users($args);

        $out = [];
        foreach ($users as $u) {
            $uid = intval($u->ID);
            $phone = get_user_meta($uid, 'billing_phone', true);
            if (!$phone) $phone = get_user_meta($uid, 'phone', true);
            $out[] = [
                'id' => $uid,
                'name' => (string)($u->display_name ?: ('Usuario #' . $uid)),
                'email' => (string)($u->user_email ?: ''),
                'phone' => (string)($phone ?: ''),
            ];
        }

        return rest_ensure_response(['items' => $out]);
    }

    // =========================
    // Caja: Turnos / Corte
    // =========================
    private static function shift_find_open($store_key, $user_id) {
        $q = new WP_Query([
            'post_type' => 'pos_shift',
            'post_status' => 'publish',
            'posts_per_page' => 1,
            'fields' => 'ids',
            'no_found_rows' => true,
            'author' => $user_id,
            'meta_query' => [
                ['key' => '_posinv_shift_store', 'value' => $store_key],
                ['key' => '_posinv_shift_status', 'value' => 'open'],
            ],
            'orderby' => 'date',
            'order' => 'DESC',
        ]);
        if (!empty($q->posts)) return intval($q->posts[0]);
        return 0;
    }

    private static function shift_report($shift_id) {
        $shift = get_post_meta($shift_id, '_posinv_shift', true);
        if (!is_array($shift)) $shift = [];

        $tickets = get_posts([
            'post_type' => 'pos_ticket',
            'post_status' => 'publish',
            'posts_per_page' => -1,
            'orderby' => 'date',
            'order' => 'ASC',
            'meta_key' => '_posinv_shift_id',
            'meta_value' => (int)$shift_id,
        ]);

        $items = [];
        foreach ($tickets as $ticket) {
            $undone = (int) get_post_meta($ticket->ID, '_posinv_undone', true);
            if ($undone) continue;
            $payload = get_post_meta($ticket->ID, '_posinv', true);
            if (!is_array($payload)) continue;
            $type = sanitize_text_field($payload['type'] ?? 'sale');
            $totals = is_array($payload['totals'] ?? null) ? $payload['totals'] : [];
            $payment = is_array($payload['payment'] ?? null) ? $payload['payment'] : [];
            $items[] = [
                'ticket_id' => (int)$ticket->ID,
                'folio' => 'T-' . (int)$ticket->ID,
                'type' => $type,
                'created_at' => get_the_date('Y-m-d H:i', $ticket),
                'total' => (float)($totals['total'] ?? 0),
                'cash' => (float)($payment['cash'] ?? 0),
                'transfer' => (float)($payment['transfer'] ?? 0),
                'card' => (float)($payment['card'] ?? 0),
            ];
        }

        $withdrawals = isset($shift['withdrawals']) && is_array($shift['withdrawals']) ? $shift['withdrawals'] : [];
        return [
            'store' => sanitize_text_field(get_post_meta($shift_id, '_posinv_shift_store', true)),
            'opened_at' => (string) get_post_meta($shift_id, '_posinv_shift_opened_at', true),
            'closed_at' => current_time('Y-m-d H:i'),
            'open_amount' => (float)($shift['open_amount'] ?? 0),
            'close_amount' => (float)($shift['close_amount'] ?? 0),
            'expected_cash' => (float)($shift['expected_cash'] ?? 0),
            'diff' => (float)($shift['diff'] ?? 0),
            'sales_total' => (float)($shift['sales_total'] ?? 0),
            'sales_cash' => (float)($shift['sales_cash'] ?? 0),
            'sales_transfer' => (float)($shift['sales_transfer'] ?? 0),
            'sales_card' => (float)($shift['sales_card'] ?? 0),
            'withdraw_total' => (float)($shift['withdraw_total'] ?? 0),
            'withdrawals' => $withdrawals,
            'transactions' => $items,
        ];
    }

    private static function shift_payload($shift_id) {
        $p = get_post_meta($shift_id, '_posinv_shift', true);
        if (!is_array($p)) $p = [];
        $p['id'] = intval($shift_id);
        $p['status'] = get_post_meta($shift_id, '_posinv_shift_status', true) ?: 'open';
        $opened = get_post_meta($shift_id, '_posinv_shift_opened_at', true);
        $p['opened_at_local'] = $opened ? (string)$opened : '';
        $p['expected_cash'] = isset($p['expected_cash']) ? (float)$p['expected_cash'] : 0.0;
        $p['diff'] = isset($p['diff']) ? (float)$p['diff'] : 0.0;
        $p['sales_total'] = isset($p['sales_total']) ? (float)$p['sales_total'] : 0.0;
        $p['sales_cash'] = isset($p['sales_cash']) ? (float)$p['sales_cash'] : 0.0;
        $p['sales_transfer'] = isset($p['sales_transfer']) ? (float)$p['sales_transfer'] : 0.0;
        $p['sales_card'] = isset($p['sales_card']) ? (float)$p['sales_card'] : 0.0;
        $p['withdraw_total'] = isset($p['withdraw_total']) ? (float)$p['withdraw_total'] : 0.0;
        return $p;
    }

    private static function shift_recalc($shift_id) {
        $p = get_post_meta($shift_id, '_posinv_shift', true);
        if (!is_array($p)) $p = [];
        $open = isset($p['open_amount']) ? (float)$p['open_amount'] : 0.0;
        $withdrawals = isset($p['withdrawals']) && is_array($p['withdrawals']) ? $p['withdrawals'] : [];
        $w_total = 0.0;
        foreach ($withdrawals as $w) { $w_total += (float)($w['amount'] ?? 0); }

        $sales_cash = (float)($p['sales_cash'] ?? 0);
        $expected = $open + $sales_cash - $w_total;
        $p['withdraw_total'] = $w_total;
        $p['expected_cash'] = $expected;

        $close_amount = isset($p['close_amount']) ? (float)$p['close_amount'] : null;
        if ($close_amount !== null) {
            $p['diff'] = (float)$close_amount - (float)$expected;
        } else {
            $p['diff'] = 0.0;
        }
        update_post_meta($shift_id, '_posinv_shift', $p);
        return $p;
    }

    public static function rest_shift_current(WP_REST_Request $req) {
        $store = sanitize_text_field($req->get_param('store') ?: self::current_store_key());
        $u = wp_get_current_user();
        $locked = (in_array('pos_san_mateo', (array)$u->roles, true) || in_array('pos_xaltocan', (array)$u->roles, true));
        if ($locked) $store = self::current_store_key();

        $uid = get_current_user_id();
        $sid = self::shift_find_open($store, $uid);
        if (!$sid) return rest_ensure_response(['shift' => null]);

        self::shift_recalc($sid);
        return rest_ensure_response(['shift' => self::shift_payload($sid)]);
    }

    public static function rest_shift_open(WP_REST_Request $req) {
        $b = $req->get_json_params(); if (!is_array($b)) $b = [];
        $store = sanitize_text_field($b['store'] ?? self::current_store_key());
        $raw_open_amount = $b['open_amount'] ?? null;
        if ($raw_open_amount === null || $raw_open_amount === '') return new WP_Error('open_amount_required', 'Escribe el monto con el que se abre el turno, aunque sea 0.', ['status'=>400]);
        $open_amount = (float)$raw_open_amount;

        $u = wp_get_current_user();
        $locked = (in_array('pos_san_mateo', (array)$u->roles, true) || in_array('pos_xaltocan', (array)$u->roles, true));
        if ($locked) $store = self::current_store_key();

        $uid = get_current_user_id();
        $existing = self::shift_find_open($store, $uid);
        if ($existing) {
            self::shift_recalc($existing);
            return rest_ensure_response(['shift' => self::shift_payload($existing)]);
        }

        $title = 'SHIFT - ' . self::store_name_for_key($store) . ' - ' . current_time('Y-m-d H:i');
        $shift_id = wp_insert_post([
            'post_type' => 'pos_shift',
            'post_status' => 'publish',
            'post_title' => $title,
            'post_author' => $uid,
        ], true);
        if (is_wp_error($shift_id)) return $shift_id;

        update_post_meta($shift_id, '_posinv_shift_store', $store);
        update_post_meta($shift_id, '_posinv_shift_status', 'open');
        update_post_meta($shift_id, '_posinv_shift_opened_at', current_time('Y-m-d H:i'));

        $payload = [
            'open_amount' => $open_amount,
            'withdrawals' => [],
            'sales_cash' => 0.0,
            'sales_total' => 0.0,
            'sales_transfer' => 0.0,
            'sales_card' => 0.0,
        ];
        update_post_meta($shift_id, '_posinv_shift', $payload);
        self::shift_recalc($shift_id);

        self::audit_add('shift_open', ['store' => $store, 'open_amount' => $open_amount, 'shift_id' => (int)$shift_id]);
        return rest_ensure_response(['shift' => self::shift_payload($shift_id)]);
    }

    public static function rest_shift_withdraw(WP_REST_Request $req) {
        $b = $req->get_json_params(); if (!is_array($b)) $b = [];
        $store = sanitize_text_field($b['store'] ?? self::current_store_key());
        $amount = isset($b['amount']) ? (float)$b['amount'] : 0.0;
        $concept = sanitize_text_field($b['concept'] ?? '');
        if ($amount <= 0) return new WP_Error('bad_amount', 'Monto inválido', ['status'=>400]);
        if ($concept === '') return new WP_Error('bad_concept', 'Escribe el concepto del retiro', ['status'=>400]);

        $u = wp_get_current_user();
        $locked = (in_array('pos_san_mateo', (array)$u->roles, true) || in_array('pos_xaltocan', (array)$u->roles, true));
        if ($locked) $store = self::current_store_key();

        $uid = get_current_user_id();
        $sid = self::shift_find_open($store, $uid);
        if (!$sid) return new WP_Error('no_shift', 'No hay turno abierto', ['status'=>409]);

        $p = get_post_meta($sid, '_posinv_shift', true);
        if (!is_array($p)) $p = [];
        if (!isset($p['withdrawals']) || !is_array($p['withdrawals'])) $p['withdrawals'] = [];
        $p['withdrawals'][] = ['amount'=>$amount, 'concept'=>$concept, 'time'=>current_time('Y-m-d H:i')];
        update_post_meta($sid, '_posinv_shift', $p);
        self::shift_recalc($sid);

        self::audit_add('shift_withdraw', ['store'=>$store, 'amount'=>$amount, 'concept'=>$concept, 'shift_id'=>(int)$sid]);
        return rest_ensure_response(['shift' => self::shift_payload($sid)]);
    }

    public static function rest_shift_close(WP_REST_Request $req) {
        $b = $req->get_json_params(); if (!is_array($b)) $b = [];
        $store = sanitize_text_field($b['store'] ?? self::current_store_key());
        $close_amount = isset($b['close_amount']) ? (float)$b['close_amount'] : 0.0;

        $u = wp_get_current_user();
        $locked = (in_array('pos_san_mateo', (array)$u->roles, true) || in_array('pos_xaltocan', (array)$u->roles, true));
        if ($locked) $store = self::current_store_key();

        $uid = get_current_user_id();
        $sid = self::shift_find_open($store, $uid);
        if (!$sid) return new WP_Error('no_shift', 'No hay turno abierto', ['status'=>409]);

        $p = get_post_meta($sid, '_posinv_shift', true);
        if (!is_array($p)) $p = [];
        $p['close_amount'] = $close_amount;
        update_post_meta($sid, '_posinv_shift', $p);
        self::shift_recalc($sid);

        update_post_meta($sid, '_posinv_shift_status', 'closed');
        $report = self::shift_report($sid);
        update_post_meta($sid, '_posinv_shift_report', $report);
        self::audit_add('shift_close', ['store'=>$store, 'close_amount'=>$close_amount, 'shift_id'=>(int)$sid]);

        return rest_ensure_response(['shift' => self::shift_payload($sid), 'report' => $report]);
    }

    private static function shift_apply_sale($store, $ticket_id, $totals, $payment) {
        $uid = get_current_user_id();
        $sid = self::shift_find_open($store, $uid);
        if (!$sid) return 0;

        $p = get_post_meta($sid, '_posinv_shift', true);
        if (!is_array($p)) $p = [];

        $total = (float)($totals['total'] ?? 0);
        $cash = (float)($payment['cash'] ?? 0);
        $transfer = (float)($payment['transfer'] ?? 0);
        $card = (float)($payment['card'] ?? 0);

        $p['sales_total'] = (float)($p['sales_total'] ?? 0) + $total;
        $p['sales_cash'] = (float)($p['sales_cash'] ?? 0) + $cash;
        $p['sales_transfer'] = (float)($p['sales_transfer'] ?? 0) + $transfer;
        $p['sales_card'] = (float)($p['sales_card'] ?? 0) + $card;

        update_post_meta($sid, '_posinv_shift', $p);
        self::shift_recalc($sid);

        update_post_meta($ticket_id, '_posinv_shift_id', (int)$sid);
        return (int)$sid;
    }

    private static function shift_revert_sale($shift_id, $totals, $payment) {
        $p = get_post_meta($shift_id, '_posinv_shift', true);
        if (!is_array($p)) return;

        $total = (float)($totals['total'] ?? 0);
        $cash = (float)($payment['cash'] ?? 0);
        $transfer = (float)($payment['transfer'] ?? 0);
        $card = (float)($payment['card'] ?? 0);

        $p['sales_total'] = (float)($p['sales_total'] ?? 0) - $total;
        $p['sales_cash'] = (float)($p['sales_cash'] ?? 0) - $cash;
        $p['sales_transfer'] = (float)($p['sales_transfer'] ?? 0) - $transfer;
        $p['sales_card'] = (float)($p['sales_card'] ?? 0) - $card;

        update_post_meta($shift_id, '_posinv_shift', $p);
        self::shift_recalc($shift_id);
    }

    // =========================
    // Caja: Deshacer ticket
    // =========================
    public static function rest_undo_ticket(WP_REST_Request $req) {
        if (!class_exists('WooCommerce')) return new WP_Error('no_wc', 'WooCommerce no está activo', ['status'=>400]);
        $b = $req->get_json_params(); if (!is_array($b)) $b = [];
        $ticket_id = intval($b['ticket_id'] ?? 0);
        if ($ticket_id <= 0) return new WP_Error('bad_ticket', 'Ticket inválido', ['status'=>400]);

        $undone = get_post_meta($ticket_id, '_posinv_undone', true);
        if ($undone) return new WP_Error('already_undone', 'Ya fue deshecho', ['status'=>409]);

        $payload = get_post_meta($ticket_id, '_posinv', true);
        if (!is_array($payload)) return new WP_Error('no_payload', 'Ticket sin datos', ['status'=>400]);

        $type = sanitize_text_field($payload['type'] ?? '');
        $store = sanitize_text_field($payload['store'] ?? '');
        $to_store = sanitize_text_field($payload['to_store'] ?? '');
        $items = $payload['items'] ?? [];
        if (!$items || !is_array($items)) return new WP_Error('no_items', 'Ticket sin productos', ['status'=>400]);

        $settings = self::get_settings();
        $allow_negative = (($settings["allow_negative_stock"] ?? "0") === "1");
        $return_type = 'inventory';
        if ($type === 'return' && isset($payload['return']) && is_array($payload['return'])) {
            $rt = sanitize_text_field($payload['return']['return_type'] ?? 'inventory');
            if (in_array($rt, ['inventory','merma'], true)) $return_type = $rt;
        }



        // Revertir stock
        $applied = [];
        foreach ($items as $it) {
            $pid = intval($it['product_id'] ?? 0);
            $qty = isset($it['qty']) ? (float)$it['qty'] : 0.0;
            if ($pid<=0 || $qty<=0) continue;

            if ($type === 'sale') {
                $res = self::update_stock($pid, $store, +$qty, $allow_negative);
                if (is_wp_error($res)) { self::rollback($applied); return $res; }
                $applied[] = [$pid, $store, -$qty];
            } elseif ($type === 'return') {
                // Si la devolución fue merma, no se movió stock; por lo tanto, tampoco hay nada que revertir.
                if ($return_type !== 'merma') {
                    $res = self::update_stock($pid, $store, -$qty, $allow_negative);
                    if (is_wp_error($res)) { self::rollback($applied); return $res; }
                    $applied[] = [$pid, $store, +$qty];
                }
            } elseif ($type === 'transfer') {
                $res1 = self::update_stock($pid, $store, +$qty, $allow_negative);
                if (is_wp_error($res1)) { self::rollback($applied); return $res1; }
                $applied[] = [$pid, $store, -$qty];

                $res2 = self::update_stock($pid, $to_store, -$qty, $allow_negative);
                if (is_wp_error($res2)) { self::rollback($applied); return $res2; }
                $applied[] = [$pid, $to_store, +$qty];
            }
        }

        // Revertir turno si aplica
        $shift_id = intval(get_post_meta($ticket_id, '_posinv_shift_id', true));
        $totals = $payload['totals'] ?? [];
        $payment = $payload['payment'] ?? [];
        if ($shift_id > 0 && $type === 'sale') {
            self::shift_revert_sale($shift_id, $totals, $payment);
        }

        update_post_meta($ticket_id, '_posinv_undone', 1);
        self::audit_add('ticket_undo', ['ticket_id' => (int)$ticket_id, 'type'=>$type, 'store'=>$store]);

        return rest_ensure_response(['ok'=>true, 'ticket_id'=>$ticket_id]);
    }

}
POS_Inventario_Woo::init();
}


// Auto-generar código de barras (meta) usando el ID del producto.
// Ideal para imprimir etiquetas Code128 con el ID como contenido.
// Respeta el meta configurado en Ajustes (por defecto: _op_barcode).
if (!function_exists('posinv_auto_barcode_from_id')) {
    function posinv_auto_barcode_from_id($post_id, $post, $update) {
        if (wp_is_post_revision($post_id) || (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE)) return;
        if (get_post_type($post_id) !== 'product' && get_post_type($post_id) !== 'product_variation') return;

        // Tomar meta key configurada en el plugin (barcode_meta). Si está vacío, no hacemos nada.
        if (class_exists('POS_Inventario_Woo') && method_exists('POS_Inventario_Woo', 'get_settings')) {
            $s = POS_Inventario_Woo::get_settings();
            $meta_key = isset($s['barcode_meta']) ? trim((string)$s['barcode_meta']) : '';
        } else {
            $meta_key = '_op_barcode';
        }
        if ($meta_key === '') return;

        $current = get_post_meta($post_id, $meta_key, true);
        if ($current !== '' && $current !== null) return;

        update_post_meta($post_id, $meta_key, (string)$post_id);
    }
}
add_action('save_post_product', 'posinv_auto_barcode_from_id', 20, 3);
add_action('save_post_product_variation', 'posinv_auto_barcode_from_id', 20, 3);


add_action('template_redirect', function() {
    if (!isset($_GET['posinv_print'], $_GET['ticket_id'])) return;
    if (!is_user_logged_in()) auth_redirect();

    $ticket_id = intval($_GET['ticket_id']);
    $p = get_post($ticket_id);
    if (!$p || $p->post_type !== 'pos_ticket') wp_die('Ticket no encontrado.');

    if (!current_user_can('pos_view_reports') && intval($p->post_author) !== get_current_user_id()) {
        wp_die('Sin permisos para ver este ticket.');
    }

    $meta = get_post_meta($ticket_id, '_posinv', true);
    if (!is_array($meta)) wp_die('Ticket inválido.');

    $store_name = POS_Inventario_Woo::store_name_for_key($meta['store']);

    $total = 0.0;
    foreach (($meta['items'] ?? []) as $it) {
        $total += (float)$it['qty'] * (float)$it['price'];
    }

    
    // Formatea montos en texto plano (sin <span> de WooCommerce), ideal para tickets térmicos.
    function posinv_money_plain($amount) {
        if (!function_exists('wc_price')) {
            return (string) $amount;
        }
        $html = wc_price($amount);
        $txt = wp_strip_all_tags($html);
        $txt = html_entity_decode($txt, ENT_QUOTES, 'UTF-8');
        // Convierte NBSP y espacios raros a un espacio normal
        $txt = str_replace(["\xC2\xA0", "\u00A0"], ' ', $txt);
        $txt = preg_replace('/\s+/u', ' ', $txt);
        return trim($txt);
    }

    // ====== TEXTO PLANO PARA ENVIAR A APP ANDROID (POSPrinterBridge) ======
    $plain_lines = [];
    $plain_lines[] = $store_name;
    $plain_lines[] = "Ticket #{$ticket_id}";
    $plain_lines[] = get_post_time('Y-m-d H:i', false, $ticket_id);
    $plain_lines[] = "Cajero: " . get_the_author_meta('display_name', $p->post_author);
    $plain_lines[] = str_repeat('-', 32);

    $type_line = "Tipo: " . ($meta['type'] ?? '');
    if (!empty($meta['customer'])) { $type_line .= " | Cliente: " . $meta['customer']; }
    $plain_lines[] = $type_line;
    $plain_lines[] = str_repeat('-', 32);

    foreach (($meta['items'] ?? []) as $it) {
        $qty = (float)($it['qty'] ?? 0);
        $price = (float)($it['price'] ?? 0);
        $line = $qty * $price;
        $name = (string)($it['name'] ?? '');
        if ($name !== '') {
            $plain_lines[] = $name;
            $plain_lines[] = "  Cant: {$qty}   Importe: " . posinv_money_plain($line);
        }
    }

    $plain_lines[] = str_repeat('-', 32);
    $plain_lines[] = "TOTAL: " . posinv_money_plain($total);
    $pay = is_array($meta['payment'] ?? null) ? $meta['payment'] : [];
    $pay_sum = (float)($pay['cash'] ?? 0) + (float)($pay['transfer'] ?? 0) + (float)($pay['card'] ?? 0);
    if (($meta['type'] ?? '') === 'layaway') {
        $lay = is_array($meta['layaway'] ?? null) ? $meta['layaway'] : [];
        $plain_lines[] = "PAGADO: " . posinv_money_plain($pay_sum);
        $plain_lines[] = "RESTA: " . posinv_money_plain((float)($lay['remaining'] ?? max(0, $total - $pay_sum)));
    }
    $plain_lines[] = "FORMA DE PAGO: Efectivo " . posinv_money_plain((float)($pay['cash'] ?? 0)) . " | Transferencia " . posinv_money_plain((float)($pay['transfer'] ?? 0)) . " | Terminal " . posinv_money_plain((float)($pay['card'] ?? 0));
    $plain_lines[] = "";
    $plain_lines[] = "Gracias por su compra";
    $plain_text = implode("\n", array_map('trim', $plain_lines));

    // Enviamos en Base64 para evitar problemas con caracteres/espacios en URL
    $plain_payload_b64 = base64_encode($plain_text);

header('Content-Type: text/html; charset=utf-8');
    ?>
    <!doctype html>
    <html>
    <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>Ticket POS #<?php echo (int)$ticket_id; ?></title>
        <style>
            /* Ticket para impresora térmica (58/80mm) */
            :root{
                --paper-mm: <?php echo (int) (POS_Inventario_Woo::get_settings()['ticket_paper_mm'] ?? 80); ?>;
                --fs: <?php echo (int) (POS_Inventario_Woo::get_settings()['ticket_font_size'] ?? 12); ?>px;
            }
            @page{ size: var(--paper-mm)mm auto; margin: 4mm; }
            html,body{ width: var(--paper-mm)mm; }
            body{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin:0; padding:0; font-size: var(--fs); line-height:1.25;}
            .ticket{padding:0;}
            .center{text-align:center;}
            .muted{opacity:.75; font-size: calc(var(--fs) - 2px);}
            .hr{border-top:1px dashed #000; margin:6px 0;}
            table{width:100%;border-collapse:collapse;}
            th,td{padding:2px 0; vertical-align:top;}
            th{font-weight:700; font-size: calc(var(--fs) - 2px);}
            .right{text-align:right;}
            .total{font-weight:700;}
            .actions{display:flex; gap:8px; padding:10px 0;}
            .btn{border:1px solid #111;background:#111;color:#fff;border-radius:6px;padding:8px 10px;cursor:pointer;}
            .btn2{border:1px solid #aaa;background:#fff;color:#111;border-radius:6px;padding:8px 10px;cursor:pointer;}
            @media print {.actions{display:none;} body{padding:0;} }
        </style>
    </head>
    <body>
        <div class="ticket">
            <div class="center"><strong><?php echo esc_html($store_name); ?></strong></div>
            <div class="center">Ticket #<?php echo (int)$ticket_id; ?></div>
            <div class="center muted"><?php echo esc_html(get_post_time('Y-m-d H:i', false, $ticket_id)); ?></div>
            <div class="center muted">Cajero: <?php echo esc_html(get_the_author_meta('display_name', $p->post_author)); ?></div>
            <div class="hr"></div>
            <div class="muted">Tipo: <?php echo esc_html(($meta['type'] === 'layaway') ? 'apartado' : $meta['type']); ?><?php if (!empty($meta['customer'])) echo ' | Cliente: ' . esc_html($meta['customer']); ?></div>
            <div class="hr"></div>

            <table>
                <thead>
                    <tr><th>Producto</th><th class="right">Cant</th><th class="right">Imp</th></tr>
                </thead>
                <tbody>
                <?php foreach (($meta['items'] ?? []) as $it):
                    $line = (float)$it['qty'] * (float)$it['price'];
                ?>
                    <tr>
                        <td><?php echo esc_html($it['name']); ?><div class="muted">ID: <?php echo (int)$it['product_id']; ?></div></td>
                        <td class="right"><?php echo esc_html($it['qty']); ?></td>
                        <td class="right"><?php echo esc_html(posinv_money_plain($line)); ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
                <tfoot>
                    <tr><td colspan="2" class="right total">TOTAL</td><td class="right total"><?php echo esc_html(posinv_money_plain($total)); ?></td></tr>
                    <?php $pay = is_array($meta['payment'] ?? null) ? $meta['payment'] : []; $pay_sum = (float)($pay['cash'] ?? 0) + (float)($pay['transfer'] ?? 0) + (float)($pay['card'] ?? 0); $lay = is_array($meta['layaway'] ?? null) ? $meta['layaway'] : []; ?>
                    <?php if (($meta['type'] ?? '') === 'layaway'): ?>
                    <tr><td colspan="2" class="right">Pagado</td><td class="right"><?php echo esc_html(posinv_money_plain($pay_sum)); ?></td></tr>
                    <tr><td colspan="2" class="right">Resta</td><td class="right"><?php echo esc_html(posinv_money_plain((float)($lay['remaining'] ?? max(0, $total - $pay_sum)))); ?></td></tr>
                    <?php endif; ?>
                    <tr><td colspan="2" class="right">Efectivo</td><td class="right"><?php echo esc_html(posinv_money_plain((float)($pay['cash'] ?? 0))); ?></td></tr>
                    <tr><td colspan="2" class="right">Transferencia</td><td class="right"><?php echo esc_html(posinv_money_plain((float)($pay['transfer'] ?? 0))); ?></td></tr>
                    <tr><td colspan="2" class="right">Terminal</td><td class="right"><?php echo esc_html(posinv_money_plain((float)($pay['card'] ?? 0))); ?></td></tr>
                </tfoot>
            </table>
            <div class="hr"></div>
            <div class="center muted">Gracias por su compra</div>
            <div class="center muted">— — — — — — — — — —</div>

            <div class="actions">
                <button class="btn" onclick="window.print()">Imprimir</button>
                <button class="btn2" onclick="posinvPrintViaAndroidApp()">Imprimir (App Android)</button>
                <button class="btn2" onclick="window.close()">Cerrar</button>
            </div>

            <script>
                // Lanza la app POSPrinterBridge con un Intent (Chrome/Android).
                // Requiere que la app tenga registrado el esquema: posprinterbridge://
                function posinvPrintViaAndroidApp() {
                    const payloadB64 = "<?php echo esc_js($plain_payload_b64); ?>";
                    const intentUrl =
                        "intent://print?payload=" + encodeURIComponent(payloadB64) +
                        "#Intent;scheme=posprinterbridge;package=com.buzkme.posprinter;end";
                    window.location.href = intentUrl;
                }
            </script>
        </div>
    </body>
    </html>
    <?php
    exit;
});
