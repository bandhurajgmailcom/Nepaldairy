const express = require('express');
const router = express.Router();
const db = require('../db/database');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role.toLowerCase() === 'lab') return res.status(403).render('error', { message: 'Access denied.' });
  next();
}

// Normalize any date string to YYYY-MM-DD
function normalizeDate(d) {
  if (!d) return '';
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  // MM/DD/YYYY  or  M/D/YYYY
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + m[1].padStart(2,'0') + '-' + m[2].padStart(2,'0');
  return d;
}

// GET /orders
router.get('/', requireLogin, (req, res) => {
  const { category, subcategory, product, status } = req.query;
  const date_from = normalizeDate(req.query.date_from);
  const date_to   = normalizeDate(req.query.date_to);
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  const SORT_MAP = {
    order_no:    'o.ORDER_NO',
    order_date:  'o.ORDER_DATE',
    ready_by:    'o.READY_DATE',
    category:    'i.CATEGORY',
    subcategory: 'i.SUBCATEGORY',
    product:     'i.PRODUCT',
    pack:        'i.QTY_PACK',
    qty:         'i.QUANTITY',
    mrp:         'i.MRP',
    amount:      'i.AMOUNT',
    customer:    'o.CUSTOMER_NAME',
    contact:     'o.CUSTOMER_PHONE',
    status:      'o.ORDER_STATUS',
  };
  const sortby  = SORT_MAP[req.query.sortby] ? req.query.sortby : 'order_date';
  const sortdir = req.query.sortdir === 'asc' ? 'asc' : 'desc';
  const sortSQL = `${SORT_MAP[sortby]} ${sortdir.toUpperCase()}`;

  const params = [];
  let where = 'WHERE 1=1';
  if (category)   { where += ' AND i.CATEGORY = ?';         params.push(category); }
  if (subcategory){ where += ' AND i.SUBCATEGORY = ?';      params.push(subcategory); }
  if (product)    { where += ' AND i.PRODUCT LIKE ?';       params.push(`%${product}%`); }
  if (date_from)  { where += ' AND o.READY_DATE >= ?';      params.push(date_from); }
  if (date_to)    { where += ' AND o.READY_DATE <= ?';      params.push(date_to); }
  if (status)     { where += ' AND o.ORDER_STATUS = ?';     params.push(status); }

  const base = `FROM NDS_ORDER_ITEMS i JOIN NDS_ORDERS o ON i.ORDER_ID = o.ID ${where}`;

  db.get(`SELECT COUNT(*) as total ${base}`, params, (err, countRow) => {
    const total = countRow ? parseInt(countRow.total) || 0 : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    db.all(
      `SELECT i.ID, i.ORDER_NO, i.PRODUCT, i.CATEGORY, i.SUBCATEGORY, i.UNIT, i.QTY_PACK,
              i.QUANTITY, i.MRP, i.AMOUNT,
              o.CUSTOMER_NAME, o.CUSTOMER_PHONE, o.CUSTOMER_ADDRESS,
              o.ORDER_DATE, o.BS_DATE, o.READY_DATE, o.ORDER_STATUS, o.PAYMENT_STATUS, o.TOTAL_AMOUNT,
              o.ID as ORDER_ID
       ${base}
       ORDER BY ${sortSQL}, o.ID DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
      (err2, rows) => {
        db.all('SELECT DISTINCT CATEGORY FROM NDS_PRICELIST ORDER BY CATEGORY', (e1, cats) => {
          db.all('SELECT DISTINCT SUBCATEGORY FROM NDS_PRICELIST ORDER BY SUBCATEGORY', (e2, subcats) => {
            db.get(`SELECT COUNT(DISTINCT o.ID) as "orderCount", COALESCE(SUM(i.AMOUNT),0) as "totalAmount" ${base}`, params, (e3, stats) => {
              // Pivot: orders grouped by READY_DATE × STATUS
              db.all(
                `SELECT COALESCE(o.READY_DATE,'(No date)') as READY_DATE,
                        o.ORDER_STATUS as STATUS,
                        COUNT(DISTINCT o.ID) as "orderCount",
                        COALESCE(SUM(i.AMOUNT),0) as "totalAmount"
                 ${base}
                 GROUP BY COALESCE(o.READY_DATE,'(No date)'), o.ORDER_STATUS
                 ORDER BY COALESCE(o.READY_DATE,'(No date)') ASC, o.ORDER_STATUS`,
                params,
                (e4, pivotRows) => {
                  // Build pivot structure: { date: { status: {orderCount, totalAmount} } }
                  const STATUSES = ['New','Processing','Completed','Cancelled'];
                  const pivotDates = [];
                  const pivotMap = {};
                  (pivotRows || []).forEach(r => {
                    if (!pivotMap[r.READY_DATE]) {
                      pivotMap[r.READY_DATE] = {};
                      pivotDates.push(r.READY_DATE);
                    }
                    pivotMap[r.READY_DATE][r.STATUS] = { orderCount: parseInt(r.orderCount) || 0, totalAmount: parseFloat(r.totalAmount) || 0 };
                  });
                  res.render('orders/index', {
                    user: req.session.user,
                    rows: rows || [],
                    categories: cats || [],
                    subcategories: subcats || [],
                    filters: {
                      category: category || '',
                      subcategory: subcategory || '',
                      product: product || '',
                      date_from: date_from || '',
                      date_to: date_to || '',
                      status: status || ''
                    },
                    total, totalPages, page,
                    stats: stats ? { orderCount: parseInt(stats.orderCount) || 0, totalAmount: parseFloat(stats.totalAmount) || 0 } : { orderCount: 0, totalAmount: 0 },
                    pivotDates, pivotMap, STATUSES,
                    sortby, sortdir
                  });
                }
              );
            });
          });
        });
      }
    );
  });
});

// POST /orders/:id/status
router.post('/:id/status', requireLogin, (req, res) => {
  const { status } = req.body;
  db.run('UPDATE NDS_ORDERS SET ORDER_STATUS = ? WHERE ID = ?', [status, req.params.id], () => {
    const ref = req.headers.referer || '/orders';
    res.redirect(ref);
  });
});

module.exports = router;
