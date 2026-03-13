# Nuvio Providers

A collection of streaming providers plus a Stremio-compatible addon server for local or Render deployment.

📖 **[Read the Comprehensive Developer Guide](DOCUMENTATION.md)**

## Quick Start

### Run The Addon Server

```bash
npm start
```

Default local URLs:

```text
http://127.0.0.1:7010/manifest.json
http://127.0.0.1:7010/health
```

### Render

The repo includes [`render.yaml`](./render.yaml). Set:

```text
NODE_ENV=production
ADDON_PUBLIC_URL=https://your-service.onrender.com
```

---

## Project Structure

```
nuvio-providers/
├── stremio-server.js       # Active addon entrypoint
├── addon.config.json       # Active provider list for the addon server
├── src/                    # Multi-file provider source folders
│   ├── hdhub4u/
│   └── webstreamer-latino/
│
├── providers/              # Provider modules consumed by the addon server
│   ├── vixsrc.js
│   ├── vidlink.js
│   ├── uhdmovies.js
│   └── ...
│
├── manifest.json           # Provider registry/options for the repo
├── build.js                # Bundles src/<provider>/ into providers/<provider>.js
├── render.yaml             # Render blueprint
└── webstreamr-main/        # Reference project used for extractor/source porting
```

---

## Development

There are two ways to create providers:

### Option 1: Single-File Provider

For simple providers, you can create a single JavaScript file directly in the `providers/` directory.

**Important:** The app's JavaScript engine (Hermes) has limitations with `async/await` in dynamic code.
- **Recommended**: Use Promise chains (`.then()`).
- **Alternative**: Use `async/await` and run the transpiler command (see below).

**Example (Promise Chains):**
```javascript
// providers/myprovider.js

function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[MyProvider] Fetching ${mediaType} ${tmdbId}`);
  
  return fetch(`https://api.example.com/streams/${tmdbId}`)
    .then(response => response.json())
    .then(data => {
      return data.streams.map(s => ({
        name: "MyProvider",
        title: s.title,
        url: s.url,
        quality: s.quality
      }));
    })
    .catch(error => {
      console.error('[MyProvider] Error:', error.message);
      return [];
    });
}

module.exports = { getStreams };
```

To register the provider, add it to `manifest.json`:
```json
{
  "id": "myprovider",
  "name": "My Provider",
  "filename": "providers/myprovider.js",
  "supportedTypes": ["movie", "tv"],
  "enabled": true
}
```

### Option 2: Multi-File Provider (Recommended)

For complex providers, use the `src/` directory. This allows you to split code into multiple files. The build script automatically handles bundling and `async/await` transpilation.

1. **Create source folder:**
   ```bash
   mkdir -p src/myprovider
   ```

2. **Create entry point** (`src/myprovider/index.js`):
   ```javascript
   import { fetchPage } from './http.js';
   import { extractStreams } from './extractor.js';

   // async/await is fully supported here
   async function getStreams(tmdbId, mediaType, season, episode) {
     const page = await fetchPage(tmdbId, mediaType, season, episode);
     return extractStreams(page);
   }

   module.exports = { getStreams };
   ```

3. **Build:**
   ```bash
   node build.js myprovider
   ```

This generates `providers/myprovider.js`.

---

## Building

### Build Source Providers
Bundles files from `src/<provider>/` into `providers/<provider>.js`.

```bash
# Build specific provider
node build.js webstreamer-latino

# Build multiple
node build.js webstreamer-latino hdhub4u

# Build all source providers
node build.js
```

### Transpile Single-File Providers
If you wrote a single-file provider using `async/await`, you must transpile it for compatibility.

```bash
# Transpile specific file
node build.js --transpile myprovider.js

# Transpile all applicable files in providers/
node build.js --transpile
```

### Watch Mode
Automatically rebuilds when files change.
```bash
npm run build:watch
```

---

## Runtime Model

`manifest.json` keeps provider metadata and options.

`addon.config.json` controls which providers the current addon server loads at runtime.

This lets the repo keep disabled or optional providers available without forcing the live addon server to load all of them.

---

## Stream Object Format

Providers must return an array of stream objects:

```javascript
{
  name: "Provider Name",           // Provider identifier
  title: "1080p Stream",           // Stream description
  url: "https://...",              // Direct stream URL (m3u8, mp4, mkv)
  quality: "1080p",                // Quality label
  size: "2.5 GB",                  // Optional file size
  headers: {                       // Optional headers for playback
    "Referer": "https://source.com",
    "User-Agent": "Mozilla/5.0..."
  }
}
```

---

## Available Modules

Providers have access to these modules via `require()`:

| Module | Usage |
|--------|-------|
| `cheerio-without-node-native` | HTML parsing |
| `crypto-js` | Encryption/decryption |
| `axios` | HTTP requests |

Native `fetch` and `console` are also available globally.

---

## Manifest Options

The `manifest.json` file controls provider settings.

```json
{
  "id": "unique-id",
  "name": "Display Name",
  "description": "Short description",
  "version": "1.0.0",
  "author": "Your Name",
  "supportedTypes": ["movie", "tv"],
  "filename": "providers/file.js",
  "enabled": true,
  "logo": "https://url/to/logo.png",
  "contentLanguage": ["en", "hi"],
  "formats": ["mkv", "mp4"],
  "limited": false,
  "disabledPlatforms": ["ios"],
  "supportsExternalPlayer": true
}
```

---

## Contributing

1. **Fork the repository**
2. **Create a branch**: `git checkout -b add-myprovider`
3. **Develop and test**
4. **Build**: `node build.js myprovider`
5. **Commit**: `git commit -m "Add MyProvider"`
6. **Push and PR**

---

## License

This project is licensed under the **GNU General Public License v3.0**.

---

## Disclaimer

- **No content is hosted by this repository.**
- Providers fetch publicly available content from third-party websites.
- Users are responsible for compliance with local laws.
- For DMCA concerns, contact the actual content hosts.
