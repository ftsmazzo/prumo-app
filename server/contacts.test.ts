import { describe, expect, it } from "vitest";
import {
  isGhostName,
  isOperatorDisplayName,
  looksLikeAgentName,
  peerDisplayName,
  suggestTagsFromText,
} from "./contacts.js";

describe("contacts", () => {
  it("não usa pushName de mensagem outbound", () => {
    expect(peerDisplayName({ direction: "out", pushName: "Frederico Mazzo" })).toBeNull();
  });

  it("aceita pushName inbound real", () => {
    expect(peerDisplayName({ direction: "in", pushName: "Junior" })).toBe("Junior");
  });

  it("rejeita nome do dono no peer", () => {
    expect(isOperatorDisplayName("Frederico Mazzo")).toBe(true);
    expect(peerDisplayName({ direction: "in", pushName: "Frederico Mazzo" })).toBeNull();
  });

  it("ghost names", () => {
    expect(isGhostName("WhatsApp")).toBe(true);
    expect(isGhostName("5517999")).toBe(true);
    expect(isGhostName("Ana Silva")).toBe(false);
  });

  it("sugere tags do texto", () => {
    const tags = suggestTagsFromText("marca reunião amanhã e envia o boleto");
    expect(tags).toContain("agenda");
    expect(tags).toContain("financeiro");
  });

  it("reconhece Secretaria/agente pelo nome", () => {
    expect(looksLikeAgentName("Secretaria")).toBe(true);
    expect(looksLikeAgentName("Prumo")).toBe(true);
    expect(looksLikeAgentName("Junior")).toBe(false);
    expect(peerDisplayName({ direction: "in", pushName: "Secretaria" })).toBeNull();
  });
});
