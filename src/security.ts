/** Request boundaries apply to Worker routes and static assets alike. */
type SecurityEnv = {APP_ORIGIN?: string; API_LIMITER: RateLimit};
const localHost = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
export const sessionCookieName = (url: string) => new URL(url).protocol === 'https:' ? '__Host-civ_session' : 'civ_local_session';
const blockedPath = /(?:^|\/)(?:\.(?!well-known(?:\/|$))|node_modules(?:\/|$)|src(?:\/|$)|migrations(?:\/|$)|docs(?:\/|$))|\.(?:map|sql|toml|env|bak|log|sqlite|db)(?:\/|$)|[\u0000-\u001f\\]/i;

export function contentSecurityPolicy(nonce:string,local=false){
 return [
      "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
      "script-src 'nonce-" + nonce + "' 'strict-dynamic'", "script-src-attr 'none'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'", "frame-src https://s.tradingview.com", "media-src 'none'", "worker-src 'none'", "manifest-src 'self'",
      ...(local ? [] : ['upgrade-insecure-requests'])
    ].join('; ');
}

export async function secureFetch<E extends SecurityEnv>(request: Request, env: E, ctx: ExecutionContext, dispatch: (request: Request, env: E, ctx: ExecutionContext) => Response | Promise<Response>): Promise<Response> {
  const url = new URL(request.url), local = localHost(url.hostname);
  const api = url.pathname.startsWith('/api/');
  const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  let response: Response;
  try {
    let path: string;
    try {path = decodeURIComponent(url.pathname)} catch {path = '\u0000'}
    const configured = env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : url.origin;
    if (!local && url.protocol !== 'https:') {
      response = new Response(null, {status: 308, headers: {Location: configured + url.pathname + url.search}});
    } else if (!local && url.origin !== configured) {
      response = new Response('Host not allowed', {status: 403});
    } else if (blockedPath.test(path) || path.length > 2048) {
      response = new Response('Not found', {status: 404});
    } else if (api && !['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(request.method)) {
      response = Response.json({error: 'Method not allowed'}, {status: 405});
    } else if (api && !['GET', 'HEAD'].includes(request.method) && (request.headers.get('Origin') !== url.origin || ['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site') || ''))) {
      response = Response.json({error: 'Same-origin request required'}, {status: 403});
    } else if (api && request.headers.get('Sec-Fetch-Site') === 'cross-site') {
      response = Response.json({error: 'Cross-site API access is not allowed'}, {status: 403});
    } else if (api && !['GET', 'HEAD'].includes(request.method) && request.body && url.pathname !== '/api/auth/logout' && !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '') && !(request.method === 'POST' && /^\/api\/investor\/kyc\/documents\/(identity|address)$/.test(url.pathname) && /^multipart\/form-data\s*;/i.test(request.headers.get('Content-Type') || ''))) {
      response = Response.json({error: 'Unsupported request content type'}, {status: 415});
    } else if (api && !(await env.API_LIMITER.limit({key: 'api:' + (request.headers.get('CF-Connecting-IP') || 'local')})).success) {
      response = Response.json({error: 'Too many requests. Please wait before retrying.'}, {status: 429, headers: {'Retry-After': '60'}});
    } else {
      response = await dispatch(request, env, ctx);
    }
  } catch (error) {
    console.error('CIV boundary unavailable', error instanceof Error ? error.name : 'Error');
    response = Response.json({error: 'Service temporarily unavailable. Please try again.'}, {status: 503});
  }
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), display-capture=(), clipboard-write=(self), document-domain=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (!local) headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.delete('X-Powered-By');
  const html = (headers.get('Content-Type') || '').includes('text/html');
  const privateResponse = api || html || url.pathname.startsWith('/review-identity') || response.status >= 300;
  if (privateResponse) {
    headers.set('Cache-Control', headers.get('Cache-Control')?.includes('private') ? 'private, no-store' : 'no-store');
    headers.set('CDN-Cache-Control', 'no-store');
    headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
    headers.set('Pragma', 'no-cache'); headers.set('Expires', '0');
    headers.set('Vary', 'Cookie, Origin, Sec-Fetch-Site');
    headers.delete('ETag'); headers.delete('Last-Modified');
  }
  if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname.startsWith('/api/admin/') || url.pathname.startsWith('/review-identity') || url.pathname.startsWith('/dashboard')) headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (html) {
    if(!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', contentSecurityPolicy(nonce,local));
    headers.delete('Content-Length');
    const secured = new Response(response.body, {status: response.status, statusText: response.statusText, headers});
    if (request.method !== 'HEAD' && response.status === 200) return new HTMLRewriter().on('script', {element(element) {element.setAttribute('nonce', nonce)}}).transform(secured);
    return secured;
  }
  if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}
