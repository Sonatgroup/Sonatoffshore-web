const INBOX = "info@sonatoffshore.com";
const MAX_BODY_BYTES = 12_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const formDefinitions = {
  intro: {
    label: "Intro call request",
    fields: ["name", "phone", "email", "company"],
    subject: "Website intro call request",
  },
  contact: {
    label: "Contact enquiry",
    fields: ["name", "phone", "email", "company", "message"],
    required: ["name", "email", "message"],
    subject: "Website contact enquiry",
  },
  assetos: {
    label: "AssetOS full details request",
    fields: ["name", "company", "email"],
    subject: "AssetOS information request",
    consent: true,
    required: ["name", "company", "email"],
  },
  projectos: {
    label: "ProjectOS full details request",
    fields: ["name", "company", "email"],
    subject: "ProjectOS information request",
    consent: true,
    required: ["name", "company", "email"],
  },
  newsletter: {
    label: "Newsletter signup",
    fields: ["email"],
    subject: "SONAT Offshore newsletter signup",
  },
};

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function clean(value, max = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ ok: false, message: "Request could not be accepted." }, 403);
  }

  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
    return json({ ok: false, message: "Unsupported request format." }, 415);
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ ok: false, message: "Request is too large." }, 413);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: "Please check the form and try again." }, 400);
  }

  if (JSON.stringify(payload).length > MAX_BODY_BYTES) {
    return json({ ok: false, message: "Request is too large." }, 413);
  }

  // Quietly accept honeypot submissions without sending an email.
  if (clean(payload.website, 200)) return json({ ok: true });

  const definition = formDefinitions[clean(payload.formType, 30)];
  if (!definition) return json({ ok: false, message: "Unknown form." }, 400);

  const values = {};
  for (const field of definition.fields) values[field] = clean(payload[field]);

  for (const field of definition.required || []) {
    if (!values[field]) return json({ ok: false, message: "Please complete all required fields." }, 400);
  }

  if (!values.email || !EMAIL_RE.test(values.email) || values.email.length > 254) {
    return json({ ok: false, message: "Enter a valid email address." }, 400);
  }
  if (definition.fields.includes("name") && !values.name) {
    return json({ ok: false, message: "Enter your name." }, 400);
  }
  if (definition.consent && payload.consent !== true) {
    return json({ ok: false, message: "Please confirm the privacy consent." }, 400);
  }

  if (!env.EMAIL_SERVICE) {
    return json({ ok: false, message: "Email delivery is not configured yet." }, 503);
  }

  const lines = [definition.label, ""];
  for (const field of definition.fields) {
    const label = field === "email" ? "Email" : field === "phone" ? "Phone" : field === "company" ? "Company" : field === "message" ? "Message" : "Name";
    lines.push(`${label}: ${values[field] || "Not provided"}`);
  }
  if (definition.consent) lines.push("Privacy consent: Yes");

  try {
    const delivery = await env.EMAIL_SERVICE.fetch("https://sonat-email.internal/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: INBOX,
        replyTo: values.email,
        subject: definition.subject,
        text: lines.join("\n"),
      }),
    });
    if (!delivery.ok) throw new Error("Email service rejected the message");
  } catch (error) {
    console.error("SONAT form email delivery failed:", error?.message || "unknown");
    return json({ ok: false, message: "We could not send your request right now. Please try again or email info@sonatoffshore.com." }, 502);
  }

  return json({ ok: true, message: "Thank you. Your information has been sent to SONAT Offshore." });
}
