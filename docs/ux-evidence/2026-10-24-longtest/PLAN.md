# PR54 release endurance gate — 2026-10-24

Candidate: 03cd764fc605afbcaa5577922f3145b490906e21 (diagnostic context, based on 2.4.1).
TV installed asset/service hashes and loaded entry verified before starting.

1. Monitor self-tests: VOD polling/counter/cleanup cases and 21 live delivery/history cases.
2. VOD: 45 wall-clock minutes, BV1sapi6qE72, 3840x2160 HEVC >=50fps. No reload between minute samples. Three real API checks every minute; service epoch/uptime checks prevent restarted services from masquerading as continuous health. Track >3s progress gaps, dropped-frame deltas by playback segment, buffered time and heap. >15s gap or API failure fails a gate; any >3s gap/dropped-frame observations require investigation.
3. Live: five open/exit cycles then 30 minutes in a currently active room. Native playback progress and resolution; token/subscription/heartbeat state; recent relay delivery (not lifetime message totals); independent history if no messages for 120s; no late DOM or subscriber leaks on exit. Quiet rooms are unverified, not silently passed.
4. Post-soak: review memory trends and cleanup, verify normal requests and new diagnostic fields still work. Preserve original failures. Restore settings and exit playback.

No release before results are reviewed. Local/TV measurements do not establish overseas network behavior or physical panel/audio quality. No automatically exported Cookie, signed URL, chat contents or nickname. Screenshots with account information remain private. Physical screen confirmation is separately requested.
