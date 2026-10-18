# Actual hosted approval/browser run; later persistence failed

This controlled automated owner test used actual Gemma (386 input / 292 output tokens), actual Mastra 1.77.0 suspend/resume and actual hosted Chromium. Approval is not a human/customer action. The unapproved proposal, approval, SDK lifecycle and browser observations are retained. Chromium observed **2 passed / 3 failed / 0 blocked / 1 unverified**.

The overall verifier failed because Tiger rejected the newly added `approvalWorkflow` audit property. No evidence-agent route was dispatched, no Temporal workflow was created, no search was sent, and no judge slot was reserved. This is partial hosted Mastra evidence, not a full hosted agent success. Screenshot references are present; this initial verifier did not download their bytes before failure. No existing request or reservation is replayed or refunded.

The one guarded Temporal continuation will make **zero new proposal calls**: it retains this successful proposal reservation and starts the still-undispatched evidence agent using a separately approved, freshly observed deterministic sample audit. No failed or uncertain model/search operation is replayed.
