# Earning Chart

Earning Chart is a Node.js and Express web service that fetches the latest SEC filing for a public ticker, extracts income statement line items, builds a Sankey data model, and renders an interactive Plotly chart with export tools.

## Features

- `GET /sankey?ticker=XXX` renders an HTML page for the latest relevant filing.
- SEC ingestion uses ticker-to-CIK lookup, filing discovery, 24-hour caching, and request throttling for EDGAR compliance.
- Parsing strategy prefers SEC XBRL company facts, then XBRL instance XML, then filing HTML tables, then PDF extraction through Tabula.
- Frontend supports PNG export, SVG export, image copy to clipboard, manual upload, and session-only mapping overrides.
- Parsing confidence and missing-line-item diagnostics are shown in the UI and logged on the server.

## Requirements

- Node.js 20 or newer.
- Java installed and available on `PATH` for the PDF Tabula fallback.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`, then replace `SEC_USER_AGENT` with your real app name and contact email before using SEC-backed routes.

3. Start the service:

   ```bash
   npm start
   ```

4. Open `http://localhost:3000/sankey?ticker=AAPL`.

## Environment Variables

- `PORT`: HTTP port for Express.
- `SEC_USER_AGENT`: Required SEC identity header. `.env.example` includes a placeholder only. The app rejects live SEC requests until you replace it with a real app name and contact email.
- `SEC_CACHE_TTL_SECONDS`: Cache lifetime for SEC fetches and computed payloads. Default: `86400`.
- `SEC_MIN_INTERVAL_MS`: Minimum delay between SEC requests. Default: `150`.
- `SEC_HTTP_TIMEOUT_MS`: Timeout for SEC HTTP calls. Default: `20000`.
- `APP_RATE_LIMIT_WINDOW_MS`: Public API rate-limit window. Default: `900000`.
- `APP_RATE_LIMIT_MAX`: Max requests per rate-limit window. Default: `60`.

## API Surface

- `GET /sankey?ticker=XXX`: Returns the HTML page with the chart bootstrap payload embedded.
- `GET /api/sankey-data?ticker=XXX`: Returns JSON payload for client-side refreshes.
- `POST /api/upload`: Accepts multipart `filing` as HTML or PDF and returns a parsed payload.
- `POST /api/rebuild`: Rebuilds the Sankey from parsed rows plus mapping overrides.
- `GET /health`: Health check.

## Notes On Parsing

- XBRL company facts are the primary structured source and are filtered to the latest matching filing when accession and report date are available.
- HTML parsing uses Cheerio to score likely income statement tables and normalize row labels and numeric formats.
- PDF parsing uses `tabula-js`, which shells out to tabula-java. If Java is unavailable, the service surfaces a clear error instead of silently failing.
- The mapping editor is session-only and does not persist remaps to disk or a database.

## Testing

Run the unit and integration tests:

```bash
npm test
```

The integration test uses recorded fixture data for an Apple-style 10-Q path so the test remains deterministic and does not hit EDGAR.

## License

MIT. See `LICENSE`.

## Limitations

- Product and service revenue detail depends on what is present in the filing or XBRL taxonomy.
- Image copy requires a secure browser context such as `localhost` and support for `navigator.clipboard.write` with image blobs.
- Some PDFs are image-only or use layouts that Tabula cannot reliably extract.