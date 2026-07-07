#!/usr/bin/env node
import { execSync } from "child_process";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));
const name = pkg.name;
const expected = pkg.version;

console.log(`Checking ${name}@${expected}...`);

try {
  const published = execSync(`npm view ${name} version`, { encoding: "utf-8" }).trim();
  if (published === expected) {
    console.log(`✅ Published: ${name}@${published}`);
  } else {
    console.log(`⏳ Latest on npm: ${published} (expected ${expected})`);
    process.exit(1);
  }
} catch {
  console.log(`❌ Package not found on npm: ${name}`);
  process.exit(1);
}

