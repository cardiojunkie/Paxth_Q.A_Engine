#!/usr/bin/env node

import { promisify } from "node:util";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";

const scrypt = promisify(scryptCallback);
const N = 131072;
const r = 8;
const p = 1;

let input = "";
for await (const chunk of process.stdin) input += chunk;
const password = input.replace(/[\r\n]+$/, "");

if (password.length < 16) {
  console.error("Password must be at least 16 characters and supplied on standard input.");
  process.exit(1);
}

const salt = randomBytes(16);
const derived = await scrypt(password, salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 });
process.stdout.write(`scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${Buffer.from(derived).toString("base64")}\n`);
