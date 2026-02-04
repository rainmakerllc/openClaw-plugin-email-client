/**
 * Email Monitor Service - IMAP Polling Loop
 */

import type { ImapFlow } from "imapflow";
import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { ResolvedEmailAccount, ParsedEmail } from "./types.js";
import {
  connectImap,
  fetchUnreadEmails,
  markAsRead,
  isAutoReply,
  isIgnoredSender,
} from "./imap.js";
import {
  getSmtpTransporter,
  sendEmail,
  buildReplySubject,
  buildThreadInfo,
} from "./smtp.js";
import {
  isMessageProcessed,
  markMessageProcessed,
  checkRateLimit,
  recordReply,
} from "./state.js";

// Runtime bridge for agent invocation
let emailRuntime: EmailRuntime | null = null;

export interface EmailRuntime {
  processInbound: (ctx: InboundEmailContext) => Promise<void>;
  logger?: { info: (msg: string) => void; error: (msg: string) => void; debug: (msg: string) => void };
}

export interface InboundEmailContext {
  channel: "email";
  accountId: string;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
  inReplyTo?: string;
  date: Date;
  reply: (text: string) => Promise<{ ok: boolean; error?: string }>;
}

export function setEmailRuntime(runtime: EmailRuntime): void {
  emailRuntime = runtime;
}

export function getEmailRuntime(): EmailRuntime | null {
  return emailRuntime;
}

export interface MonitorOptions {
  account: ResolvedEmailAccount;
  config: ClawdbotConfig;
  abortSignal: AbortSignal;
  statusSink: (patch: Record<string, unknown>) => void;
  runtime: EmailRuntime;
}

export async function monitorEmailProvider(opts: MonitorOptions): Promise<void> {
  const { account, config, abortSignal, statusSink, runtime } = opts;
  const log = runtime.logger;

  console.log(`[email] monitorEmailProvider starting for account: ${account.accountId}`);
  console.log(`[email] Account config:`, {
    imapHost: account.config.imapHost,
    imapPort: account.config.imapPort,
    imapUser: account.config.imapUser,
    smtpHost: account.config.smtpHost,
    pollIntervalSeconds: account.config.pollIntervalSeconds,
  });

  const pollIntervalMs = (account.config.pollIntervalSeconds ?? 60) * 1000;
  const folder = account.config.folder ?? "INBOX";
  const maxReplies = account.config.maxRepliesPerSenderPerHour ?? 5;

  let client: ImapFlow | null = null;
  let retryDelay = 1000;
  const maxRetryDelay = 60000;

  const connectWithRetry = async (): Promise<ImapFlow> => {
    while (!abortSignal.aborted) {
      try {
        console.log(`[email] Connecting to IMAP ${account.config.imapHost}:${account.config.imapPort ?? 993}...`);
        log?.info(`[${account.accountId}] Connecting to IMAP ${account.config.imapHost}...`);

        client = await connectImap({
          host: account.config.imapHost,
          port: account.config.imapPort ?? 993,
          user: account.config.imapUser,
          password: account.config.imapPassword,
          tls: account.config.imapTls ?? true,
          logger: log ? { debug: log.debug, error: log.error } : undefined,
        });

        log?.info(`[${account.accountId}] IMAP connected`);
        statusSink({ connected: true, lastError: null });
        retryDelay = 1000; // Reset on success
        return client;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log?.error(`[${account.accountId}] IMAP connection failed: ${errorMsg}`);
        statusSink({ connected: false, lastError: errorMsg });

        await sleep(retryDelay);
        retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
      }
    }
    throw new Error("Aborted");
  };

  // Main polling loop
  while (!abortSignal.aborted) {
    try {
      if (!client) {
        client = await connectWithRetry();
      }

      console.log(`[email] Polling for unread emails in ${folder}...`);
      log?.debug(`[${account.accountId}] Polling for unread emails in ${folder}...`);
      const emails = await fetchUnreadEmails(client, folder);
      console.log(`[email] Found ${emails.length} unread emails`);

      for (const email of emails) {
        if (abortSignal.aborted) break;

        console.log(`[email] Processing email:`, {
          from: email.from,
          subject: email.subject,
          messageId: email.messageId,
          date: email.date,
        });

        await processEmail({
          email,
          account,
          config,
          runtime,
          maxReplies,
          folder,
          client,
        });
      }

      statusSink({ lastPollAt: Date.now() });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log?.error(`[${account.accountId}] Poll error: ${errorMsg}`);
      statusSink({ lastError: errorMsg });

      // Reconnect on error
      if (client) {
        try {
          await client.logout();
        } catch {
          // Ignore logout errors
        }
        client = null;
      }
    }

    // Wait for next poll
    await sleep(pollIntervalMs, abortSignal);
  }

  // Cleanup
  if (client) {
    try {
      await client.logout();
    } catch {
      // Ignore
    }
  }
}

