# Intelligent Route Engine — V1

A personal-use web navigation prototype that uses Google Maps Platform traffic-aware routing and adds a transparent route-decision layer.

## What V1 does

- Uses browser GPS as the default origin.
- Accepts an address/place name as destination.
- Requests traffic-aware driving routes from Google's Routes library.
- Requests alternate routes when Google returns them.
- Calculates estimated average achievable speed from route distance and traffic-aware duration.
- Estimates traffic delay by comparing traffic-aware and static duration.
- Detects U-turns, merges, turns, sharp/hairpin maneuvers from route steps and applies bounded penalties.
- Selects the lowest current route cost rather than simply the shortest route.
- Draws the selected and alternative routes.
- Lets you manually inspect/select any candidate route.
- Provides a plain-language explanation of the decision.
- Supports avoid-tolls and avoid-highways options.

## Important limitation

This is **not yet a full autonomous navigation engine**. Google provides the traffic-aware route calculation; this project adds a deterministic scoring layer on top. V1 does not independently predict traffic speed for every road segment or guarantee that a maneuver is physically possible in a particular traffic queue.

Those are planned V2 features: traffic-aware polylines/segment states, live GPS tracking, route-deviation detection, reroute hysteresis, future-segment traffic prediction, and voice navigation.

## Google Cloud setup

1. Create a Google Cloud project.
2. Enable **Maps JavaScript API**.
3. Enable the Google Maps **Routes API** / Routes library required by your project.
4. Configure billing according to your Maps Platform account.
5. Create a browser API key.
6. Restrict the key by HTTP referrer (your local/deployed domains) and by the APIs it can call.
7. Put the key into `config.js` locally.
8. Serve the project over HTTP/HTTPS. Do not use `file://`.

### Local testing

You can use any static server, for example:

```bash
npx serve .
```

Then open the address shown by the server.

## GitHub / deployment

The repository can contain the placeholder `config.js`, but **do not commit a real unrestricted key**.

Because this is a static browser app, the Google browser key is necessarily present in the browser at runtime. That is acceptable only when the key is tightly restricted by HTTP referrer and API. Use Google Cloud quotas/budget alerts as an additional safeguard.

For a simple personal deployment, upload these files to GitHub and deploy the repository with Netlify, Cloudflare Pages, GitHub Pages, or another static host. Add the deployed domain to the key's HTTP-referrer allowlist.

## Current route cost model

The engine uses:

`route cost = traffic-aware travel time + bounded maneuver penalty`

Traffic-aware travel time remains dominant. The maneuver penalty is intended to discourage operationally awkward routes such as U-turn-heavy alternatives without overriding a large genuine travel-time advantage.

## V2 target

1. Traffic-aware polylines / segment traffic state
2. Live GPS tracking
3. Automatic rerouting
4. Route-deviation detection
5. Reroute hysteresis so the app does not constantly switch routes
6. Predicted traffic at the time the vehicle reaches each segment
7. More realistic maneuver feasibility rules
8. Turn-by-turn and voice guidance
