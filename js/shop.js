// ============================================================
// SHOP.JS — Product display, cart, Stripe checkout
// ============================================================

const SHOP_WEBHOOK = 'https://script.google.com/macros/s/AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec';

let products = [];
let cart = JSON.parse(localStorage.getItem('ggm_cart') || '[]');

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
    // --- Payment gateway removed (migrating to GoCardless Direct Debit) ---
    // Hide card element and wallet containers
    const cardEl = document.getElementById('card-element-shop');
    if (cardEl) cardEl.style.display = 'none';
    const walletBtn = document.getElementById('walletButtonContainer');
    if (walletBtn) walletBtn.style.display = 'none';

    // Load products
    await loadProducts();

    // Setup filters
    document.querySelectorAll('#shopFilters button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#shopFilters button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderProducts(btn.dataset.filter);
        });
    });

    // Update cart UI
    updateCartUI();

    // Override pay button to show coming-soon message
    const payBtn = document.getElementById('btnPay');
    if (payBtn) {
        payBtn.addEventListener('click', (e) => {
            e.preventDefault();
            processPayment();
        });
    }
});


// ── Load Products from Google Sheets ──
async function loadProducts() {
    const loading = document.getElementById('shopLoading');
    const empty = document.getElementById('shopEmpty');
    const grid = document.getElementById('shopGrid');

    try {
        const resp = await fetch(SHOP_WEBHOOK + '?action=get_products');
        const data = await resp.json();

        loading.style.display = 'none';

        if (data.status === 'success' && data.products && data.products.length > 0) {
            products = data.products;
            renderProducts('all');
        } else {
            empty.style.display = 'block';
        }
    } catch (e) {
        console.error('Failed to load products:', e);
        loading.style.display = 'none';
        empty.style.display = 'block';
    }
}


