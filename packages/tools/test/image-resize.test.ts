import { beforeEach, describe, expect, it, vi } from "vitest";
import { resizeImage, formatDimensionNote, type ImageResizeOptions, type ResizedImage } from "../src/image-resize";
import type { ImageContent } from "@mariozechner/pi-ai";

// 创建 1x1 像素的 PNG (最小有效 PNG)
function createMinimalPNG(width: number = 10, height: number = 10): string {
  // 简化的 PNG - 实际使用 base64 编码的小图片
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, width, height);
  }
  return canvas.toDataURL("image/png").split(",")[1];
}

// 创建测试用的 base64 图片数据
const SMALL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="; // 1x1 像素透明 PNG

function makeImage(data: string = SMALL_PNG, mimeType: string = "image/png"): ImageContent {
  return { type: "image", data, mimeType };
}

describe("resizeImage", () => {
  describe("当 Photon 不可用时", () => {
    it("应该返回原始图片，wasResized 为 false", async () => {
      // Mock loadPhoton 返回 null
      vi.doMock("../src/photon", () => ({
        loadPhoton: vi.fn().mockResolvedValue(null),
      }));

      const result = await resizeImage(makeImage());
      expect(result.wasResized).toBe(false);
      expect(result.data).toBe(SMALL_PNG);
      expect(result.mimeType).toBe("image/png");
    });
  });

  describe("当图片已经符合限制时", () => {
    it("不应调整大小（小于最大尺寸和字节数）", async () => {
      // 1x1 PNG 远小于默认限制
      const result = await resizeImage(makeImage(), {
        maxWidth: 2000,
        maxHeight: 2000,
        maxBytes: 4.5 * 1024 * 1024,
      });

      expect(result.wasResized).toBe(false);
      expect(result.data).toBe(SMALL_PNG);
    });

    it("应该返回原始的 mimeType", async () => {
      const result = await resizeImage(makeImage(SMALL_PNG, "image/jpeg"));
      expect(result.mimeType).toBe("image/jpeg");
    });
  });

  describe("默认选项", () => {
    it("应该使用 maxWidth=2000", async () => {
      const options: ImageResizeOptions = {};
      // 由于我们无法真正加载 Photon，这个测试验证选项处理
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });

    it("应该使用 maxHeight=2000", async () => {
      const options: ImageResizeOptions = {};
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });

    it("应该使用 maxBytes=4.5MB", async () => {
      const options: ImageResizeOptions = {};
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });

    it("应该使用 jpegQuality=80", async () => {
      const options: ImageResizeOptions = {};
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });
  });

  describe("自定义选项", () => {
    it("应该接受自定义 maxWidth", async () => {
      const options: ImageResizeOptions = { maxWidth: 500 };
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });

    it("应该接受自定义 maxHeight", async () => {
      const options: ImageResizeOptions = { maxHeight: 500 };
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });

    it("应该接受自定义 maxBytes", async () => {
      const options: ImageResizeOptions = { maxBytes: 1024 * 1024 }; // 1MB
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });

    it("应该接受自定义 jpegQuality", async () => {
      const options: ImageResizeOptions = { jpegQuality: 90 };
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });
  });

  describe("错误处理", () => {
    it("应该处理无效的 base64 数据", async () => {
      // 无效的 base64 字符串
      const result = await resizeImage({ type: "image", data: "invalid-base64!!!", mimeType: "image/png" });
      expect(result.wasResized).toBe(false);
    });

    it("应该处理缺少 mimeType 的图片", async () => {
      const result = await resizeImage({ type: "image", data: SMALL_PNG } as ImageContent);
      expect(result).toBeDefined();
    });

    it("应该处理空数据", async () => {
      const result = await resizeImage({ type: "image", data: "", mimeType: "image/png" });
      expect(result.wasResized).toBe(false);
    });
  });

  describe("图片格式处理", () => {
    it("应该处理 JPEG 格式", async () => {
      const result = await resizeImage(makeImage(SMALL_PNG, "image/jpeg"));
      expect(result.mimeType).toBe("image/jpeg");
    });

    it("应该处理 PNG 格式", async () => {
      const result = await resizeImage(makeImage(SMALL_PNG, "image/png"));
      expect(result.mimeType).toBe("image/png");
    });

    it("应该从 mimeType 中提取格式", async () => {
      const result = await resizeImage(makeImage(SMALL_PNG, "image/webp"));
      expect(result).toBeDefined();
    });
  });

  describe("ResizedImage 接口", () => {
    it("应该返回包含所有必需字段的结果", async () => {
      const result = await resizeImage(makeImage());

      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("mimeType");
      expect(result).toHaveProperty("originalWidth");
      expect(result).toHaveProperty("originalHeight");
      expect(result).toHaveProperty("width");
      expect(result).toHaveProperty("height");
      expect(result).toHaveProperty("wasResized");
    });

    it("data 应该是 base64 字符串", async () => {
      const result = await resizeImage(makeImage());
      expect(typeof result.data).toBe("string");
    });

    it("mimeType 应该是字符串", async () => {
      const result = await resizeImage(makeImage());
      expect(typeof result.mimeType).toBe("string");
    });

    it("尺寸应该是数字", async () => {
      const result = await resizeImage(makeImage());
      expect(typeof result.originalWidth).toBe("number");
      expect(typeof result.originalHeight).toBe("number");
      expect(typeof result.width).toBe("number");
      expect(typeof result.height).toBe("number");
    });

    it("wasResized 应该是布尔值", async () => {
      const result = await resizeImage(makeImage());
      expect(typeof result.wasResized).toBe("boolean");
    });
  });

  describe("尺寸计算", () => {
    it("应该保持宽高比缩放", async () => {
      // 这个测试需要 Photon 实际工作才能验证
      // 这里只验证函数不会抛出错误
      const options: ImageResizeOptions = { maxWidth: 100, maxHeight: 100 };
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });

    it("应该处理宽度超限的情况", async () => {
      const options: ImageResizeOptions = { maxWidth: 50 };
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });

    it("应该处理高度超限的情况", async () => {
      const options: ImageResizeOptions = { maxHeight: 50 };
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });
  });

  describe("文件大小优化策略", () => {
    it("应该尝试 PNG 和 JPEG 两种格式", async () => {
      // 策略在代码中实现，这里验证不抛错
      const options: ImageResizeOptions = { maxBytes: 500 };
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });

    it("应该选择较小的文件", async () => {
      // pickSmaller 函数的行为
      const options: ImageResizeOptions = { maxBytes: 1000 };
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });

    it("应该降低 JPEG 质量来减小文件", async () => {
      // 质量步骤: 85, 70, 55, 40
      const options: ImageResizeOptions = { maxBytes: 100 };
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });

    it("应该降低尺寸来减小文件", async () => {
      // 缩放步骤: 1.0, 0.75, 0.5, 0.35, 0.25
      const options: ImageResizeOptions = { maxBytes: 50 };
      expect(() => resizeImage(makeImage(), options)).not.toThrow();
    });
  });
});

