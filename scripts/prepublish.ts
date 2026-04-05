import {readFileSync, writeFileSync} from "fs";
import {execSync} from "child_process";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = resolve(root, "package.json");
const changelogPath = resolve(root, "CHANGELOG.md");

// --- npm auth check ---

try {
	execSync("npm whoami", {stdio: "pipe"});
} catch {
	console.error("error: not logged in to npm. run `npm login` first.");
	process.exit(1);
}

// --- version resolution ---

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const currentVersion: string = pkg.version;

let publishedVersion: string | null = null;
try {
	publishedVersion = execSync(`npm view ${pkg.name} version 2>/dev/null`, {encoding: "utf8"}).trim();
} catch {
	// not yet published
}

let newVersion: string;
if (!publishedVersion || currentVersion === publishedVersion) {
	const [major, minor, patch] = currentVersion.split(".").map(Number);
	newVersion = `${major}.${minor}.${patch + 1}`;
	console.log(`version bump: ${currentVersion} → ${newVersion}`);
} else {
	newVersion = currentVersion;
	console.log(`version already bumped to ${newVersion} (published: ${publishedVersion})`);
}

// --- update package.json ---

pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t") + "\n");

// --- update CHANGELOG.md ---

const today = new Date().toISOString().slice(0, 10);
let changelog = readFileSync(changelogPath, "utf8");
const hasUnreleased = /^## \[Unreleased\]/m.test(changelog);

if (hasUnreleased) {
	changelog = changelog.replace(/^## \[Unreleased\]/m, `## [${newVersion}] - ${today}`);
	writeFileSync(changelogPath, changelog);
	console.log(`changelog: [Unreleased] → [${newVersion}] - ${today}`);
} else {
	console.log("changelog: no [Unreleased] section found, skipping");
}

// --- git commit + tag ---

const isGitRepo = (() => {
	try {
		execSync("git rev-parse --is-inside-work-tree", {stdio: "pipe"});
		return true;
	} catch {
		return false;
	}
})();

if (isGitRepo) {
	const hasStageable = execSync("git status --porcelain", {encoding: "utf8"}).trim().length > 0;

	if (hasStageable) {
		execSync(`git add -A`, {stdio: "inherit"});
		execSync(`git commit -m "chore: release v${newVersion}"`, {stdio: "inherit"});
		console.log(`committed: release v${newVersion}`);
	} else {
		console.log("nothing to commit, skipping");
	}

	const tagExists = (() => {
		try {
			execSync(`git rev-parse v${newVersion}`, {stdio: "pipe"});
			return true;
		} catch {
			return false;
		}
	})();

	if (!tagExists) {
		execSync(`git tag v${newVersion}`, {stdio: "inherit"});
		console.log(`tagged: v${newVersion}`);
	} else {
		console.log(`tag v${newVersion} already exists, skipping`);
	}
} else {
	console.log("not a git repository, skipping git commit + tag");
}