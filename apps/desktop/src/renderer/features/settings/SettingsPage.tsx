import { Button, cn } from "@/ui";
import { ChevronLeft, Eye, EyeOff, Plus } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { ProviderConfig } from "@omi/core";
import type { ModelListResult } from "@omi/protocol";

import {
  buildProviderTypeOptions,
  createProviderDraft,
  createProviderDraftFromConfig,
  formatProviderConfigLabel,
  providerLabel,
  type ProviderDraft,
} from "../app/model-governance";

export function SettingsPage(props: {
  modelList: ModelListResult | undefined;
  loading: boolean;
  saving: boolean;
  onBack: () => void;
  onSaveProvider: (draft: ProviderDraft) => Promise<ProviderConfig>;
}) {
  const providerConfigs = props.modelList?.providerConfigs ?? [];
  const providerTypeOptions = useMemo(
    () => buildProviderTypeOptions(props.modelList),
    [props.modelList],
  );
  const [newProviderType, setNewProviderType] = useState<string>(
    providerTypeOptions[0]?.value ?? "openai",
  );
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(providerConfigs.length === 0);
  const [draft, setDraft] = useState<ProviderDraft>(() =>
    createProviderDraft(providerTypeOptions[0]?.value ?? "openai", props.modelList),
  );
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    setNewProviderType((current) =>
      providerTypeOptions.some((option) => option.value === current)
        ? current
        : (providerTypeOptions[0]?.value ?? "openai"),
    );
  }, [providerTypeOptions]);

  useEffect(() => {
    if (providerConfigs.length === 0) {
      setIsCreating(true);
      setSelectedProviderId(null);
      setDraft(createProviderDraft(providerTypeOptions[0]?.value ?? "openai", props.modelList));
      return;
    }

    if (isCreating) {
      setSelectedProviderId(null);
      return;
    }

    if (selectedProviderId) {
      const current = providerConfigs.find((providerConfig) => providerConfig.id === selectedProviderId);
      if (current) {
        setDraft(createProviderDraftFromConfig(current));
        return;
      }
    }

    if (providerConfigs[0]) {
      setSelectedProviderId(providerConfigs[0].id);
      setDraft(createProviderDraftFromConfig(providerConfigs[0]));
      return;
    }

    setSelectedProviderId(null);
    setDraft(createProviderDraft(providerTypeOptions[0]?.value ?? "openai", props.modelList));
  }, [isCreating, props.modelList, providerConfigs, providerTypeOptions, selectedProviderId]);

  const selectedProvider =
    selectedProviderId
      ? providerConfigs.find((providerConfig) => providerConfig.id === selectedProviderId) ?? null
      : null;

  function beginCreate(providerType = newProviderType) {
    setIsCreating(true);
    setSelectedProviderId(null);
    setDraft(createProviderDraft(providerType, props.modelList));
    setShowApiKey(true);
  }

  function selectProvider(providerConfig: ProviderConfig) {
    setIsCreating(false);
    setSelectedProviderId(providerConfig.id);
    setDraft(createProviderDraftFromConfig(providerConfig));
    setShowApiKey(false);
  }

  function handleProviderTypeChange(providerType: string) {
    const nextDraft = createProviderDraft(providerType, props.modelList);
    setDraft((current) => ({
      ...current,
      type: providerType,
      baseUrl: nextDraft.baseUrl,
      model: nextDraft.model,
    }));
  }

  async function saveCurrentDraft() {
    const saved = await props.onSaveProvider(draft);
    setIsCreating(false);
    setSelectedProviderId(saved.id);
    setDraft(createProviderDraftFromConfig(saved));
    setShowApiKey(false);
  }

  return (
    <div className="flex h-full min-h-0 gap-6">
      <aside className="flex w-[280px] shrink-0 flex-col rounded-[30px] border border-foreground/8 bg-foreground/[0.03] p-4 shadow-[0_16px_40px_color-mix(in_oklab,var(--foreground)_5%,transparent)]">
        <button
          type="button"
          onClick={props.onBack}
          className="inline-flex items-center gap-2 rounded-full px-2 py-1.5 text-sm text-foreground/56 transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          返回应用
        </button>

        <div className="mt-8">
          <div className="text-xs font-medium uppercase tracking-[0.24em] text-foreground/34">
            模型配置
          </div>
          <div className="mt-2 text-sm leading-6 text-foreground/54">
            应用内设置是唯一事实来源，命令行环境变量不会覆盖这里的 provider 配置。
          </div>
        </div>

        <div className="mt-6 rounded-[24px] border border-foreground/8 bg-background/78 p-3">
          <div className="text-xs font-medium text-foreground/46">新增提供商</div>
          <div className="mt-3 grid gap-3">
            <select
              value={newProviderType}
              onChange={(event) => setNewProviderType(event.target.value)}
              className="h-11 rounded-2xl border border-foreground/10 bg-background px-3 text-sm outline-none transition-colors focus:border-foreground/20"
            >
              {providerTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              onClick={() => beginCreate()}
              className="h-11 rounded-2xl"
            >
              <Plus className="mr-2 size-4" />
              新建配置
            </Button>
          </div>
        </div>

        <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-2">
            {providerConfigs.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-foreground/12 px-4 py-5 text-sm leading-6 text-foreground/46">
                还没有已配置模型。先选择一个提供商并保存你的第一条配置。
              </div>
            ) : (
              providerConfigs.map((providerConfig) => (
                <button
                  key={providerConfig.id}
                  type="button"
                  onClick={() => selectProvider(providerConfig)}
                  className={cn(
                    "rounded-[24px] border px-4 py-3 text-left transition-colors",
                    selectedProviderId === providerConfig.id
                      ? "border-foreground/16 bg-foreground/7"
                      : "border-foreground/8 bg-background/72 hover:bg-foreground/4",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {formatProviderConfigLabel(providerConfig)}
                    </div>
                    <div className="mt-1 truncate text-xs text-foreground/46">
                      {providerLabel(providerConfig.type)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto pr-2">
        <div className="mx-auto max-w-4xl pb-10">
          <div className="pt-10">
            <div className="text-4xl font-semibold tracking-[-0.045em]">
              {selectedProvider ? "编辑模型配置" : "新建模型配置"}
            </div>
            <div className="mt-3 max-w-2xl text-sm leading-7 text-foreground/52">
              配置不同 provider 或兼容协议的模型入口。保存后，线程里会默认展示这些已配置模型，并允许按 session 切换。
            </div>
          </div>

          <div className="mt-8 overflow-hidden rounded-[30px] border border-foreground/8 bg-background/86 shadow-[0_24px_60px_color-mix(in_oklab,var(--foreground)_6%,transparent)]">
            <SettingsRow
              title="提供商类型"
              description="选择内建 provider 或兼容协议类型。切换类型时会重置推荐的 Base URL 和默认模型。"
            >
              <select
                value={draft.type}
                onChange={(event) => handleProviderTypeChange(event.target.value)}
                className="h-11 min-w-[240px] rounded-2xl border border-foreground/10 bg-background px-3 text-sm outline-none transition-colors focus:border-foreground/20"
              >
                {providerTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingsRow>

            <SettingsRow
              title="Base URL"
              description="内建 provider 可以保留默认地址；兼容协议 provider 则填写你的自定义接口地址。"
            >
              <input
                value={draft.baseUrl}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, baseUrl: event.target.value }))
                }
                placeholder="https://api.openai.com/v1"
                className="h-11 min-w-[320px] rounded-2xl border border-foreground/10 bg-background px-3 text-sm outline-none transition-colors focus:border-foreground/20"
              />
            </SettingsRow>

            <SettingsRow
              title="模型 ID"
              description="这里使用 provider 实际识别的模型名。session 下拉里会直接展示这条配置。"
            >
              <input
                value={draft.model}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, model: event.target.value }))
                }
                placeholder="gpt-5.4"
                className="h-11 min-w-[320px] rounded-2xl border border-foreground/10 bg-background px-3 text-sm outline-none transition-colors focus:border-foreground/20"
              />
            </SettingsRow>

            <SettingsRow
              title="API Key"
              description="密钥会明文保存在应用数据库里，但默认以黑点形式隐藏展示。"
            >
              <div className="flex items-center gap-3">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={draft.apiKey}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, apiKey: event.target.value }))
                  }
                  placeholder="sk-..."
                  className="h-11 min-w-[320px] rounded-2xl border border-foreground/10 bg-background px-3 text-sm outline-none transition-colors focus:border-foreground/20"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((current) => !current)}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl border border-foreground/10 px-3 text-sm text-foreground/62 transition-colors hover:bg-foreground/4 hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  {showApiKey ? "隐藏" : "显示"}
                </button>
              </div>
            </SettingsRow>

          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="text-sm text-foreground/48">
              {selectedProvider
                ? `当前标签预览：${formatProviderConfigLabel({
                    ...selectedProvider,
                    name: providerLabel(draft.type),
                    model: draft.model,
                  })}`
                : `保存后会显示为：${providerLabel(draft.type)} · ${draft.model || "未填写模型"}`}
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={() => void saveCurrentDraft()}
                disabled={
                  props.saving ||
                  !draft.type.trim() ||
                  !draft.model.trim() ||
                  !draft.apiKey.trim()
                }
                className="rounded-full px-5"
              >
                {props.saving ? "保存中..." : "保存配置"}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingsRow(props: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-foreground/8 px-6 py-5 last:border-b-0">
      <div className="max-w-xl">
        <div className="text-sm font-medium">{props.title}</div>
        <div className="mt-1 text-sm leading-6 text-foreground/50">{props.description}</div>
      </div>
      <div className="shrink-0">{props.children}</div>
    </div>
  );
}
