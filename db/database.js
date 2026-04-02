const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Convert SQLite ? placeholders to PostgreSQL $1, $2, ...
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Add uppercase key aliases so existing code using row.COLUMN_NAME keeps working
function normalizeRow(row) {
  if (!row) return row;
  const result = { ...row };
  for (const k of Object.keys(row)) {
    result[k.toUpperCase()] = row[k];
  }
  return result;
}

function normalizeRows(rows) {
  return rows ? rows.map(normalizeRow) : [];
}

// SQLite-compatible db interface wrapping pg Pool
const db = {
  get(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    pool.query(convertPlaceholders(sql), params, (err, result) => {
      callback(err, result && result.rows.length ? normalizeRow(result.rows[0]) : undefined);
    });
  },

  all(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    pool.query(convertPlaceholders(sql), params, (err, result) => {
      callback(err, result ? normalizeRows(result.rows) : []);
    });
  },

  run(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    const isInsert = /^\s*INSERT/i.test(sql);
    let pgSql = convertPlaceholders(sql);
    if (isInsert) pgSql += ' RETURNING id';
    pool.query(pgSql, params, (err, result) => {
      if (callback) {
        const lastID = isInsert && result && result.rows && result.rows[0] ? result.rows[0].id : null;
        callback.call({ lastID }, err);
      }
    });
  },

  // Simulate SQLite prepared statements as a batch collector
  prepare(sql) {
    const pgSql = convertPlaceholders(sql);
    const batch = [];
    return {
      run(...args) { batch.push(args); },
      finalize(callback) {
        if (!batch.length) return callback && callback();
        Promise.all(batch.map(p => pool.query(pgSql, p)))
          .then(() => callback && callback())
          .catch(err => callback && callback(err));
      }
    };
  }
};

// --- Schema & seed ---

const BS_MONTHS = ['Baishakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin','Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'];
const BS_SEED = {
  2078: [31,31,32,31,31,31,30,30,29,30,29,31],
  2079: [31,32,31,32,31,30,30,30,29,29,30,30],
  2080: [31,32,31,32,31,30,30,30,29,29,30,30],
  2081: [31,31,32,31,31,31,30,29,30,29,30,30],
  2082: [31,32,31,32,31,30,30,30,29,30,30,30],
  2083: [31,31,32,32,31,30,30,30,29,30,30,30],
};

async function initializeDB() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Administrator','Lab','Sales')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT,
      price REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS lab_tests (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id),
      test_date TEXT,
      fat REAL,
      snf REAL,
      moisture REAL,
      result TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id),
      quantity REAL,
      unit TEXT,
      sale_date TEXT,
      customer TEXT,
      total_amount REAL,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS nds_pricelist (
      id SERIAL PRIMARY KEY,
      sn INTEGER,
      product TEXT,
      wholesale REAL,
      mrp REAL,
      category TEXT,
      unit TEXT,
      qty TEXT,
      barcode INTEGER,
      url TEXT,
      subcategory TEXT,
      description TEXT
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS nds_orders (
      id SERIAL PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_address TEXT,
      order_date TEXT NOT NULL,
      bs_date TEXT,
      ready_date TEXT,
      payment_method TEXT DEFAULT 'QR Code',
      payment_status TEXT DEFAULT 'Pending',
      order_status TEXT DEFAULT 'New',
      total_amount REAL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS nds_order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES nds_orders(id),
      order_no TEXT NOT NULL,
      product_id INTEGER,
      product TEXT NOT NULL,
      category TEXT,
      subcategory TEXT,
      unit TEXT,
      qty_pack TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      mrp REAL NOT NULL,
      amount REAL NOT NULL
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS rnepalical (
      id SERIAL PRIMARY KEY,
      bs_year INTEGER NOT NULL,
      bs_month INTEGER NOT NULL,
      month_name TEXT NOT NULL,
      days INTEGER NOT NULL,
      cumstartdays INTEGER,
      cumdays INTEGER,
      UNIQUE(bs_year, bs_month)
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS calendar_notes (
      id SERIAL PRIMARY KEY,
      bs_date TEXT NOT NULL UNIQUE,
      note TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed default users
    const users = [
      ['admin',     bcrypt.hashSync('admin123', 10), 'Administrator'],
      ['labuser',   bcrypt.hashSync('lab123',   10), 'Lab'],
      ['salesuser', bcrypt.hashSync('sales123', 10), 'Sales'],
    ];
    for (const [username, password, role] of users) {
      await client.query(
        `INSERT INTO users (username, password, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING`,
        [username, password, role]
      );
    }

    // Seed sample products
    const products = [
      [1, 'Full Cream Milk', 'Milk',         'Liter', 85],
      [2, 'Butter',          'Fat Products', 'Kg',    650],
      [3, 'Cheese',          'Dairy',        'Kg',    900],
      [4, 'Yogurt',          'Fermented',    'Kg',    180],
      [5, 'Ghee',            'Fat Products', 'Kg',    1200],
    ];
    for (const [id, name, category, unit, price] of products) {
      await client.query(
        `INSERT INTO products (id, name, category, unit, price) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [id, name, category, unit, price]
      );
    }

    // Seed Nepali calendar data if empty
    const { rows } = await client.query('SELECT COUNT(*) as cnt FROM rnepalical');
    if (parseInt(rows[0].cnt) === 0) {
      let cumdays = 0;
      for (const year of Object.keys(BS_SEED).sort()) {
        for (let mi = 0; mi < BS_SEED[year].length; mi++) {
          const days = BS_SEED[year][mi];
          const cumstart = cumdays + 1;
          cumdays += days;
          await client.query(
            `INSERT INTO rnepalical (bs_year, bs_month, month_name, days, cumstartdays, cumdays)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (bs_year, bs_month) DO NOTHING`,
            [parseInt(year), mi + 1, BS_MONTHS[mi], days, cumstart, cumdays]
          );
        }
      }
    }

    console.log('Connected to PostgreSQL and schema ready.');
  } catch (err) {
    console.error('DB init error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

initializeDB().catch(err => {
  console.error('Fatal DB init error:', err.message);
  process.exit(1);
});

module.exports = db;
