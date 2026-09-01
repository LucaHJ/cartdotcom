#!/bin/sh
set -eu

mkdir -p /home/ibgateway/Jts /home/ibgateway/.fluxbox
chown -R ibgateway:ibgateway /home/ibgateway/Jts /home/ibgateway/.fluxbox
exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
