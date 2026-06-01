# Remote Setup Guide (Tailscale)

Use your G2 glasses from anywhere — not just your home LAN — by routing
all traffic through Tailscale. This is a one-time setup.

## 1. Install Tailscale on your Mac

Choose one:

- **Homebrew:** `brew install tailscale`
- **Mac App Store / direct download:** https://tailscale.com/download/mac

After installing, connect:

```
tailscale up
```

Or open the Tailscale menu bar app and sign in. Verify with:

```
tailscale status
```

You should see your machine listed with an IP like `100.x.y.z`.

## 2. Install Tailscale on your iPhone

1. Download **Tailscale** from the App Store.
2. Sign in with the **same account** as your Mac.
3. Tap **Connect**. It will ask to install a VPN profile — allow it.
4. Verify it shows "Connected" in the Tailscale app.

## 3. Run `colive setup`

From the `colive-terminal` directory:

```
npm run dev -- setup
```

The wizard detects your Tailscale state, captures your Mac's Tailscale IP
and MagicDNS hostname, and saves them to `~/.config/colive/remote.json`.

## 4. Start serving

```
npm run dev -- serve
```

The QR code will point to your Tailscale address. Scan it from the Even
app on your phone — the glasses connect through Tailscale from the start.

The desk client still connects via localhost:

```
npm run dev -- desk --host localhost --port 3456 --token <token>
```

## 5. Verify remote access

1. Connect your glasses via the QR while on the same WiFi.
2. Switch your phone to cellular (turn off WiFi).
3. The glasses should continue working — Tailscale re-routes transparently.

## Manual config (without the wizard)

If you prefer to skip the wizard, create `~/.config/colive/remote.json`:

```json
{
  "tailscaleHostname": "your-mac.tailnet-name.ts.net",
  "tailscaleIp": "100.x.y.z",
  "prefer": "hostname"
}
```

Get these values from `tailscale status --json` (look for `Self.TailscaleIPs[0]`
and `Self.DNSName`).

## Troubleshooting

- **`colive serve` fails with "Tailscale is not connected"** — run `tailscale up`
  or open the Tailscale menu bar app.
- **Glasses can't connect** — make sure your phone's Tailscale VPN is active
  (check the Tailscale app on your phone).
- **Slow connection** — if Tailscale can't establish a direct connection, it
  relays through a DERP server. This adds latency but still works. Check
  `tailscale status` for "relay" indicators.
