const CANONICAL_HOST = "www.sonatoffshore.com";
const PAGES_HOST = "sonatoffshore-web.pages.dev";

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  const isPagesAlias = hostname === PAGES_HOST || hostname.endsWith(`.${PAGES_HOST}`);
  const isApex = hostname === "sonatoffshore.com";
  const isHttpCanonicalDomain = url.protocol === "http:" &&
    (hostname === "sonatoffshore.com" || hostname === CANONICAL_HOST);

  if (isPagesAlias || isApex || isHttpCanonicalDomain) {
    url.protocol = "https:";
    url.hostname = CANONICAL_HOST;
    url.port = "";
    const headers = new Headers({ Location: url.toString() });
    if (isPagesAlias) headers.set("X-Robots-Tag", "noindex");
    return new Response(null, { status: 308, headers });
  }

  return next();
}
