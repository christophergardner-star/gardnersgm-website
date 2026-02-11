// ============================================================
// ADMIN-SHOP.JS — Product management + Order tracking
// ============================================================

const SHOP_API = 'https://script.google.com/macros/s/AKfycbxMOG1s0F2rUG3EBdaJ1R1x1ofkHjyYqxoBaKTZKVnpvr2g_o2NYSySXU6d8EKkdb0ayg/exec';

let allProducts = [];
let allOrders = [];

// ── Init when Shop tab is activated ──
document.addEventListener('DOMContentLoaded', () => {
    // Add Product button
    document.getElementById('btnAddProduct')?.addEventListener('click', showNewProductForm);

    // Observe tab changes — load data when Shop tab shown
    const observer = new MutationObserver(() => {
        const panel = document.getElementById('panelShop');
        if (panel && panel.classList.contains('active')) {
            loadShopData();
        }
    });

    const tabPanels = document.querySelectorAll('.adm-tab-panel');
    tabPanels.forEach(p => observer.observe(p, { attributes: true, attributeFilter: ['class'] }));

    // Also check on initial load
    setTimeout(() => {
        const panel = document.getElementById('panelShop');
        if (panel && panel.classList.contains('active')) loadShopData();
    }, 500);
});


// ── Load Products + Orders ──
async function loadShopData() {
    await Promise.all([loadProducts(), loadOrders()]);
}

async function loadProducts() {
    const tbody = document.getElementById('productsBody');
    try {
        const resp = await fetch(SHOP_API + '?action=get_products&showAll=true');
        const data = await resp.json();
        allProducts = data.products || [];
        renderProductsTable();
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:#C62828;">Failed to load products</td></tr>';
    }
}

async function loadOrders() {
    const tbody = document.getElementById('ordersBody');
    try {
        const resp = await fetch(SHOP_API + '?action=get_orders');
        const data = await resp.json();
        allOrders = (data.orders || []).reverse(); // newest first
        renderOrdersTable();
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#C62828;">Failed to load orders</td></tr>';
    }
}


