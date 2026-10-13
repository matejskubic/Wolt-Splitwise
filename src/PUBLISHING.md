# Store Submission Answers

## Single Purpose Description

Wolt to Splitwise converts a Wolt group order into a shared expense in the user's selected Splitwise group. It reads participant costs, applies available discounts, and divides service and delivery fees among participants. Users review member matching, amounts, and the payer before submitting the expense. Saved checkout breakdowns allow the same order to be split later from order history or tracking.

## Storage Justification

The extension uses local storage to retain the user's Splitwise access token, default group, settings, and remembered participant-to-member mappings. It also retains up to 50 checkout breakdowns containing participant names, prices, discounts, and fees so an expense can be created after checkout. Checkout breakdowns are additionally stored in browser sync storage for use across the user's synced browser installations. Access tokens are stored locally, not in sync storage.

## Identity Justification

The identity permission is used with `chrome.identity.launchWebAuthFlow` to let the user sign in to Splitwise and approve access. It receives the OAuth callback at the extension's redirect address so the extension can obtain an access token. The Splitwise application secret remains on the authentication service and is not included in the extension.

## ActiveTab Justification

When the user clicks the extension, it identifies the active Wolt tab and requests its order breakdown for review. The activeTab permission provides temporary access to that tab for this user-initiated workflow without requesting the general tabs permission or access to unrelated browsing activity.

## Scripting Justification

The scripting permission allows the extension to inject its bundled Wolt receipt-reading content script when the user clicks the extension on a Wolt tab that was already open before the extension was installed or reloaded. This restores communication with that tab without requiring a page refresh. Only the extension's packaged script is injected, and only into a Wolt tab; no remote code is executed.

## Host Permission Justification

- `https://wolt.com/*`: Reads participant costs, discounts, fees, and receipt details on Wolt checkout, order history, and tracking pages. A content script also saves checkout breakdowns automatically while the Ready tab is selected, without requiring the extension popup to be opened. Host access supports these pages and Wolt's client-side navigation between them. The extension does not place orders or change payment details.
- `https://secure.splitwise.com/*`: Makes authenticated Splitwise API requests to retrieve the user's identity, groups, and group members, and to create the expense after the user reviews and submits it.
- `https://auth-research.splitwise-extensions.workers.dev/*`: Exchanges the OAuth authorization code for an access token through the extension's authentication service. The service supplies the Splitwise application secret server-side. It is used for authentication, not receipt processing or expense submission.

## Developer Review Note

The Wolt host permission already grants access to Wolt tabs, so `activeTab` may be redundant for the current implementation. Review whether it can be removed before submitting the extension, and omit its justification if it is removed. This note is for developers, not a store submission field.
