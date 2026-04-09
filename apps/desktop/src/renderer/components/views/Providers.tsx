import { useEffect, useRef, useState } from "react";
import { ChevronDown, Edit, Plus, Trash2, X } from "lucide-react";

import type { ProviderConfig } from "@omi/core";

import { formatProviderConfigLabel, useWorkspaceStore } from "../../store/workspace-store";

type ProtocolType = "anthropic-messages" | "openai-chat" | "openai-responses";

interface ProviderOption {
  type: string;
  label: string;
  baseUrl: string;
  defaultProtocol: ProtocolType;
  models: string[];
}

const PROVIDERS: ProviderOption[] = [
  {
    type: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultProtocol: "anthropic-messages",
    models: [
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-sonnet-4-5-20250514",
      "claude-haiku-4-5-20250301",
    ],
  },
  {
    type: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultProtocol: "openai-chat",
    models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o4-mini"],
  },
  {
    type: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultProtocol: "openai-chat",
    models: [
      "anthropic/claude-sonnet-4",
      "openai/gpt-4.1",
      "google/gemini-2.5-pro",
      "deepseek/deepseek-chat-v3-0324",
    ],
  },
  {
    type: "google",
    label: "Google (Gemini)",
    baseUrl: "https://generativelanguage.googleapis.com",
    defaultProtocol: "openai-chat",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
  },
  {
    type: "bedrock",
    label: "Amazon Bedrock",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    defaultProtocol: "anthropic-messages",
    models: [
      "anthropic.claude-sonnet-4-20250514-v1:0",
      "anthropic.claude-haiku-4-5-20250301-v1:0",
    ],
  },
  {
    type: "azure",
    label: "Azure OpenAI",
    baseUrl: "https://{resource}.openai.azure.com",
    defaultProtocol: "openai-chat",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1"],
  },
  {
    type: "mistral",
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai",
    defaultProtocol: "openai-chat",
    models: ["mistral-large-latest", "mistral-medium-latest", "codestral-latest"],
  },
  {
    type: "xai",
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai",
    defaultProtocol: "openai-chat",
    models: ["grok-3", "grok-3-mini"],
  },
  {
    type: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultProtocol: "openai-chat",
    models: ["llama-3.3-70b-versatile", "llama-4-maverick-17b-128e"],
  },
  {
    type: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    defaultProtocol: "openai-chat",
    models: ["llama-3.3-70b", "llama-4-scout-17b-16e"],
  },
  {
    type: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultProtocol: "openai-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    type: "openai-compatible",
    label: "OpenAI Compatible",
    baseUrl: "",
    defaultProtocol: "openai-chat",
    models: [],
  },
  {
    type: "anthropic-compatible",
    label: "Anthropic Compatible",
    baseUrl: "",
    defaultProtocol: "anthropic-messages",
    models: [],
  },
];

const PROTOCOLS: { value: ProtocolType; label: string }[] = [
  { value: "anthropic-messages", label: "Anthropic Messages API" },
  { value: "openai-chat", label: "OpenAI Chat Completions API" },
  { value: "openai-responses", label: "OpenAI Responses API" },
];

interface FormState {
  id?: string;
  type: string;
  protocol: ProtocolType;
  baseUrl: string;
  model: string;
  apiKey: string;
}

function emptyForm(): FormState {
  const first = PROVIDERS[0];
  return {
    type: first.type,
    protocol: first.defaultProtocol,
    baseUrl: first.baseUrl,
    model: first.models[0] ?? "",
    apiKey: "",
  };
}

