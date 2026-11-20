(() => {
  const turnstileSiteKey = "0x4AAAAAAGK3nLYFafABL6rc";
  const widgets = new WeakMap();
  let turnstileReady;

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstileReady) {
      turnstileReady = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
        if (existing) {
          existing.addEventListener("load", () => resolve(window.turnstile), { once: true });
          existing.addEventListener("error", reject, { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.onload = () => resolve(window.turnstile);
        script.onerror = reject;
        document.head.append(script);
      });
    }
    return turnstileReady;
  }

  function addTurnstile(form) {
    const container = document.createElement("div");
    container.className = "cf-turnstile form-turnstile";
    container.setAttribute("aria-label", "Security verification");
    const button = form.querySelector('button[type="submit"]');
    if (button) button.before(container);
    else form.append(container);

    loadTurnstile().then((api) => {
      if (!api || !container.isConnected) return;
      const id = api.render(container, {
        sitekey: turnstileSiteKey,
        callback: () => form.removeAttribute("data-turnstile-error"),
        "expired-callback": () => api.reset(widgets.get(form)),
        "error-callback": () => form.setAttribute("data-turnstile-error", "true"),
      });
      widgets.set(form, id);
    }).catch(() => form.setAttribute("data-turnstile-error", "true"));
  }

  const formTypes = new Map([
    ["contact-form", "intro"],
    ["contact-page-form", "contact"],
    ["assetos-information-form", "assetos"],
    ["projectos-information-form", "projectos"],
    ["footer-newsletter__form", "newsletter"],
  ]);

  function getType(form) {
    if (form.dataset.emailForm) return form.dataset.emailForm;
    for (const className of formTypes.keys()) {
      if (form.classList.contains(className)) return formTypes.get(className);
    }
    return null;
  }

  function addHoneypot(form) {
    if (form.querySelector('[name="website"]')) return;
    const wrapper = document.createElement("div");
    wrapper.className = "form-honeypot";
    wrapper.setAttribute("aria-hidden", "true");
    wrapper.innerHTML = '<label>Leave this field blank<input name="website" type="text" tabindex="-1" autocomplete="off" /></label>';
    form.append(wrapper);
  }

  function statusFor(form) {
    let status = form.querySelector("[data-form-status]");
    if (!status) {
      status = document.createElement("p");
      status.className = "form-submission-status";
      status.dataset.formStatus = "";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.hidden = true;
      form.append(status);
    }
    return status;
  }

  async function submit(form, type) {
    if (!form.reportValidity()) return;
    const turnstileResponse = form.querySelector('[name="cf-turnstile-response"]')?.value;
    if (!turnstileResponse) {
      const status = statusFor(form);
      status.hidden = false;
      status.dataset.state = "error";
      status.textContent = "Please complete the security check and try again.";
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    const status = statusFor(form);
    const originalText = button?.textContent;
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.formType = type;
    payload.consent = data.get("consent") === "on";

    if (button) {
      button.disabled = true;
      if (button.textContent.trim()) button.textContent = "Sending…";
      button.setAttribute("aria-busy", "true");
    }
    status.hidden = false;
    status.dataset.state = "pending";
    status.textContent = "Sending your information…";

    try {
      const response = await fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to send your information.");
      status.dataset.state = "success";
      status.textContent = result.message || "Thank you. Your information has been sent to SONAT Offshore.";
      form.reset();
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error.message || "We could not send your information. Please try again or email info@sonatoffshore.com.";
    } finally {
      const api = window.turnstile;
      if (api && widgets.has(form)) api.reset(widgets.get(form));
      if (button) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        if (originalText?.trim()) button.textContent = originalText;
      }
    }
  }

  document.querySelectorAll("form").forEach((form) => {
    const type = getType(form);
    if (!type) return;
    addHoneypot(form);
    addTurnstile(form);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit(form, type);
    });
  });
})();
