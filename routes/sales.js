const express = require('express');
const router = express.Router();
const db = require('../db/database');

function salesAccess(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (!['Administrator', 'Sales'].includes(req.session.user.role)) return res.status(403).render('error', { message: 'Access denied.' });
  next();
}

router.get('/', salesAccess, (req, res) => {
  db.all(`SELECT s.*, p.name as product_name FROM sales s
    LEFT JOIN products p ON s.product_id = p.id
    ORDER BY s.created_at DESC LIMIT 50`, (err, sales) => {
    db.all('SELECT * FROM products ORDER BY name', (err2, products) => {
      // Totals
      db.get('SELECT SUM(total_amount) as total FROM sales', (err3, totals) => {
        res.render('sales/index', {
          sales: sales || [],
          products: products || [],
          user: req.session.user,
          grandTotal: totals ? (totals.total || 0) : 0
        });
      });
    });
  });
});

router.post('/add', salesAccess, (req, res) => {
  const { product_id, quantity, unit, sale_date, customer, total_amount } = req.body;
  db.run(`INSERT INTO sales (product_id, quantity, unit, sale_date, customer, total_amount, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [product_id, quantity, unit, sale_date, customer, total_amount, req.session.user.id],
    () => res.redirect('/sales?success=Sale recorded'));
});

router.post('/delete/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'Administrator') return res.status(403).send('Forbidden');
  db.run('DELETE FROM sales WHERE id = ?', [req.params.id], () => res.redirect('/sales?success=Deleted'));
});

module.exports = router;
