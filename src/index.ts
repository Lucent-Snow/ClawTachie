#!/usr/bin/env node
// Ciel Pet — Terminal prototype

import readline from "node:readline";
import { GatewayClient } from "./gateway-client.js";
import { ChatManager } from "./chat.js";

const GATEWAY_URL = process.env["OPENCLAW_GATEWAY_URL"] ?? "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env["OPENCLAW_GATEWAY_TOKEN"];
const SESSION_KEY = process.env["CIEL_PET_SESSION"] ?? "agent:main:ciel-pet";

if (!GATEWAY_TOKEN) {
  console.error("Error: OPENCLAW_GATEWAY_TOKEN is required");
  process.exit(1);
}

console.log(`🐾 Ciel Pet Terminal v0.1.0`);
console.log(`   Gateway: ${GATEWAY_URL}`);
console.log(`   Session: ${SESSION_KEY}`);
console.log(`   Connecting...`);

let responding = false;
let streamEndTimer: ReturnType<typeof setTimeout> | null = null;

function clearPrompt() {
  // Move to start of line, clear it
  process.stdout.write("\r\x1b[K");
}

function finishResponse() {
  if (streamEndTimer) { clearTimeout(streamEndTimer); streamEndTimer = null; }
  if (responding) {
    chat.finishCurrentRun();
  }
}

function resetStreamEndTimer() {
  if (streamEndTimer) clearTimeout(streamEndTimer);
  streamEndTimer = setTimeout(finishResponse, 2000);
}

const client = new GatewayClient({
  url: GATEWAY_URL,
  token: GATEWAY_TOKEN,
  sessionKey: SESSION_KEY,
  onChatEvent: (payload) => chat.handleChatEvent(payload),
  onAgentRunEnd: () => finishResponse(),
  onConnected: (hello) => {
    console.log(`\n✅ Connected (protocol ${hello.protocol})`);
    console.log(`   Commands: /history, /status, /quit\n`);
    rl.resume();
    rl.prompt();
  },
  onDisconnected: (code, reason) => {
    console.log(`\n❌ Disconnected: ${code} ${reason}`);
    process.exit(0);
  },
  onError: (err) => {
    console.error(`\n⚠️  ${err.message}`);
  },
});

const chat = new ChatManager(
  client,
  SESSION_KEY,
  // onDelta
  (text) => {
    if (!responding) {
      responding = true;
      // Pause readline to prevent prompt interference
      rl.pause();
      clearPrompt();
      process.stdout.write("🤖 ");
    }
    process.stdout.write(text);
    resetStreamEndTimer();
  },
  // onFinal
  (text, emotions) => {
    if (!responding) {
      clearPrompt();
      process.stdout.write("🤖 ");
      process.stdout.write(text);
    }
    if (emotions.length > 0) {
      process.stdout.write(` [${emotions.join(", ")}]`);
    }
    process.stdout.write("\n\n");
    responding = false;
    rl.resume();
    rl.prompt();
  },
  // onError
  (msg) => {
    clearPrompt();
    console.error(`❌ Error: ${msg}\n`);
    responding = false;
    rl.resume();
    rl.prompt();
  },
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "you> ",
});

rl.pause();

rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) { rl.prompt(); return; }

  if (input === "/quit" || input === "/exit") {
    console.log("Bye! 👋");
    client.disconnect();
    process.exit(0);
  }

  if (input === "/status") {
    console.log(`  Connected: ${client.isConnected()}`);
    console.log(`  Gateway: ${GATEWAY_URL}`);
    console.log(`  Session: ${SESSION_KEY}\n`);
    rl.prompt();
    return;
  }

  if (input === "/history") {
    try {
      const messages = await chat.history(10);
      console.log("\n📜 Recent history:");
      for (const msg of messages) {
        const m = msg as Record<string, unknown>;
        const role = m.role ?? "?";
        const content = typeof m.content === "string"
          ? m.content.slice(0, 120)
          : JSON.stringify(m.content)?.slice(0, 120);
        console.log(`  [${role}] ${content}`);
      }
      console.log();
    } catch (err) {
      console.error(`  Error: ${err}\n`);
    }
    rl.prompt();
    return;
  }

  try {
    await chat.send(input);
  } catch (err) {
    console.error(`\n❌ Send failed: ${err}\n`);
    rl.prompt();
  }
});

rl.on("close", () => {
  client.disconnect();
  process.exit(0);
});

client.connect();
