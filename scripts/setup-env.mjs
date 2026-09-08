#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

// Generate local secrets only. Provider-issued credentials must come from
// the account owner; never invent credentials or overwrite an existing file.
const target = resolve(process.argv[2] || '.env');
let template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
template = template.replace(/^([A-Z][A-Z0-9_]*)="[^"]*"/gm, (line, name) => {
  if (name === 'RAZORPAY_MOCK_SECRET' || name === 'RAZORPAY_WEBHOOK_SECRET') {
    return `${name}="${randomBytes(32).toString('hex')}"`;
  }
  return line;
});
try {
  writeFileSync(target, template, { flag: 'wx', mode: 0o600 });
  console.log(`Created ${target}. No secret values were printed.`);
  console.log('Setup is NOT complete: fill account credentials using ENV_SETUP.md.');
  console.log('Register the generated webhook secret in Razorpay before using webhooks.');
} catch (error) {
  if (error.code === 'EEXIST') {
    console.error('File already exists; nothing was changed. Choose a new output path.');
    process.exitCode = 1;
  } else {
    throw error;
  }
}
