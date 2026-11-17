const INBOX = "info@sonatoffshore.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBJECTS = new Set([
  "Website intro call request",
  "Website contact enquiry",
  "AssetOS information request",
  "ProjectOS information request",
  "SONAT Offshore newsletter signup",
]);

function response(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/send") {
      return response({ ok: false }, 404);
    }
    if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
      return response({ ok: false }, 415);
    }

    let message;
    try {
      const raw = await request.text();
      if (raw.length > 12_000) return response({ ok: false }, 413);
      message = JSON.parse(raw);
    } catch {
      return response({ ok: false }, 400);
    }

    const replyTo = String(message.replyTo || "").trim();
    const subject = String(message.subject || "");
    const text = String(message.text || "").slice(0, 10_000);
    if (!EMAIL_RE.test(replyTo) || !SUBJECTS.has(subject) || !text) {
      return response({ ok: false }, 400);
    }
    if (!env.EMAIL) return response({ ok: false }, 503);

    try {
      await env.EMAIL.send({
        from: "info@sonatoffshore.com",
        to: INBOX,
        replyTo,
        subject,
        text,
      });
    } catch (error) {
      console.error("Email Service send failed:", error?.code || "unknown");
      return response({ ok: false }, 502);
    }

    return response({ ok: true });
  },
};