export default function Providers() {
  const modelCatalog = useWorkspaceStore((state) => state.modelCatalog);
  const saveProviderConfig = useWorkspaceStore((state) => state.saveProviderConfig);
  const deleteProviderConfig = useWorkspaceStore((state) => state.deleteProviderConfig);

  const providerConfigs = modelCatalog?.providerConfigs ?? [];

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  function openAddForm() {
    setForm(emptyForm());
    setShowForm(true);
  }

  function openEditForm(config: ProviderConfig) {
    setForm({
      id: config.id,
      type: config.type,
      protocol: (config.protocol as ProtocolType) ?? "openai-chat",
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: "",
    });
    setShowForm(true);
  }

  function handleProviderChange(type: string) {
    const provider = PROVIDERS.find((p) => p.type === type);
    if (!provider) return;
    setForm((prev) => ({
      ...prev,
      type,
      protocol: provider.defaultProtocol,
      baseUrl: provider.baseUrl,
      model: provider.models[0] ?? prev.model,
    }));
  }

  async function handleSave() {
    if (!form.model || (!form.id && !form.apiKey)) return;
    setSaving(true);
    await saveProviderConfig({
      id: form.id,
      type: form.type,
      protocol: form.protocol,
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: form.apiKey || undefined!,
    });
    setSaving(false);
    setShowForm(false);
  }

  async function handleDelete(id: string) {
    await deleteProviderConfig(id);
  }

  const selectedProvider = PROVIDERS.find((p) => p.type === form.type);
  const availableModels = selectedProvider?.models ?? [];

  return (
    <div className="flex-1 overflow-y-auto h-full">
      <div className="p-10">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold mb-2">模型提供商</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-8">
            管理你的 AI 模型提供商配置。添加 API Key 后即可在对话中使用对应模型。
          </p>

          <div className="space-y-8">
            {/* Add button */}
            <button
              onClick={openAddForm}
              className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus size={16} />
              添加提供商
            </button>

            {/* Form */}
            {showForm ? (
              <div className="bg-white dark:bg-[#252525] border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm transition-colors">
                <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-white/10">
                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                    {form.id ? "编辑提供商" : "添加新提供商"}
                  </div>
                  <button
                    onClick={() => setShowForm(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  {/* Provider type */}
                  <FormField label="提供商">
                    <FormSelect
                      value={form.type}
                      onChange={handleProviderChange}
                      options={PROVIDERS.map((p) => ({ value: p.type, label: p.label }))}
                    />
                  </FormField>

                  {/* Model */}
                  <FormField label="模型">
                    {availableModels.length > 0 ? (
                      <FormSelect
                        value={form.model}
                        onChange={(v) => setForm((prev) => ({ ...prev, model: v }))}
                        options={availableModels.map((m) => ({ value: m, label: m }))}
                      />
                    ) : (
                      <input
                        type="text"
                        value={form.model}
                        onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
                        placeholder="输入模型 ID"
                        className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors"
                      />
                    )}
                  </FormField>

                  {/* Protocol */}
                  <FormField label="协议">
                    <FormSelect
                      value={form.protocol}
                      onChange={(v) => setForm((prev) => ({ ...prev, protocol: v as ProtocolType }))}
                      options={PROTOCOLS.map((p) => ({ value: p.value, label: p.label }))}
                    />
                  </FormField>

                  {/* Base URL */}
                  <FormField label="Base URL">
                    <input
                      type="text"
                      value={form.baseUrl}
                      onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                      placeholder="https://api.example.com"
                      className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors"
                    />
                  </FormField>

                  {/* API Key */}
                  <FormField label="API Key">
                    <input
                      type="password"
                      value={form.apiKey}
                      onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                      placeholder={form.id ? "留空则不修改" : "输入 API Key"}
                      className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors"
                    />
                  </FormField>

                  {/* Save button */}
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={() => setShowForm(false)}
                      className="px-4 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => void handleSave()}
                      disabled={saving || !form.model || (!form.id && !form.apiKey)}
                      className="px-4 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? "保存中..." : "保存"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Provider list */}
            {providerConfigs.length > 0 ? (
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                  已配置的提供商
                </h2>
                <div className="bg-white dark:bg-[#252525] border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm transition-colors">
                  {providerConfigs.map((config, index) => (
                    <div
                      key={config.id}
                      className={`flex items-center justify-between p-4 ${
                        index < providerConfigs.length - 1
                          ? "border-b border-gray-100 dark:border-white/10"
                          : ""
                      }`}
                    >
                      <div className="pr-8">
                        <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">
                          {formatProviderConfigLabel(config)}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {config.type}
                          {config.protocol ? ` · ${config.protocol}` : ""}
                          {config.baseUrl ? ` · ${config.baseUrl}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => openEditForm(config)}
                          className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                          title="编辑"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => void handleDelete(config.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors"
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : !showForm ? (
              <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/10 px-5 py-8 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  还没有配置任何模型提供商。点击上方按钮添加你的第一个提供商。
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function FormSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-left text-gray-900 dark:text-gray-100 hover:border-gray-300 dark:hover:border-white/20 transition-colors"
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown size={14} className="text-gray-400 dark:text-gray-500 flex-shrink-0 ml-2" />
      </button>

      {open ? (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg border border-gray-200 dark:border-white/10 py-1 z-50 max-h-[240px] overflow-y-auto custom-scrollbar">
          {options.map((opt) => (
            <button
              type="button"
              key={opt.value}
              className={`w-full px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-white/5 transition-colors ${
                opt.value === value
                  ? "text-blue-500 dark:text-blue-400 font-medium"
                  : "text-gray-700 dark:text-gray-200"
              }`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
