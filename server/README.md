# Glass Music Server

This optional gateway gives Glass Music a separate search source backed by an existing Navidrome installation. It does not edit the Navidrome collection, scan files directly, or share the Windows sync endpoints. Use Node.js 22 or later.

On the homelab, set `GLASS_NAVIDROME_USER` and `GLASS_NAVIDROME_PASSWORD` privately in the process environment. Prefer a dedicated non-admin Navidrome account. If Navidrome is bound to `127.0.0.1:4533`, start the gateway with `node server/index.mjs`. Otherwise set `GLASS_NAVIDROME_URL` to the local loopback HTTP or trusted HTTPS address. Run one gateway process per data directory. `GLASS_SERVER_DATA` defaults to `server-data` and should be a private persistent folder. Never add that folder or the credentials to Git.

Run `cloudflared tunnel --url http://127.0.0.1:8767` for a temporary test URL. Publish only the gateway, keeping Navidrome and SMB private. If changing the tunnel address, create a fresh invitation for this preview.

Generate an invitation on the homelab:

```sh
node server/index.mjs invite https://YOUR-TUNNEL.trycloudflare.com
```

Copy the JSON into Glass or encode it as a QR locally. For example, with `qrencode` installed, pipe the invitation command into `qrencode -t ANSIUTF8` and scan the terminal. Invitations expire after five minutes and can only be redeemed once. Generate one per device. `node server/index.mjs devices` lists linked devices and `node server/index.mjs revoke DEVICE_ID` removes one. Revocation applies to new requests, including issued audio links.

To validate, search from the iPhone with Wi-Fi off, play and seek in a FLAC, and verify that search results stay out of My Library unless added explicitly. Keep the gateway running on the homelab during the test.