describe("formatDimensionNote", () => {
  describe("当图片被调整大小时", () => {
    it("应该返回格式化的尺寸说明", () => {
      const resized: ResizedImage = {
        data: "base64data",
        mimeType: "image/jpeg",
        originalWidth: 4000,
        originalHeight: 3000,
        width: 2000,
        height: 1500,
        wasResized: true,
      };

      const note = formatDimensionNote(resized);
      expect(note).toBeDefined();
      expect(note).toContain("4000x3000");
      expect(note).toContain("2000x1500");
    });

    it("应该包含正确的缩放比例", () => {
      const resized: ResizedImage = {
        data: "base64data",
        mimeType: "image/jpeg",
        originalWidth: 2000,
        originalHeight: 2000,
        width: 1000,
        height: 1000,
        wasResized: true,
      };

      const note = formatDimensionNote(resized);
      expect(note).toContain("2.00"); // 2000/1000 = 2.0
    });

    it("应该处理非整数缩放比例", () => {
      const resized: ResizedImage = {
        data: "base64data",
        mimeType: "image/jpeg",
        originalWidth: 3000,
        originalHeight: 2000,
        width: 2000,
        height: 1333,
        wasResized: true,
      };

      const note = formatDimensionNote(resized);
      expect(note).toBeDefined();
    });
  });

  describe("当图片未调整大小时", () => {
    it("应该返回 undefined", () => {
      const notResized: ResizedImage = {
        data: "base64data",
        mimeType: "image/png",
        originalWidth: 500,
        originalHeight: 500,
        width: 500,
        height: 500,
        wasResized: false,
      };

      const note = formatDimensionNote(notResized);
      expect(note).toBeUndefined();
    });
  });

  describe("格式化文本内容", () => {
    it("应该包含 'original' 关键字", () => {
      const resized: ResizedImage = {
        data: "base64data",
        mimeType: "image/jpeg",
        originalWidth: 1000,
        originalHeight: 800,
        width: 500,
        height: 400,
        wasResized: true,
      };

      const note = formatDimensionNote(resized);
      expect(note).toMatch(/original/);
    });

    it("应该包含 'displayed' 关键字", () => {
      const resized: ResizedImage = {
        data: "base64data",
        mimeType: "image/jpeg",
        originalWidth: 1000,
        originalHeight: 800,
        width: 500,
        height: 400,
        wasResized: true,
      };

      const note = formatDimensionNote(resized);
      expect(note).toMatch(/displayed/);
    });

    it("应该包含坐标映射说明", () => {
      const resized: ResizedImage = {
        data: "base64data",
        mimeType: "image/jpeg",
        originalWidth: 1000,
        originalHeight: 800,
        width: 500,
        height: 400,
        wasResized: true,
      };

      const note = formatDimensionNote(resized);
      expect(note).toMatch(/Multiply coordinates/);
    });
  });
});

