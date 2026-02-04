/**
 * Runtime Bridge - Connects plugin to Clawdbot core
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";

let pluginRuntime: ClawdbotPluginApi["runtime"] | null = null;

export function setPluginRuntime(runtime: ClawdbotPluginApi["runtime"]): void {
  pluginRuntime = runtime;
}

export function getPluginRuntime(): ClawdbotPluginApi["runtime"] | null {
  return pluginRuntime;
}
