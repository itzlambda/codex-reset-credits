#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const BASE_URL = "https://chatgpt.com/backend-api";
const CREDITS_URL = `${BASE_URL}/wham/rate-limit-reset-credits`;
const USAGE_URL = `${BASE_URL}/wham/usage`;

const HELP = `Usage: codex-reset-credits [options]

Show Codex banked reset credits and current usage.

Options:
  --auth <path>  Path to Codex auth JSON (default: ~/.codex/auth.json)
  --no-usage     Only show banked reset credits
  --raw          Print raw JSON responses
  -h, --help     Show this help message
`;

function parseArgs(argv) {
  const args = {
    authPath: "~/.codex/auth.json",
    noUsage: false,
    raw: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--no-usage") {
      args.noUsage = true;
    } else if (arg === "--raw") {
      args.raw = true;
    } else if (arg === "--auth") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--auth requires a path");
      }
      args.authPath = next;
      i += 1;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  return args;
}

function expandPath(path) {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(path);
}

function assertAsciiUrls() {
  for (const [name, url] of Object.entries({
    BASE_URL,
    CREDITS_URL,
    USAGE_URL,
  })) {
    for (const char of url) {
      if (char.charCodeAt(0) > 0x7f) {
        throw new Error(`${name} contains non-ASCII characters`);
      }
    }
  }
}

async function loadAuth(authPath) {
  let raw;
  try {
    raw = await readFile(authPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(`auth file not found: ${authPath}`);
    }
    throw error;
  }

  const auth = JSON.parse(raw);
  const token = auth?.tokens?.access_token;
  if (!token) {
    throw new Error(`no access token found in ${authPath}`);
  }
  return auth;
}

function headers(auth) {
  const result = {
    Authorization: `Bearer ${auth.tokens.access_token}`,
    "OpenAI-Beta": "codex-1",
    originator: "Codex Desktop",
    Accept: "application/json",
  };

  const accountId = auth?.tokens?.account_id;
  if (accountId) {
    result["ChatGPT-Account-ID"] = String(accountId);
  }

  return result;
}

async function getJson(url, auth) {
  const response = await fetch(url, {
    method: "GET",
    headers: headers(auth),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body ? `: ${body.slice(0, 300)}` : "";
    throw new Error(`${url} returned HTTP ${response.status}${detail}`);
  }

  return response.json();
}

function parseIso(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(date) {
  if (!date) {
    return "n/a";
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function formatLeft(date) {
  if (!date) {
    return "n/a";
  }

  const ms = date.getTime() - Date.now();
  if (ms <= 0) {
    return "expired";
  }

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h left`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m left`;
  }
  return `${minutes}m left`;
}

function bar(percent, width = 24) {
  if (percent === null || percent === undefined || Number.isNaN(percent)) {
    return `[${"-".repeat(width)}]`;
  }
  const clamped = Math.max(0, Math.min(100, Number(percent)));
  const filled = Math.round((width * clamped) / 100);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function normalizeWindow(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const usedPercent = value.used_percent ?? value.usedPercent;
  const windowSeconds = value.limit_window_seconds ?? value.window_seconds;
  let resetsAt = value.reset_at ?? value.resetsAt ?? value.resets_at;
  const resetAfterSeconds = value.reset_after_seconds;

  if (resetsAt === undefined && resetAfterSeconds !== undefined) {
    resetsAt = Math.floor(Date.now() / 1000) + Number(resetAfterSeconds);
  }

  if (usedPercent === undefined && windowSeconds === undefined && resetsAt === undefined) {
    return null;
  }

  return {
    usedPercent: usedPercent === undefined ? null : Number(usedPercent),
    windowSeconds: windowSeconds === undefined ? null : Number(windowSeconds),
    resetsAt: resetsAt === undefined ? null : Number(resetsAt),
  };
}

function parseUsage(data) {
  const rateLimit = data.rate_limit ?? data.rateLimits ?? {};
  return {
    primary: normalizeWindow(rateLimit.primary_window ?? rateLimit.primary),
    secondary: normalizeWindow(rateLimit.secondary_window ?? rateLimit.secondary),
  };
}

function renderCredits(data) {
  const credits = Array.isArray(data.credits) ? data.credits : [];
  const available = Number.parseInt(data.available_count ?? 0, 10);

  console.log("Codex banked reset credits");
  console.log(`Available: ${Number.isNaN(available) ? 0 : available}`);

  if (credits.length === 0) {
    console.log("No credit details returned.");
    return;
  }

  const sortedCredits = [...credits].sort((a, b) => {
    const aExpiry = parseIso(a.expires_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bExpiry = parseIso(b.expires_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aExpiry - bExpiry;
  });

  const nextExpiry = parseIso(sortedCredits[0].expires_at);
  console.log(`Next expiry: ${formatDateTime(nextExpiry)} (${formatLeft(nextExpiry)})`);
  console.log("");

  sortedCredits.forEach((credit, index) => {
    const granted = parseIso(credit.granted_at);
    const expires = parseIso(credit.expires_at);
    console.log(`${index + 1}. ${credit.status ?? "unknown"}`);
    console.log(`   granted: ${formatDateTime(granted)}`);
    console.log(`   expires: ${formatDateTime(expires)} (${formatLeft(expires)})`);
  });
}

function renderUsage(data) {
  const { primary, secondary } = parseUsage(data);
  console.log("");
  console.log("Codex usage");

  for (const [label, window] of [
    ["5-hour", primary],
    ["7-day", secondary],
  ]) {
    if (!window) {
      continue;
    }

    const used = window.usedPercent;
    const remaining = used === null ? "n/a" : `${Math.max(0, Math.round(100 - used))}% left`;
    const resetsDate = window.resetsAt === null ? null : new Date(window.resetsAt * 1000);
    console.log(`${label.padEnd(7)} ${bar(used)} ${remaining}; resets ${formatLeft(resetsDate)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  assertAsciiUrls();
  const authPath = expandPath(args.authPath);
  const auth = await loadAuth(authPath);
  const credits = await getJson(CREDITS_URL, auth);
  const usage = args.noUsage ? null : await getJson(USAGE_URL, auth);

  if (args.raw) {
    console.log(JSON.stringify({ credits, usage }, null, 2));
    return;
  }

  renderCredits(credits);
  if (usage) {
    renderUsage(usage);
  }
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});
