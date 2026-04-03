import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

type Suite = {
  name: string;
  cwd: string;
  testDir: string;
  note: string;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const mode = process.argv.includes("--matrix-only") ? "matrix" : "gate";

const suites: Suite[] = [
  {
    name: "agent core behaviors",
    cwd: resolve(repoRoot, "packages/agent"),
    testDir: "test",
    note: "session / recovery / permission / skill / subagent",
  },
  {
    name: "provider protocol adapters",
    cwd: resolve(repoRoot, "packages/provider"),
    testDir: "test",
    note: "mcp / protocol routing",
  },
  {
    name: "tools registry and builtins",
    cwd: resolve(repoRoot, "packages/tools"),
    testDir: "test",
    note: "tool registry / tool execution",
  },
  {
    name: "memory pipeline",
    cwd: resolve(repoRoot, "packages/memory"),
    testDir: "test",
    note: "context / compaction / recall / inject",
  },
  {
    name: "store persistence",
    cwd: resolve(repoRoot, "packages/store"),
    testDir: "test",
    note: "session history / runtime persistence",
  },
  {
    name: "protocol schemas",
    cwd: resolve(repoRoot, "packages/protocol"),
    testDir: "test",
    note: "runner protocol schema and parsing",
  },
  {
    name: "runner control plane",
    cwd: resolve(repoRoot, "apps/runner"),
    testDir: "test",
    note: "runner request handling / diagnostics",
  },
  {
    name: "core domain",
    cwd: resolve(repoRoot, "packages/core"),
    testDir: "test",
    note: "shared domain primitives",
  },
  {
    name: "extensions runtime",
    cwd: resolve(repoRoot, "packages/extensions"),
    testDir: "test",
    note: "extension loader / runner / wrapper",
  },
  {
    name: "prompt assembly",
    cwd: resolve(repoRoot, "packages/prompt"),
    testDir: "test",
    note: "system prompt assembly",
  },
  {
    name: "settings defaults",
    cwd: resolve(repoRoot, "packages/settings"),
    testDir: "test",
    note: "settings precedence and defaults",
  },
];

function listTestFiles(testRoot: string): string[] {
  const entries = readdirSync(testRoot, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(testRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function run(command: string, args: string[], cwd: string): void {
  const pretty = `${command} ${args.join(" ")}`;
  console.log(`\n> ${pretty}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const exitCode = result.status ?? 1;
    throw new Error(`Command failed with exit code ${exitCode}: ${pretty}`);
  }
}

function validateSuite(suite: Suite): void {
  const testRoot = resolve(suite.cwd, suite.testDir);
  const stats = statSync(testRoot);

  if (!stats.isDirectory()) {
    throw new Error(`Expected test directory for ${suite.name}: ${testRoot}`);
  }

  const files = listTestFiles(testRoot);
  if (files.length === 0) {
    throw new Error(`No test files found for ${suite.name} under ${testRoot}`);
  }

  console.log(`- ${suite.name} (${files.length} files) :: ${suite.note}`);
}

function main(): void {
  const targetSuites = suites.slice(0, 7);
  const failures: string[] = [];

  console.log(`WS-15 ${mode === "matrix" ? "matrix" : "gate"} starting`);
  console.log(`Repository root: ${repoRoot}`);

  console.log("\nCoverage matrix:");
  for (const suite of targetSuites) {
    try {
      validateSuite(suite);
    } catch (error) {
      failures.push(
        `${suite.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (mode === "matrix") {
    if (failures.length > 0) {
      console.error("\nWS-15 matrix validation failed:");
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log("\nWS-15 matrix validation completed.");
    return;
  }

  for (const suite of targetSuites) {
    try {
      run("pnpm", ["exec", "vitest", "run", suite.testDir], suite.cwd);
    } catch (error) {
      failures.push(
        `${suite.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log("\nRunning workspace support suites.");
  for (const suite of suites.slice(7)) {
    try {
      validateSuite(suite);
      run("pnpm", ["exec", "vitest", "run", suite.testDir], suite.cwd);
    } catch (error) {
      failures.push(
        `${suite.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log("\nRunning workspace typecheck.");
  try {
    run("pnpm", ["typecheck"], repoRoot);
  } catch (error) {
    failures.push(
      `workspace typecheck: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (failures.length > 0) {
    console.error("\nWS-15 release gate failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nWS-15 release gate completed.");
}

main();
