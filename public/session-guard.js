/* Session responses and account data stay out of shared browser caches. */
(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  let epoch = 0, closed = false, pending = new AbortController();
  const privatePage = () => document.body?.classList.contains('signed-in') || location.pathname.startsWith('/review-identity');
  const stale = () => new DOMException('The account session has ended.', 'AbortError');
  function erasePrivateView(clearPending = true) {
    epoch++; closed = true; pending.abort();
    const dashboard = document.getElementById('dashboard');
    if (dashboard) {
      dashboard.classList.add('hidden'); dashboard.inert = true;
      // Preserve nodes until navigation so in-flight error handlers remain harmless.
      const walker = document.createTreeWalker(dashboard, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) walker.currentNode.textContent = '';
      dashboard.querySelectorAll('input,textarea').forEach(input => {input.value = ''; if (input.type === 'checkbox') input.checked = false});
      dashboard.querySelectorAll('a').forEach(link => link.removeAttribute('href'));
    }
    for (const id of ['identityDialogBody', 'withdrawalDialogBody', 'reviewQueue', 'reviewDetail']) document.getElementById(id)?.replaceChildren();
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    document.body?.classList.remove('signed-in');
    if (clearPending) try {localStorage.removeItem('civ:pending-quote-v1'); sessionStorage.removeItem('civ:pending-quote-v1')} catch {}
  }
  let channel;
  try {channel = new BroadcastChannel('civ:session'); channel.onmessage = event => {if (event.data === 'logout' && privatePage()) {erasePrivateView(); location.replace('/join')}}} catch {}
  window.addEventListener('civ:session-ended', () => {erasePrivateView(); channel?.postMessage('logout')});
  window.addEventListener('pagehide', () => {if (privatePage()) erasePrivateView(false)});
  window.addEventListener('pageshow', event => {if (event.persisted) location.reload()});
  window.fetch = async (input, options = {}) => {
    const target = new URL(input instanceof Request ? input.url : String(input), location.href);
    const privateRequest = target.origin === location.origin && /^\/api\/(?:me(?:$|\?)|investor\/|admin\/|payments\/(?!config(?:$|\?))|celo\/testnet\/)/.test(target.pathname);
    if (!privateRequest) return nativeFetch(input, options);
    if (closed) throw stale();
    const start = epoch, signals = [pending.signal, options.signal || (input instanceof Request ? input.signal : AbortSignal.timeout(20000))].filter(Boolean);
    let release = () => {}, signal;
    if (typeof AbortSignal.any === 'function') signal = AbortSignal.any(signals);
    else {
      const joined = new AbortController();
      const abort = event => {joined.abort(event.target.reason); release()};
      release = () => signals.forEach(source => source.removeEventListener('abort', abort));
      signals.forEach(source => {if (source.aborted) joined.abort(source.reason); else source.addEventListener('abort', abort, {once:true})});
      signal = joined.signal;
    }
    let response;
    try {response = await nativeFetch(input, {...options, cache: 'no-store', signal})} catch (error) {release(); throw error}
    if (start !== epoch || closed) {release(); throw stale()}
    if (response.status === 401 && privatePage()) {erasePrivateView(); channel?.postMessage('logout'); location.replace('/join'); throw stale()}
    for (const method of ['json', 'text', 'blob', 'arrayBuffer']) {
      const read = response[method].bind(response);
      response[method] = async () => {try {const value = await read(); if (start !== epoch || closed) throw stale(); return value} finally {release()}};
    }
    return response;
  };
  window.addEventListener('focus', () => {if (privatePage() && !closed) fetch('/api/me',{signal:AbortSignal.timeout(15000)}).then(response=>response.body?.cancel()).catch(() => {})});
})();
