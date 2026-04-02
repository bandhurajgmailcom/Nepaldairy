require('dotenv').config({ path: '.env.local' });
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const path = require('path');
const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(session({
  store: new pgSession({
    pool: sessionPool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'nepaldairy-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// Public API for Nepali calendar data (must be before session-gated routes)
app.get('/api/nepalical', (req, res) => {
  db.all('SELECT bs_year, bs_month, days FROM rnepalical ORDER BY bs_year, bs_month', (err, rows) => {
    const data = {};
    (rows || []).forEach(r => {
      if (!data[r.bs_year]) data[r.bs_year] = [];
      data[r.bs_year][r.bs_month - 1] = r.days;
    });
    res.json(data);
  });
});

// Calendar notes API
app.get('/api/calendar-notes', (req, res) => {
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year and month required' });
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  db.all('SELECT bs_date, note FROM calendar_notes WHERE bs_date LIKE ?', [prefix + '%'], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const map = {};
    (rows || []).forEach(r => { map[r.bs_date] = r.note; });
    res.json(map);
  });
});

app.post('/api/calendar-notes', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const { bs_date, note } = req.body;
  if (!bs_date) return res.status(400).json({ error: 'bs_date required' });
  const trimmed = (note || '').slice(0, 25);
  if (!trimmed) {
    db.run('DELETE FROM calendar_notes WHERE bs_date = ?', [bs_date], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ deleted: true });
    });
  } else {
    db.run(
      `INSERT INTO calendar_notes (bs_date, note, created_by, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(bs_date) DO UPDATE SET note = excluded.note, updated_at = CURRENT_TIMESTAMP`,
      [bs_date, trimmed, req.session.user.id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ saved: true, bs_date, note: trimmed });
      }
    );
  }
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/admin/nepalical', require('./routes/nepalical'));
app.use('/admin', require('./routes/admin'));
app.use('/lab', require('./routes/lab'));
app.use('/sales', require('./routes/sales'));
app.use('/pricelist', require('./routes/pricelist'));
app.use('/shop', require('./routes/shop'));
app.use('/orders', require('./routes/orders'));

// Profile — any logged-in user can change their own password
app.get('/profile', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  db.get('SELECT id, username, role, created_at FROM users WHERE id = ?', [req.session.user.id], (err, row) => {
    const user = row || req.session.user;
    res.render('profile', { user, success: req.query.success || '', error: req.query.error || '' });
  });
});

app.post('/profile/change-password', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const { new_password } = req.body;
  if (!new_password || new_password.length < 4)
    return res.redirect('/profile?error=Password must be at least 4 characters');
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(new_password, 10);
  db.run('UPDATE users SET password = ? WHERE id = ?', [hash, req.session.user.id], (err) => {
    if (err) return res.redirect('/profile?error=Update failed');
    res.redirect('/profile?success=Password updated');
  });
});

// Calendar + Date Converter — accessible to all logged-in users
app.get('/calendar', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('calendar', { user: req.session.user });
});

// Dashboard
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.redirect('/dashboard');
});

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const user = req.session.user;

  db.get('SELECT COUNT(*) as count FROM products', (err, products) => {
    db.get('SELECT COUNT(*) as count FROM lab_tests', (err2, labTests) => {
      db.get('SELECT COUNT(*) as count, SUM(total_amount) as total FROM sales', (err3, salesData) => {
        db.get('SELECT COUNT(*) as count FROM users', (err4, users) => {
          db.get("SELECT COUNT(*) as count FROM NDS_ORDERS WHERE ORDER_STATUS != 'Completed' AND ORDER_STATUS != 'Cancelled'", (err5, onlineOrders) => {
            res.render('dashboard', {
              user,
              stats: {
                products: products ? products.count : 0,
                labTests: labTests ? labTests.count : 0,
                salesCount: salesData ? salesData.count : 0,
                salesTotal: salesData ? (salesData.total || 0) : 0,
                users: users ? users.count : 0,
                onlineOrders: onlineOrders ? onlineOrders.count : 0
              }
            });
          });
        });
      });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Nepal Dairy NDS App running at http://localhost:${PORT}`);
});

module.exports = app;
