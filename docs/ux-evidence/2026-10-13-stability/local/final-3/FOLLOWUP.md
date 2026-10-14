# Candidate 3 superseded after real TV live endurance

The two completed local commands and their original results remain unchanged. They did not detect the subsequent TV relay delivery stall: chat frames/events stayed at 216/956 while two independent room-history probes showed new chat. The original live tool tested cumulative receipt and missed ongoing delivery failure.

The corrected monitor re-evaluated the preserved TV data as `active_room_relay_stale`: [evidence and limits](../../live-continuity-monitor/README.md), [machine-readable reassessment](../../live-continuity-monitor/candidate3-reassessment.json). At least 371,927ms without new delivery is established conservatively; the exact old socket state was not recorded, so retry-budget exhaustion is a reproduced code mechanism, not a proven cause of that particular TV session.

Candidate 4 changes relay recovery, auth/heartbeat deadlines and actual transport disposal; its local and TV runs must start over. Candidate 3's local PASS is not a final application stability approval.
