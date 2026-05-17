const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database setup
const dbPath = path.join(__dirname, 'tempmail.db');
const db = new sqlite3.Database(dbPath);

// Create tables (Promise wrappers for sqlite3)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id TEXT UNIQUE,
    recipient TEXT,
    sender TEXT,
    subject TEXT,
    body TEXT,
    html TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_name TEXT UNIQUE,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Helper functions with Promise
const dbHelpers = {
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

  getEmailById: (id) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM emails WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  markAsRead: (id) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE emails SET is_read = 1 WHERE id = ?`, [id], (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  },

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

  clearInbox: (recipient) => {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM emails WHERE recipient = ?`, [recipient], (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  },

  getActiveDomains: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT domain_name FROM domains WHERE is_active = 1`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(r => r.domain_name));
      });
    });
  },

  addDomain: (domainName) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT OR IGNORE INTO domains (domain_name) VALUES (?)`, [domainName], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }
};

// Add default domains
(async () => {
  const domains = await dbHelpers.getActiveDomains();
  if (domains.length === 0) {
    await dbHelpers.addDomain('tempmail.com');
    await dbHelpers.addDomain('tempinbox.com');
    await dbHelpers.addDomain('throwaway.com');
    console.log('✅ Default domains added');
  }
})();

// Generate random email address
function generateEmail(domain = 'tempmail.com') {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let username = '';
  for (let i = 0; i < 10; i++) {
    username += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${username}@${domain}`;
}

// ==================== API ROUTES ====================

app.get('/api/generate', (req, res) => {
  const domain = req.query.domain || 'tempmail.com';
  const email = generateEmail(domain);
  res.json({ email, expiresIn: 7200 });
});

app.get('/api/inbox/:email', async (req, res) => {
  const email = decodeURIComponent(req.params.email);
  try {
    const messages = await dbHelpers.getEmailsByRecipient(email);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch inbox' });
  }
});

app.get('/api/message/:id', async (req, res) => {
  try {
    const message = await dbHelpers.getEmailById(req.params.id);
    if (message) {
      await dbHelpers.markAsRead(req.params.id);
      res.json(message);
    } else {
      res.status(404).json({ error: 'Message not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

app.delete('/api/inbox/:email', async (req, res) => {
  const email = decodeURIComponent(req.params.email);
  try {
    await dbHelpers.clearInbox(email);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear inbox' });
  }
});

app.get('/api/domains', async (req, res) => {
  try {
    const domains = await dbHelpers.getActiveDomains();
    res.json(domains);
  } catch (error) {
    res.json(['tempmail.com', 'tempinbox.com', 'throwaway.com']);
  }
});

app.post('/api/receive', async (req, res) => {
  const { to, from, subject, body, html } = req.body;
  if (!to || !from) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const emailData = {
    email_id: Date.now().toString(),
    recipient: to,
    sender: from,
    subject: subject || '(No Subject)',
    body: body || '',
    html: html || '',
    created_at: new Date().toISOString()
  };
  
  try {
    await dbHelpers.saveEmail(emailData);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save email' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Clean old emails every hour
setInterval(async () => {
  try {
    await dbHelpers.deleteOldEmails(2);
    console.log('Cleaned old emails');
  } catch (error) {
    console.error('Error cleaning emails:', error);
  }
}, 3600000);

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 TempMail Server running on http://localhost:${PORT}`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health\n`);
});