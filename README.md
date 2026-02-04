# Email Responder Plugin for Clawdbot

📧 Monitor an IMAP inbox and send AI-powered replies via SMTP.

Works with any standard email provider (Gmail, Fastmail, Outlook, self-hosted, etc.).

## Installation

```bash
clawdbot plugins install @clawdbot/email-responder
clawdbot gateway restart
```

## Configuration

Add to your Clawdbot config:

```yaml
channels:
  email:
    enabled: true
    
    # IMAP (incoming)
    imapHost: imap.gmail.com
    imapPort: 993
    imapUser: you@gmail.com
    imapPassword: your-app-password
    
    # SMTP (outgoing)
    smtpHost: smtp.gmail.com
    smtpPort: 587
    
    # Optional settings
    pollIntervalSeconds: 60
    folder: INBOX
    maxRepliesPerSenderPerHour: 5
    dmPolicy: pairing  # pairing | allowlist | open
    signature: |
      --
      Sent via Clawdbot
```

### Multi-Account Setup

```yaml
channels:
  email:
    enabled: true
    accounts:
      personal:
        imapHost: imap.fastmail.com
        imapUser: me@fastmail.com
        imapPassword: app-password-here
        smtpHost: smtp.fastmail.com
      work:
        imapHost: imap.office365.com
        imapUser: me@company.com
        imapPassword: app-password-here
        smtpHost: smtp.office365.com
```

## Features

- **IMAP Polling** — Monitors inbox for new unread messages
- **Smart Replies** — Routes emails through your Clawdbot agent for AI responses
- **Email Threading** — Proper `In-Reply-To` and `References` headers
- **Rate Limiting** — Prevents reply loops (default: 5/sender/hour)
- **Auto-Reply Detection** — Skips noreply@, mailer-daemon@, auto-submitted
- **Quote Stripping** — Cleans up forwarded/quoted content before processing
- **DM Policy** — Supports pairing, allowlist, or open access modes

## Provider-Specific Notes

### Gmail
Use an [App Password](https://myaccount.google.com/apppasswords) (requires 2FA enabled).

### Fastmail
Generate an app password from Settings → Password & Security → App Passwords.

### Outlook/Office 365
- IMAP: `imap.office365.com:993`
- SMTP: `smtp.office365.com:587`

### Self-Hosted
Any standard IMAP/SMTP server works. Adjust ports and TLS settings as needed.

## State & Logs

- Processed message IDs: `~/.clawdbot/email-responder/state.json`
- Rate limit tracking stored in the same file
- Logs appear in gateway output with `[email]` prefix

## License

MIT

---

**Created by [Blockrush](https://www.blockrush.com)**
