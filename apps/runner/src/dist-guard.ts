import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

interface StalePackageIssue {
  name: string;
  mainEntryPath: string;
  latestSrcMtimeMs: number;
  distMtimeMs: number | null;
}

const RUNTIME_PACKAGE_NAMES = new Set([
  "@omi/agent",
  "@omi/core",
  "@omi/memory",
  "@omi/prompt",
  "@omi/protocol",
  "@omi/provider",
  "@omi/settings",
  "@omi/store",
  "@omi/tools",
]);

export function assertWorkspaceDistFreshness(workspaceRoot: string): void {
  if (process.env.OMI_SKIP_DIST_GUARD === "1") {
    return;
  }

  const issues = collectStalePackageIssues(workspaceRoot);
  if (issues.length === 0) {
    return;
  }

  const rebuildFilters = issues.map((issue) => `--filter ${issue.name}`).join(" ");
  const details = issues
    .map((issue, index) => {
      const srcTime = new Date(issue.latestSrcMtimeMs).toISOString();
      const distTime = issue.distMtimeMs ? new Date(issue.distMtimeMs).toISOString() : "missing";
      const entry = relative(workspaceRoot, issue.mainEntryPath);
      return `${index + 1}. ${issue.name} (${entry})\n   src: ${srcTime}\n   dist: ${distTime}`;
    })
    .join("\n");

  throw new Error(
    [
      "Detected stale workspace dist artifacts. Runner only executes built package outputs.",
      details,
      `Rebuild now: pnpm ${rebuildFilters} build`,
      "Long-term fix: start dev via root command `pnpm dev` to keep dist in watch mode.",
    ].join("\n"),
  );
}

function collectStalePackageIssues(workspaceRoot: string): StalePackageIssue[] {
  const packagesRoot = join(workspaceRoot, "packages");
  if (!existsSync(packagesRoot)) {
    return [];
  }

  const packageDirs = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesRoot, entry.name));

  const issues: StalePackageIssue[] = [];
  for (const packageDir of packageDirs) {
    const packageJsonPath = join(packageDir, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: string;
      main?: string;
    };

    if (!packageJson.name || !RUNTIME_PACKAGE_NAMES.has(packageJson.name)) {
      continue;
    }

    if (!packageJson.main) {
      continue;
    }

    const srcDir = join(packageDir, "src");
    if (!existsSync(srcDir)) {
      continue;
    }

    const latestSrcMtimeMs = getLatestMtimeMs(srcDir);
    if (latestSrcMtimeMs === 0) {
      continue;
    }

    const mainEntryPath = resolve(packageDir, packageJson.main);
    if (!existsSync(mainEntryPath)) {
      issues.push({
        name: packageJson.name,
        mainEntryPath,
        latestSrcMtimeMs,
        distMtimeMs: null,
      });
      continue;
    }

    const distMtimeMs = statSync(mainEntryPath).mtimeMs;
    if (latestSrcMtimeMs > distMtimeMs + 1) {
      issues.push({
        name: packageJson.name,
        mainEntryPath,
        latestSrcMtimeMs,
        distMtimeMs,
      });
    }
  }

  return issues;
}

function getLatestMtimeMs(dir: string): number {
  let latest = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nestedLatest = getLatestMtimeMs(fullPath);
      if (nestedLatest > latest) {
        latest = nestedLatest;
      }
      continue;
    }
    const mtimeMs = statSync(fullPath).mtimeMs;
    if (mtimeMs > latest) {
      latest = mtimeMs;
    }
  }
  return latest;
}
