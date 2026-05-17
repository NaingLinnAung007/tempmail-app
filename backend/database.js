const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database file location
const dbPath = path.join(__dirname, 'tempmail.db');
const db = new sqlite3.Database(dbPath);

// Create tables
db.serialize(() => {
  // Emails table
  db.run(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id TEXT UNIQUE,
      recipient TEXT,
      sender TEXT,
      subject TEXT,
      body TEXT,
      html TEXT,
      is_read BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Domains table (for multiple domains support)
  db.run(`
    CREATE TABLE IF NOT EXISTS domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_name TEXT UNIQUE,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Helper functions
const dbHelpers = {
  // Save email to database
  saveEmail: (emailData) => {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO emails 
        (email_id, recipient, sender, subject, body, html, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        emailData.email_id,
        emailData.recipient,
        emailData.sender,
        emailData.subject,
        emailData.body,
        emailData.html,
        emailData.created_at || new Date().toISOString(),
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
      stmt.finalize();
    });
  },

  // Get emails by recipient
  getEmailsByRecipient: (recipient, limit = 50) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM emails WHERE recipient = ? 
         ORDER BY created_at DESC LIMIT ?`,
        [recipient, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  },

  // Get single email by ID
  getEmailById: (id) => {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM emails WHERE id = ?`,
        [id],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  },

  // Mark email as read
  markAsRead: (id) => {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE emails SET is_read = 1 WHERE id = ?`,
        [id],
        (err) => {
          if (err) reject(err);
          else resolve(true);
        }
      );
    });
  },

  // Delete old emails (older than X hours)
  deleteOldEmails: (hours = 2) => {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM emails WHERE created_at < datetime('now', '-' || ? || ' hours')`,
        [hours],
        (err) => {
          if (err) reject(err);
          else resolve(true);
        }
      );
    });
  },

  // Add domain
  addDomain: (domainName) => {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO domains (domain_name) VALUES (?)
      `);
      stmt.run(domainName, function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
      stmt.finalize();
    });
  },

  // Get active domains
  getActiveDomains: () => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT domain_name FROM domains WHERE is_active = 1`,
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows.map(r => r.domain_name));
        }
      );
    });
  }
};

module.exports = { db, dbHelpers };