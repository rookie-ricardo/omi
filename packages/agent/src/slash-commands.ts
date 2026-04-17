/**
 * Slash command registration and dispatch system.
 *
 * Provides a registry for slash commands with built-in commands support
 * and extensibility for custom commands.
 */

import type { AgentSession } from "./agent-session";
import type { AppStore } from "@omi/store";
import type { SettingsManager } from "@omi/settings";
import type { SessionManager } from "./session-manager";
import type { PromptTemplate } from "./prompt-templates";
import type { SkillDescriptor } from "@omi/core";

// ============================================================================
// Types
// ============================================================================

export type SlashCommandSource = "extension" | "prompt" | "skill";

export type SlashCommandLocation = "user" | "project" | "path";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	location?: SlashCommandLocation;
	path?: string;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
}

/**
 * Result of executing a slash command.
 */
export interface SlashCommandResult {
	success: boolean;
	output?: string;
	error?: string;
	continueInteraction?: boolean; // If true, continue prompting user
}

/**
 * Context provided to slash command handlers.
 */
export interface SlashCommandContext {
	session: AgentSession;
	database: AppStore;
	sessionManager: SessionManager;
	settingsManager?: SettingsManager;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

/**
 * Interface for a slash command.
 */
export interface SlashCommand {
	name: string;
	description: string;
	usage?: string;
	execute(args: string, context: SlashCommandContext): Promise<SlashCommandResult>;
}

/**
 * Built-in slash commands list (for backward compatibility).
 */
export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "export", description: "Export session to HTML file" },
	{ name: "share", description: "Share session as a secret GitHub gist" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "name", description: "Set session display name" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "fork", description: "Create a new fork from a previous message" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "login", description: "Login with OAuth provider" },
	{ name: "logout", description: "Logout from OAuth provider" },
	{ name: "new", description: "Start a new session" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "resume", description: "Resume a different session" },
	{ name: "reload", description: "Reload keybindings, skills, prompts, and themes" },
	{ name: "quit", description: "Quit pi" },
];

// ============================================================================
// Registry
// ============================================================================

/**
 * Registry for slash commands.
 */
export class SlashCommandRegistry {
	private commands = new Map<string, SlashCommand>();
	private promptTemplates = new Map<string, PromptTemplate>();
	private skillCommands = new Map<string, SkillDescriptor>();

	constructor() {
		this.registerBuiltinCommands();
	}

	/**
	 * Register a slash command.
	 */
	registerCommand(command: SlashCommand): void {
		this.commands.set(command.name.toLowerCase(), command);
	}

	/**
	 * Unregister a slash command.
	 */
	unregisterCommand(name: string): void {
		this.commands.delete(name.toLowerCase());
	}

	/**
	 * Check if a command exists.
	 */
	hasCommand(name: string): boolean {
		const normalizedName = name.toLowerCase();
		return (
			this.commands.has(normalizedName) ||
			this.promptTemplates.has(normalizedName) ||
			this.skillCommands.has(normalizedName)
		);
	}

	/**
	 * Get a command by name.
	 */
	getCommand(name: string): SlashCommand | undefined {
		return this.commands.get(name.toLowerCase());
	}

