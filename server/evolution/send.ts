/** Envio Evolution — só canal agent_*. */

export type SendResult = { ok: true; providerId?: string } | { ok: false; error: string };

export async function sendTextMessage(opts: {
  instanceName: string;
  toPhone: string;
  text: string;
}): Promise<SendResult> {
  const base = process.env.EVOLUTION_URL?.replace(/\/$/, "");
  const key = process.env.EVOLUTION_API_KEY;
  if (!base || !key) return { ok: false, error: "evolution_not_configured" };
  // Default OFF até o dono ligar AGENT_SEND=true (ensaio da caixa de saída).
  if (process.env.AGENT_SEND !== "1" && process.env.AGENT_SEND !== "true") {
    return { ok: false, error: "agent_send_disabled" };
  }

  const number = opts.toPhone.replace(/\D/g, "");
  try {
    const res = await fetch(`${base}/message/sendText/${encodeURIComponent(opts.instanceName)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
      },
      body: JSON.stringify({
        number,
        text: opts.text,
      }),
    });
    const raw = await res.text();
    let data: { key?: { id?: string }; message?: { key?: { id?: string } }; error?: string } = {};
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      return { ok: false, error: data.error || `evolution_http_${res.status}` };
    }
    const providerId = data.key?.id || data.message?.key?.id;
    return { ok: true, providerId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
