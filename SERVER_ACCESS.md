# Cartdotcom Ubuntu Server Access

Last verified: 2026-08-19 (Australia/Brisbane)

This document is the handoff reference for chats and tools that need to access the local Cartdotcom server. It intentionally contains no passwords, private keys, API keys, or dashboard tokens.

## Quick Access

From the Windows PC, use the configured SSH alias:

```powershell
ssh cartdotcom-server
```

For a non-interactive connectivity check:

```powershell
ssh -o BatchMode=yes -o ConnectTimeout=10 cartdotcom-server "hostname; whoami; uptime -p"
```

Expected host and user:

```text
cartdotcom-server
lucaj
```

Key-only authentication is configured and does not require the Ubuntu account password for normal SSH commands.

## Server Identity

| Field | Value |
|---|---|
| Distribution | Ubuntu Server 24.04.4 LTS |
| Codename | Noble Numbat (`noble`) |
| Architecture | x86_64 |
| Kernel at verification | `6.8.0-138-generic` |
| Hostname | `cartdotcom-server` |
| SSH user | `lucaj` |
| Network interface | `enp4s0` |
| Current IPv4 address | `192.168.68.66/22` |
| SSH port | `22` |
| ED25519 host fingerprint | `SHA256:YXQpxhKkqI2wt5MAmETup//xneLPiX73Ej9Ek/URy4I` |

The address currently comes from DHCP and may change after a router lease change. Prefer the SSH alias, but note that the alias currently resolves to this fixed address in the local SSH configuration.

## Windows SSH Configuration

The connection alias is defined in:

```text
C:\Users\User\.ssh\config
```

Configuration:

```sshconfig
Host cartdotcom-server
    HostName 192.168.68.66
    User lucaj
    IdentityFile C:/Users/User/.ssh/cartdotcom-server-auto
    IdentitiesOnly yes
```

The private key is stored only on this Windows PC:

```text
C:\Users\User\.ssh\cartdotcom-server-auto
```

Its public-key fingerprint is:

```text
SHA256:M2kn9BH4+8CBCN+zbRMlMtjc6EwQP5XyZNLE5ksN55c
```

Never copy the private key into the repository, chat, server application files, container images, deployment bundles, or logs.

## Common Commands

Run a command remotely:

```powershell
ssh cartdotcom-server "COMMAND"
```

Copy a file to the user's home directory:

```powershell
scp C:\path\to\file cartdotcom-server:/home/lucaj/
```

Copy a file from the server:

```powershell
scp cartdotcom-server:/remote/path C:\local\destination
```

Inspect the server:

```powershell
ssh cartdotcom-server "cat /etc/os-release; uname -a; ip -br address; df -h"
```

The `lucaj` account belongs to the Ubuntu `sudo` group. Commands requiring `sudo` may still require the Ubuntu password in an interactive session:

```powershell
ssh -t cartdotcom-server "sudo COMMAND"
```

Do not place the password in commands, scripts, environment variables, repository files, or chat messages.

## Storage Layout

The server uses an MSI M371 500 GB NVMe drive with Windows preserved for dual boot:

| Device | Size | Filesystem | Purpose |
|---|---:|---|---|
| `/dev/nvme0n1p1` | 200 MB | VFAT | Shared EFI system partition mounted at `/boot/efi` |
| `/dev/nvme0n1p2` | 16 MB | Microsoft reserved | Windows; do not modify |
| `/dev/nvme0n1p3` | 110 GB | NTFS | Windows 11; do not modify |
| `/dev/nvme0n1p4` | 695 MB | NTFS | Windows recovery; do not modify |
| `/dev/nvme0n1p5` | 354.9 GB | ext4 | Ubuntu root filesystem `/` |

At verification, Ubuntu reported approximately 349 GB formatted capacity with 324 GB available.

## Troubleshooting

Test whether SSH is reachable:

```powershell
Test-NetConnection 192.168.68.66 -Port 22
```

If the address has changed, run this on the server console:

```bash
ip -br address show scope global
```

Then update `HostName` in `C:\Users\User\.ssh\config` and retry the alias.

For detailed client diagnostics:

```powershell
ssh -vvv cartdotcom-server
```

If a host-key warning appears after a deliberate Ubuntu reinstall, verify the new fingerprint at the physical server before changing `known_hosts`. Do not bypass or suppress an unexpected host-key mismatch.

## Current Security State

- Public-key SSH authentication works.
- Password SSH authentication remains enabled as a recovery path.
- The private key is outside the Git repository.
- The server is currently reachable on the local network, not documented here as publicly exposed.
- A DHCP reservation or static address should be configured before depending on `192.168.68.66` for unattended services.
