#!/bin/sh
set -eu

mkdir -p /home/ibgateway/Jts /home/ibgateway/.fluxbox
chown -R ibgateway:ibgateway /home/ibgateway/Jts /home/ibgateway/.fluxbox

# The broker network pins the single trading worker to 172.24.0.3.  Trust
# only that peer (plus loopback) so IB Gateway never exposes its API to the
# broader Docker host or edge networks.  The file exists after first login;
# subsequent container starts enforce this invariant before Gateway starts.
if [ -f /home/ibgateway/Jts/jts.ini ]; then
    if grep -q '^TrustedIPs=' /home/ibgateway/Jts/jts.ini; then
        sed -i 's/^TrustedIPs=.*/TrustedIPs=127.0.0.1,172.24.0.3/' /home/ibgateway/Jts/jts.ini
    else
        sed -i '/^\\[IBGateway\\]/a TrustedIPs=127.0.0.1,172.24.0.3' /home/ibgateway/Jts/jts.ini
    fi
    chown ibgateway:ibgateway /home/ibgateway/Jts/jts.ini
fi

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
