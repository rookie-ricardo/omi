import { join } from "node:path";
import { spawn } from "node:child_process";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { parseToolInput } from "./input-parse.js";

// ============================================================================
// Schemas
// ============================================================================

export const browserSchema = Type.Object({
  action: Type.String({ description: "Action to perform: 'read_text', 'read_html', or 'screenshot'" }),
  url: Type.String({ description: "URL to navigate to" }),
});

// ============================================================================
// Auto-Install Helper
// ============================================================================

async function ensurePlaywright(cwd: string, onUpdate?: (delta: any) => void): Promise<any> {
  try {
    // Try to resolve playwright locally
    const playwrightPath = require.resolve("playwright", { paths: [cwd, __dirname] });
    return require(playwrightPath);
  } catch (err: any) {
    if (err.code !== "MODULE_NOT_FOUND") {
      throw err;
    }

    // Playwright is not installed. Auto-install it.
    if (onUpdate) {
      onUpdate({ content: [{ type: "text", text: "Playwright is not installed. Beginning automatic download of Playwright and Chromium dependencies...\n" }] });
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn("npm", ["install", "--no-save", "playwright@latest"], { cwd, shell: true });
      child.stdout.on("data", (chunk: Buffer) => {
        if (onUpdate) {
          onUpdate({ content: [{ type: "text", text: chunk.toString() }] });
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
         if (onUpdate) {
          onUpdate({ content: [{ type: "text", text: chunk.toString() }] });
        }
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to automatically install Playwright. npm exited with code ${code}`));
        }
      });
      child.on("error", reject);
    });

    if (onUpdate) {
      onUpdate({ content: [{ type: "text", text: "Installation complete. Launching browser...\n" }] });
    }

    try {
      const playwrightPath = require.resolve("playwright", { paths: [cwd, __dirname] });
      return require(playwrightPath);
    } catch (e) {
      throw new Error("Playwright installation succeeded, but module resolution failed.");
    }
  }
}

// ============================================================================
// Tool Factory
// ============================================================================

export function createWebBrowserTool(cwd: string): AgentTool<typeof browserSchema, any> {
  return {
    name: "web.browser",
    label: "web.browser",
    description: "Launch a headless browser (Playwright) to navigate to a URL and perform an action: read_text, read_html, or screenshot. If Playwright is not present, it will automatically install.",
    parameters: browserSchema,
    execute: async (_toolCallId: string, params: unknown, _signal?: AbortSignal, onUpdate?: (delta: any) => void) => {
      const { action, url } = parseToolInput("web.browser", browserSchema, params);
      
      const playwright = await ensurePlaywright(cwd, onUpdate);

      let browser;
      try {
        browser = await playwright.chromium.launch({ headless: true });
        const page = await browser.newPage();
        
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

        let resultText = "";
        let details: Record<string, any> = { action, url };

        if (action === "screenshot") {
            const buffer = await page.screenshot({ fullPage: true });
            const base64 = buffer.toString('base64');
            resultText = `Screenshot captured successfully. Base64 Size: ${base64.length} chars`;
            // Normally you might return image blocks, but for generic usage we return base64
            details.screenshotBase64 = base64;
        } else if (action === "read_html") {
            const html = await page.content();
            resultText = html;
            details.length = html.length;
        } else {
            // Default to read_text
            const text = await page.evaluate(() => document.body.innerText);
            resultText = text;
            details.length = text.length;
        }

        return {
          content: [{ type: "text" as const, text: resultText }],
          details,
        };

      } catch (err: any) {
         throw new Error(`Browser automation failed: ${err.message}`);
      } finally {
        if (browser) {
          await browser.close();
        }
      }
    },
  };
}