	/**
	 * List all registered commands.
	 */
	listCommands(): SlashCommand[] {
		return Array.from(this.commands.values()).sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * List all available commands including prompt templates and skills.
	 */
	listAllCommands(): Array<{ name: string; description: string; source: SlashCommandSource }> {
		const result: Array<{ name: string; description: string; source: SlashCommandSource }> = [];

		for (const command of this.commands.values()) {
			result.push({ name: command.name, description: command.description, source: "extension" });
		}

		for (const template of this.promptTemplates.values()) {
			result.push({ name: template.name, description: template.description, source: "prompt" });
		}

		for (const skill of this.skillCommands.values()) {
			result.push({ name: skill.name, description: skill.description || "", source: "skill" });
		}

		return result.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Register prompt templates as commands.
	 */
	registerPromptTemplates(templates: PromptTemplate[]): void {
		for (const template of templates) {
			this.promptTemplates.set(template.name.toLowerCase(), template);
		}
	}

	/**
	 * Register skills as commands.
	 */
	registerSkillCommands(skills: SkillDescriptor[], enableSkillCommands: boolean): void {
		if (!enableSkillCommands) {
			return;
		}

		for (const skill of skills) {
			// Skills are registered as /skill:name commands
			const commandName = `skill:${skill.name.toLowerCase()}`;
			this.skillCommands.set(commandName, skill);
		}
	}

	/**
	 * Execute a slash command.
	 */
	async executeCommand(
		name: string,
		args: string,
		context: SlashCommandContext,
	): Promise<SlashCommandResult> {
		const normalizedName = name.toLowerCase();

		// Check for registered command
		const command = this.commands.get(normalizedName);
		if (command) {
			return command.execute(args, context);
		}

		// Check for prompt template
		const template = this.promptTemplates.get(normalizedName);
		if (template) {
			return this.executePromptTemplate(template, args, context);
		}

		// Check for skill command
		const skill = this.skillCommands.get(normalizedName);
		if (skill) {
			return this.executeSkillCommand(skill, args, context);
		}

		// Check for skill:name pattern
		if (normalizedName.startsWith("skill:")) {
			const skillName = normalizedName.slice(6);
			const matchedSkill = Array.from(this.skillCommands.values()).find(
				(s) => s.name.toLowerCase() === skillName,
			);
			if (matchedSkill) {
				return this.executeSkillCommand(matchedSkill, args, context);
			}
		}

		return {
			success: false,
			error: `Unknown command: /${name}. Type /help for available commands.`,
		};
	}

	/**
	 * Parse a slash command string into name and arguments.
	 */
 parseCommand(input: string): { name: string; args: string } {
		const trimmed = input.trim();
		if (!trimmed.startsWith("/")) {
			return { name: "", args: "" };
		}

		const withoutSlash = trimmed.slice(1);
		const spaceIndex = withoutSlash.indexOf(" ");

		if (spaceIndex === -1) {
			return { name: withoutSlash, args: "" };
		}

		return {
			name: withoutSlash.slice(0, spaceIndex),
			args: withoutSlash.slice(spaceIndex + 1).trim(),
		};
	}

	/**
	 * Execute a command from a full input string.
	 */
	async execute(input: string, context: SlashCommandContext): Promise<SlashCommandResult> {
		const { name, args } = this.parseCommand(input);
		if (!name) {
			return {
				success: false,
				error: "Invalid command format. Commands must start with /",
			};
		}

		return this.executeCommand(name, args, context);
	}

	private executePromptTemplate(
		template: PromptTemplate,
		args: string,
		context: SlashCommandContext,
	): SlashCommandResult {
		// Substitute arguments in template
		const { substituteArgs, parseCommandArgs } = require("./prompt-templates");
		const parsedArgs = parseCommandArgs(args);
		const expanded = substituteArgs(template.content, parsedArgs);

		// Return the expanded content to be used as a prompt
		return {
			success: true,
			output: expanded,
			continueInteraction: true,
		};
	}

	private async executeSkillCommand(
		skill: SkillDescriptor,
		args: string,
		context: SlashCommandContext,
	): Promise<SlashCommandResult> {
		// Skills are executed by sending the skill prompt
		const prompt = `${skill.description || skill.name}\n\n${args}`;

		try {
			await context.session.prompt(prompt);
			return {
				success: true,
				output: `Executing skill: ${skill.name}`,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private registerBuiltinCommands(): void {
		// /model [name] - View or switch model
		this.registerCommand({
			name: "model",
			description: "View or switch the current model",
			usage: "/model [model-id]",
			execute: async (args, context) => {
				if (!args.trim()) {
					const stats = context.session.getSessionStats();
					return {
						success: true,
						output: `Session: ${stats.sessionId}\nUse /model <model-id> to switch models.`,
					};
				}

				try {
					context.session.setModel(args.trim());
					return {
						success: true,
						output: `Model set to: ${args.trim()}`,
					};
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
		});

		// /compact - Manually trigger compaction
		this.registerCommand({
			name: "compact",
			description: "Manually compact the session context",
			usage: "/compact",
			execute: async (_args, context) => {
				try {
					const result = await context.session.compactSession();
					return {
						success: true,
						output: `Compacted: ${result.summary.goal}`,
					};
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
		});

		// /fork - Fork the current session
		this.registerCommand({
			name: "fork",
			description: "Create a new fork from a previous message",
			usage: "/fork [history-entry-id]",
			execute: async (args, context) => {
				const historyEntryId = args.trim() || null;

				try {
					const result = await context.session.fork(historyEntryId || "");
					return {
						success: true,
						output: `Created fork: ${result.newSessionId}\nSelected: ${result.selectedText}`,
					};
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
		});

		// /new - Create a new session
		this.registerCommand({
			name: "new",
			description: "Start a new session",
			usage: "/new [title]",
			execute: async (args, context) => {
				const title = args.trim() || "New Session";

				try {
					const session = context.database.createSession(title);
					return {
						success: true,
						output: `Created new session: ${session.id}`,
					};
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
		});

		// /resume - Resume a different session
		this.registerCommand({
			name: "resume",
			description: "Resume a different session",
			usage: "/resume [session-id]",
			execute: async (args, context) => {
				const sessionId = args.trim();

				if (!sessionId) {
					// List available sessions
					const sessions = context.database.listSessions();
					const sessionList = sessions
						.map((s) => `${s.id}: ${s.title}`)
						.join("\n");
					return {
						success: true,
						output: `Available sessions:\n${sessionList}`,
					};
				}

				const session = context.database.getSession(sessionId);
				if (!session) {
					return {
						success: false,
						error: `Session not found: ${sessionId}`,
					};
				}

				return {
					success: true,
					output: `Resumed session: ${session.title} (${session.id})`,
				};
			},
		});

		// /settings - View or modify settings
		this.registerCommand({
			name: "settings",
			description: "View or modify settings",
			usage: "/settings [key] [value]",
			execute: async (args, context) => {
				if (!context.settingsManager) {
					return {
						success: false,
						error: "Settings manager not available",
					};
				}

				const parts = args.trim().split(" ");
				const key = parts[0];

				if (!key) {
					const settings = context.settingsManager.getGlobalSettings();
					return {
						success: true,
						output: JSON.stringify(settings, null, 2),
					};
				}

				// For simplicity, just display the current setting value
				// Full implementation would allow setting values
				return {
					success: true,
					output: `Setting: ${key}\nUse settings file to modify values`,
				};
			},
		});

		// /quit - Exit
		this.registerCommand({
			name: "quit",
			description: "Exit the application",
			usage: "/quit",
			execute: async () => {
				return {
					success: true,
					output: "Exiting...",
				};
			},
		});

		// /help - Show help
		this.registerCommand({
			name: "help",
			description: "Show available commands",
			usage: "/help [command-name]",
			execute: async (args, context) => {
				const commandName = args.trim().toLowerCase();

				if (commandName) {
					const command = this.getCommand(commandName);
					if (command) {
						return {
							success: true,
							output: `Command: /${command.name}\nDescription: ${command.description}${command.usage ? `\nUsage: ${command.usage}` : ""}`,
						};
					}

					const template = this.promptTemplates.get(commandName);
					if (template) {
						return {
							success: true,
							output: `Template: /${template.name}\nDescription: ${template.description}\nSource: ${template.source}`,
						};
					}

					return {
						success: false,
						error: `Unknown command: /${commandName}`,
					};
				}

				const commands = this.listAllCommands();
				const helpText = commands
					.map((c) => `  /${c.name}${c.source !== "extension" ? ` (${c.source})` : ""}: ${c.description}`)
					.join("\n");

				return {
					success: true,
					output: `Available commands:\n${helpText}`,
				};
			},
		});

		// /session - Show session info and stats
		this.registerCommand({
			name: "session",
			description: "Show session info and stats",
			usage: "/session",
			execute: async (_args, context) => {
				const stats = context.session.getSessionStats();
				const runtime = context.sessionManager.getState(stats.sessionId);

				return {
					success: true,
					output: `Session Stats:\n  Session ID: ${stats.sessionId}\n  Messages: ${stats.totalMessages}\n  User messages: ${stats.userMessages}\n  Assistant messages: ${stats.assistantMessages}\n  Tool calls: ${stats.toolCalls}\n  Runs: ${stats.runs}\n  Active run: ${runtime?.activeRunId || "none"}`,
				};
			},
		});
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a slash command registry with built-in commands registered.
 */
export function createSlashCommandRegistry(): SlashCommandRegistry {
	return new SlashCommandRegistry();
}

/**
 * Create a slash command context from dependencies.
 */
export function createSlashCommandContext(
	session: AgentSession,
	database: AppStore,
	sessionManager: SessionManager,
	stdout?: (text: string) => void,
	settingsManager?: SettingsManager,
): SlashCommandContext {
	return {
		session,
		database,
		sessionManager,
		settingsManager,
		stdout: stdout || console.log,
		stderr: console.error,
	};
}
