# Service transport stability, 2026-10-13

Command from the repository root (Node 18+; no npm install, account, TV or internet required):

```sh
STABILITY_OUTPUT=docs/ux-evidence/2026-10-13-stability/service node tools/test-service-stability.mjs
```

`STABILITY_ROUNDS` defaults to 50 and accepts 20–500. The transport helper deadline is deliberately reduced to 120 ms; individual operations have a 1.5 s watchdog and the suite has a 180 s hard watchdog that saves an incomplete report and exits nonzero. Increasing the rounds can hit this fixed upper bound; use the default for the normal gate. This is a repeated fault/recovery stress test, not a wall-clock soak or throughput benchmark.

The final run on Node v25.4.0 passed **20/20 cases**, with 2,300 helper operations, 400 calls through the isolated production HTTP proxy, and three positive controls. The helper created 2,450 actual `ClientRequest` objects including retries; all 2,450 emitted `close`. No process warning was emitted. The suite was rerun after the fingerprint bootstrap fix below. See exact start/end timestamps in [results.json](results.json) and [run.log](run.log).

## Coverage and acceptance

The real `upstreamRequest.js`, `requestDeadline.js`, and `httpBody.js` execute against loopback HTTP sockets. Each of the following runs 50 times with an immediate healthy request using the same pool: successful JSON, gzip, reset followed by a successful single retry, two consecutive resets, POST reset without replay, HTTP 503 without replay, truncated response, stalled response body, missing response headers, and corrupt gzip. Error completion is bounded, response callbacks settle once, and a delayed second callback is rejected after the deadline elapses.

Additional repeated cases cover 50 DNS deadlines with 50 immediate DNS cancellations; 50 cancellations after the retry has actually connected; and 50 saturated-pool rounds. Each pool round holds two sockets, queues 12 requests that expire and six requests that are cancelled, releases the blockers, and requires a successful new request. **600 queued expirations and 300 queued cancellations never reached the fixture.** The queue must drain before proceeding.

The unchanged `service.js` is also loaded in a VM with isolated disk, webOS registration, and loopback network boundaries. No real cookie file is opened and no real host is contacted. Four proxy cases each run 50 times followed by a successful proxy request: client cancellation before upstream headers, client cancellation during the body, truncated upstream response, and repeated upstream connection reset. The latter must return HTTP 502 with CORS; partial bodies must reject. After each case the service's upstream Agent has zero active requests and zero queued requests.

The three positive controls show that raw HTTP fails on a reset, an end-only response consumer never receives `end` on truncation, and `ClientRequest.setTimeout()` alone does not bound pending DNS lookup. They verify the fixture really produces the targeted failures. The pending DNS resolver is deliberately injected; HTTP resets, body truncation, client cancellation, and connection-pool queueing exercise real Node socket and request lifecycles.

## Resource evidence

`checkpoints` record Agent active, queued and idle sockets plus owned requests and fixture connections. Idle keep-alive connections are expected and bounded by each pool's configured limit, rather than misclassified as leaks. After every saturated-pool round the queue is empty and the pool can successfully serve a new request. At final teardown every owned Agent is destroyed; fixture sockets and tracked requests must reach zero and request creation/close counts must match. This is stronger than comparing a single `process._getActiveHandles()` count, but does not prove there are no heap leaks in other application subsystems.

The first run reached 19/20 and failed only teardown. Inspection identified the anonymous bootstrap request using the test process's default Node 25 keep-alive Agent, which the harness had not owned or destroyed. The harness now supplies an explicitly owned default Agent at the isolated HTTPS boundary. This teardown correction required no production code change. The first report is retained in [initial-harness-failure.json](initial-harness-failure.json); it must not be presented as a discovered production socket leak.

## Confirmed anonymous startup defect and repair

Investigating that bootstrap path exposed a separate production defect: `ensureBuvid()` still bypassed the transport helpers. DNS and header waits had no deadline, body truncation had no application error handler, and malformed responses did not schedule the existing retry. The old code also accepted a JSON fingerprint from an HTTP 503 response.

The dedicated test uses the **real production 10-second deadline and 15-second retry backoff** against isolated loopback fixtures:

```sh
BUVID_OUTPUT=docs/ux-evidence/2026-10-13-stability/service/buvid-after node tools/test-buvid-stability.mjs
```

To compare an old source snapshot without checking out or modifying the repository:

```sh
git show 4eb77e0c14ee04c51ba07739d92dd6bd9a650e73:service/com.biliwebos.app.service/service.js > /tmp/old-service.js
BUVID_SOURCE=/tmp/old-service.js BUVID_BASELINE=1 BUVID_OUTPUT=/tmp/bili-buvid-before node tools/test-buvid-stability.mjs
```

The baseline intentionally exits 1 when it reproduces the failures. Its source SHA-256 is `81904add59fe8f021c5ba2185ae76f5a7a7a6dee7b1cdab2b71ae0b3ca671276`.

The saved [before report](buvid-before/results.json) fails all seven gates. At 11.2 seconds the DNS, missing-header and stalled-body cases each still own an unfinished request. Truncation has zero production response-error listeners. Invalid JSON does not retry, and the 503 response stores the deliberately invalid fingerprint. A separate guard in the harness observes the old unhandled response error so the test process can retain evidence; it does not count as a production error listener.

`service.js` now uses `upstreamRequest` and `httpBody` for that startup path, checks HTTP status and the parsed fingerprint, and keeps the existing maximum of six logical attempts with 15-second backoff. Requests carry the same anonymous headers, and only anonymous fingerprint fields are saved; no login credentials are fabricated or replaced.

