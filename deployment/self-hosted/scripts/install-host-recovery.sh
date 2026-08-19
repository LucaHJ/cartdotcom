#!/usr/bin/env bash
set -euo pipefail

recovery_line='@reboot sleep 60 && /srv/platform/scripts/boot-recovery.sh >>/srv/platform/logs/boot-recovery.log 2>&1'
audit_line='*/5 * * * * /srv/platform/scripts/health-audit.sh >>/srv/platform/logs/health-audit.log 2>&1'
current="$(crontab -l 2>/dev/null || true)"

{
  printf '%s\n' "${current}"
  if ! grep -Fqx "${recovery_line}" <<<"${current}"; then
    printf '%s\n' "${recovery_line}"
  fi
  if ! grep -Fqx "${audit_line}" <<<"${current}"; then
    printf '%s\n' "${audit_line}"
  fi
} | sed '/^[[:space:]]*$/d' | crontab -

echo "Boot recovery and five-minute health auditing are installed for $(whoami)."
