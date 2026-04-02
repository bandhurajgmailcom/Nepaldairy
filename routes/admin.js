const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');

function adminOnly(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'Administrator') return res.status(403).render('error', { message: 'Access denied.' });
  next();
}

// Users management
router.get('/users', adminOnly, (req, res) => {
  db.all('SELECT id, username, role, created_at FROM users ORDER BY id', (err, users) => {
    res.render('admin/users', {
      users: users || [],
      user: req.session.user,
      success: req.query.success || '',
      error: req.query.error || ''
    });
  });
});

router.post('/users/add', adminOnly, (req, res) => {
  const { username, password, role } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hash, role], (err) => {
    if (err) return res.redirect('/admin/users?error=Username already exists');
    res.redirect('/admin/users?success=User added');
  });
});

router.post('/users/delete/:id', adminOnly, (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) return res.redirect('/admin/users?error=Cannot delete yourself');
  db.run('DELETE FROM users WHERE id = ?', [req.params.id], () => res.redirect('/admin/users?success=User deleted'));
});

router.post('/users/change-password/:id', adminOnly, (req, res) => {
  const id = parseInt(req.params.id);
  const { new_password } = req.body;
  if (!new_password || new_password.length < 4)
    return res.redirect('/admin/users?error=Password must be at least 4 characters');
  const hash = bcrypt.hashSync(new_password, 10);
  db.run('UPDATE users SET password = ? WHERE id = ?', [hash, id], (err) => {
    if (err) return res.redirect('/admin/users?error=Update failed');
    res.redirect('/admin/users?success=Password updated');
  });
});

// Products management
router.get('/products', adminOnly, (req, res) => {
  db.all('SELECT * FROM products ORDER BY id', (err, products) => {
    res.render('admin/products', { products: products || [], user: req.session.user });
  });
});

router.post('/products/add', adminOnly, (req, res) => {
  const { name, category, unit, price } = req.body;
  db.run('INSERT INTO products (name, category, unit, price) VALUES (?, ?, ?, ?)',
    [name, category, unit, parseFloat(price)], () => res.redirect('/admin/products?success=Product added'));
});

router.post('/products/delete/:id', adminOnly, (req, res) => {
  db.run('DELETE FROM products WHERE id = ?', [req.params.id], () => res.redirect('/admin/products?success=Product deleted'));
});

module.exports = router;
