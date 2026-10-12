# Wolt to Splitwise

Browser extension for Microsoft Edge, Brave and other Chromium browsers. It reads who ordered what in a **Wolt group order** and adds it to a **Splitwise** group as one expense. The person who paid is the payer, everyone owes their own items, and service/delivery fees are split evenly.

## Install

1. Download `wolt-splitwise-<version>.zip` from the latest [GitHub release](../../releases) and unzip it.
2. Open `edge://extensions` (or `brave://extensions`), turn on **Developer mode**, click **Load unpacked** and pick the unzipped folder.

## First-time setup

Open the extension's **Settings** (right-click the icon → *Extension options*):

1. **Connect with Splitwise** and approve access. Alternatively, paste a personal Splitwise API key.
2. Pick your default **Splitwise group** and click **Save group**.

## Splitting an order

### On the checkout page (recommended)

1. Open the group order checkout page (`wolt.com/…/group-order/<id>/checkout`) and select the **Ready** tab. Per-person discounts are only shown there.
2. Click the extension icon.
3. Check the people matched to Splitwise members (pick any that weren't matched), the fees, the payer and the group.
4. Click **Send to Splitwise**.

The extension also saves the checkout breakdown automatically whenever the **Ready** tab is visible, so you can send the expense later.

### Later, from order history

1. Open the order under **Profile → Order history** on wolt.com and click the extension icon.
2. Per-person discounts come from the checkout saved earlier. If none was saved, either:
   - paste the amounts under **Paste split amounts** as CSV (`Name,8.67` per line) or JSON. **Settings** has a prompt for getting them from a checkout screenshot with an AI assistant, or
   - leave it, and the order discount is split proportionally.

## Privacy

Your Splitwise access token, settings and the last 50 saved checkouts stay in your browser's extension storage. Saved checkouts are also synced through your browser profile.

Developers: see [DEVELOPMENT.md](DEVELOPMENT.md).