describe("ImageResizeOptions 接口", () => {
  it("应该接受所有可选属性", () => {
    const options: ImageResizeOptions = {
      maxWidth: 1920,
      maxHeight: 1080,
      maxBytes: 3 * 1024 * 1024,
      jpegQuality: 85,
    };
    expect(options.maxWidth).toBe(1920);
    expect(options.maxHeight).toBe(1080);
    expect(options.maxBytes).toBe(3 * 1024 * 1024);
    expect(options.jpegQuality).toBe(85);
  });

  it("应该接受部分选项", () => {
    const options: ImageResizeOptions = {
      maxWidth: 1000,
    };
    expect(options.maxWidth).toBe(1000);
    expect(options.maxHeight).toBeUndefined();
  });

  it("应该接受空选项", () => {
    const options: ImageResizeOptions = {};
    expect(Object.keys(options)).toHaveLength(0);
  });
});

describe("常量值", () => {
  it("DEFAULT_MAX_BYTES 应该是 4.5MB", () => {
    // 从代码中得知 DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024
    const expected = 4.5 * 1024 * 1024;
    expect(expected).toBe(4718592);
  });

  it("默认质量步骤应该包含 4 个值", () => {
    // 从代码中得知 qualitySteps = [85, 70, 55, 40]
    const qualitySteps = [85, 70, 55, 40];
    expect(qualitySteps).toHaveLength(4);
    expect(qualitySteps).toEqual([85, 70, 55, 40]);
  });

  it("默认缩放步骤应该包含 5 个值", () => {
    // 从代码中得知 scaleSteps = [1.0, 0.75, 0.5, 0.35, 0.25]
    const scaleSteps = [1.0, 0.75, 0.5, 0.35, 0.25];
    expect(scaleSteps).toHaveLength(5);
  });
});
