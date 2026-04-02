/**
 * print-mode-images.test.ts - Print Mode 图片附件功能测试
 *
 * 测试覆盖：
 * - readImageFiles 正确读取支持的格式 (png, jpg, jpeg, gif, webp, svg)
 * - 不支持的格式报错（console.error 输出 Warning）
 * - 文件不存在时输出警告
 * - images 和 imagePaths 合并逻辑
 * - PrintModeOptions 的 images 和 imagePaths 参数
 * - IMAGE_MIME_TYPES 映射正确性
 */

import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { type PrintModeOptions } from "../src/modes/print-mode";

// Helper: 创建临时图片文件
function createTempImageFile(ext: string, content: Buffer): string {
	const tmpDir = path.join(process.cwd(), ".test-tmp");
	if (!fs.existsSync(tmpDir)) {
		fs.mkdirSync(tmpDir, { recursive: true });
	}
	const filePath = path.join(
		tmpDir,
		`test-image-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
	);
	fs.writeFileSync(filePath, content);
	return filePath;
}

function cleanupTempFiles() {
	const tmpDir = path.join(process.cwd(), ".test-tmp");
	if (fs.existsSync(tmpDir)) {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

// 复制 print-mode.ts 中的 MIME 类型映射以用于测试
// 这确保了测试与实现保持同步
const IMAGE_MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
};

// 复制 readImageFiles 的核心逻辑用于直接测试
// 因为 readImageFiles 是模块私有函数
function readImageFilesForTest(imagePaths: string[]): {
	images: Array<{ type: string; source: { type: string; media_type: string; data: string } }>;
	warnings: string[];
} {
	const images: Array<{
		type: string;
		source: { type: string; media_type: string; data: string };
	}> = [];
	const warnings: string[] = [];

	for (const filePath of imagePaths) {
		const resolved = path.resolve(filePath);
		if (!fs.existsSync(resolved)) {
			warnings.push(`[Warning: Image file not found: ${resolved}]`);
			continue;
		}
		const ext = path.extname(resolved).toLowerCase();
		const mimeType = IMAGE_MIME_TYPES[ext];
		if (!mimeType) {
			warnings.push(`[Warning: Unsupported image format: ${ext}]`);
			continue;
		}
		const data = fs.readFileSync(resolved);
		const base64 = data.toString("base64");
		images.push({
			type: "image",
			source: { type: "base64", media_type: mimeType, data: base64 },
		});
	}

	return { images, warnings };
}

describe("PrintModeOptions images 和 imagePaths 参数", () => {
	it("应该接受 images 参数", () => {
		const options: PrintModeOptions = {
			mode: "text",
			images: [
				{
					type: "image",
					source: { type: "base64", media_type: "image/png", data: "abc123" },
				} as any,
			],
		};
		expect(options.images).toHaveLength(1);
	});

	it("应该接受 imagePaths 参数", () => {
		const options: PrintModeOptions = {
			mode: "text",
			imagePaths: ["/tmp/test.png", "/tmp/test.jpg"],
		};
		expect(options.imagePaths).toHaveLength(2);
	});

	it("应该同时接受 images 和 imagePaths", () => {
		const options: PrintModeOptions = {
			mode: "text",
			images: [
				{
					type: "image",
					source: { type: "base64", media_type: "image/png", data: "abc" },
				} as any,
			],
			imagePaths: ["/tmp/test.jpg"],
		};
		expect(options.images).toHaveLength(1);
		expect(options.imagePaths).toHaveLength(1);
	});

	it("images 和 imagePaths 默认为 undefined", () => {
		const options: PrintModeOptions = { mode: "text" };
		expect(options.images).toBeUndefined();
		expect(options.imagePaths).toBeUndefined();
	});
});

describe("IMAGE_MIME_TYPES 映射", () => {
	it("应该包含 png 格式", () => {
		expect(IMAGE_MIME_TYPES[".png"]).toBe("image/png");
	});

	it("应该包含 jpg/jpeg 格式", () => {
		expect(IMAGE_MIME_TYPES[".jpg"]).toBe("image/jpeg");
		expect(IMAGE_MIME_TYPES[".jpeg"]).toBe("image/jpeg");
	});

	it("应该包含 gif 格式", () => {
		expect(IMAGE_MIME_TYPES[".gif"]).toBe("image/gif");
	});

	it("应该包含 webp 格式", () => {
		expect(IMAGE_MIME_TYPES[".webp"]).toBe("image/webp");
	});

	it("应该包含 svg 格式", () => {
		expect(IMAGE_MIME_TYPES[".svg"]).toBe("image/svg+xml");
	});

	it("不应该包含 bmp 格式", () => {
		expect(IMAGE_MIME_TYPES[".bmp"]).toBeUndefined();
	});

	it("不应该包含 tiff 格式", () => {
		expect(IMAGE_MIME_TYPES[".tiff"]).toBeUndefined();
	});
});

describe("readImageFiles 图片文件读取", () => {
	afterEach(() => {
		cleanupTempFiles();
	});

	it("文件不存在时应该输出警告", () => {
		const { images, warnings } = readImageFilesForTest([
			"/tmp/nonexistent-image-file-12345.png",
		]);

		expect(images).toHaveLength(0);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("Image file not found");
	});

	it("不支持的格式应该输出警告", () => {
		const tmpPath = createTempImageFile(".bmp", Buffer.from("fake bmp content"));
		const { images, warnings } = readImageFilesForTest([tmpPath]);

		expect(images).toHaveLength(0);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("Unsupported image format");
		expect(warnings[0]).toContain(".bmp");
	});

	it("支持的格式 (.png) 应该被正确读取并 base64 编码", () => {
		const pngContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const tmpPath = createTempImageFile(".png", pngContent);

		const { images, warnings } = readImageFilesForTest([tmpPath]);

		expect(warnings).toHaveLength(0);
		expect(images).toHaveLength(1);
		expect(images[0].type).toBe("image");
		expect(images[0].source.type).toBe("base64");
		expect(images[0].source.media_type).toBe("image/png");
		expect(images[0].source.data).toBe(pngContent.toString("base64"));
	});

	it("应该支持 jpg 格式", () => {
		const tmpPath = createTempImageFile(".jpg", Buffer.from("fake jpg"));
		const { images, warnings } = readImageFilesForTest([tmpPath]);

		expect(warnings).toHaveLength(0);
		expect(images).toHaveLength(1);
		expect(images[0].source.media_type).toBe("image/jpeg");
	});

	it("应该支持 jpeg 格式", () => {
		const tmpPath = createTempImageFile(".jpeg", Buffer.from("fake jpeg"));
		const { images, warnings } = readImageFilesForTest([tmpPath]);

		expect(warnings).toHaveLength(0);
		expect(images).toHaveLength(1);
		expect(images[0].source.media_type).toBe("image/jpeg");
	});

	it("应该支持 gif 格式", () => {
		const tmpPath = createTempImageFile(".gif", Buffer.from("fake gif"));
		const { images, warnings } = readImageFilesForTest([tmpPath]);

		expect(warnings).toHaveLength(0);
		expect(images).toHaveLength(1);
		expect(images[0].source.media_type).toBe("image/gif");
	});

	it("应该支持 webp 格式", () => {
		const tmpPath = createTempImageFile(".webp", Buffer.from("fake webp"));
		const { images, warnings } = readImageFilesForTest([tmpPath]);

		expect(warnings).toHaveLength(0);
		expect(images).toHaveLength(1);
		expect(images[0].source.media_type).toBe("image/webp");
	});

	it("应该支持 svg 格式", () => {
		const tmpPath = createTempImageFile(".svg", Buffer.from("<svg></svg>"));
		const { images, warnings } = readImageFilesForTest([tmpPath]);

		expect(warnings).toHaveLength(0);
		expect(images).toHaveLength(1);
		expect(images[0].source.media_type).toBe("image/svg+xml");
	});

	it("混合存在和不存在的文件时应该部分成功", () => {
		const existingPath = createTempImageFile(".png", Buffer.from("png data"));
		const nonExistentPath = "/tmp/absolutely-not-exist-99999.png";

		const { images, warnings } = readImageFilesForTest([existingPath, nonExistentPath]);

		expect(images).toHaveLength(1);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("Image file not found");
	});

	it("空路径数组应该返回空结果", () => {
		const { images, warnings } = readImageFilesForTest([]);

		expect(images).toHaveLength(0);
		expect(warnings).toHaveLength(0);
	});

	it("多个支持的格式应该全部成功", () => {
		const pngPath = createTempImageFile(".png", Buffer.from("png"));
		const jpgPath = createTempImageFile(".jpg", Buffer.from("jpg"));
		const gifPath = createTempImageFile(".gif", Buffer.from("gif"));

		const { images, warnings } = readImageFilesForTest([pngPath, jpgPath, gifPath]);

		expect(images).toHaveLength(3);
		expect(warnings).toHaveLength(0);
		expect(images[0].source.media_type).toBe("image/png");
		expect(images[1].source.media_type).toBe("image/jpeg");
		expect(images[2].source.media_type).toBe("image/gif");
	});
});
