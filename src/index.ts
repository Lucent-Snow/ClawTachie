#!/usr/bin/env node
// ClawTachie — Terminal prototype

import readline from "node:readline";
import { GatewayClient } from "./gateway-client.js";
import { ChatManager } from "./chat.js";

const GATEWAY_URL = process.env["OPENCLAW_GATEWAY_URL"] ?? "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env["OPENCLAW_GATEWAY_TOKEN"];
const SESSION_KEY = process.env["CLAWTACHIE_SESSION"] ?? "agent:clawtachie:main";

if (!GATEWAY_TOKEN) {
  console.error("Error: OPENCLAW_GATEWAY_TOKEN is required");
  process.exit(1);
}

console.log(`🐾 ClawTachie Terminal v0.1.0`);
console.log(`   Gateway: ${GATEWAY_URL}`);
console.log(`   Session: ${SESSION_KEY}`);
console.log(`   Connecting...`);

let responding = false;

const client = new GatewayClient({
  url: GATEWAY_URL,
  token: GATEWAY_TOKEN,
  sessionKey: SESSION_KEY,
  onChatEvent: (payload) => chat.handleChatEvent(payload),
  onAgentRunEnd: () => {
    if (responding) {
      chat.finishCurrentRun();
    }
  },
  onConnected: (hello) => {
    console.log(`\n✅ Connected (protocol ${hello.protocol})`);
    console.log(`   Commands: /history, /status, /quit\n`);
    showPrompt();
  },
  onDisconnected: (code, reason) => {
    console.log(`\n❌ Disconnected: ${code} ${reason}`);
    process.exit(0);
  },
  onError: (err) => {
    process.stderr.write(`\n⚠️  ${err.message}\n`);
  },
});

const chat = new ChatManager(
  client,
  SESSION_KEY,
  // onDelta
  (text) => {
    if (!responding) {
      responding = true;
      // Clear current line and start response
      process.stdout.write("\r\x1b[K🤖 ");
    }
    process.stdout.write(text);
  },
  // onFinal
  (text, emotions) => {
    if (!responding) {
      process.stdout.write("\r\x1b[K🤖 ");
      process.stdout.write(text);
    }
    if (emotions.length > 0) {
      process.stdout.write(` [${emotions.join(", ")}]`);
    }
    process.stdout.write("\n\n");
    responding = false;
    showPrompt();
  },
  // onError
  (msg) => {
    process.stdout.write(`\r\x1b[K❌ Error: ${msg}\n\n`);
    responding = false;
    showPrompt();
  },
);

// Use raw stdin/stdout instead of readline to avoid prompt interference
function showPrompt() {
  process.stdout.write("you> ");
}

let inputBuffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  // Handle each character
  for (const ch of chunk) {
    if (ch === "\n" || ch === "\r") {
      process.stdout.write("\n");
      handleInput(inputBuffer.trim());
      inputBuffer = "";
    } else if (ch === "\x7f" || ch === "\b") {
      // Backspace
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        process.stdout.write("\b \b");
      }
    } else if (ch === "\x03") {
      // Ctrl+C
      console.log("\nBye! 👋");
      client.disconnect();
      process.exit(0);
    } else {
      inputBuffer += ch;
      process.stdout.write(ch);
    }
  }
});

async function handleInput(input: string) {
  if (!input) { showPrompt(); return; }

  if (input === "/quit" || input === "/exit") {
    console.log("Bye! 👋");
    client.disconnect();
    process.exit(0);
  }

  if (input === "/status") {
    console.log(`  Connected: ${client.isConnected()}`);
    console.log(`  Gateway: ${GATEWAY_URL}`);
    console.log(`  Session: ${SESSION_KEY}\n`);
    showPrompt();
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
    showPrompt();
    return;
  }

  try {
    await chat.send(input);
    // Response will come via events
  } catch (err) {
    console.error(`\n❌ Send failed: ${err}\n`);
    showPrompt();
  }
}

// Enable raw mode for character-by-character input
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

client.connect();
