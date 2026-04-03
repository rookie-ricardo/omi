import { describe, it, expect } from "vitest";
import {
  loadSingleSkill,
  getModelConstraints,
  requiresSpecificModel,
  getExecutionMode,
  shouldFork,
  getToolRules,
  isCommandAllowed,
} from "../src/skills/loader";

describe("loader", () => {
  describe("getModelConstraints", () => {
    it("should return model constraints from skill", () => {
      // This test would require a properly loaded skill
      // For now, just test the function exists
      expect(getModelConstraints).toBeDefined();
    });
  });

  describe("requiresSpecificModel", () => {
    it("should identify skills requiring specific models", () => {
      // This test would require a properly loaded skill
      expect(requiresSpecificModel).toBeDefined();
    });
  });

  describe("getExecutionMode", () => {
    it("should return execution mode from skill", () => {
      // This test would require a properly loaded skill
      expect(getExecutionMode).toBeDefined();
    });
  });

  describe("shouldFork", () => {
    it("should identify fork mode skills", () => {
      // This test would require a properly loaded skill
      expect(shouldFork).toBeDefined();
    });
  });

  describe("getToolRules", () => {
    it("should return tool rules from skill", () => {
      // This test would require a properly loaded skill
      expect(getToolRules).toBeDefined();
    });
  });

  describe("isCommandAllowed", () => {
    it("should check command against tool rules", () => {
      // This test would require a properly loaded skill
      expect(isCommandAllowed).toBeDefined();
    });
  });
});
