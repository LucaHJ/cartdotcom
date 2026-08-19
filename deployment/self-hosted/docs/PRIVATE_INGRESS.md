# Private Dashboard Ingress

The production dashboard remains on Cloudflare Workers. Its API reaches the
Ubuntu `news-api` through a private Cloudflare Tunnel and Workers VPC Service;
the origin is not assigned a public hostname and no inbound router port is
opened.

Workers VPC is currently a free beta. Recheck its status before making a later
architecture change:

- https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/
- https://developers.cloudflare.com/workers-vpc/configuration/tunnel/

## Cloudflare resources

Provisioned on 2026-08-19:

- Tunnel: `cartdotcom-news-local`
- Tunnel ID: `1bb7b4e0-aa3b-48c9-ae57-0349c283b7d2`
- VPC Service: `cartdotcom-news-api`
- VPC Service ID: `01a01a1d-431d-7fe3-8615-ae2145a219e4`
- Origin: HTTP `news-api:3000` on the private Docker `edge` network

Do not store the API token or tunnel token in Git. The tunnel token belongs at
`/srv/platform/secrets/cloudflare_tunnel_token` with mode `0600`.

## Provisioning sequence

1. Create the remotely managed tunnel `cartdotcom-news-local`.
2. Store its token in the server secret file.
3. Start the connector:

   ```bash
   cd /srv/cartdotcom/news
   docker compose --profile ingress up -d cloudflared
   ```

4. Create an HTTP VPC Service named `cartdotcom-news-api` with the tunnel,
   hostname `news-api`, and HTTP port `3000`:

   ```bash
   npx wrangler vpc service create cartdotcom-news-api \
     --type http \
     --tunnel-id TUNNEL_UUID \
     --hostname news-api \
     --http-port 3000
   ```

5. Add the returned service ID to `wrangler.jsonc`:

   ```json
   "vpc_services": [
     {
       "binding": "SELF_HOSTED_API",
     "service_id": "01a01a1d-431d-7fe3-8615-ae2145a219e4",
       "remote": true
     }
   ]
   ```

6. Deploy with `SELF_HOSTED_PROXY_ENABLED=false` and verify the binding. This
   does not move traffic.
   The authenticated `/api/internal/self-hosted-status` route performs a live
   Worker-to-VPC-to-server readiness check without enabling the proxy.
7. Enable the proxy only after data reconciliation and local processing
   activation have passed the cutover runbook.

## Failure behavior

When the tunnel, VPC Service, or server is unavailable, Cloudflare serves the
latest private R2 dashboard snapshot for supported GET routes. Mutations fail
closed with HTTP 503. When the VPC request succeeds again, the same dashboard
automatically returns to live mode.
