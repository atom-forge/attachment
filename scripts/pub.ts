#!/usr/bin/env node
import { execSync } from "child_process";

const bump = process.argv[2] ?? "patch";
const semverRe = /^\d+\.\d+\.\d+$/;
if (!["patch", "minor", "major"].includes(bump) && !semverRe.test(bump)) {
  console.error(`❌ Invalid bump: ${bump}. Use patch, minor, major, or an explicit version like 1.2.3.`);
  process.exit(1);
}

const version = execSync(`npm version ${bump} --no-git-tag-version`, { encoding: "utf-8" }).trim();
console.log(`📦 Bumped to ${version}`);

execSync(`git add package.json`);
execSync(`git commit -m "release ${version}"`);
execSync(`git tag ${version}`);
execSync(`git push && git push --tags`);
console.log(`🚀 Tagged and pushed ${version}`);

