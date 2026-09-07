/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

// Fixed map of every valid platform to its pre-resolved manifest path.
// No untrusted string is ever interpolated into an fs path: the platform
// value from the request header is used only as a lookup key.
const MANIFEST_PATHS = Object.freeze({
  ios: path.resolve(STATIC_ROOT, "ios", "manifest.json"),
  android: path.resolve(STATIC_ROOT, "android", "manifest.json"),
});

function serveManifest(platform, res) {
  // Reject anything that is not an explicit key in the fixed map.
  const manifestPath = MANIFEST_PATHS[platform];
  if (!manifestPath) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Unsupported platform" }));
    return;
  }

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  // Safe: manifestPath is selected only from the fixed MANIFEST_PATHS map.
  // nosemgrep: javascript.express.file.fs-express.fs-express
  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(manifest);
}

function buildExpoGoUrl(host, artifactBasePath = basePath) {
  const cleanHost = String(host || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const cleanPath = String(artifactBasePath || "").replace(/^\/+|\/+$/g, "");
  return `exps://${cleanHost}${cleanPath ? `/${cleanPath}` : ""}`;
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  const baseUrl = `${protocol}://${host}`;
  const expoGoUrl = buildExpoGoUrl(host);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPO_GO_URL_PLACEHOLDER/g, expoGoUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

/**
 * Resolve a URL pathname to a file inside STATIC_ROOT, rejecting any attempt
 * to escape the root.
 *
 * Attack vectors guarded against:
 *   - Percent-encoded traversal  (%2e%2e%2f, %2e%2e%5c, …)
 *   - Double-encoded traversal   (%252e%252e%252f, …)
 *   - NUL byte injection         (%00, \x00)
 *   - Backslash separators       (foo\bar)
 *   - Sibling-prefix bypass      (/static-build-evil/…)
 *   - Unicode / overlong encoding (handled by URL parser + decodeURIComponent)
 *
 * Returns the absolute resolved file path on success, or null if the path
 * is malformed or escapes STATIC_ROOT.
 */
function resolveStaticPath(urlPathname) {
  // 1. Reject NUL bytes in the raw pathname (before any decoding).
  if (urlPathname.includes("\x00") || urlPathname.includes("%00")) {
    return null;
  }

  // 2. Decode percent-encoding.  Use decodeURIComponent so that sequences
  //    like %2f, %5c, and %2e are fully expanded before we canonicalise.
  let decoded;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    // Malformed percent-encoding (e.g. %gg).
    return null;
  }

  // 3. Reject NUL bytes that survived as literal characters post-decode.
  if (decoded.includes("\x00")) {
    return null;
  }

  // Treat backslashes as separators on every platform before canonicalizing.
  decoded = decoded.replace(/\\/g, "/");

  // 4. Canonicalise: resolve against STATIC_ROOT with path.resolve, which
  //    eliminates all . and .. components and normalises separators.
  const resolved = path.resolve(STATIC_ROOT, decoded.replace(/^\/+/, ""));

  // 5. Containment: the resolved path must be STATIC_ROOT itself or a
  //    strict child.  Using a separator-terminated prefix prevents the
  //    sibling-prefix attack (/static-build-evil matching /static-build).
  const rootWithSep = STATIC_ROOT + path.sep;
  if (resolved !== STATIC_ROOT && !resolved.startsWith(rootWithSep)) {
    return null;
  }

  return resolved;
}

function serveStaticFile(urlPathname, res) {
  const filePath = resolveStaticPath(urlPathname);

  if (filePath === null) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  // Safe: resolveStaticPath canonicalizes and proves containment in STATIC_ROOT.
  // nosemgrep: javascript.express.file.fs-express.fs-express
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "content-type": contentType });
  res.end(content);
}

// ─── Exports for unit testing (tree-shaken away in production use) ───────────
// Guard the server startup so this module can be required by tests without
// binding a port.
if (require.main === module) {
  const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  const appName = getAppName();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    let pathname = url.pathname;

    if (basePath && pathname.startsWith(basePath)) {
      pathname = pathname.slice(basePath.length) || "/";
    }

    // Expo Go uses /--/<route> to distinguish a deep-link route from the
    // manifest path. The Field App artifact is mounted at /field-app, so a
    // production QR reaches this process as /--/login. It still needs the
    // manifest response; Expo Go handles the /login navigation client-side.
    if (pathname === "/" || pathname === "/manifest" || pathname.startsWith("/--/")) {
      const platform = req.headers["expo-platform"];
      if (platform === "ios" || platform === "android") {
        return serveManifest(platform, res);
      }

      if (pathname === "/") {
        return serveLandingPage(req, res, landingPageTemplate, appName);
      }
    }

    serveStaticFile(pathname, res);
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen(port, "0.0.0.0", () => {
    console.log(`Serving static Expo build on port ${port}`);
  });
}

module.exports = { buildExpoGoUrl, resolveStaticPath, serveManifest, serveStaticFile, STATIC_ROOT, MANIFEST_PATHS };
