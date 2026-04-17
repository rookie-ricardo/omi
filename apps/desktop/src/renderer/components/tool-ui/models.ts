import type { ToolCall } from "@omi/core";

export type ToolUiKind = "terminal" | "code-diff" | "generic";

export type NormalizedToolCallStatus =
  | "running"
  | "requires_action"
  | "completed"
  | "failed"
  | "canceled";

export type RunLifecycleStatus = "started" | "running" | "completed" | "failed" | "canceled";

export type ProgressStepStatus = "pending" | "in-progress" | "completed" | "failed";

export interface RunProgressStep {
  id: string;
  label: string;
  description: string;
  status: ProgressStepStatus;
}

export interface NormalizedToolCallViewModel {
  id: string;
  runId: string;
  toolName: string;
  kind: ToolUiKind;
  status: NormalizedToolCallStatus;
  createdAt: string;
  updatedAt: string;
  approvalState: ToolCall["approvalState"];
  title: string;
  subtitle: string;
  inputPreview: string;
  outputPreview: string;
  errorText: string | null;
  command: string | null;
  cwd: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  diff: string | null;
  filePath: string | null;
  outputTruncated: boolean;
  metadata: Array<{ label: string; value: string }>;
}

export interface RunEventDisplayModel {
  runId: string;
  status: RunLifecycleStatus;
  title: string;
  summary: string;
  durationMs: number | null;
  steps: RunProgressStep[];
  toolCalls: NormalizedToolCallViewModel[];
}

export interface NormalizeToolCallOptions {
  activeToolIds: Set<string>;
  runStatus?: RunLifecycleStatus;
}

export interface BuildRunEventDisplayModelOptions {
  runId: string;
  toolCalls: ToolCall[];
  activeToolIds: Set<string>;
  activeRunId: string | null;
  assistantCreatedAt: string | null;
  runErrorMessage: string | null;
  isLatestRun: boolean;
}

interface ParsedToolOutput {
  text: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  diff: string | null;
  cwd: string | null;
  outputTruncated: boolean;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function lower(value: string): string {
  return value.toLowerCase();
}

function textFromContentItem(item: unknown): string {
  if (typeof item === "string") {
    return item;
  }

  if (typeof item === "number" || typeof item === "boolean") {
    return String(item);
  }

  const record = asRecord(item);
  if (!record) {
    return safeJsonStringify(item);
  }

  if (record.type === "text" && typeof record.text === "string") {
    return record.text;
  }

  if (typeof record.text === "string") {
    return record.text;
  }

  return safeJsonStringify(item);
}

export function extractToolOutputText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  if (typeof output === "number" || typeof output === "boolean") {
    return String(output);
  }

  if (Array.isArray(output)) {
    return output.map(textFromContentItem).join("\n").trim();
  }

  const record = asRecord(output);
  if (!record) {
    return "";
  }

  if (Array.isArray(record.content)) {
    return extractToolOutputText(record.content);
  }

  if (typeof record.stdout === "string") {
    return record.stdout;
  }

  if (typeof record.output === "string") {
    return record.output;
  }

  if (typeof record.text === "string") {
    return record.text;
  }

  if (typeof record.error === "string") {
    return record.error;
  }

  return safeJsonStringify(output);
}

export function parseToolError(error: string | null): string | null {
  if (!error) {
    return null;
  }

  try {
    const parsed = JSON.parse(error) as unknown;
    const record = asRecord(parsed);
    if (record && typeof record.error === "string") {
      return record.error;
    }
  } catch {
    // keep raw error text
  }

  return error;
}

