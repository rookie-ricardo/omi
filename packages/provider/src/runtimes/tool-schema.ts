import { z } from "zod";

type JsonSchema = Record<string, unknown>;
type JsonLiteral = string | number | boolean | null;

function isJsonLiteral(value: unknown): value is JsonLiteral {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function asObjectSchema(schema: unknown): JsonSchema | null {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return null;
  }
  return schema as JsonSchema;
}

function parseEnum(schema: JsonSchema): z.ZodTypeAny | null {
  const enumValues = schema.enum;
  if (!Array.isArray(enumValues) || enumValues.length === 0) {
    return null;
  }
  if (enumValues.every((value) => typeof value === "string")) {
    const values = enumValues as string[];
    return z.enum([values[0], ...values.slice(1)]);
  }
  if (!enumValues.every(isJsonLiteral)) {
    return null;
  }

  const literals = enumValues.map((value) => z.literal(value));
  const first = literals[0];
  if (!first) {
    return null;
  }
  const second = literals[1];
  if (!second) {
    return first;
  }
  return z.union([first, second, ...literals.slice(2)]);
}

function toZodSchema(schema: unknown): z.ZodTypeAny {
  const objectSchema = asObjectSchema(schema);
  if (!objectSchema) {
    return z.any();
  }

  const enumSchema = parseEnum(objectSchema);
  if (enumSchema) {
    return enumSchema;
  }

  const schemaType = objectSchema.type;
  if (schemaType === "string") {
    return z.string();
  }
  if (schemaType === "integer") {
    return z.number().int();
  }
  if (schemaType === "number") {
    return z.number();
  }
  if (schemaType === "boolean") {
    return z.boolean();
  }
  if (schemaType === "array") {
    return z.array(toZodSchema(objectSchema.items));
  }
  if (schemaType === "object") {
    const properties = asObjectSchema(objectSchema.properties) ?? {};
    const requiredList = Array.isArray(objectSchema.required)
      ? new Set(objectSchema.required.filter((entry): entry is string => typeof entry === "string"))
      : new Set<string>();

    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      const field = toZodSchema(propertySchema);
      shape[propertyName] = requiredList.has(propertyName) ? field : field.optional();
    }
    return z.object(shape).passthrough();
  }

  return z.any();
}

export function jsonSchemaToZodShape(schema: unknown): Record<string, z.ZodTypeAny> {
  const objectSchema = asObjectSchema(schema);
  if (!objectSchema || objectSchema.type !== "object") {
    return {};
  }

  const properties = asObjectSchema(objectSchema.properties) ?? {};
  const requiredList = Array.isArray(objectSchema.required)
    ? new Set(objectSchema.required.filter((entry): entry is string => typeof entry === "string"))
    : new Set<string>();

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    const field = toZodSchema(propertySchema);
    shape[propertyName] = requiredList.has(propertyName) ? field : field.optional();
  }

  return shape;
}
