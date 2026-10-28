import { describe, expect, it } from "vitest";
import { normalizeEvent, parseMessagesUpsert } from "./evolution.js";

function upsertItem(overrides: Record<string, unknown> = {}) {
  const keyOverride =
    overrides.key && typeof overrides.key === "object"
      ? (overrides.key as Record<string, unknown>)
      : {};
  return {
    pushName: "Ana",
    messageType: "conversation",
    messageTimestamp: 1_700_000_000,
    message: { conversation: "oi, marca amanhã às 15h" },
    ...overrides,
    key: {
      id: "ABC123",
      remoteJid: "5511999990000@s.whatsapp.net",
      fromMe: false,
      ...keyOverride,
    },
  };
}

describe("normalizeEvent", () => {
  it("normalizes MESSAGES_UPSERT", () => {
    expect(normalizeEvent("MESSAGES_UPSERT")).toBe("messages.upsert");
  });
});

describe("parseMessagesUpsert", () => {
  it("parses a 1:1 text message", () => {
    const { messages, ignored } = parseMessagesUpsert(upsertItem());
    expect(ignored).toEqual([]);
    expect(messages).toHaveLength(1);
    const m = messages[0].message;
    expect(m.providerMessageId).toBe("ABC123");
    expect(m.direction).toBe("in");
    expect(m.contactPhone).toBe("5511999990000");
    expect(m.text).toBe("oi, marca amanhã às 15h");
    expect(m.isGroup).toBe(false);
  });

  it("ignores groups by default", () => {
    const { messages, ignored } = parseMessagesUpsert(
      upsertItem({
        key: {
          id: "G1",
          remoteJid: "120363@g.us",
          participant: "5511888@s.whatsapp.net",
          fromMe: false,
        },
      }),
    );
    expect(messages).toHaveLength(0);
    expect(ignored).toContain("group");
  });

  it("keeps groups when enabled and uses participant phone", () => {
    const { messages } = parseMessagesUpsert(
      upsertItem({
        key: {
          id: "G1",
          remoteJid: "120363000000000000@g.us",
          participant: "5511888777666@s.whatsapp.net",
          fromMe: false,
        },
      }),
      { listenGroups: true },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].message.isGroup).toBe(true);
    expect(messages[0].message.contactPhone).toBe("5511888777666");
  });

  it("dedupes nothing at parse layer; strips base64 from raw", () => {
    const { messages } = parseMessagesUpsert(
      upsertItem({
        message: { conversation: "x", base64: "AAAA" },
      }),
    );
    expect(messages[0].raw.message).toEqual({ conversation: "x" });
  });

  it("ignores reactions", () => {
    const { ignored } = parseMessagesUpsert(
      upsertItem({
        messageType: "reactionMessage",
        message: { reactionMessage: { text: "👍" } },
      }),
    );
    expect(ignored).toContain("reaction");
  });
});
