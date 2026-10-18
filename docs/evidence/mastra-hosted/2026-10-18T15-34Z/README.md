# Actual hosted Mastra approval and Chromium — persistence unverified

Deployed source `2a610ef8221d22c3b817af0ee343c47008788b15`, Render deployment `dep-dbaec9eq1p3s73bbp630`. One fresh Gemma proposal: 386 input + 292 output = 678 tokens, one HTTP 200 attempt. Actual Mastra 1.77.0 workflow run `ee3b01ae-f5fc-47fb-80dc-67b3811268e8`: approval suspension → controlled automated owner approval (not a human sign-off) → browser suspension → completion. All 4 steps succeeded and all 3 SDK processes exited. Maximum child RSS 150.58 MiB.

Actual Chromium: 2 passed, 3 failed, 0 blocked, 1 manual unverified. Five PNG files and the HTML report are downloaded real artifacts. Native events and snapshot hashes are in `browser-audit.json` and `controlled-approval.json`.

Tiger persistence returned unverified; this is a failed full verifier run. No judge-agent route was dispatched, no agent model/search reservation was taken. The actual retained receipt passes strict offline storage validation. Separately authorized read-only database diagnosis found no row for this audit ID and normal existing table constraints; the database remains unmodified. The root cause of the hosted insert failure is not established.

No successful Gemma proposal is replayed. A separately linked one-use continuation may exercise only the still-undispatched Mastra agent using fresh real Chromium from deterministic fixed checks. That is a separate source audit and does not turn this failed source save into a success.
