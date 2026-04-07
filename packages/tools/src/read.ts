import type { OmiTool } from "@omi/core";
import type { ImageContent, TextContent, Static, TSchema } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";
import { constants } from "node:fs";
import { access as fsAccess, readFile as fsReadFile } from "node:fs/promises";
import { formatDimensionNote, resizeImage } from "./image-resize.js";
import { detectSupportedImageMimeTypeFromFile } from "./mime.js";
import { resolveReadPath } from "./path-utils.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateHead } from "./truncate.js";

export const readSchema: TSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export type ReadToolInput = typeof readSchema.static;

export interface ReadToolDetails {
	truncation?: TruncationResult;
}

/**
 * Pluggable operations for the read tool.
 * Override these to delegate file reading to remote systems (e.g., SSH).
 */
export interface ReadOperations {
	/** Read file contents as a Buffer */
	readFile: (absolutePath: string) => Promise<Buffer>;
	/** Check if file is readable (throw if not) */
	access: (absolutePath: string) => Promise<void>;
	/** Detect image MIME type, return null/undefined for non-images */
	detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

/**
 * Create local read operations using node fs primitives.
 */
export function createLocalReadOperations(): ReadOperations {
	return {
		readFile: (path) => fsReadFile(path),
		access: (path) => fsAccess(path, constants.R_OK),
		detectImageMimeType: detectSupportedImageMimeTypeFromFile,
	};
}

export interface ReadToolOptions {
	/** Whether to auto-resize images to 2000x2000 max. Default: true */
	autoResizeImages?: boolean;
	/** Custom operations for file reading. Default: local filesystem */
	operations?: ReadOperations;
}

export function createReadTool(cwd: string, options?: ReadToolOptions): OmiTool<typeof readSchema, ReadToolDetails> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	const ops = options?.operations ?? createLocalReadOperations();

	return {
		name: "read",
		label: "read",
		description: `Reads a file from the local filesystem. You can access any file directly by using this tool.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to ${DEFAULT_MAX_LINES} lines starting from the beginning of the file, or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first)
- When you already know which part of the file you need, only read that part. This can be important for larger files.
- Results are returned using cat -n format, with line numbers starting at 1
- This tool can read images (e.g., PNG, JPG, GIF, WebP). When reading an image file the contents are presented visually as the LLM is multimodal.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the offset/limit parameters to read specific page ranges. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`,
		parameters: readSchema,
		execute: async (
			_toolCallId: string,
			params: unknown,
			signal?: AbortSignal,
		) => {
			const { path, offset, limit } = params as { path: string; offset?: number; limit?: number };
			const absolutePath = resolveReadPath(path, cwd);

			return new Promise<{ content: (TextContent | ImageContent)[]; details: ReadToolDetails }>(
				(resolve, reject) => {
					// Check if already aborted
					if (signal?.aborted) {
						reject(new Error("Operation aborted"));
						return;
					}

					let aborted = false;

					// Set up abort handler
					const onAbort = () => {
						aborted = true;
						reject(new Error("Operation aborted"));
					};

					if (signal) {
						signal.addEventListener("abort", onAbort, { once: true });
					}

					// Perform the read operation
					(async () => {
						try {
							// Check if file exists
							await ops.access(absolutePath);

							// Check if aborted before reading
							if (aborted) {
								return;
							}

							const mimeType = ops.detectImageMimeType ? await ops.detectImageMimeType(absolutePath) : undefined;

							// Read the file based on type
							let content: (TextContent | ImageContent)[];
							let details: ReadToolDetails = {};

							if (mimeType) {
								// Read as image (binary)
								const buffer = await ops.readFile(absolutePath);
								const base64 = buffer.toString("base64");

								if (autoResizeImages) {
									// Resize image if needed
									const resized = await resizeImage({ type: "image", data: base64, mimeType });
									const dimensionNote = formatDimensionNote(resized);

									let textNote = `Read image file [${resized.mimeType}]`;
									if (dimensionNote) {
										textNote += `\n${dimensionNote}`;
									}

									content = [
										{ type: "text", text: textNote },
										{ type: "image", data: resized.data, mimeType: resized.mimeType },
									];
								} else {
									const textNote = `Read image file [${mimeType}]`;
									content = [
										{ type: "text", text: textNote },
										{ type: "image", data: base64, mimeType },
									];
								}
							} else {
								// Read as text
								const buffer = await ops.readFile(absolutePath);
								const textContent = buffer.toString("utf-8");
								const allLines = textContent.split("\n");
								const totalFileLines = allLines.length;

								// Apply offset if specified (1-indexed to 0-indexed)
								const startLine = offset ? Math.max(0, offset - 1) : 0;
								const startLineDisplay = startLine + 1; // For display (1-indexed)

								// Check if offset is out of bounds
								if (startLine >= allLines.length) {
									throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
								}

								// If limit is specified by user, use it; otherwise we'll let truncateHead decide
								let selectedContent: string;
								let userLimitedLines: number | undefined;
								if (limit !== undefined) {
									const endLine = Math.min(startLine + limit, allLines.length);
									selectedContent = allLines.slice(startLine, endLine).join("\n");
									userLimitedLines = endLine - startLine;
								} else {
									selectedContent = allLines.slice(startLine).join("\n");
								}

								// Apply truncation (respects both line and byte limits)
								const truncation = truncateHead(selectedContent);

								let outputText: string;

								if (truncation.firstLineExceedsLimit) {
									// First line at offset exceeds 30KB - tell model to use bash
									const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
									outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
									details = { truncation };
								} else if (truncation.truncated) {
									// Truncation occurred - build actionable notice
									const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
									const nextOffset = endLineDisplay + 1;

									outputText = truncation.content;

									if (truncation.truncatedBy === "lines") {
										outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
									} else {
										outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
									}
									details = { truncation };
								} else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
									// User specified limit, there's more content, but no truncation
									const remaining = allLines.length - (startLine + userLimitedLines);
									const nextOffset = startLine + userLimitedLines + 1;

									outputText = truncation.content;
									outputText += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
								} else {
									// No truncation, no user limit exceeded
									outputText = truncation.content;
								}

								content = [{ type: "text", text: outputText }];
							}

							// Check if aborted after reading
							if (aborted) {
								return;
							}

							// Clean up abort handler
							if (signal) {
								signal.removeEventListener("abort", onAbort);
							}

							resolve({ content, details });
						} catch (error: unknown) {
							// Clean up abort handler
							if (signal) {
								signal.removeEventListener("abort", onAbort);
							}

							if (!aborted) {
								reject(error);
							}
						}
					})();
				},
			);
		},
	};
}

/** Default read tool using process.cwd() - for backwards compatibility */
export const readTool: OmiTool<typeof readSchema, ReadToolDetails> = createReadTool(process.cwd());
