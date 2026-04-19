export enum SkillSettingSource {
  Project = "project",
  Local = "local",
  User = "user",
}

export const DEFAULT_SKILL_SETTING_SOURCES: SkillSettingSource[] = [
  SkillSettingSource.Project,
  SkillSettingSource.Local,
  SkillSettingSource.User,
];

export function isSkillSettingSource(value: unknown): value is SkillSettingSource {
  return value === SkillSettingSource.Project
    || value === SkillSettingSource.Local
    || value === SkillSettingSource.User;
}

export function normalizeSkillSettingSources(
  value: unknown,
  fallback: SkillSettingSource[] = DEFAULT_SKILL_SETTING_SOURCES,
): SkillSettingSource[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const normalized = value.filter((entry): entry is SkillSettingSource => isSkillSettingSource(entry));
  const deduped = [...new Set(normalized)];
  return deduped.length > 0 ? deduped : [...fallback];
}
