# AI Dev Guide

## Current workflow
1. Commit before using an agent.
2. Use small vertical slices.
3. Ask the agent to inspect first if app wiring is unclear.
4. Require exact validation commands.
5. Review diff before committing.

## NAS validation
The real runtime is the NAS Docker container, not the local Mac `.venv`.

Useful checks:

```bash
./deploy_to_nas.sh
curl -sS http://192.168.1.188:8088/api/gear/dashboard?limit=5 | jq .