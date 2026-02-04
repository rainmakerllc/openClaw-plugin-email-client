/**
 * Email Channel Config Schema (Zod)
 */

import { z } from "zod";

const emailAccountSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),

  // IMAP
  imapHost: z.string().optional(),
  imapPort: z.number().int().positive().optional().default(993),
  imapUser: z.string().optional(),
  imapPassword: z.string().optional(),
  imapTls: z.boolean().optional().default(true),

  // SMTP
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().positive().optional().default(587),
  smtpUser: z.string().optional(), // defaults to imapUser
  smtpPassword: z.string().optional(), // defaults to imapPassword
  smtpTls: z.boolean().optional().default(false),
  smtpStartTls: z.boolean().optional().default(true),

  // Behavior
  pollIntervalSeconds: z.number().int().min(10).optional().default(60),
  folder: z.string().optional().default("INBOX"),
  maxRepliesPerSenderPerHour: z.number().int().min(1).optional().default(5),
  systemPrompt: z.string().optional(),
  replyPrefix: z.string().optional().default("Re: "),

  // Security
  dmPolicy: z.enum(["open", "pairing", "allowlist"]).optional().default("pairing"),
  allowFrom: z.array(z.string()).optional(),

  // Signature
  signature: z.string().optional(),
});

export const EmailConfigSchema = emailAccountSchema.extend({
  accounts: z.object({}).catchall(emailAccountSchema).optional(),
});

export type EmailAccountConfigType = z.infer<typeof emailAccountSchema>;
export type EmailConfigType = z.infer<typeof EmailConfigSchema>;
