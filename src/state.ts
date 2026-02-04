/**
 * State Management - Processed IDs and Rate Limiting
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ProcessedMessageStore } from "./types.js";

const STATE_DIR = path.join(os.homedir(), ".clawdbot", "email-responder");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const MAX_PROCESSED_IDS = 10000; // Limit stored IDs to prevent unbounded growth
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

let stateCache: ProcessedMessageStore | null = null;

function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

export function loadState(): ProcessedMessageStore {
  if (stateCache) return stateCache;

  ensureStateDir();

  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, "utf-8");
      stateCache = JSON.parse(data);
      return stateCache!;
    }
  } catch (err) {
    console.error("Failed to load email responder state:", err);
  }

  stateCache = {
    processedIds: [],
    rateLimits: {},
  };
  return stateCache;
}

export function saveState(state: ProcessedMessageStore): void {
  ensureStateDir();

  // Trim processed IDs to prevent unbounded growth
  if (state.processedIds.length > MAX_PROCESSED_IDS) {
    state.processedIds = state.processedIds.slice(-MAX_PROCESSED_IDS);
  }

  // Clean up old rate limit entries
  const now = Date.now();
  for (const sender of Object.keys(state.rateLimits)) {
    state.rateLimits[sender] = state.rateLimits[sender].filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS
    );
    if (state.rateLimits[sender].length === 0) {
      delete state.rateLimits[sender];
    }
  }

  stateCache = state;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function isMessageProcessed(messageId: string): boolean {
  const state = loadState();
  return state.processedIds.includes(messageId);
}

export function markMessageProcessed(messageId: string): void {
  const state = loadState();
  if (!state.processedIds.includes(messageId)) {
    state.processedIds.push(messageId);
    saveState(state);
  }
}

export function checkRateLimit(sender: string, maxPerHour: number): boolean {
  const state = loadState();
  const now = Date.now();
  const timestamps = state.rateLimits[sender] || [];

  // Filter to only timestamps within the last hour
  const recentTimestamps = timestamps.filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );

  return recentTimestamps.length < maxPerHour;
}

export function recordReply(sender: string): void {
  const state = loadState();
  const now = Date.now();

  if (!state.rateLimits[sender]) {
    state.rateLimits[sender] = [];
  }

  state.rateLimits[sender].push(now);
  saveState(state);
}

export function getRateLimitStatus(sender: string): { count: number; remaining: number; resetMs: number } {
  const state = loadState();
  const now = Date.now();
  const timestamps = state.rateLimits[sender] || [];

  const recentTimestamps = timestamps.filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );

  // Find the oldest timestamp to calculate reset time
  const oldestTs = recentTimestamps.length > 0 ? Math.min(...recentTimestamps) : now;
  const resetMs = Math.max(0, (oldestTs + RATE_LIMIT_WINDOW_MS) - now);

  return {
    count: recentTimestamps.length,
    remaining: Math.max(0, 5 - recentTimestamps.length), // Default max is 5
    resetMs,
  };
}

export function clearState(): void {
  stateCache = null;
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
}

export function getStatePath(): string {
  return STATE_FILE;
}
