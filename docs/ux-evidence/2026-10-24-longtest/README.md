# Release endurance gate — incomplete

Candidate tested: 03cd764fc605afbcaa5577922f3145b490906e21. All 16 checked installed bundle/service hashes matched; loaded legacy entry matched.

The planned 45-minute VOD run started with 3840x2160 HEVC at 50fps and three successful API probes. Around 40 seconds the video was closed and the page became hidden. At minute 1 there was no player, no media error and no uncaught page exception, while all three API checks and service uptime were healthy. No application restart was observed. The cause of leaving playback is unconfirmed; this is not proof of a network or decoder defect. The first run was explicitly interrupted (SIGINT), evidence retained, and monitor/settings cleanup passed. The attempted foreground-app query was denied by webOS. Physical screen/remote-operation confirmation is pending. Do not count the run as passed or as 45 minutes of testing.

Local loopback stress completed in approximately 109 seconds: 20/20 scenarios passed with STABILITY_ROUNDS=500, 23,000 helper operations and 4,000 production-proxy operations. All 24,500 owned helper requests closed; resource cleanup assertions passed. These are repeated injected failures, not a substitute for wall-clock TV endurance, real DNS/TLS or overseas conditions.

Release remains gated on completed VOD and live endurance runs plus review of gaps, counters and memory. No release was made.