// ── Render Product Grid ──
function renderProducts(filter) {
    const grid = document.getElementById('shopGrid');
    const filtered = filter === 'all'
        ? products
        : products.filter(p => p.category.toLowerCase() === filter);

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="shop-empty"><i class="fas fa-search"></i><h3>No products in this category yet</h3></div>';
        return;
    }

    grid.innerHTML = filtered.map(p => {
        const pricePounds = (p.price / 100).toFixed(2);
        const stockClass = p.stock <= 0 ? 'out' : p.stock <= 5 ? 'low' : '';
        const stockText = p.stock <= 0 ? 'Out of stock' : p.stock <= 5 ? `Only ${p.stock} left` : `${p.stock} in stock`;
        const disabled = p.stock <= 0 ? 'disabled' : '';

        const imgBlock = p.imageUrl
            ? `<img class="product-img" src="${p.imageUrl}" alt="${esc(p.name)}" loading="lazy" onerror="this.outerHTML='<div class=\\'product-img-placeholder\\'><i class=\\'fas fa-seedling\\'></i></div>'">`
            : `<div class="product-img-placeholder"><i class="fas fa-seedling"></i></div>`;

        const catLabel = p.category.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        return `
            <div class="product-card" data-category="${esc(p.category)}">
                ${imgBlock}
                <div class="product-body">
                    <span class="product-cat">${esc(catLabel)}</span>
                    <h3>${esc(p.name)}</h3>
                    <p class="product-desc">${esc(p.description)}</p>
                    <div class="product-footer">
                        <div>
                            <div class="product-price">£${pricePounds}</div>
                            <div class="product-stock ${stockClass}">${stockText}</div>
                        </div>
                        <button class="btn-add-cart" ${disabled} onclick="addToCart('${esc(p.id)}')">
                            <i class="fas fa-cart-plus"></i> Add
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}


// ── Cart Functions ──
function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock <= 0) return;

    const existing = cart.find(c => c.id === productId);
    if (existing) {
        if (existing.qty < product.stock) {
            existing.qty++;
        } else {
            showToast('Maximum stock reached for ' + product.name);
            return;
        }
    } else {
        cart.push({ id: productId, qty: 1 });
    }

    saveCart();
    updateCartUI();
    showToast(product.name + ' added to cart!');

    // Briefly animate the FAB
    const fab = document.getElementById('cartFab');
    fab.style.transform = 'scale(1.2)';
    setTimeout(() => fab.style.transform = '', 300);
}

function removeFromCart(productId) {
    cart = cart.filter(c => c.id !== productId);
    saveCart();
    updateCartUI();
}

function updateQty(productId, delta) {
    const item = cart.find(c => c.id === productId);
    if (!item) return;

    const product = products.find(p => p.id === productId);
    item.qty += delta;

    if (item.qty <= 0) {
        removeFromCart(productId);
        return;
    }
    if (product && item.qty > product.stock) {
        item.qty = product.stock;
    }

    saveCart();
    updateCartUI();
}

function saveCart() {
    localStorage.setItem('ggm_cart', JSON.stringify(cart));
}

function getCartTotal() {
    let subtotal = 0;
    for (const item of cart) {
        const product = products.find(p => p.id === item.id);
        if (product) subtotal += product.price * item.qty;
    }
    const delivery = subtotal >= 4000 ? 0 : 395;
    return { subtotal, delivery, total: subtotal + delivery };
}

function updateCartUI() {
    const fab = document.getElementById('cartFab');
    const countEl = document.getElementById('cartCount');
    const itemsEl = document.getElementById('cartItems');
    const emptyEl = document.getElementById('cartEmpty');
    const footerEl = document.getElementById('cartFooter');
    const totalEl = document.getElementById('cartTotal');
    const deliveryNote = document.getElementById('deliveryNote');
    const payAmount = document.getElementById('payAmount');

    const totalItems = cart.reduce((sum, c) => sum + c.qty, 0);
    countEl.textContent = totalItems;
    fab.style.display = totalItems > 0 || products.length > 0 ? 'block' : 'none';

    if (cart.length === 0) {
        emptyEl.style.display = 'block';
        footerEl.style.display = 'none';
        itemsEl.innerHTML = emptyEl.outerHTML;
        return;
    }

    emptyEl.style.display = 'none';
    footerEl.style.display = 'block';

    const { subtotal, delivery, total } = getCartTotal();

    // Render cart items
    let html = '';
    for (const item of cart) {
        const product = products.find(p => p.id === item.id);
        if (!product) continue;

        const imgBlock = product.imageUrl
            ? `<img class="cart-item-img" src="${product.imageUrl}" alt="${esc(product.name)}">`
            : `<div class="cart-item-img" style="display:flex;align-items:center;justify-content:center;background:#E8F5E9;"><i class="fas fa-seedling" style="color:#2E7D32;"></i></div>`;

        html += `
            <div class="cart-item">
                ${imgBlock}
                <div class="cart-item-info">
                    <h4>${esc(product.name)}</h4>
                    <div class="cart-item-price">£${(product.price / 100).toFixed(2)}</div>
                    <div class="cart-item-qty">
                        <button onclick="updateQty('${product.id}', -1)">−</button>
                        <span>${item.qty}</span>
                        <button onclick="updateQty('${product.id}', 1)">+</button>
                    </div>
                </div>
                <button class="cart-item-remove" onclick="removeFromCart('${product.id}')"><i class="fas fa-trash"></i></button>
            </div>
        `;
    }
    itemsEl.innerHTML = html;

    // Update totals
    totalEl.textContent = '£' + (total / 100).toFixed(2);
    payAmount.textContent = '£' + (total / 100).toFixed(2);

    if (delivery === 0) {
        deliveryNote.innerHTML = '🎉 <span class="free">FREE delivery!</span>';
    } else {
        const remaining = ((4000 - subtotal) / 100).toFixed(2);
        deliveryNote.innerHTML = `🚚 £3.95 delivery • Spend £${remaining} more for <span class="free">FREE delivery</span>`;
    }
}


// ── Cart Drawer Toggle ──
function toggleCart() {
    const drawer = document.getElementById('cartDrawer');
    const overlay = document.getElementById('cartOverlay');
    const isOpen = drawer.classList.contains('open');

    drawer.classList.toggle('open');
    overlay.classList.toggle('open');

    // Reset to cart view when opening
    if (!isOpen) {
        hideCheckout();
    }
}


// ── Checkout Flow ──
function showCheckout() {
    document.getElementById('cartItems').style.display = 'none';
    document.getElementById('cartFooter').style.display = 'none';
    document.getElementById('checkoutForm').style.display = 'block';
    document.getElementById('shopError').style.display = 'none';
}

function hideCheckout() {
    document.getElementById('cartItems').style.display = 'block';
    document.getElementById('cartFooter').style.display = cart.length > 0 ? 'block' : 'none';
    document.getElementById('checkoutForm').style.display = 'none';
}


// ── Process Payment ──
async function processPayment() {
    const errorEl = document.getElementById('shopError');
    errorEl.style.display = 'none';

    // Shop payments not yet available — show coming-soon message
    errorEl.innerHTML = '<i class="fas fa-info-circle"></i> Shop payments coming soon — please <a href="contact.html" style="color:#2E7D32;font-weight:600;">contact us</a> or call <a href="tel:01726432051" style="color:#2E7D32;font-weight:600;">01726 432051</a> to order.';
    errorEl.style.display = 'block';
    errorEl.style.background = '#FFF8E1';
    errorEl.style.color = '#5D4037';
    errorEl.style.border = '1px solid #FFE082';
}


// ── Toast notification ──
function showToast(msg) {
    const existing = document.querySelector('.shop-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'shop-toast';
    toast.style.cssText = 'position:fixed;bottom:90px;right:24px;background:#333;color:#fff;padding:12px 20px;border-radius:8px;font-size:0.9rem;z-index:300;animation:fadeInUp 0.3s ease;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}


// ── Escape HTML ──
function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
