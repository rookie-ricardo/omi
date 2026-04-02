/**
 * Permission Policy Engine - Persistence and Change Audit
 *
 * Persists rule bundles to JSON and emits structured change audit records
 * when rules are added, updated, or deleted.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { nowIso, createId } from "@omi/core";

import type { PermissionRule, PermissionRuleSource } from "./rules";

export interface PermissionRuleBundle {
  sessionRules: PermissionRule[];
  projectRules: PermissionRule[];
  userRules: PermissionRule[];
  managedRules: PermissionRule[];
  defaultRules: PermissionRule[];
}

export interface PermissionRuleChangeAuditEntry {
  id: string;
  action: "added" | "updated" | "deleted";
  source: PermissionRuleSource;
  ruleId: string;
  actor: string;
  timestamp: string;
  filePath: string;
}

export interface SavePermissionRuleBundleOptions {
  actor?: string;
}

const EMPTY_BUNDLE: PermissionRuleBundle = {
  sessionRules: [],
  projectRules: [],
  userRules: [],
  managedRules: [],
  defaultRules: [],
};

/**
 * Load a permission rule bundle from disk.
 * Missing files are treated as empty bundles.
 */
export function loadPermissionRuleBundle(filePath: string): PermissionRuleBundle {
  if (!existsSync(filePath)) {
    return cloneBundle(EMPTY_BUNDLE);
  }

  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<PermissionRuleBundle>;
  return normalizeBundle(parsed);
}

/**
 * Save a permission rule bundle to disk and return the resulting audit entries.
 */
export function savePermissionRuleBundle(
  filePath: string,
  bundle: PermissionRuleBundle,
  options: SavePermissionRuleBundleOptions = {},
): PermissionRuleChangeAuditEntry[] {
  const previous = loadPermissionRuleBundle(filePath);
  const normalized = normalizeBundle(bundle);
  const actor = options.actor ?? "system";
  const auditEntries = diffPermissionRuleBundles(previous, normalized, filePath, actor);

  writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf-8");
  return auditEntries;
}

/**
 * Compute an audit trail for changes between two bundles.
 */
export function diffPermissionRuleBundles(
  previous: PermissionRuleBundle,
  next: PermissionRuleBundle,
  filePath: string,
  actor = "system",
): PermissionRuleChangeAuditEntry[] {
  const previousRules = indexRules(previous);
  const nextRules = indexRules(next);
  const entries: PermissionRuleChangeAuditEntry[] = [];

  for (const [key, rule] of nextRules.entries()) {
    const existing = previousRules.get(key);
    if (!existing) {
      entries.push(createAuditEntry("added", rule, filePath, actor));
      continue;
    }

    if (JSON.stringify(existing) !== JSON.stringify(rule)) {
      entries.push(createAuditEntry("updated", rule, filePath, actor));
    }
  }

  for (const [key, rule] of previousRules.entries()) {
    if (!nextRules.has(key)) {
      entries.push(createAuditEntry("deleted", rule, filePath, actor));
    }
  }

  return entries;
}

function normalizeBundle(bundle: Partial<PermissionRuleBundle>): PermissionRuleBundle {
  return {
    sessionRules: cloneRules(bundle.sessionRules),
    projectRules: cloneRules(bundle.projectRules),
    userRules: cloneRules(bundle.userRules),
    managedRules: cloneRules(bundle.managedRules),
    defaultRules: cloneRules(bundle.defaultRules),
  };
}

function cloneBundle(bundle: PermissionRuleBundle): PermissionRuleBundle {
  return normalizeBundle(bundle);
}

function cloneRules(rules: PermissionRule[] | undefined): PermissionRule[] {
  return (rules ?? []).map((rule) => ({ ...rule }));
}

function indexRules(bundle: PermissionRuleBundle): Map<string, PermissionRule> {
  const map = new Map<string, PermissionRule>();
  for (const rule of [...bundle.sessionRules, ...bundle.projectRules, ...bundle.userRules, ...bundle.managedRules, ...bundle.defaultRules]) {
    map.set(`${rule.source}:${rule.id}`, rule);
  }
  return map;
}

function createAuditEntry(
  action: PermissionRuleChangeAuditEntry["action"],
  rule: PermissionRule,
  filePath: string,
  actor: string,
): PermissionRuleChangeAuditEntry {
  return {
    id: createId("perm_audit"),
    action,
    source: rule.source,
    ruleId: rule.id,
    actor,
    timestamp: nowIso(),
    filePath,
  };
}
