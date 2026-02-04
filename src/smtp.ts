/**
 * SMTP Email Sending
 */

import nodemailer, { type Transporter } from "nodemailer";
import type { EmailAccountConfig, EmailThreadInfo } from "./types.js";

export interface SmtpOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  startTls: boolean;
}

let transporterCache: Map<string, Transporter> = new Map();

export function getSmtpTransporter(opts: SmtpOptions): Transporter {
  const key = `${opts.host}:${opts.port}:${opts.user}`;
  let transporter = transporterCache.get(key);

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.tls,
      requireTLS: opts.startTls,
      auth: {
        user: opts.user,
        pass: opts.password,
      },
    });
    transporterCache.set(key, transporter);
  }

  return transporter;
}

export interface SendEmailOptions {
  transporter: Transporter;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  threadInfo?: EmailThreadInfo;
  signature?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    // Build message with proper threading headers
    const messageOptions: nodemailer.SendMailOptions = {
      from: opts.fromName ? `"${opts.fromName}" <${opts.from}>` : opts.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.signature ? `${opts.text}\n\n${opts.signature}` : opts.text,
    };

    if (opts.html) {
      messageOptions.html = opts.signature
        ? `${opts.html}<br><br><pre>${opts.signature}</pre>`
        : opts.html;
    }

    // Add threading headers for proper email threading
    if (opts.threadInfo) {
      const headers: Record<string, string> = {};

      if (opts.threadInfo.inReplyTo) {
        headers["In-Reply-To"] = opts.threadInfo.inReplyTo;
      }

      if (opts.threadInfo.references && opts.threadInfo.references.length > 0) {
        headers["References"] = opts.threadInfo.references.join(" ");
      }

      messageOptions.headers = headers;
    }

    const result = await opts.transporter.sendMail(messageOptions);

    return {
      ok: true,
      messageId: result.messageId,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}

export function buildReplySubject(originalSubject: string, prefix: string = "Re: "): string {
  // Don't add prefix if already present
  if (originalSubject.toLowerCase().startsWith(prefix.toLowerCase())) {
    return originalSubject;
  }
  return `${prefix}${originalSubject}`;
}

export function buildThreadInfo(
  originalMessageId: string,
  originalReferences?: string[],
): EmailThreadInfo {
  // Build references chain: existing references + the message we're replying to
  const references = [...(originalReferences || [])];
  if (originalMessageId && !references.includes(originalMessageId)) {
    references.push(originalMessageId);
  }

  return {
    messageId: `<${Date.now()}-${Math.random().toString(36).slice(2)}@clawdbot>`,
    inReplyTo: originalMessageId,
    references,
  };
}

export function clearTransporterCache(): void {
  transporterCache.clear();
}