function parseExitCode(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function maybeDiffText(raw: string): string | null {
  if (raw.includes("@@") || raw.startsWith("---") || raw.startsWith("diff --git")) {
    return raw;
  }
  return null;
}

function parseToolOutput(output: unknown): ParsedToolOutput {
  const parsed: ParsedToolOutput = {
    text: "",
    stdout: "",
    stderr: "",
    exitCode: null,
    diff: null,
    cwd: null,
    outputTruncated: false,
  };

  if (typeof output === "string") {
    parsed.text = output;
    parsed.stdout = output;
    parsed.diff = maybeDiffText(output);
    return parsed;
  }

  if (Array.isArray(output)) {
    const text = extractToolOutputText(output);
    parsed.text = text;
    parsed.stdout = text;
    parsed.diff = maybeDiffText(text);
    return parsed;
  }

  const record = asRecord(output);
  if (!record) {
    if (output !== null && output !== undefined) {
      const text = safeJsonStringify(output);
      parsed.text = text;
      parsed.stdout = text;
      parsed.diff = maybeDiffText(text);
    }
    return parsed;
  }

  const details = asRecord(record.details);

  if (typeof record.stdout === "string") {
    parsed.stdout = record.stdout;
  }

  if (typeof record.stderr === "string") {
    parsed.stderr = record.stderr;
  }

  if (typeof record.cwd === "string") {
    parsed.cwd = record.cwd;
  } else if (details && typeof details.cwd === "string") {
    parsed.cwd = details.cwd;
  }

  parsed.exitCode =
    parseExitCode(record.exitCode) ??
    parseExitCode(details?.exitCode);

  const directDiff =
    (typeof record.diff === "string" ? record.diff : null) ??
    (details && typeof details.diff === "string" ? details.diff : null);
  if (directDiff) {
    parsed.diff = directDiff;
  }

  const text = extractToolOutputText(output);
  parsed.text = text;
  if (!parsed.stdout) {
    parsed.stdout = text;
  }
  if (!parsed.diff) {
    parsed.diff = maybeDiffText(text);
  }

  parsed.outputTruncated =
    record.truncated === true ||
    details?.truncation !== undefined ||
    text.includes("Full output:");

  return parsed;
}

export function getToolUiKind(toolName: string): ToolUiKind {
  const name = lower(toolName);

  if (name.includes("bash") || name.includes("shell") || name.includes("command")) {
    return "terminal";
  }

  if (name.includes("edit") || name.includes("write")) {
    return "code-diff";
  }

  return "generic";
}

function getFilePath(input: Record<string, unknown>): string | null {
  const value = input.path ?? input.file_path ?? input.filePath;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hasOutput(toolCall: ToolCall): boolean {
  return toolCall.output !== null && toolCall.output !== undefined;
}

function resolveToolTitle(toolCall: ToolCall, kind: ToolUiKind, filePath: string | null): string {
  if (kind === "terminal") {
    return "Terminal";
  }

  if (kind === "code-diff") {
    return filePath ? `Code Diff · ${filePath}` : "Code Diff";
  }

  return toolCall.toolName;
}

function resolveToolStatus(
  toolCall: ToolCall,
  options: NormalizeToolCallOptions,
  hasError: boolean,
): NormalizedToolCallStatus {
  if (toolCall.approvalState === "pending") {
    return "requires_action";
  }

  if (options.activeToolIds.has(toolCall.id)) {
    return "running";
  }

  if (toolCall.approvalState === "rejected") {
    return "canceled";
  }

  if (hasError) {
    return "failed";
  }

  if (options.runStatus === "canceled" && !hasOutput(toolCall)) {
    return "canceled";
  }

  return "completed";
}

function buildMetadata(vm: {
  createdAt: string;
  approvalState: ToolCall["approvalState"];
  exitCode: number | null;
  status: NormalizedToolCallStatus;
  filePath: string | null;
}): Array<{ label: string; value: string }> {
  const metadata: Array<{ label: string; value: string }> = [
    {
      label: "时间",
      value: new Date(vm.createdAt).toLocaleString("zh-CN"),
    },
    {
      label: "状态",
      value: statusLabel(vm.status),
    },
    {
      label: "审批",
      value: approvalLabel(vm.approvalState),
    },
  ];

  if (vm.exitCode !== null) {
    metadata.push({ label: "退出码", value: String(vm.exitCode) });
  }

  if (vm.filePath) {
    metadata.push({ label: "文件", value: vm.filePath });
  }

  return metadata;
}

export function statusLabel(status: NormalizedToolCallStatus): string {
  switch (status) {
    case "running":
      return "运行中";
    case "requires_action":
      return "待审批";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
    default:
      return "已完成";
  }
}

export function approvalLabel(state: ToolCall["approvalState"]): string {
  switch (state) {
    case "approved":
      return "已批准";
    case "rejected":
      return "已拒绝";
    case "pending":
      return "待审批";
    default:
      return "无需审批";
  }
}

export function normalizeToolCallViewModel(
  toolCall: ToolCall,
  options: NormalizeToolCallOptions,
): NormalizedToolCallViewModel {
  const input = toolCall.input as Record<string, unknown>;
  const kind = getToolUiKind(toolCall.toolName);
  const filePath = getFilePath(input);

  const parsedOutput = parseToolOutput(toolCall.output);
  const errorText = parseToolError(toolCall.error);
  const hasError = Boolean(errorText);

  const command = typeof input.command === "string" ? input.command : null;
  const exitCodeFromText =
    parsedOutput.exitCode ??
    (errorText
      ? (() => {
          const match = errorText.match(/Command exited with code\s+(\d+)/i);
          if (!match) {
            return null;
          }
          const parsed = Number.parseInt(match[1], 10);
          return Number.isNaN(parsed) ? null : parsed;
        })()
      : null);

  const status = resolveToolStatus(toolCall, options, hasError);
  const title = resolveToolTitle(toolCall, kind, filePath);
  const outputPreview = parsedOutput.text || (errorText ?? "");

  const vm: NormalizedToolCallViewModel = {
    id: toolCall.id,
    runId: toolCall.runId,
    toolName: toolCall.toolName,
    kind,
    status,
    createdAt: toolCall.createdAt,
    updatedAt: toolCall.updatedAt,
    approvalState: toolCall.approvalState,
    title,
    subtitle: toolCall.toolName,
    inputPreview: safeJsonStringify(toolCall.input),
    outputPreview,
    errorText,
    command,
    cwd: parsedOutput.cwd,
    stdout: parsedOutput.stdout,
    stderr: parsedOutput.stderr,
    exitCode: exitCodeFromText,
    diff: parsedOutput.diff,
    filePath,
    outputTruncated: parsedOutput.outputTruncated,
    metadata: [],
  };

  vm.metadata = buildMetadata({
    createdAt: vm.createdAt,
    approvalState: vm.approvalState,
    exitCode: vm.exitCode,
    status: vm.status,
    filePath: vm.filePath,
  });

  if (vm.kind === "code-diff" && !vm.diff && typeof input.content === "string") {
    vm.diff = `+ ${input.content}`;
  }

  return vm;
}

function toTimestamp(iso: string): number {
  const timestamp = new Date(iso).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function durationFromRun(
  toolCalls: ToolCall[],
  assistantCreatedAt: string | null,
  running: boolean,
): number | null {
  if (toolCalls.length === 0) {
    return null;
  }

  const firstTimestamp = toTimestamp(toolCalls[0].createdAt);
  const lastTimestamp = toTimestamp(toolCalls[toolCalls.length - 1].updatedAt);
  const endTimestamp = assistantCreatedAt
    ? toTimestamp(assistantCreatedAt)
    : running
      ? Date.now()
      : lastTimestamp;

  if (firstTimestamp <= 0 || endTimestamp <= firstTimestamp) {
    return null;
  }

  return endTimestamp - firstTimestamp;
}

function mapToolStatusToStepStatus(status: NormalizedToolCallStatus): ProgressStepStatus {
  switch (status) {
    case "running":
    case "requires_action":
      return "in-progress";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return "completed";
  }
}

function inferRunStatus(options: {
  runId: string;
  toolCalls: ToolCall[];
  activeToolIds: Set<string>;
  activeRunId: string | null;
  runErrorMessage: string | null;
  isLatestRun: boolean;
}): RunLifecycleStatus {
  if (options.runId === options.activeRunId) {
    return options.toolCalls.length === 0 ? "started" : "running";
  }

  const hasActiveTool = options.toolCalls.some((call) => options.activeToolIds.has(call.id));
  if (hasActiveTool) {
    return "running";
  }

  if (options.isLatestRun && options.runErrorMessage) {
    return "failed";
  }

  const hasFailedTool = options.toolCalls.some((call) => parseToolError(call.error));
  if (hasFailedTool) {
    return "failed";
  }

  const hasInterruptedTool = options.toolCalls.some(
    (call) =>
      call.output === null &&
      !parseToolError(call.error) &&
      call.approvalState !== "pending",
  );
  if (options.isLatestRun && hasInterruptedTool) {
    return "canceled";
  }

  const allRejected =
    options.toolCalls.length > 0 &&
    options.toolCalls.every((call) => call.approvalState === "rejected");
  if (allRejected) {
    return "canceled";
  }

  return "completed";
}

export function buildRunEventDisplayModel(
  options: BuildRunEventDisplayModelOptions,
): RunEventDisplayModel {
  const status = inferRunStatus({
    runId: options.runId,
    toolCalls: options.toolCalls,
    activeToolIds: options.activeToolIds,
    activeRunId: options.activeRunId,
    runErrorMessage: options.runErrorMessage,
    isLatestRun: options.isLatestRun,
  });

  const normalizedTools = options.toolCalls.map((toolCall) =>
    normalizeToolCallViewModel(toolCall, {
      activeToolIds: options.activeToolIds,
      runStatus: status,
    }),
  );

  const steps: RunProgressStep[] = [
    {
      id: `${options.runId}-started`,
      label: "Run started",
      description: "初始化会话与上下文",
      status: status === "started" || status === "running" ? "in-progress" : "completed",
    },
    ...normalizedTools.map((tool) => ({
      id: `${options.runId}-${tool.id}`,
      label: tool.toolName,
      description: statusLabel(tool.status),
      status: mapToolStatusToStepStatus(tool.status),
    })),
    {
      id: `${options.runId}-finished`,
      label: "Run finished",
      description:
        status === "failed"
          ? "运行失败"
          : status === "canceled"
            ? "运行已取消"
            : status === "running" || status === "started"
              ? "等待执行完成"
              : "运行完成",
      status:
        status === "failed" || status === "canceled"
          ? "failed"
          : status === "running" || status === "started"
            ? "pending"
            : "completed",
    },
  ];

  const durationMs = durationFromRun(options.toolCalls, options.assistantCreatedAt, status === "running");

  return {
    runId: options.runId,
    status,
    title:
      status === "failed"
        ? "运行失败"
        : status === "canceled"
          ? "运行已取消"
          : status === "running" || status === "started"
            ? "运行中"
            : "运行完成",
    summary:
      status === "failed"
        ? options.runErrorMessage ?? "工具调用出现错误"
        : `${options.toolCalls.length} 个工具调用`,
    durationMs,
    steps,
    toolCalls: normalizedTools,
  };
}

export function formatDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${restSeconds}s`;
  }

  return `${restSeconds}s`;
}