// ── Render Products Table ──
function renderProductsTable() {
    const tbody = document.getElementById('productsBody');

    if (allProducts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:30px;text-align:center;color:#999;"><i class="fas fa-box-open" style="font-size:2rem;display:block;margin-bottom:10px;"></i>No products yet. Click "Add Product" to get started!</td></tr>';
        return;
    }

    tbody.innerHTML = allProducts.map(p => {
        const price = (p.price / 100).toFixed(2);
        const statusBadge = {
            'active': '<span style="background:#E8F5E9;color:#2E7D32;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">Active</span>',
            'draft': '<span style="background:#FFF3E0;color:#E65100;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">Draft</span>',
            'sold-out': '<span style="background:#FFEBEE;color:#C62828;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">Sold Out</span>'
        }[p.status] || '<span style="background:#eee;padding:3px 10px;border-radius:12px;font-size:12px;">' + p.status + '</span>';

        const stockColor = p.stock <= 0 ? '#C62828' : p.stock <= 5 ? '#E65100' : '#333';
        const catLabel = (p.category || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        return `<tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:10px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    ${p.imageUrl ? '<img src="' + esc(p.imageUrl) + '" style="width:40px;height:40px;border-radius:6px;object-fit:cover;" onerror="this.style.display=\'none\'">' : '<div style="width:40px;height:40px;border-radius:6px;background:#E8F5E9;display:flex;align-items:center;justify-content:center;"><i class="fas fa-seedling" style="color:#2E7D32;font-size:14px;"></i></div>'}
                    <strong>${esc(p.name)}</strong>
                </div>
            </td>
            <td style="padding:10px;color:#666;">${esc(catLabel)}</td>
            <td style="padding:10px;text-align:right;font-weight:600;color:#2E7D32;">£${price}</td>
            <td style="padding:10px;text-align:center;color:${stockColor};font-weight:600;">${p.stock}</td>
            <td style="padding:10px;text-align:center;">${statusBadge}</td>
            <td style="padding:10px;text-align:center;">
                <button onclick="editProduct('${p.id}')" style="background:none;border:none;color:#1976D2;cursor:pointer;font-size:14px;padding:4px 8px;" title="Edit"><i class="fas fa-edit"></i></button>
                <button onclick="deleteProduct('${p.id}','${esc(p.name)}')" style="background:none;border:none;color:#C62828;cursor:pointer;font-size:14px;padding:4px 8px;" title="Delete"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
}


// ── Render Orders Table ──
function renderOrdersTable() {
    const tbody = document.getElementById('ordersBody');

    if (allOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="padding:30px;text-align:center;color:#999;">No orders yet</td></tr>';
        return;
    }

    tbody.innerHTML = allOrders.map(o => {
        let items = '';
        try {
            const parsed = JSON.parse(o.items);
            items = parsed.map(i => i.name + ' ×' + i.qty).join(', ');
        } catch(e) { items = o.items; }

        const date = o.date ? new Date(o.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

        const statusColors = {
            'processing': { bg: '#FFF3E0', color: '#E65100' },
            'shipped': { bg: '#E3F2FD', color: '#1565C0' },
            'ready': { bg: '#E8F5E9', color: '#2E7D32' },
            'delivered': { bg: '#E8F5E9', color: '#1B5E20' },
            'cancelled': { bg: '#FFEBEE', color: '#C62828' }
        };
        const sc = statusColors[o.orderStatus.toLowerCase()] || { bg: '#eee', color: '#333' };

        return `<tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:10px;font-weight:600;font-size:13px;">${esc(o.orderId)}</td>
            <td style="padding:10px;color:#666;font-size:13px;">${date}</td>
            <td style="padding:10px;">
                <div><strong style="font-size:13px;">${esc(o.name)}</strong></div>
                <div style="color:#999;font-size:12px;">${esc(o.email)}</div>
            </td>
            <td style="padding:10px;font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(items)}">${esc(items)}</td>
            <td style="padding:10px;text-align:right;font-weight:600;">£${o.total}</td>
            <td style="padding:10px;text-align:center;"><span style="background:${sc.bg};color:${sc.color};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">${esc(o.orderStatus)}</span></td>
            <td style="padding:10px;text-align:center;">
                <select onchange="updateOrderStatus('${esc(o.orderId)}', this.value)" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;cursor:pointer;">
                    <option value="">Update...</option>
                    <option value="Processing">Processing</option>
                    <option value="Ready">Ready for Collection</option>
                    <option value="Shipped">Shipped</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Cancelled">Cancelled</option>
                </select>
            </td>
        </tr>`;
    }).join('');
}


// ── Product Form ──
function showNewProductForm() {
    document.getElementById('productFormTitle').innerHTML = '<i class="fas fa-box"></i> New Product';
    document.getElementById('productId').value = '';
    document.getElementById('productName').value = '';
    document.getElementById('productDesc').value = '';
    document.getElementById('productPrice').value = '';
    document.getElementById('productStock').value = '';
    document.getElementById('productCategory').value = 'lawn-care';
    document.getElementById('productImage').value = '';
    document.getElementById('productStatus').value = 'active';
    document.getElementById('productForm').style.display = 'block';
    document.getElementById('productName').focus();
}

function editProduct(id) {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;

    document.getElementById('productFormTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Product';
    document.getElementById('productId').value = p.id;
    document.getElementById('productName').value = p.name;
    document.getElementById('productDesc').value = p.description;
    document.getElementById('productPrice').value = (p.price / 100).toFixed(2);
    document.getElementById('productStock').value = p.stock;
    document.getElementById('productCategory').value = p.category;
    document.getElementById('productImage').value = p.imageUrl;
    document.getElementById('productStatus').value = p.status;
    document.getElementById('productForm').style.display = 'block';
    document.getElementById('productName').focus();
}

function hideProductForm() {
    document.getElementById('productForm').style.display = 'none';
}

async function saveProduct() {
    const name = document.getElementById('productName').value.trim();
    const price = parseFloat(document.getElementById('productPrice').value);
    const stock = parseInt(document.getElementById('productStock').value);

    if (!name) { alert('Product name is required'); return; }
    if (isNaN(price) || price <= 0) { alert('Valid price is required'); return; }
    if (isNaN(stock) || stock < 0) { alert('Valid stock quantity is required'); return; }

    const btn = document.getElementById('btnSaveProduct');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
        const payload = {
            action: 'save_product',
            id: document.getElementById('productId').value || '',
            name: name,
            description: document.getElementById('productDesc').value.trim(),
            price: Math.round(price * 100), // Store in pence
            category: document.getElementById('productCategory').value,
            stock: stock,
            imageUrl: document.getElementById('productImage').value.trim(),
            status: document.getElementById('productStatus').value
        };

        const resp = await fetch(SHOP_API, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });
        const result = await resp.json();

        if (result.status === 'success') {
            hideProductForm();
            await loadProducts();
        } else {
            alert('Error: ' + (result.message || 'Failed to save'));
        }
    } catch (e) {
        alert('Error saving product: ' + e.message);
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save Product';
}

async function deleteProduct(id, name) {
    if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;

    try {
        const resp = await fetch(SHOP_API, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'delete_product', id: id })
        });
        const result = await resp.json();
        if (result.status === 'success') {
            await loadProducts();
        } else {
            alert('Error: ' + (result.message || 'Failed to delete'));
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}


// ── Update Order Status ──
async function updateOrderStatus(orderId, newStatus) {
    if (!newStatus) return;
    if (!confirm('Update order ' + orderId + ' to "' + newStatus + '"?\n\nThis will also email the customer.')) return;

    try {
        const resp = await fetch(SHOP_API, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'update_order_status',
                orderId: orderId,
                orderStatus: newStatus
            })
        });
        const result = await resp.json();
        if (result.status === 'success') {
            await loadOrders();
        } else {
            alert('Error: ' + (result.message || 'Failed to update'));
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}


// ── HTML Escape ──
function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
