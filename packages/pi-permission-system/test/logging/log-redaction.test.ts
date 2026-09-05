import { describe, expect, test } from "vitest";
import {
  isSensitiveLogKey,
  REDACTED_PLACEHOLDER,
  redactedJsonStringify,
} from "#src/logging/log-redaction";

describe("isSensitiveLogKey", () => {
  test.each([
    "authorization",
    "Authorization",
    "apiKey",
    "api_key",
    "api-key",
    "x-api-key",
    "ANTHROPIC_API_KEY",
    "secret",
    "clientSecret",
    "token",
    "accessToken",
    "refresh_token",
    "password",
    "passwd",
    "credential",
    "credentials",
    "cookie",
    "privateKey",
    "private_key",
  ])("treats %s as sensitive", (key) => {
    expect(isSensitiveLogKey(key)).toBe(true);
  });

  test.each([
    "toolName",
    "command",
    "path",
    "target",
    "origin",
    "matchedPattern",
    "resolution",
    "toolInputPreview",
    "requesterAgentName",
    "denialReason",
    "",
  ])("treats %s as not sensitive", (key) => {
    expect(isSensitiveLogKey(key)).toBe(false);
  });
});

describe("redactedJsonStringify", () => {
  test("masks a top-level sensitive value", () => {
    expect(redactedJsonStringify({ token: "abc123" })).toBe(
      `{"token":"${REDACTED_PLACEHOLDER}"}`,
    );
  });

  test("masks a nested sensitive value", () => {
    const details = {
      toolName: "http",
      headers: { authorization: "Bearer TEST_VALUE" },
    };

    expect(redactedJsonStringify(details)).toBe(
      `{"toolName":"http","headers":{"authorization":"${REDACTED_PLACEHOLDER}"}}`,
    );
  });

  test("masks a sensitive value inside an array element", () => {
    const details = { entries: [{ name: "prod", apiKey: "sk-real-value" }] };

    expect(redactedJsonStringify(details)).toBe(
      `{"entries":[{"name":"prod","apiKey":"${REDACTED_PLACEHOLDER}"}]}`,
    );
  });

  test("masks an object-valued sensitive key without descending into it", () => {
    const details = { credentials: { user: "root", password: "hunter2" } };

    expect(redactedJsonStringify(details)).toBe(
      `{"credentials":"${REDACTED_PLACEHOLDER}"}`,
    );
  });

  test("leaves non-sensitive keys untouched", () => {
    const details = {
      toolName: "bash",
      command: "echo hello",
      matchedPattern: "echo *",
    };

    expect(redactedJsonStringify(details)).toBe(
      '{"toolName":"bash","command":"echo hello","matchedPattern":"echo *"}',
    );
  });

  test("leaves a null or absent sensitive value as-is rather than reading as suppressed", () => {
    expect(redactedJsonStringify({ token: null })).toBe('{"token":null}');
    expect(redactedJsonStringify({ token: undefined })).toBe("{}");
  });

  test("retains the Error, bigint, and cycle handling of the plain serializer", () => {
    const error = new Error("boom");
    error.stack = "trace";
    const node: Record<string, unknown> = { size: 10n, error };
    node.self = node;

    expect(redactedJsonStringify(node)).toBe(
      '{"size":"10","error":{"name":"Error","message":"boom","stack":"trace"},"self":"[Circular]"}',
    );
  });
});
