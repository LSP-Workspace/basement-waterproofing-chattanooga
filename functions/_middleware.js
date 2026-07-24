const CANONICAL_HOST = "basementwaterproofingchattanooga.com";
const PAGES_HOST = "basement-waterproofing-chattanooga.pages.dev";
const REDIRECT_HOSTS = new Set([CANONICAL_HOST, `www.${CANONICAL_HOST}`, PAGES_HOST]);

export function onRequest(context) {
  const url = new URL(context.request.url);

  if (!REDIRECT_HOSTS.has(url.hostname)) {
    return context.next();
  }

  if (url.protocol === "https:" && url.hostname === CANONICAL_HOST) {
    return context.next();
  }

  url.protocol = "https:";
  url.hostname = CANONICAL_HOST;
  return Response.redirect(url.toString(), 301);
}
