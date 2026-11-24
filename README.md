# UmeWorld

UmeWorld is an anonymous, one-to-one video, voice, and text chat app. WebRTC carries calls and messages. A Vercel Function uses Redis for matchmaking, temporary signaling, live presence, and user reports. Xirsys or Cloudflare can relay calls when a direct connection is unavailable.

## Deploy to Vercel

1. Connect Upstash for Redis from the Vercel Marketplace, or create an Upstash database and copy its read/write REST token and URL. The Marketplace can inject `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which UmeWorld accepts automatically. [Upstash on the Vercel Marketplace](https://vercel.com/marketplace/upstash/upstash-kv)
2. For a free relay, use Xirsys Developer. From the Xirsys Connect page, select a channel and use its **Dynamic** credentials. This plan stops relaying when it reaches its bandwidth cap. After the introductory period it includes 500 MB per month in one relay region. Cloudflare Realtime is also supported for accounts with billing enabled. [Xirsys Developer plan](https://xirsys.com/pricing) · [Xirsys dashboard](https://docs.xirsys.com/dashboard)
3. Import this folder as a Vite project in Vercel, or run `npx vercel` from the folder to create or link the project. The checked-in configuration sets the framework and the direct routes for Video, Voice, and Text. Use Node.js 24. [Vercel's Vite guide](https://vercel.com/docs/frameworks/frontend/vite)
4. In the Vercel project’s environment settings, add the variables below to Production. Set them for Preview too if preview deployments should support calls. Generate your own session secret with `openssl rand -hex 32`. Keep the values server-side.
5. Deploy the project after saving the environment variables. With the CLI, use `npx vercel --prod`. Vercel runs `npm run build` and deploys `api/chat.js` alongside the site.
6. Open the HTTPS URL in two separate browser profiles or devices, select the same chat mode, and start matching on both. To verify the TURN relay, test on separate networks and inspect the selected ICE candidate pair in the browser’s WebRTC diagnostics. Check that at least one selected candidate has type `relay`.

| Variable | Value |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis HTTPS endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis read/write REST token |
| `SESSION_SECRET` | Random value of at least 32 characters |
| `XIRSYS_IDENT` | Xirsys identifier from the Dynamic credentials |
| `XIRSYS_SECRET` | Xirsys API secret from the Dynamic credentials |
| `XIRSYS_CHANNEL` | Xirsys channel name |

For Cloudflare instead, set `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` to the Cloudflare TURN key ID and token. When both providers are configured, UmeWorld uses Xirsys. [Cloudflare TURN setup](https://developers.cloudflare.com/realtime/turn/generate-credentials/)

An example is in `.env.example`. To verify the provider credentials before deploying, set them in your environment or in the ignored `.env.local` file and run `npm run check:production`. This checks Redis connectivity and TURN credential issuance without printing credential values. For an existing deployment, open the Vercel Function logs if the online indicator shows **Chat unavailable**. Missing settings are logged by name. Redeploy after changing environment variables.

## Run locally

Use Node.js 24 and start Redis locally, for example with `redis-server --bind 127.0.0.1`. Then run:

```sh
npm ci
npm run dev
```

Open the localhost address printed by Vite. Redis defaults to `redis://127.0.0.1:6379`. Set `REDIS_URL` in `.env.local` for a different local Redis endpoint, or provide the two Upstash variables to use hosted Redis. For local-only testing, the API defaults to STUN when no TURN provider is configured. Set `DEVELOPMENT_COUNTRY=US` or another ISO country code to change the local test country, which defaults to India.

Use two different browser profiles, or a normal and private window. Each browser must accept the 18+ rules, use the same chat mode, and select compatible filters. An interest requires a shared topic, a country restriction applies to both participants, and a selected chat language requires the same selection on both sides. **Match with anyone** clears the filters and restarts the search.

Run `npm test` for the API tests. With Redis running, include the matchmaking and report regression test with `TEST_REDIS_URL=redis://127.0.0.1:6379 npm test`. The integration test uses its own Redis keys and removes them afterward.

## Review reports

Run the moderation commands from this folder with the Upstash credentials in your environment or in an ignored `.env.local` file. Without Upstash credentials, the commands use the local Redis database. Set `VERCEL_ENV=preview` when reviewing preview data with production-style Upstash credentials.

```sh
npm run moderation -- list 25
npm run moderation -- ban <target-id>
npm run moderation -- unban <target-id>
```

Members can report a current or recent call. Report records are kept for 30 days. The report form can also block that anonymous browser from future matching for up to 90 days. The operator reviews reports manually. Chat messages are sent over the WebRTC channel, and users can save a text transcript on their own devices.
