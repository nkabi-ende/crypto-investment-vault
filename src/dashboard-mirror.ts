export const dashboardMirror = `<!doctype html>
<html lang="en">
<head>
 <meta charset="utf-8">
 <meta name="viewport" content="width=device-width,initial-scale=1">
 <meta name="theme-color" content="#0b1011">
 <meta name="robots" content="noindex,nofollow">
 <title>Dashboard mirror | Crypto Investment Vault</title>
 <link rel="icon" href="/favicon.svg">
 <link rel="stylesheet" href="/dashboard-mirror.css">
</head>
<body>
 <div class="shell">
  <header>
   <a href="/" class="brand"><img src="/civ-mark.svg" alt="" width="83" height="36">Crypto Investment Vault</a>
   <a class="pill" href="/dashboard">Open my dashboard</a>
  </header>
  <main>
   <h1>Dashboard mirror</h1>
   <p class="muted">A read-only preview of the member dashboard.</p>
   <nav aria-label="Dashboard sections">
    <a class="pill" href="#overview">Overview</a>
    <a class="pill" href="#big-seven">Big 7</a>
    <a class="pill" href="#deposits">Deposits</a>
    <a class="pill" href="#circle">CIV Circle</a>
    <a class="pill" href="#account">Account</a>
   </nav>
   <section id="overview">
    <h2>Overview</h2>
    <div class="grid">
     <article class="card"><h3>Market watch</h3><p>Explore the seven cryptoassets tracked by the vault.</p><a href="#big-seven">View the Big 7</a></article>
     <article class="card"><h3>Deposit setup</h3><p>See the steps members follow when using MiniPay.</p><a href="#deposits">View deposit steps</a></article>
     <article class="card"><h3>Account details</h3><p>See where members find their account information.</p><a href="#account">View account</a></article>
    </div>
   </section>
   <section id="big-seven">
    <h2>Big 7 market watch</h2>
    <ul class="card assets">
     <li><img src="/assets/coins/btc.svg" alt="" width="28" height="28">Bitcoin <strong>BTC</strong></li>
     <li><img src="/assets/coins/eth.svg" alt="" width="28" height="28">Ethereum <strong>ETH</strong></li>
     <li><img src="/assets/coins/sol.svg" alt="" width="28" height="28">Solana <strong>SOL</strong></li>
     <li><img src="/assets/coins/xrp.svg" alt="" width="28" height="28">XRP <strong>XRP</strong></li>
     <li><img src="/assets/coins/bnb.svg" alt="" width="28" height="28">BNB <strong>BNB</strong></li>
     <li><img src="/assets/coins/ada.svg" alt="" width="28" height="28">Cardano <strong>ADA</strong></li>
     <li><img src="/assets/coins/doge.svg" alt="" width="28" height="28">Dogecoin <strong>DOGE</strong></li>
    </ul>
   </section>
   <div class="grid">
    <section class="card" id="deposits">
     <h2>Deposits</h2>
     <ol><li>Choose USDC or USDT.</li><li>Review the payment request.</li><li>Approve in MiniPay.</li><li>Check the deposit status.</li></ol>
    </section>
    <section class="card" id="circle">
     <h2>CIV Circle</h2>
     <p>Members can find their invitation link and referral activity in this section.</p>
    </section>
    <section class="card" id="account">
     <h2>Account</h2>
     <dl><dt>Account name</dt><dd>Mirror account</dd><dt>Access</dt><dd>Read-only preview</dd></dl>
    </section>
   </div>
  </main>
 </div>
</body>
</html>
`;
