const express = require('express');
const router = express.Router();
const db = require('../db/database');

// AD epoch: BS 2078 Baishakh 1 = AD 2021-04-14 = cumday 1
const AD_EPOCH = new Date('2021-04-14T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function adToBs(dateStr, callback) {
  const date = new Date(dateStr + 'T00:00:00Z');
  const cumday = Math.round((date - AD_EPOCH) / MS_PER_DAY) + 1;
  db.get(
    'SELECT bs_year, bs_month, month_name, cumstartdays FROM rnepalical WHERE cumstartdays <= ? AND cumdays >= ?',
    [cumday, cumday],
    (err, row) => {
      if (err || !row) return callback(null);
      const bs_day = cumday - row.cumstartdays + 1;
      callback(`${bs_day} ${row.month_name} ${row.bs_year} BS`);
    }
  );
}

function generateOrderNo() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `NDS-${d}-${rand}`;
}

// GET /shop - Home: category cards
router.get('/', (req, res) => {
  db.all(
    `SELECT CATEGORY, COUNT(*) as cnt FROM NDS_PRICELIST WHERE CATEGORY IS NOT NULL GROUP BY CATEGORY ORDER BY CATEGORY`,
    (err, cats) => {
      const cartCount = (req.session.cart || []).length;
      res.render('shop/home', { categories: cats || [], cartCount });
    }
  );
});

// GET /shop/products?category=X&subcategory=Y
router.get('/products', (req, res) => {
  const category = req.query.category || '';
  const subcategory = req.query.subcategory || '';

  const params = [];
  let where = 'WHERE 1=1';
  if (category) { where += ' AND CATEGORY = ?'; params.push(category); }
  if (subcategory) { where += ' AND SUBCATEGORY = ?'; params.push(subcategory); }

  db.all(`SELECT * FROM NDS_PRICELIST ${where} ORDER BY SUBCATEGORY, SN`, params, (err, products) => {
    db.all(
      'SELECT DISTINCT SUBCATEGORY FROM NDS_PRICELIST WHERE CATEGORY = ? AND SUBCATEGORY IS NOT NULL ORDER BY SUBCATEGORY',
      [category],
      (err2, subcats) => {
        const cartCount = (req.session.cart || []).length;
        res.render('shop/products', {
          products: products || [],
          subcategories: subcats || [],
          category,
          subcategory,
          cartCount
        });
      }
    );
  });
});

// POST /shop/cart/add  (AJAX)
router.post('/cart/add', (req, res) => {
  const productId = parseInt(req.body.productId);
  const qty = Math.max(1, parseInt(req.body.quantity) || 1);

  db.get('SELECT * FROM NDS_PRICELIST WHERE ID = ?', [productId], (err, p) => {
    if (err || !p) return res.json({ success: false, message: 'Product not found' });

    if (!req.session.cart) req.session.cart = [];
    const idx = req.session.cart.findIndex(i => i.productId === p.ID);

    if (idx >= 0) {
      req.session.cart[idx].quantity += qty;
      req.session.cart[idx].amount = req.session.cart[idx].quantity * p.MRP;
    } else {
      req.session.cart.push({
        productId: p.ID,
        product: p.PRODUCT,
        category: p.CATEGORY,
        subcategory: p.SUBCATEGORY,
        unit: p.UNIT,
        qtyPack: p.QTY,
        mrp: p.MRP,
        quantity: qty,
        amount: qty * p.MRP,
        url: p.URL
      });
    }

    res.json({ success: true, cartCount: req.session.cart.length });
  });
});

// POST /shop/cart/update
router.post('/cart/update', (req, res) => {
  const productId = parseInt(req.body.productId);
  const qty = parseInt(req.body.quantity);
  if (!req.session.cart) req.session.cart = [];

  const idx = req.session.cart.findIndex(i => i.productId === productId);
  if (idx >= 0) {
    if (qty <= 0) {
      req.session.cart.splice(idx, 1);
    } else {
      req.session.cart[idx].quantity = qty;
      req.session.cart[idx].amount = qty * req.session.cart[idx].mrp;
    }
  }
  res.redirect('/shop/cart');
});

// POST /shop/cart/remove
router.post('/cart/remove', (req, res) => {
  const productId = parseInt(req.body.productId);
  if (req.session.cart) {
    req.session.cart = req.session.cart.filter(i => i.productId !== productId);
  }
  res.redirect('/shop/cart');
});

// GET /shop/cart
router.get('/cart', (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((sum, i) => sum + i.amount, 0);
  const cartCount = cart.length;
  res.render('shop/cart', { cart, total, cartCount });
});

// GET /shop/checkout
router.get('/checkout', (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) return res.redirect('/shop');
  const total = cart.reduce((sum, i) => sum + i.amount, 0);
  const cartCount = cart.length;
  res.render('shop/checkout', { cart, total, cartCount, error: req.query.error || '' });
});

// POST /shop/place-order
router.post('/place-order', (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) return res.redirect('/shop');

  const { customer_name, customer_phone, customer_address, ready_date, notes } = req.body;
  if (!customer_name || !customer_phone) {
    return res.redirect('/shop/checkout?error=Name and phone number are required');
  }
  if (!ready_date) {
    return res.redirect('/shop/checkout?error=Please select a ready date for your order');
  }

  const orderNo = generateOrderNo();
  const orderDate = new Date().toISOString().slice(0, 10);
  const total = cart.reduce((sum, i) => sum + i.amount, 0);

  adToBs(orderDate, (bsDate) => {
    db.run(
      `INSERT INTO NDS_ORDERS (ORDER_NO, CUSTOMER_NAME, CUSTOMER_PHONE, CUSTOMER_ADDRESS, ORDER_DATE, BS_DATE, READY_DATE, TOTAL_AMOUNT, NOTES)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderNo, customer_name.trim(), customer_phone.trim(), customer_address || null, orderDate, bsDate || null, ready_date, total, notes || null],
      function(err) {
        if (err) return res.redirect('/shop/checkout?error=Failed to place order. Please try again.');

        const orderId = this.lastID;
        const stmt = db.prepare(
          `INSERT INTO NDS_ORDER_ITEMS (ORDER_ID, ORDER_NO, PRODUCT_ID, PRODUCT, CATEGORY, SUBCATEGORY, UNIT, QTY_PACK, QUANTITY, MRP, AMOUNT)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        cart.forEach(item => {
          stmt.run(orderId, orderNo, item.productId, item.product, item.category,
            item.subcategory, item.unit, item.qtyPack, item.quantity, item.mrp, item.amount);
        });
        stmt.finalize(() => {
          req.session.cart = [];
          res.redirect(`/shop/order/${orderNo}`);
        });
      }
    );
  });
});

// GET /shop/order/:orderNo - Confirmation page
router.get('/order/:orderNo', (req, res) => {
  db.get('SELECT * FROM NDS_ORDERS WHERE ORDER_NO = ?', [req.params.orderNo], (err, order) => {
    if (!order) return res.redirect('/shop');
    db.all('SELECT * FROM NDS_ORDER_ITEMS WHERE ORDER_ID = ?', [order.ID], (err2, items) => {
      res.render('shop/confirm', { order, items: items || [], cartCount: 0 });
    });
  });
});

module.exports = router;
