/**
 * Email Responder Channel Plugin
 *
 * Monitors IMAP inbox and sends AI-powered replies via SMTP.
 * Works with any standard email provider (Gmail, Fastmail, self-hosted, etc.).
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

import { emailPlugin, setEmailRuntime } from "./src/channel.js";

const plugin = {
  id: "email-responder",
  name: "Email Responder",
  description: "IMAP/SMTP email channel - monitors inbox and sends AI-powered replies",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    console.log("[email] Plugin register() called");
    // Store runtime reference for the monitor
    setEmailRuntime({
      processInbound: async () => {
        // Will be set by channel gateway.startAccount
      },
      logger: api.logger,
    });

    // Register the email channel
    console.log("[email] Calling api.registerChannel with plugin:", emailPlugin.id);
    api.registerChannel({ plugin: emailPlugin });

    console.log("[email] Plugin registration complete");
    api.logger?.info("Email responder plugin registered");
  },
};

export default plugin;
