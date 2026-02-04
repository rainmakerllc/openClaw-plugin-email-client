/**
 * Email Channel Plugin Implementation
 */

import type { ChannelAccountSnapshot, ChannelPlugin, ClawdbotConfig } from "clawdbot/plugin-sdk";
import {
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  setAccountEnabledInConfigSection,
  deleteAccountFromConfigSection,
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  PAIRING_APPROVED_MESSAGE,
} from "clawdbot/plugin-sdk";

import {
  listEmailAccountIds,
  resolveEmailAccount,
  resolveDefaultEmailAccountId,
  normalizeEmailAddress,
  type ResolvedEmailAccount,
} from "./accounts.js";
import { EmailConfigSchema } from "./config-schema.js";
import { monitorEmailProvider, setEmailRuntime } from "./monitor.js";
import { getSmtpTransporter, sendEmail, buildReplySubject, buildThreadInfo } from "./smtp.js";

const meta = {
  id: "email",
  label: "Email",
  selectionLabel: "Email (IMAP/SMTP)",
  detailLabel: "Email",
  docsPath: "/channels/email",
  docsLabel: "email",
  blurb: "Monitor IMAP inbox and send AI-powered replies via SMTP.",
  systemImage: "envelope",
  aliases: ["mail", "imap"],
  order: 80,
};

