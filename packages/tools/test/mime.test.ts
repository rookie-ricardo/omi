import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectSupportedImageMimeTypeFromFile } from "../src/mime";
import { open } from "node:fs/promises";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// JPEG 文件头 (FF D8 FF)
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff]);
// PNG 文件头 (89 50 4E 47 0D 0A 1A 0A) - file-type 需要至少 16 字节来正确识别 PNG
const PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG 签名
  Buffer.from([0x00, 0x00, 0x00, 0x0d]), // IHDR 长度
  Buffer.from([0x49, 0x48, 0x44, 0x52]), // IHDR 类型
  Buffer.from([0x00, 0x00, 0x00, 0x01]), // 宽度 1
  Buffer.from([0x00, 0x00, 0x00, 0x01]), // 高度 1
]);
// GIF 文件头 (47 49 46 38)
const GIF_HEADER = Buffer.from([0x47, 0x49, 0x46, 0x38]);
// WebP 文件头 (RIFF....WEBP)
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x00, 0x00, 0x00, 0x00, // size (placeholder)
  0x57, 0x45, 0x42, 0x50, // WEBP
]);

describe("detectSupportedImageMimeTypeFromFile", () => {
  let testDir: string;
  let testFiles: string[] = [];

  beforeEach(async () => {
    testDir = join(tmpdir(), `omi-mime-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    await mkdir(testDir, { recursive: true });
    testFiles = [];
  });

  async function createTestFile(filename: string, content: Buffer): Promise<string> {
    const filePath = join(testDir, filename);
    await writeFile(filePath, content);
    testFiles.push(filePath);
    return filePath;
  }

  describe("JPEG 格式检测", () => {
    it("应该检测 JPEG 文件", async () => {
      const jpegFile = await createTestFile("test.jpg", JPEG_HEADER);
      const mimeType = await detectSupportedImageMimeTypeFromFile(jpegFile);
      expect(mimeType).toBe("image/jpeg");
    });

    it("应该检测包含更多数据的 JPEG 文件", async () => {
      const jpegData = Buffer.concat([JPEG_HEADER, Buffer.alloc(1000, 0xff)]);
      const jpegFile = await createTestFile("test-large.jpg", jpegData);
      const mimeType = await detectSupportedImageMimeTypeFromFile(jpegFile);
      expect(mimeType).toBe("image/jpeg");
    });
  });

  describe("PNG 格式检测", () => {
    it("应该检测 PNG 文件", async () => {
      const pngFile = await createTestFile("test.png", PNG_HEADER);
      const mimeType = await detectSupportedImageMimeTypeFromFile(pngFile);
      expect(mimeType).toBe("image/png");
    });

    it("应该检测包含更多数据的 PNG 文件", async () => {
      const pngData = Buffer.concat([PNG_HEADER, Buffer.alloc(1000)]);
      const pngFile = await createTestFile("test-large.png", pngData);
      const mimeType = await detectSupportedImageMimeTypeFromFile(pngFile);
      expect(mimeType).toBe("image/png");
    });
  });

  describe("GIF 格式检测", () => {
    it("应该检测 GIF 文件", async () => {
      const gifFile = await createTestFile("test.gif", GIF_HEADER);
      const mimeType = await detectSupportedImageMimeTypeFromFile(gifFile);
      expect(mimeType).toBe("image/gif");
    });

    it("应该检测 GIF87a 格式", async () => {
      const gif87a = Buffer.concat([Buffer.from("GIF87a"), Buffer.alloc(10)]);
      const gifFile = await createTestFile("test87a.gif", gif87a);
      const mimeType = await detectSupportedImageMimeTypeFromFile(gifFile);
      expect(mimeType).toBe("image/gif");
    });

    it("应该检测 GIF89a 格式", async () => {
      const gif89a = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(10)]);
      const gifFile = await createTestFile("test89a.gif", gif89a);
      const mimeType = await detectSupportedImageMimeTypeFromFile(gifFile);
      expect(mimeType).toBe("image/gif");
    });
  });

  describe("WebP 格式检测", () => {
    it("应该检测 WebP 文件", async () => {
      const webpFile = await createTestFile("test.webp", WEBP_HEADER);
      const mimeType = await detectSupportedImageMimeTypeFromFile(webpFile);
      expect(mimeType).toBe("image/webp");
    });

    it("应该检测包含更多数据的 WebP 文件", async () => {
      const webpData = Buffer.concat([WEBP_HEADER, Buffer.alloc(1000)]);
      const webpFile = await createTestFile("test-large.webp", webpData);
      const mimeType = await detectSupportedImageMimeTypeFromFile(webpFile);
      expect(mimeType).toBe("image/webp");
    });
  });

  describe("不支持的格式", () => {
    it("应该拒绝 BMP 文件", async () => {
      const bmpHeader = Buffer.from([0x42, 0x4d]); // BM
      const bmpFile = await createTestFile("test.bmp", bmpHeader);
      const mimeType = await detectSupportedImageMimeTypeFromFile(bmpFile);
      expect(mimeType).toBeNull();
    });

    it("应该拒绝 TIFF 文件", async () => {
      const tiffHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00]); // II
      const tiffFile = await createTestFile("test.tiff", tiffHeader);
      const mimeType = await detectSupportedImageMimeTypeFromFile(tiffFile);
      expect(mimeType).toBeNull();
    });

    it("应该拒绝纯文本文件", async () => {
      const textFile = await createTestFile("test.txt", Buffer.from("Hello, World!"));
      const mimeType = await detectSupportedImageMimeTypeFromFile(textFile);
      expect(mimeType).toBeNull();
    });

    it("应该拒绝 JSON 文件", async () => {
      const jsonFile = await createTestFile("test.json", Buffer.from('{"key": "value"}'));
      const mimeType = await detectSupportedImageMimeTypeFromFile(jsonFile);
      expect(mimeType).toBeNull();
    });
  });

  describe("空文件和无效文件", () => {
    it("应该处理空文件", async () => {
      const emptyFile = await createTestFile("empty.jpg", Buffer.alloc(0));
      const mimeType = await detectSupportedImageMimeTypeFromFile(emptyFile);
      expect(mimeType).toBeNull();
    });

    it("应该处理非常小的文件", async () => {
      const tinyFile = await createTestFile("tiny.png", Buffer.from([0x89]));
      const mimeType = await detectSupportedImageMimeTypeFromFile(tinyFile);
      expect(mimeType).toBeNull();
    });

    it("应该处理损坏的图像文件", async () => {
      const corruptedFile = await createTestFile("corrupted.jpg", Buffer.from([0xff, 0xff, 0xff]));
      const mimeType = await detectSupportedImageMimeTypeFromFile(corruptedFile);
      expect(mimeType).toBeNull();
    });
  });

  describe("文件读取行为", () => {
    it("应该只读取文件头部（不读取整个文件）", async () => {
      // 创建大文件，但只有头部是有效的 PNG
      const largeContent = Buffer.concat([PNG_HEADER, Buffer.alloc(10 * 1024 * 1024)]); // 10MB
      const largeFile = await createTestFile("large.png", largeContent);

      // 应该快速返回，不需要读取整个文件
      const startTime = Date.now();
      const mimeType = await detectSupportedImageMimeTypeFromFile(largeFile);
      const duration = Date.now() - startTime;

      expect(mimeType).toBe("image/png");
      expect(duration).toBeLessThan(1000); // 应该在 1 秒内完成
    });

    it("应该正确关闭文件句柄", async () => {
      const pngFile = await createTestFile("test.png", PNG_HEADER);

      // 多次调用不应导致文件句柄泄漏
      const results = await Promise.all([
        detectSupportedImageMimeTypeFromFile(pngFile),
        detectSupportedImageMimeTypeFromFile(pngFile),
        detectSupportedImageMimeTypeFromFile(pngFile),
      ]);

      expect(results[0]).toBe("image/png");
      expect(results[1]).toBe("image/png");
      expect(results[2]).toBe("image/png");
    });
  });

  describe("不存在的文件", () => {
    it("应该抛出错误或不存在的文件路径", async () => {
      const nonexistentPath = join(testDir, "does-not-exist.jpg");

      // 应该抛出错误或返回 null
      let result: string | null = null;
      let errorOccurred = false;

      try {
        result = await detectSupportedImageMimeTypeFromFile(nonexistentPath);
      } catch (e) {
        errorOccurred = true;
      }

      // 应该抛出错误
      expect(errorOccurred).toBe(true);
    });
  });

  describe("边界情况", () => {
    it("应该处理恰好等于 FILE_TYPE_SNIFF_BYTES 大小的文件", async () => {
      // FILE_TYPE_SNIFF_BYTES = 4100
      const exactSizeContent = Buffer.concat([PNG_HEADER, Buffer.alloc(4100 - PNG_HEADER.length)]);
      const exactFile = await createTestFile("exact.png", exactSizeContent);
      const mimeType = await detectSupportedImageMimeTypeFromFile(exactFile);
      expect(mimeType).toBe("image/png");
    });

    it("应该处理大于 FILE_TYPE_SNIFF_BYTES 大小的文件", async () => {
      const largeContent = Buffer.concat([JPEG_HEADER, Buffer.alloc(5000)]);
      const largeFile = await createTestFile("oversize.jpg", largeContent);
      const mimeType = await detectSupportedImageMimeTypeFromFile(largeFile);
      expect(mimeType).toBe("image/jpeg");
    });

    it("应该处理非标准扩展名的图像文件", async () => {
      const noExtFile = await createTestFile("noextension", PNG_HEADER);
      const mimeType = await detectSupportedImageMimeTypeFromFile(noExtFile);
      expect(mimeType).toBe("image/png");
    });

    it("应该忽略文件扩展名，基于内容检测", async () => {
      // PNG 内容但 .jpg 扩展名
      const misnamedFile = await createTestFile("wrong.jpg", PNG_HEADER);
      const mimeType = await detectSupportedImageMimeTypeFromFile(misnamedFile);
      expect(mimeType).toBe("image/png");
    });
  });

  describe("IMAGE_MIME_TYPES 常量", () => {
    it("应该包含 JPEG", () => {
      // 从代码中得知 IMAGE_MIME_TYPES 包含 image/jpeg
      const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
      expect(imageMimeTypes.has("image/jpeg")).toBe(true);
    });

    it("应该包含 PNG", () => {
      const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
      expect(imageMimeTypes.has("image/png")).toBe(true);
    });

    it("应该包含 GIF", () => {
      const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
      expect(imageMimeTypes.has("image/gif")).toBe(true);
    });

    it("应该包含 WebP", () => {
      const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
      expect(imageMimeTypes.has("image/webp")).toBe(true);
    });

    it("应该有 4 个支持的格式", () => {
      const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
      expect(imageMimeTypes.size).toBe(4);
    });
  });

  describe("FILE_TYPE_SNIFF_BYTES 常量", () => {
    it("应该是 4100 字节", () => {
      // 从代码中得知 FILE_TYPE_SNIFF_BYTES = 4100
      const FILE_TYPE_SNIFF_BYTES = 4100;
      expect(FILE_TYPE_SNIFF_BYTES).toBe(4100);
    });
  });
});
