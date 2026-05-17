// Current state
let currentEmail = '';
let currentEmails = [];
let refreshInterval = null;

// DOM Elements
const emailUsernameSpan = document.getElementById('emailUsername');
const emailDomainSpan = document.getElementById('emailDomain');
const domainSelect = document.getElementById('domainSelect');
const inboxContent = document.getElementById('inboxContent');

// Initialize
async function init() {
    await loadDomains();
    await generateNewEmail();
    startAutoRefresh();
}

// Load available domains
async function loadDomains() {
    try {
        const response = await fetch('/api/domains');
        const domains = await response.json();
        
        domainSelect.innerHTML = '';
        domains.forEach(domain => {
            const option = document.createElement('option');
            option.value = domain;
            option.textContent = domain;
            domainSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading domains:', error);
    }
}

// Generate new email address
async function generateNewEmail() {
    try {
        const domain = domainSelect.value;
        const response = await fetch(`/api/generate?domain=${encodeURIComponent(domain)}`);
        const data = await response.json();
        
        const [username, ...rest] = data.email.split('@');
        emailUsernameSpan.textContent = username;
        emailDomainSpan.textContent = `@${rest.join('@')}`;
        
        currentEmail = data.email;
        
        // Refresh inbox for new email
        await refreshInbox();
        
        // Show notification
        showToast('New email address generated!', 'success');
    } catch (error) {
        console.error('Error generating email:', error);
        showToast('Failed to generate email', 'error');
    }
}

// Change domain
async function changeDomain() {
    await generateNewEmail();
}

// Copy email to clipboard
async function copyEmail() {
    const fullEmail = `${emailUsernameSpan.textContent}${emailDomainSpan.textContent}`;
    try {
        await navigator.clipboard.writeText(fullEmail);
        showToast('Email copied to clipboard!', 'success');
    } catch (error) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = fullEmail;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('Email copied to clipboard!', 'success');
    }
}

// Refresh inbox
async function refreshInbox() {
    if (!currentEmail) return;
    
    try {
        const encodedEmail = encodeURIComponent(currentEmail);
        const response = await fetch(`/api/inbox/${encodedEmail}`);
        const messages = await response.json();
        
        currentEmails = messages;
        renderInbox(messages);
    } catch (error) {
        console.error('Error refreshing inbox:', error);
        inboxContent.innerHTML = '<div class="empty-state">❌ Failed to load messages</div>';
    }
}

// Render inbox
function renderInbox(messages) {
    if (!messages || messages.length === 0) {
        inboxContent.innerHTML = `
            <div class="empty-state">
                <div>📭</div>
                <p>No emails yet</p>
                <p style="font-size: 12px;">Send an email to ${currentEmail}</p>
            </div>
        `;
        return;
    }
    
    inboxContent.innerHTML = messages.map(msg => `
        <div class="email-item ${msg.is_read ? '' : 'unread'}" onclick="viewEmail(${msg.id})">
            <div class="email-header">
                <span class="email-from">${escapeHtml(msg.sender)}</span>
                <span class="email-date">${formatDate(msg.created_at)}</span>
            </div>
            <div class="email-subject">${escapeHtml(msg.subject)}</div>
            <div class="email-preview">${escapeHtml(msg.body.substring(0, 100))}...</div>
        </div>
    `).join('');
}

// View email
async function viewEmail(id) {
    try {
        const response = await fetch(`/api/message/${id}`);
        const email = await response.json();
        
        // Show modal
        document.getElementById('modalSubject').textContent = email.subject;
        document.getElementById('modalFrom').textContent = email.sender;
        document.getElementById('modalDate').textContent = formatDate(email.created_at);
        
        const modalBody = document.getElementById('modalBody');
        if (email.html) {
            modalBody.innerHTML = email.html;
        } else {
            modalBody.innerHTML = `<pre style="white-space: pre-wrap;">${escapeHtml(email.body)}</pre>`;
        }
        
        document.getElementById('emailModal').style.display = 'block';
        
        // Refresh inbox to update read status
        await refreshInbox();
    } catch (error) {
        console.error('Error viewing email:', error);
        showToast('Failed to load email', 'error');
    }
}

// Clear inbox
async function clearInbox() {
    if (!confirm('Are you sure you want to clear all emails?')) return;
    
    try {
        const encodedEmail = encodeURIComponent(currentEmail);
        await fetch(`/api/inbox/${encodedEmail}`, { method: 'DELETE' });
        await refreshInbox();
        showToast('Inbox cleared!', 'success');
    } catch (error) {
        console.error('Error clearing inbox:', error);
        showToast('Failed to clear inbox', 'error');
    }
}

// Send test email
async function sendTestEmail() {
    const from = document.getElementById('testFrom').value;
    const subject = document.getElementById('testSubject').value;
    const body = document.getElementById('testBody').value;
    
    if (!from) {
        showToast('Please enter a sender email', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/receive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: currentEmail,
                from: from,
                subject: subject,
                body: body,
                html: `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>`
            })
        });
        
        if (response.ok) {
            showToast('Test email sent!', 'success');
            document.getElementById('testFrom').value = '';
            document.getElementById('testSubject').value = '';
            document.getElementById('testBody').value = '';
            await refreshInbox();
        } else {
            showToast('Failed to send test email', 'error');
        }
    } catch (error) {
        console.error('Error sending test email:', error);
        showToast('Failed to send test email', 'error');
    }
}

// Close modal
function closeModal() {
    document.getElementById('emailModal').style.display = 'none';
}

// Start auto-refresh
function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(refreshInbox, 10000); // Refresh every 10 seconds
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString();
}

// Show toast notification
function showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'success' ? '#48bb78' : '#e53e3e'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 1000;
        animation: slideIn 0.3s;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('emailModal');
    if (event.target === modal) {
        closeModal();
    }
}

// Start the app
init();