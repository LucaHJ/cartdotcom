FROM debian:bookworm-slim

ARG IB_GATEWAY_INSTALLER=https://download.interactivebrokers.com/installers/ibgateway/stable-standalone/ibgateway-stable-standalone-linux-x64.sh
ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl fluxbox novnc procps supervisor websockify x11vnc xvfb \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --shell /bin/bash ibgateway \
    && curl -fsSL "$IB_GATEWAY_INSTALLER" -o /tmp/ibgateway-installer.sh \
    && chmod +x /tmp/ibgateway-installer.sh \
    && /tmp/ibgateway-installer.sh -q -dir /opt/ibgateway \
    && rm -f /tmp/ibgateway-installer.sh \
    && mkdir -p /home/ibgateway/Jts /var/log/supervisor \
    && chown -R ibgateway:ibgateway /home/ibgateway /opt/ibgateway /var/log/supervisor

RUN sed -i '/### keep on update/a -Duser.home=/home/ibgateway' /opt/ibgateway/ibgateway.vmoptions \
    && sed -i 's#/root/Jts#/home/ibgateway/Jts#g' /opt/ibgateway/.install4j/response.varfile

COPY supervisord.conf /etc/supervisor/conf.d/ibgateway.conf
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

EXPOSE 4002 5900 6080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
