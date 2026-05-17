const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database setup (better-sqlite3 - Render compatible)
const dbPath = path.join(__dirname, 'tempmail.db');
const db = new Database(dbPath);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id TEXT UNIQUE,
    recipient TEXT,
    sender TEXT,
    subject TEXT,
    body TEXT,
    html TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_name TEXT UNIQUE,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Insert default domains if none exist
const domainCount = db.prepare('SELECT COUNT(*) as count FROM domains').get();
if (domainCount.count === 0) {
  const insertDomain = db.prepare('INSERT INTO domains (domain_name) VALUES (?)');
  insertDomain.run('tempmail.com');
  insertDomain.run('tempinbox.com');
  insertDomain.run('throwaway.com');
  console.log('✅ Default domains added');
}

// Database helper functions
const dbHelpers = {
  saveEmail: (emailData) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO emails 
      (email_id, recipient, sender, subject, body, html, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      emailData.email_id,
      emailData.recipient,
      emailData.sender,
      emailData.subject,
      emailData.body,
      emailData.html,
      emailData.created_at || new Date().toISOString()
    );
  },

  getEmailsByRecipient: (recipient, limit = 50) => {
    const stmt = db.prepare(`
      SELECT * FROM emails WHERE recipient = ? 
      ORDER BY created_at DESC LIMIT ?
    `);
    return stmt.all(recipient, limit);
  },

  getEmailById: (id) => {
    const stmt = db.prepare(`SELECT * FROM emails WHERE id = ?`);
    return stmt.get(id);
  },

  markAsRead: (id) => {
    const stmt = db.prepare(`UPDATE emails SET is_read = 1 WHERE id = ?`);
    return stmt.run(id);
  },

  deleteOldEmails: (hours = 2) => {
    const stmt = db.prepare(`
      DELETE FROM emails WHERE created_at < datetime('now', '-' || ? || ' hours')
    `);
    return stmt.run(hours);
  },

  clearInbox: (recipient) => {
    const stmt = db.prepare(`DELETE FROM emails WHERE recipient = ?`);
    return stmt.run(recipient);
  },

  getActiveDomains: () => {
    const stmt = db.prepare(`SELECT domain_name FROM domains WHERE is_active = 1`);
    const rows = stmt.all();
    return rows.map(row => row.domain_name);
  },

  addDomain: (domainName) => {
    const stmt = db.prepare(`INSERT OR IGNORE INTO domains (domain_name) VALUES (?)`);
    return stmt.run(domainName);
  }
};

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

// Generate new email address
app.get('/api/generate', (req, res) => {
  const domain = req.query.domain || 'tempmail.com';
  const email = generateEmail(domain);
  res.json({ email, expiresIn: 7200 });
});

// Get inbox for specific email
app.get('/api/inbox/:email', (req, res) => {
  const email = decodeURIComponent(req.params.email);
  
  try {
    const messages = dbHelpers.getEmailsByRecipient(email);
    res.json(messages);
  } catch (error) {
    console.error('Error fetching inbox:', error);
    res.status(500).json({ error: 'Failed to fetch inbox' });
  }
});

// Get single email by ID
app.get('/api/message/:id', (req, res) => {
  try {
    const message = dbHelpers.getEmailById(req.params.id);
    if (message) {
      dbHelpers.markAsRead(req.params.id);
      res.json(message);
    } else {
      res.status(404).json({ error: 'Message not found' });
    }
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

// Delete all emails for a recipient
app.delete('/api/inbox/:email', (req, res) => {
  const email = decodeURIComponent(req.params.email);
  
  try {
    dbHelpers.clearInbox(email);
    res.json({ success: true, message: 'Inbox cleared' });
  } catch (error) {
    console.error('Error clearing inbox:', error);
    res.status(500).json({ error: 'Failed to clear inbox' });
  }
});

// Get available domains
app.get('/api/domains', (req, res) => {
  try {
    const domains = dbHelpers.getActiveDomains();
    res.json(domains);
  } catch (error) {
    console.error('Error fetching domains:', error);
    res.json(['tempmail.com', 'tempinbox.com', 'throwaway.com']);
  }
});

// Webhook to receive emails (for testing)
app.post('/api/receive', (req, res) => {
  const { to, from, subject, body, html } = req.body;
  
  if (!to || !from) {
    return res.status(400).json({ error: 'Missing required fields: to and from are required' });
  }
  
  const emailData = {
    email_id: Date.now().toString() + Math.random().toString(36).substring(2),
    recipient: to,
    sender: from,
    subject: subject || '(No Subject)',
    body: body || '',
    html: html || body || '',
    created_at: new Date().toISOString()
  };
  
  try {
    dbHelpers.saveEmail(emailData);
    console.log(`✅ Email saved: from ${from} to ${to}`);
    res.json({ success: true, message: 'Email received' });
  } catch (error) {
    console.error('Error saving email:', error);
    res.status(500).json({ error: 'Failed to save email' });
  }
});

// Health check endpoint (for Render)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Clean old emails every hour (emails older than 2 hours)
setInterval(() => {
  try {
    const result = dbHelpers.deleteOldEmails(2);
    console.log(`🧹 Cleaned old emails: ${result.changes} deleted`);
  } catch (error) {
    console.error('Error cleaning emails:', error);
  }
}, 3600000); // Every hour

// ==================== FRONTEND ROUTE ====================
// Serve static files from frontend folder
app.use(express.static(path.join(__dirname, '../frontend')));

// Catch-all route for frontend (must be last)
app.get('*', (req, res) => {
  // Skip API routes
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ========================================`);
  console.log(`✅ TempMail Server is running!`);
  console.log(`========================================`);
  console.log(`📡 Server URL: http://localhost:${PORT}`);
  console.log(`🌐 Open in browser: http://localhost:${PORT}`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log(`========================================\n`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  db.close();
  console.log('📁 Database closed');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server...');
  db.close();
  console.log('📁 Database closed');
  process.exit(0);
});