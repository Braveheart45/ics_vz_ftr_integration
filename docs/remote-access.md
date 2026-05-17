# SQL Curator Remote Access

Use this only for a controlled POC/demo environment. Do not expose SQL Curator on the public internet without authentication, TLS, and network allow-listing.

## What users access

Colleagues access only the Next.js UI:

```text
http://<machine-public-or-private-ip>:3000/
```

Example:

```text
http://34.14.183.200:3000/
```

The Claude bridge should remain local to the host:

```text
http://127.0.0.1:3001
```

The browser does not need direct access to the bridge. The Next.js `/api/chat` route forwards requests to the bridge from the server side.

## Run locally for colleague access

From the SQL Curator project root, open two terminals on the host machine.

Terminal 1 — Claude bridge, local only:

```powershell
npm.cmd run bridge
```

Terminal 2 — UI bound to all network interfaces:

```powershell
npm.cmd run dev:public
```

Then share:

```text
http://<host-ip>:3000/
```

## Production-style run

```powershell
npm.cmd run build
npm.cmd run bridge
npm.cmd run start:public
```

## Network requirements

- The machine must have a reachable private or public IP.
- TCP port `3000` must be allowed in the OS firewall.
- If running on a cloud VM, the cloud firewall/security group must allow inbound TCP `3000` from approved colleague IPs.
- Do not open port `3001` publicly; keep the Claude bridge bound to localhost.

## Security requirement before wider use

Before sharing beyond a trusted POC group, add:

- Authentication.
- HTTPS/TLS.
- IP allow-listing or VPN-only access.
- Request logging and audit retention.
- A reverse proxy such as NGINX/Caddy/IIS in front of Next.js.
