/**
 * IMAP Connection and Email Fetching
 */

import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { convert } from "html-to-text";
import type { EmailAccountConfig, ParsedEmail, AUTO_REPLY_HEADERS, IGNORED_SENDERS } from "./types.js";

export interface ImapConnectionOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  logger?: { debug: (msg: string) => void; error: (msg: string) => void };
}

export async function connectImap(opts: ImapConnectionOptions): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: opts.host,
    port: opts.port,
    secure: opts.tls,
    auth: {
      user: opts.user,
      pass: opts.password,
    },
    logger: opts.logger ? {
      debug: (obj: unknown) => opts.logger?.debug(JSON.stringify(obj)),
      info: (obj: unknown) => opts.logger?.debug(JSON.stringify(obj)),
      warn: (obj: unknown) => opts.logger?.debug(JSON.stringify(obj)),
      error: (obj: unknown) => opts.logger?.error(JSON.stringify(obj)),
    } : false,
  });

  await client.connect();
  return client;
}

export async function fetchUnreadEmails(
  client: ImapFlow,
  folder: string = "INBOX",
  limit: number = 20,
): Promise<ParsedEmail[]> {
  const emails: ParsedEmail[] = [];

  const lock = await client.getMailboxLock(folder);
  try {
    // Search for unseen messages
    const uids = await client.search({ seen: false }, { uid: true });
    if (uids.length === 0) return [];

    // Limit to most recent
    const fetchUids = uids.slice(-limit);

    for await (const message of client.fetch(fetchUids, {
      uid: true,
      envelope: true,
      source: true,
    })) {
      try {
        const parsed = await simpleParser(message.source);
        const email = parseMailToEmail(parsed, message.uid);
        if (email) {
          emails.push(email);
        }
      } catch (err) {
        // Skip unparseable messages
        console.error(`Failed to parse message UID ${message.uid}:`, err);
      }
    }
  } finally {
    lock.release();
  }

  return emails;
}

export async function markAsRead(
  client: ImapFlow,
  folder: string,
  uid: number,
): Promise<void> {
  const lock = await client.getMailboxLock(folder);
  try {
    await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });
  } finally {
    lock.release();
  }
}

function parseMailToEmail(parsed: ParsedMail, uid: number): ParsedEmail | null {
  const messageId = parsed.messageId || `generated-${uid}-${Date.now()}`;
  const from = extractEmailAddress(parsed.from?.value?.[0]?.address || "");
  const fromName = parsed.from?.value?.[0]?.name;

  if (!from) return null;

  const to = (parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]) : [])
    .flatMap((addr) => addr.value?.map((v) => v.address || "") || [])
    .filter(Boolean);

  const cc = (parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]) : [])
    .flatMap((addr) => addr.value?.map((v) => v.address || "") || [])
    .filter(Boolean);

  // Extract text body, falling back to HTML conversion
  let textBody = parsed.text || "";
  if (!textBody && parsed.html) {
    textBody = convert(parsed.html, {
      wordwrap: 80,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
      ],
    });
  }

  // Strip quoted content and signatures
  textBody = stripQuotedContent(textBody);

  // Collect headers as flat record
  const headers: Record<string, string> = {};
  if (parsed.headers) {
    parsed.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = String(value);
    });
  }

  return {
    messageId,
    from,
    fromName,
    to,
    cc,
    subject: parsed.subject || "(no subject)",
    textBody,
    htmlBody: parsed.html || undefined,
    date: parsed.date || new Date(),
    inReplyTo: parsed.inReplyTo || undefined,
    references: parsed.references
      ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references])
      : undefined,
    headers,
    uid,
  };
}

function extractEmailAddress(input: string): string {
  const match = input.match(/<([^>]+)>/);
  return (match ? match[1] : input).toLowerCase().trim();
}

function stripQuotedContent(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inQuotedBlock = false;

  for (const line of lines) {
    // Detect start of quoted content
    if (/^On .+ wrote:$/i.test(line.trim())) {
      inQuotedBlock = true;
      continue;
    }
    if (/^-{2,}\s*Original Message/i.test(line.trim())) {
      inQuotedBlock = true;
      continue;
    }
    if (/^>+/.test(line.trim())) {
      continue; // Skip quoted lines
    }

    // Detect signature block
    if (/^--\s*$/.test(line)) {
      break; // Stop at signature
    }

    if (!inQuotedBlock) {
      result.push(line);
    }
  }

  return result.join("\n").trim();
}

export function isAutoReply(email: ParsedEmail): boolean {
  const autoReplyHeaders = [
    "x-auto-reply",
    "x-autoreply",
    "auto-submitted",
    "x-autorespond",
    "precedence",
  ];

  for (const header of autoReplyHeaders) {
    const value = email.headers[header];
    if (value) {
      // Check specific values that indicate auto-reply
      if (header === "auto-submitted" && value !== "no") return true;
      if (header === "precedence" && ["bulk", "junk", "list"].includes(value.toLowerCase())) return true;
      if (value.toLowerCase().includes("auto")) return true;
      return true;
    }
  }

  return false;
}

export function isIgnoredSender(email: string): boolean {
  const patterns = [
    /^noreply@/i,
    /^no-reply@/i,
    /^mailer-daemon@/i,
    /^postmaster@/i,
    /^bounce/i,
    /^notifications?@/i,
    /^donotreply@/i,
    /^do-not-reply@/i,
  ];

  return patterns.some((pattern) => pattern.test(email));
}