interface ProcessEmailOptions {
  email: ParsedEmail;
  account: ResolvedEmailAccount;
  config: ClawdbotConfig;
  runtime: EmailRuntime;
  maxReplies: number;
  folder: string;
  client: ImapFlow;
}

async function processEmail(opts: ProcessEmailOptions): Promise<void> {
  const { email, account, config, runtime, maxReplies, folder, client } = opts;
  const log = runtime.logger;

  // Skip if already processed
  if (isMessageProcessed(email.messageId)) {
    log?.debug(`[${account.accountId}] Skipping already processed: ${email.messageId}`);
    return;
  }

  // Skip own emails
  if (email.from.toLowerCase() === account.email.toLowerCase()) {
    log?.debug(`[${account.accountId}] Skipping own email: ${email.messageId}`);
    markMessageProcessed(email.messageId);
    await markAsRead(client, folder, email.uid);
    return;
  }

  // Skip auto-replies
  if (isAutoReply(email)) {
    log?.debug(`[${account.accountId}] Skipping auto-reply: ${email.messageId}`);
    markMessageProcessed(email.messageId);
    await markAsRead(client, folder, email.uid);
    return;
  }

  // Skip ignored senders
  if (isIgnoredSender(email.from)) {
    log?.debug(`[${account.accountId}] Skipping ignored sender: ${email.from}`);
    markMessageProcessed(email.messageId);
    await markAsRead(client, folder, email.uid);
    return;
  }

  // Check rate limit
  if (!checkRateLimit(email.from, maxReplies)) {
    log?.debug(`[${account.accountId}] Rate limited: ${email.from}`);
    markMessageProcessed(email.messageId);
    await markAsRead(client, folder, email.uid);
    return;
  }

  log?.info(`[${account.accountId}] Processing email from ${email.from}: ${email.subject}`);

  // Build reply function
  const reply = async (text: string): Promise<{ ok: boolean; error?: string }> => {
    const transporter = getSmtpTransporter({
      host: account.config.smtpHost,
      port: account.config.smtpPort ?? 587,
      user: account.config.smtpUser ?? account.config.imapUser,
      password: account.config.smtpPassword ?? account.config.imapPassword,
      tls: account.config.smtpTls ?? false,
      startTls: account.config.smtpStartTls ?? true,
    });

    const threadInfo = buildThreadInfo(email.messageId, email.references);
    const subject = buildReplySubject(email.subject, account.config.replyPrefix);

    const result = await sendEmail({
      transporter,
      from: account.email,
      to: email.from,
      subject,
      text,
      threadInfo,
      signature: account.config.signature,
    });

    if (result.ok) {
      recordReply(email.from);
      log?.info(`[${account.accountId}] Replied to ${email.from}`);
    } else {
      log?.error(`[${account.accountId}] Failed to reply: ${result.error}`);
    }

    return result;
  };

  // Process through agent
  const context: InboundEmailContext = {
    channel: "email",
    accountId: account.accountId,
    from: email.from,
    fromName: email.fromName,
    to: account.email,
    subject: email.subject,
    body: email.textBody,
    messageId: email.messageId,
    inReplyTo: email.inReplyTo,
    date: email.date,
    reply,
  };

  await runtime.processInbound(context);

  // Mark as processed and read
  markMessageProcessed(email.messageId);
  await markAsRead(client, folder, email.uid);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    }
  });
}