The [after report](buvid-after/results.json) passes **7/7** in approximately 25 seconds. DNS, missing headers and the stalled body close at approximately 10 seconds. Six fault scenarios recover their anonymous fingerprint after the real 15-second backoff. A seventh persistent-invalid-response case compresses only the retry delays to 20 ms to verify exactly six attempts, then zero pending retry timers; it does not claim a 75-second continuous retry test. All seven cases retain a working service request, save no account credential fields, and release all owned requests/sockets at teardown. The suite has a 45-second hard watchdog and records the tested service source SHA-256. [Service unit tests](unit-after.log) also pass 41/41.

The change is limited to devices starting without `buvid3`. This is not evidence that the earlier authenticated-TV "all requests fail after 20 minutes" report had the same root cause. The real TV candidate under long playback test was not modified by this local repair.

## Confirmed service subscription retention and repair

The TV SDK cancelling a request is only half of subscription cleanup. The service previously kept cast and live subscription messages in arrays without registering a cancellation callback. Cast messages were removed only if a later broadcast threw; in a quiet room, a live relay could also remain after its final listener left.

The service now registers the third `service.register` callback and removes messages by `uniqueToken`, retaining object identity as a fallback for local bridges. The final live listener's cancellation also stops the relay. This follows LG's documented [cancellation and message identity contract](https://webostv.developer.lge.com/develop/references/webos-service-reference) and [service subscription lifecycle](https://webostv.developer.lge.com/develop/guides/js-service-usage). Diagnostic responses include subscriber counts and relay-active state so device testing can observe whether they return to baseline.

```sh
SERVICE_SUB_OUTPUT=docs/ux-evidence/2026-10-13-stability/service/subscriptions-after node tools/test-service-subscriptions.mjs
```

The [old source fails 5/5](subscriptions-before/results.json): 50 cancelled cast subscriptions retain 50 message references, and 50 cancelled live subscriptions do the same. The [new source passes 5/5](subscriptions-after/results.json): no stale references or broadcasts, all 50 live relay start/stop pairs balance, cancelling one of two listeners keeps the other working, and duplicate/unknown cancellation cannot remove another listener. Source SHA-256 is recorded in each report. These are production handlers invoked at an isolated webOS boundary; actual LS2 event delivery and actual WebSocket closure still require the corresponding device/bridge tests. The relay is a controlled start/stop fixture, not a real remote connection.

## Development bridge cancellation

The development bridge previously discarded the service registration's cancel callback and did not forward a closed subscription WebSocket. The shared webOS service stub now retains cancel callbacks, and `dev-service.mjs` gives each request a unique token and forwards connection close/error exactly once. This allows the simulator to exercise the same service cleanup contract.

```sh
BRIDGE_SUB_OUTPUT=docs/ux-evidence/2026-10-13-stability/service/bridge-after node tools/test-dev-bridge-subscriptions.mjs
```

The test executes the actual bridge HTTP/WebSocket dispatch source with the actual shared stub and isolated production service. It opens and closes real loopback WebSockets. [The old bridge fails 3/3](bridge-before/results.json), retaining 50 cast messages and 50 live messages. [The new bridge passes 3/3](bridge-after/results.json), returning both counts to zero and preserving the surviving connection in the two-subscriber case. All request tokens are distinct. This test intentionally isolates service disk, relay and LAN advertisement boundaries; the separate simulator test still covers bridge process startup and its module-loader hook.

## Final review additions

A valid JSON `null` fingerprint response exposed a remaining parse-success/type-check failure. The [pre-fix run](buvid-null-before/results.json) passes 7/8 but records `TypeError: Cannot read properties of null (reading 'code')` and no scheduled retry for this case. The service now rejects null through its normal failure path. The [final fingerprint run](buvid-null-after/results.json) passes **8/8 with zero uncaught errors**; all real deadline/backoff checks remain in place. The test's process-level observer records uncaught failures and makes the gate fail, rather than hiding them. [Service unit tests](unit-after-null.log) remain 41/41.

The DEV client also previously returned only the fallback socket's cleanup while bridge discovery was pending. A late successful discovery could then create an unowned second subscription. The DEV branch now selects one transport after discovery and uses one idempotent cleanup for either outcome, suppressing frames after cancellation. The TV branch is unchanged by this addition.

```sh
DEV_SUB_OUTPUT=/tmp/bili-dev-subscription-cleanup node tools/test-dev-subscription-cleanup.mjs
```

This deterministic in-memory DEV client test uses controlled discovery and WebSocket event boundaries. [Before](dev-client-before/results.json): 0/4, including 20 active late bridge sockets after 20 cancellations. [After](dev-client-after/results.json): **4/4**, covering early cancellation, single-transport selection, fallback, idempotent close and late-frame suppression. It compiles only the test module in memory and does not write app build output. The shipped SDK cancellation [recheck](client-tv-cancel-recheck/results.json) remains **6/6**, including 20 cast and 20 live request handles each cancelled exactly once.

## Limits

This run does not test TLS handshakes, remote DNS servers, overseas routes, webOS's legacy Node binaries, authenticated/VIP API behavior, decoder/GPU memory, sleep/wake, or 24-hour lifetime. A passing local stress test cannot close those device or network investigations. Production timeouts remain unchanged; the 120 ms value is supplied only to the helper test calls. The production proxy's cancellation and error paths are tested without shortening its internal timeout.