export const emailPlugin: ChannelPlugin<ResolvedEmailAccount> = {
  id: "email",
  meta,
  capabilities: {
    chatTypes: ["direct"],
    media: false, // Email attachments not yet supported
    reactions: false,
    edit: false,
    unsend: false,
    reply: true,
    effects: false,
    groupManagement: false,
  },
  threading: {
    buildToolContext: ({ context, hasRepliedRef }) => ({
      currentChannelId: context.To?.trim() || undefined,
      currentThreadTs: context.ReplyToId,
      hasRepliedRef,
    }),
  },
  reload: { configPrefixes: ["channels.email"] },
  configSchema: buildChannelConfigSchema(EmailConfigSchema),
  config: {
    listAccountIds: (cfg) => listEmailAccountIds(cfg as ClawdbotConfig),
    resolveAccount: (cfg, accountId) =>
      resolveEmailAccount({ cfg: cfg as ClawdbotConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultEmailAccountId(cfg as ClawdbotConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as ClawdbotConfig,
        sectionKey: "email",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as ClawdbotConfig,
        sectionKey: "email",
        accountId,
        clearBaseFields: [
          "imapHost", "imapPort", "imapUser", "imapPassword", "imapTls",
          "smtpHost", "smtpPort", "smtpUser", "smtpPassword", "smtpTls", "smtpStartTls",
          "pollIntervalSeconds", "folder", "maxRepliesPerSenderPerHour",
          "systemPrompt", "replyPrefix", "dmPolicy", "allowFrom", "signature", "name",
        ],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      email: account.email,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveEmailAccount({ cfg: cfg as ClawdbotConfig, accountId }).config.allowFrom ?? []).map(
        (entry) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => normalizeEmailAddress(entry.replace(/^email:/i, ""))),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(
        (cfg as ClawdbotConfig).channels?.email?.accounts?.[resolvedAccountId],
      );
      const basePath = useAccountPath
        ? `channels.email.accounts.${resolvedAccountId}.`
        : "channels.email.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("email"),
        normalizeEntry: (raw) => normalizeEmailAddress(raw.replace(/^email:/i, "")),
      };
    },
  },
  messaging: {
    normalizeTarget: (target) => normalizeEmailAddress(target),
    targetResolver: {
      looksLikeId: (target) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target),
      hint: "<email@example.com>",
    },
    formatTargetDisplay: ({ target, display }) => {
      return display?.trim() || target?.trim() || "";
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) =>
      accountId?.trim().toLowerCase() || DEFAULT_ACCOUNT_ID,
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg: cfg as ClawdbotConfig,
        channelKey: "email",
        accountId,
        name,
      }),
    validateInput: ({ input }) => {
      if (!input.imapHost) return "Email requires --imap-host.";
      if (!input.imapUser) return "Email requires --imap-user (your email address).";
      if (!input.imapPassword) return "Email requires --imap-password (or app password).";
      if (!input.smtpHost) return "Email requires --smtp-host.";
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg: cfg as ClawdbotConfig,
        channelKey: "email",
        accountId,
        name: input.name,
      });

      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...namedConfig,
          channels: {
            ...namedConfig.channels,
            email: {
              ...namedConfig.channels?.email,
              enabled: true,
              ...(input.imapHost ? { imapHost: input.imapHost } : {}),
              ...(input.imapPort ? { imapPort: input.imapPort } : {}),
              ...(input.imapUser ? { imapUser: input.imapUser } : {}),
              ...(input.imapPassword ? { imapPassword: input.imapPassword } : {}),
              ...(input.smtpHost ? { smtpHost: input.smtpHost } : {}),
              ...(input.smtpPort ? { smtpPort: input.smtpPort } : {}),
              ...(input.smtpUser ? { smtpUser: input.smtpUser } : {}),
              ...(input.smtpPassword ? { smtpPassword: input.smtpPassword } : {}),
            },
          },
        } as ClawdbotConfig;
      }

      return {
        ...namedConfig,
        channels: {
          ...namedConfig.channels,
          email: {
            ...namedConfig.channels?.email,
            enabled: true,
            accounts: {
              ...(namedConfig.channels?.email?.accounts ?? {}),
              [accountId]: {
                ...(namedConfig.channels?.email?.accounts?.[accountId] ?? {}),
                enabled: true,
                ...(input.imapHost ? { imapHost: input.imapHost } : {}),
                ...(input.imapPort ? { imapPort: input.imapPort } : {}),
                ...(input.imapUser ? { imapUser: input.imapUser } : {}),
                ...(input.imapPassword ? { imapPassword: input.imapPassword } : {}),
                ...(input.smtpHost ? { smtpHost: input.smtpHost } : {}),
                ...(input.smtpPort ? { smtpPort: input.smtpPort } : {}),
                ...(input.smtpUser ? { smtpUser: input.smtpUser } : {}),
                ...(input.smtpPassword ? { smtpPassword: input.smtpPassword } : {}),
              },
            },
          },
        },
      } as ClawdbotConfig;
    },
  },
  pairing: {
    idLabel: "emailSenderId",
    normalizeAllowEntry: (entry) => normalizeEmailAddress(entry.replace(/^email:/i, "")),
    notifyApproval: async ({ cfg, id }) => {
      // Send approval notification email
      const account = resolveEmailAccount({ cfg: cfg as ClawdbotConfig });
      if (!account.configured) return;

      const transporter = getSmtpTransporter({
        host: account.config.smtpHost,
        port: account.config.smtpPort ?? 587,
        user: account.config.smtpUser ?? account.config.imapUser,
        password: account.config.smtpPassword ?? account.config.imapPassword,
        tls: account.config.smtpTls ?? false,
        startTls: account.config.smtpStartTls ?? true,
      });

      await sendEmail({
        transporter,
        from: account.email,
        to: id,
        subject: "Clawdbot Pairing Approved",
        text: PAIRING_APPROVED_MESSAGE,
      });
    },
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 50000, // Emails can be long
    resolveTarget: ({ to }) => {
      const trimmed = to?.trim();
      if (!trimmed) {
        return {
          ok: false,
          error: new Error("Sending email requires --to <email@example.com>"),
        };
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return {
          ok: false,
          error: new Error(`Invalid email address: ${trimmed}`),
        };
      }
      return { ok: true, to: trimmed };
    },
    sendText: async ({ cfg, to, text, accountId, replyToId }) => {
      const account = resolveEmailAccount({
        cfg: cfg as ClawdbotConfig,
        accountId: accountId ?? undefined,
      });

      if (!account.configured) {
        return { ok: false, error: "Email account not configured" };
      }

      const transporter = getSmtpTransporter({
        host: account.config.smtpHost,
        port: account.config.smtpPort ?? 587,
        user: account.config.smtpUser ?? account.config.imapUser,
        password: account.config.smtpPassword ?? account.config.imapPassword,
        tls: account.config.smtpTls ?? false,
        startTls: account.config.smtpStartTls ?? true,
      });

      // Build thread info if replying
      let threadInfo;
      if (replyToId) {
        threadInfo = buildThreadInfo(replyToId);
      }

      const result = await sendEmail({
        transporter,
        from: account.email,
        to,
        subject: replyToId ? "Re: Your message" : "Message from Clawdbot",
        text,
        threadInfo,
        signature: account.config.signature,
      });

      return { channel: "email", ...result };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
      lastPollAt: null,
    },
    collectStatusIssues: (accounts) => {
      const issues: Array<{ channel: string; accountId: string; kind: string; message: string; fix?: string }> = [];
      for (const entry of accounts) {
        const account = entry as { accountId?: string; configured?: boolean; config?: { imapHost?: string; smtpHost?: string; imapUser?: string; imapPassword?: string } };
        const accountId = account?.accountId ?? "default";
        if (!account?.config) {
          issues.push({
            channel: "email",
            accountId,
            kind: "config",
            message: "Email account not configured",
            fix: "Add IMAP/SMTP settings to channels.email config",
          });
          continue;
        }
        if (!account.config.imapHost) {
          issues.push({
            channel: "email",
            accountId,
            kind: "config",
            message: "IMAP host not configured",
            fix: "Set channels.email.imapHost",
          });
        }
        if (!account.config.smtpHost) {
          issues.push({
            channel: "email",
            accountId,
            kind: "config",
            message: "SMTP host not configured",
            fix: "Set channels.email.smtpHost",
          });
        }
        if (!account.config.imapUser || !account.config.imapPassword) {
          issues.push({
            channel: "email",
            accountId,
            kind: "config",
            message: "IMAP credentials not configured",
            fix: "Set channels.email.imapUser and imapPassword",
          });
        }
      }
      return issues;
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      email: snapshot.email ?? null,
      running: snapshot.running ?? false,
      connected: snapshot.connected ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      lastPollAt: snapshot.lastPollAt ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => {
      const running = runtime?.running ?? false;
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        email: account.email,
        config: account.config,  // Include config for collectStatusIssues
        running,
        connected: runtime?.connected ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        lastPollAt: runtime?.lastPollAt ?? null,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      console.log("[email] gateway.startAccount called!");
      const account = ctx.account;
      console.log("[email] account:", JSON.stringify(account, null, 2));
      ctx.setStatus({
        accountId: account.accountId,
        email: account.email,
        running: true,
        lastStartAt: Date.now(),
      });
      ctx.log?.info(`[${account.accountId}] Starting email monitor for ${account.email}`);

      return monitorEmailProvider({
        account,
        config: ctx.cfg as ClawdbotConfig,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
        runtime: {
          processInbound: async (emailCtx) => {
            // Route through Clawdbot's inbound message pipeline
            await ctx.runtime.handleInboundMessage({
              channel: "email",
              accountId: emailCtx.accountId,
              senderId: emailCtx.from,
              senderName: emailCtx.fromName,
              text: `Subject: ${emailCtx.subject}\n\n${emailCtx.body}`,
              messageId: emailCtx.messageId,
              context: {
                From: emailCtx.from,
                To: emailCtx.to,
                Subject: emailCtx.subject,
                ReplyToId: emailCtx.messageId,
              },
              reply: async (text) => {
                const result = await emailCtx.reply(text);
                return result.ok;
              },
            });
          },
          logger: ctx.log,
        },
      });
    },
  },
};

export { setEmailRuntime };
