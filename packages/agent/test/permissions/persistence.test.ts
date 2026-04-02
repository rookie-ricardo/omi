import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadPermissionRuleBundle,
  savePermissionRuleBundle,
  type PermissionRuleBundle,
} from "../../src/permissions/persistence";

const tmpDirs: string[] = [];

describe("permissions/persistence", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads a missing bundle as empty and preserves saved rules", () => {
    const dir = mkdtempSync(join(tmpdir(), "omi-permissions-"));
    tmpDirs.push(dir);
    const filePath = join(dir, "permissions.json");

    const initial = loadPermissionRuleBundle(filePath);
    expect(initial).toEqual({
      sessionRules: [],
      projectRules: [],
      userRules: [],
      managedRules: [],
      defaultRules: [],
    });

    const bundle: PermissionRuleBundle = {
      sessionRules: [
        {
          id: "session-allow",
          source: "session",
          decision: "allow",
          matchers: [{ type: "tool_name", pattern: "read" }],
          description: "Allow read for this session",
          active: true,
        },
      ],
      projectRules: [],
      userRules: [],
      managedRules: [],
      defaultRules: [],
    };

    const audit = savePermissionRuleBundle(filePath, bundle, { actor: "tester" });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("added");
    expect(audit[0]?.source).toBe("session");

    const loaded = loadPermissionRuleBundle(filePath);
    expect(loaded).toEqual(bundle);
  });

  it("emits update and delete audit entries when the bundle changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "omi-permissions-"));
    tmpDirs.push(dir);
    const filePath = join(dir, "permissions.json");

    const initial: PermissionRuleBundle = {
      sessionRules: [
        {
          id: "session-allow",
          source: "session",
          decision: "allow",
          matchers: [{ type: "tool_name", pattern: "read" }],
          description: "Allow read",
          active: true,
        },
      ],
      projectRules: [],
      userRules: [],
      managedRules: [],
      defaultRules: [],
    };

    savePermissionRuleBundle(filePath, initial);

    const next: PermissionRuleBundle = {
      sessionRules: [
        {
          id: "session-allow",
          source: "session",
          decision: "deny",
          matchers: [{ type: "tool_name", pattern: "read" }],
          description: "Block read",
          active: true,
        },
      ],
      projectRules: [
        {
          id: "project-ask",
          source: "project",
          decision: "ask",
          matchers: [{ type: "tool_name", pattern: "bash" }],
          description: "Ask before bash",
          active: true,
        },
      ],
      userRules: [],
      managedRules: [],
      defaultRules: [],
    };

    const audit = savePermissionRuleBundle(filePath, next, { actor: "tester" });
    expect(audit.map((entry) => entry.action).sort()).toEqual(["added", "updated"]);
    expect(audit.find((entry) => entry.action === "updated")?.ruleId).toBe("session-allow");
    expect(audit.find((entry) => entry.action === "added")?.ruleId).toBe("project-ask");
  });
});
