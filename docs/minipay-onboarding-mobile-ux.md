# MiniPay first-time user journey and mobile accessibility

## Product principles
- **CIV signup has no wallet prerequisite.** A new visitor may create an account and explore the Big 7 without stablecoins.
- **Prepare to deposit only when eligible.** CIV public deposits are still closed; the one-account production pilot is separate.
- The funding experience is a three-stage pathway: (1) CIV account → (2) MiniPay wallet → (3) obtain USDC or USDT inside MiniPay and return to CIV for a separate verified checkout.
- Use officially published download destinations: Google Play `com.opera.minipay` and App Store `id6504087257` (South Africa localization). MiniPay https://minipay.to/ is the fallback official product site.
- Local Add Cash options, costs, fiat ramps and identity verification differ by region and payment partner; CIV does not promise a specific partner or rate.
- Never suggest a wallet top-up itself credits the CIV account. A CIV deposit requires a signed-in eligible user, an active and unexpired quote, MiniPay approval and independent Celo mainnet reconciliation.

## Interface
- Hero: short, optional explanation with anchor to the guide, not a blocker in the signup form.
- Landing page: three small cards and a link to either app store or the MiniPay Add Cash action.
- Registration: a brief note that no wallet is necessary for registration.
- Deposit tab: a compact setup shortcut above the amount selector, and a context card for new and existing MiniPay users.
- Walkthrough: five skippable and replayable stages, starting with wallet creation and stablecoin acquisition.
- Bottom navigation under 700px: fixed five-column grid with all tabs visible at once, ~60px total height, safe-area inset spacing and 44px minimum tap height. Avoid horizontal tab scrolling entirely.
- Layout: shell width is exactly viewport-contained at mobile; nested cards, funding panels, prices and referral links are allowed to shrink or wrap.

## Regression coverage
Mobile browser tests cover 320, 360, 390, 428, 768 and 1280px; validate that the navigation is visible, never horizontal-scrolls, and that all five tabs remain within viewport width. Validate three-step public MiniPay guidance, the signup CTA, wallet modal first two steps, install links and absence of page-level overflow.

This release does **not** alter the authenticated payment allowlist, receiving address, D1 balances, pilot settings, token contracts, provider keys or regulatory requirements.
