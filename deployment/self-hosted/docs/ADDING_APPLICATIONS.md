# Adding an Application

Every new application must remain independently deployable and must not be able
to exhaust the server resources needed by Cartdotcom.

## Required process

1. Create `/srv/<application>` and a dedicated Compose project.
2. Give the project its own named volumes and internal network.
3. Join `cartdotcom-edge` only when Caddy must route traffic to it.
4. Never join `cartdotcom-data` unless the application is an approved
   Cartdotcom component.
5. Set explicit CPU, memory, and PID limits for every service.
6. Publish no host ports except temporary loopback-only diagnostic ports.
7. Add the public route to Caddy instead of exposing the container directly.
8. Put secrets in ignored files with mode `0600`; commit only examples.
9. Add a health check, restart policy, backup definition, and verification script.
10. Document purpose, ownership, storage, recovery, and upgrade procedure here or
    in the application's own README.

## Initial resource ceilings

| Workload | Initial ceiling |
|---|---:|
| Shared platform | 3.5 GB RAM |
| Cartdotcom core excluding Codex workers | 4 GB RAM |
| Cartdotcom Codex worker pool | 5 GB RAM |
| Media server | 2 GB RAM when idle/direct-playing |
| Other Codex applications | 1.5 GB RAM initially |

Do not schedule 4K software transcoding alongside a full Codex worker pool. The
Ryzen 5 5500 has no integrated video encoder, so media clients should use direct
play until a supported GPU is added.

## Application checklist

- [ ] Unique Compose project name
- [ ] Health endpoint and container health check
- [ ] CPU, memory, and PID limits
- [ ] No unnecessary published ports
- [ ] Durable files on named volume or documented bind mount
- [ ] Backup and restore commands tested
- [ ] Secrets excluded from Git and logs
- [ ] Start, stop, upgrade, and rollback commands documented
- [ ] Monitoring and failure notification defined
- [ ] Changelog entry added
