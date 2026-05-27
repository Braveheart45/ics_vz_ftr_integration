# SQL Curator Remote Access

Use remote access only for a controlled demo or an internally protected deployment. Do not expose SQL Curator to the public internet unless authentication, TLS, and network restrictions are in place.

## Access Model

Remote users access only the Next.js UI:

```text
https://<sql-curator-host>/
```

For a short-lived LAN demo without TLS:

```text
http://<host-ip>:3000/
```

The Claude bridge must stay private to the host:

```text
http://127.0.0.1:3001
```

Browser clients never call the bridge directly. Next.js API routes forward requests to the local bridge from the server side.

## Demo Runbook

Use this for a trusted LAN or VPN demo only.

1. Start the Claude bridge on the host:

   ```powershell
   npm.cmd run bridge
   ```

1. Start the UI on all network interfaces:

   ```powershell
   npm.cmd run dev:public
   ```

1. Share the UI URL:

   ```text
   http://<host-ip>:3000/
   ```

## Production-Style Runbook

Build once, then run the bridge and UI as supervised processes.

```powershell
npm.cmd run build
npm.cmd run bridge
npm.cmd run start:public
```

Recommended production topology:

```text
User browser -> HTTPS reverse proxy -> Next.js UI -> 127.0.0.1:3001 bridge -> Claude Code CLI
```

The reverse proxy should terminate TLS, enforce authentication, apply IP allow-listing or VPN-only access, and disable response buffering for Server-Sent Events.

## Network Controls

- Allow inbound TCP `443` to the reverse proxy from approved networks.
- For demo mode only, allow inbound TCP `3000` from approved colleague IPs.
- Do not allow inbound TCP `3001`; the bridge must remain bound to localhost.
- If running on a cloud VM, enforce the same restrictions in both the OS firewall and the cloud security group.
- Keep Jira, BigQuery, GitHub, and Claude credentials on the host; remote users should not receive direct access to MCP servers.

## Operational Checks

Before sharing access:

- Confirm the bridge health endpoint is healthy from the host: `http://127.0.0.1:3001/health`.
- Confirm the UI can reach the bridge through the Next.js API routes.
- Verify long-running SQL generation streams through the proxy without buffering or timeout.
- Confirm logs include enough request context for audit and incident review.
- Confirm no secrets, tokens, or bridge URLs are exposed in browser-visible configuration.

## Production Requirements

Do not use public remote access until these are implemented:

- Authentication for every user.
- HTTPS/TLS with managed certificates.
- IP allow-listing or VPN-only network access.
- Process supervision and restart policy for both bridge and UI.
- Structured request logging with retention.
- Reverse proxy hardening, including request size limits and SSE-compatible timeouts.
- Documented owner, rollback process, and incident contact.
