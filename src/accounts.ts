/**
 * Email Account Resolution
 */

import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { ResolvedEmailAccount, EmailAccountConfig } from "./types.js";

const DEFAULT_ACCOUNT_ID = "default";

interface EmailChannelConfig {
  enabled?: boolean;
  accounts?: Record<string, EmailAccountConfig>;
  // Top-level fields for single-account setups
  name?: string;
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  imapPassword?: string;
  imapTls?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpTls?: boolean;
  smtpStartTls?: boolean;
  pollIntervalSeconds?: number;
  folder?: string;
  maxRepliesPerSenderPerHour?: number;
  systemPrompt?: string;
  replyPrefix?: string;
  dmPolicy?: "open" | "pairing" | "allowlist";
  allowFrom?: string[];
  signature?: string;
}

export function listEmailAccountIds(cfg: ClawdbotConfig): string[] {
  const channelConfig = (cfg.channels as Record<string, unknown>)?.email as EmailChannelConfig | undefined;
  if (!channelConfig) return [DEFAULT_ACCOUNT_ID];

  const accountIds: string[] = [];

  // Check for accounts object
  if (channelConfig.accounts) {
    accountIds.push(...Object.keys(channelConfig.accounts));
  }

  // Check for top-level config (implies default account)
  if (channelConfig.imapHost || channelConfig.imapUser) {
    if (!accountIds.includes(DEFAULT_ACCOUNT_ID)) {
      accountIds.push(DEFAULT_ACCOUNT_ID);
    }
  }

  // Always return at least default account
  if (accountIds.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return accountIds;
}

function mergeEmailAccountConfig(
  cfg: ClawdbotConfig,
  accountId: string,
): EmailAccountConfig {
  const channelConfig = (cfg.channels as Record<string, unknown>)?.email as EmailChannelConfig | undefined;
  if (!channelConfig) {
    return {} as EmailAccountConfig;
  }

  // Base config (top-level fields, excluding accounts)
  const { accounts: _ignored, ...baseConfig } = channelConfig;

  // Account-specific config (if exists)
  const accountConfig = channelConfig.accounts?.[accountId] ?? {};

  // Merge: account config overrides base config
  return { ...baseConfig, ...accountConfig } as EmailAccountConfig;
}

export function resolveEmailAccount(opts: {
  cfg: ClawdbotConfig;
  accountId?: string;
}): ResolvedEmailAccount {
  const { cfg, accountId = DEFAULT_ACCOUNT_ID } = opts;
  const channelConfig = (cfg.channels as Record<string, unknown>)?.email as EmailChannelConfig | undefined;

  const merged = mergeEmailAccountConfig(cfg, accountId);
  const baseEnabled = channelConfig?.enabled;
  const accountEnabled = merged.enabled !== false;

  // Debug: log what we're checking
  console.log(`[email] resolveEmailAccount(${accountId}):`, {
    imapHost: merged.imapHost,
    imapUser: merged.imapUser,
    imapPassword: merged.imapPassword ? "[set]" : "[not set]",
    smtpHost: merged.smtpHost,
  });

  const configured = Boolean(
    merged.imapHost &&
    merged.imapUser &&
    merged.imapPassword &&
    merged.smtpHost
  );

  console.log(`[email] Account ${accountId} configured: ${configured}`);

  return {
    accountId,
    name: merged.name,
    enabled: baseEnabled !== false && accountEnabled,
    configured,
    email: merged.imapUser || "",
    config: merged,
  };
}

export function resolveDefaultEmailAccountId(cfg: ClawdbotConfig): string {
  const accountIds = listEmailAccountIds(cfg);

  // Prefer explicitly named default
  if (accountIds.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }

  // Fall back to first account
  return accountIds[0] || DEFAULT_ACCOUNT_ID;
}

export function normalizeEmailAddress(email: string): string {
  return email.toLowerCase().trim();
}

export { DEFAULT_ACCOUNT_ID };
