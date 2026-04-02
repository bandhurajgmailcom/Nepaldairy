const express = require('express');
const router = express.Router();
const db = require('../db/database');

function labAccess(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (!['Administrator', 'Lab'].includes(req.session.user.role)) return res.status(403).render('error', { message: 'Access denied.' });
  next();
}

router.get('/', labAccess, (req, res) => {
  db.all(`SELECT lt.*, p.name as product_name FROM lab_tests lt
    LEFT JOIN products p ON lt.product_id = p.id
    ORDER BY lt.created_at DESC LIMIT 50`, (err, tests) => {
    db.all('SELECT * FROM products ORDER BY name', (err2, products) => {
      res.render('lab/index', { tests: tests || [], products: products || [], user: req.session.user });
    });
  });
});

router.post('/add', labAccess, (req, res) => {
  const { product_id, test_date, fat, snf, moisture, result, notes } = req.body;
  db.run(`INSERT INTO lab_tests (product_id, test_date, fat, snf, moisture, result, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [product_id, test_date, fat, snf, moisture, result, notes, req.session.user.id],
    () => res.redirect('/lab?success=Test recorded'));
});

router.post('/delete/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'Administrator') return res.status(403).send('Forbidden');
  db.run('DELETE FROM lab_tests WHERE id = ?', [req.params.id], () => res.redirect('/lab?success=Deleted'));
});

module.exports = router;
