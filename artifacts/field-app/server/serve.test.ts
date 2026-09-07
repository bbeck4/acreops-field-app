/**
 * Focused tests for the path-containment logic in server/serve.js.
 *
 * We import only the pure helpers (resolveStaticPath, STATIC_ROOT) so no HTTP
 * server is started and no port is bound during the test run.
 */

import path from "path";
import { describe, it, expect, vi, type MockInstance } from "vitest";

// ── Module under test ────────────────────────────────────────────────────────
// Require (not import) so that `require.main === module` stays false and the
// server is NOT started.
const { buildExpoGoUrl, resolveStaticPath, serveManifest, STATIC_ROOT, MANIFEST_PATHS } =
  require("./serve.js") as {
    buildExpoGoUrl: (host: string, basePath?: string) => string;
    resolveStaticPath: (p: string) => string | null;
    serveManifest: (platform: string, res: any) => void;
    STATIC_ROOT: string;
    MANIFEST_PATHS: Record<string, string>;
  };

describe("buildExpoGoUrl – published artifact routing", () => {
  it("includes the field-app base path in the secure Expo Go URL", () => {
    expect(buildExpoGoUrl("acreops.longacresinc.com", "/field-app/"))
      .toBe("exps://acreops.longacresinc.com/field-app");
  });

  it("normalizes host and path slashes", () => {
    expect(buildExpoGoUrl("https://acreops.replit.app/", "field-app"))
      .toBe("exps://acreops.replit.app/field-app");
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
/** Absolute path to a file inside the static root. */
const inside = (rel: string) => path.resolve(STATIC_ROOT, rel);

// ── Normal asset paths ───────────────────────────────────────────────────────
describe("resolveStaticPath – normal assets", () => {
  it("resolves a top-level file", () => {
    expect(resolveStaticPath("/index.html")).toBe(inside("index.html"));
  });

  it("resolves a nested file", () => {
    expect(resolveStaticPath("/android/manifest.json")).toBe(
      inside("android/manifest.json"),
    );
  });

  it("resolves a deeply nested asset", () => {
    expect(resolveStaticPath("/ios/bundles/main.js")).toBe(
      inside("ios/bundles/main.js"),
    );
  });

  it("handles multiple leading slashes", () => {
    expect(resolveStaticPath("//android/manifest.json")).toBe(
      inside("android/manifest.json"),
    );
  });
});

// ── Manifest paths ───────────────────────────────────────────────────────────
describe("resolveStaticPath – manifest paths", () => {
  it("resolves ios/manifest.json inside the root", () => {
    expect(resolveStaticPath("/ios/manifest.json")).toBe(
      inside("ios/manifest.json"),
    );
  });

  it("resolves android/manifest.json inside the root", () => {
    expect(resolveStaticPath("/android/manifest.json")).toBe(
      inside("android/manifest.json"),
    );
  });
});

// ── Encoded dot/slash traversal ──────────────────────────────────────────────
describe("resolveStaticPath – encoded traversal attacks", () => {
  it("blocks %2e%2e%2f (encoded ../)", () => {
    expect(resolveStaticPath("/%2e%2e%2fetc/passwd")).toBeNull();
  });

  it("blocks %2e%2e/ (mixed: encoded dots, literal slash)", () => {
    expect(resolveStaticPath("/%2e%2e/etc/passwd")).toBeNull();
  });

  it("blocks ..%2f (literal dots, encoded slash)", () => {
    expect(resolveStaticPath("/..%2fetc/passwd")).toBeNull();
  });

  it("blocks literal dot-dot traversal (../)", () => {
    expect(resolveStaticPath("/../etc/passwd")).toBeNull();
  });

  it("blocks multiple traversal segments (../../)", () => {
    expect(resolveStaticPath("/../../etc/passwd")).toBeNull();
  });

  it("blocks %2e%2e%5c (encoded ..\\ Windows separator)", () => {
    expect(resolveStaticPath("/%2e%2e%5cetc/passwd")).toBeNull();
  });

  it("treats double-encoded %252e%252e%252f as a literal filename (safe)", () => {
    // After one decodeURIComponent pass this becomes %2e%2e%2f which is a
    // literal filename component, not a separator sequence — path.resolve
    // places it inside STATIC_ROOT.  Both null and an in-root path are safe.
    const result = resolveStaticPath("/%252e%252e%252fetc/passwd");
    if (result !== null) {
      expect(result.startsWith(STATIC_ROOT)).toBe(true);
    }
  });
});

// ── Backslash traversal ──────────────────────────────────────────────────────
describe("resolveStaticPath – backslash traversal", () => {
  it("blocks literal backslash traversal", () => {
    expect(resolveStaticPath("/..\\etc\\passwd")).toBeNull();
  });

  it("blocks %5c%2e%2e traversal", () => {
    expect(resolveStaticPath("/%5c%2e%2e%5cetc")).toBeNull();
  });
});

// ── NUL byte injection ───────────────────────────────────────────────────────
describe("resolveStaticPath – NUL byte injection", () => {
  it("blocks %00 (encoded NUL)", () => {
    expect(resolveStaticPath("/foo%00.txt")).toBeNull();
  });

  it("blocks literal NUL character in pathname", () => {
    expect(resolveStaticPath("/foo\x00.txt")).toBeNull();
  });
});

// ── Malformed percent-encoding ────────────────────────────────────────────────
describe("resolveStaticPath – malformed encoding", () => {
  it("blocks an invalid percent-sequence (%gg)", () => {
    expect(resolveStaticPath("/%gg/file.js")).toBeNull();
  });

  it("blocks a truncated percent-sequence (%2 at end)", () => {
    expect(resolveStaticPath("/file.js%2")).toBeNull();
  });
});

// ── Sibling-prefix attack ────────────────────────────────────────────────────
describe("resolveStaticPath – sibling-prefix attack", () => {
  it("blocks traversal to a sibling directory whose name starts with the root's basename", () => {
    // e.g. if root is /…/static-build, ensure /…/static-build-evil is blocked.
    const siblingName = path.basename(STATIC_ROOT) + "-evil";
    // We need to escape to the parent then enter the sibling.
    const traversal = `/../${siblingName}/secret.txt`;
    expect(resolveStaticPath(traversal)).toBeNull();
  });

  it("blocks URL-encoded traversal to sibling directory", () => {
    const siblingName = path.basename(STATIC_ROOT) + "-evil";
    // %2e%2e = '..'
    const traversal = `/%2e%2e/${siblingName}/secret.txt`;
    expect(resolveStaticPath(traversal)).toBeNull();
  });
});

// ── serveManifest – fixed path map ───────────────────────────────────────────
// Minimal fake res that records the status code and the body written to it.
function makeFakeRes() {
  const res = {
    statusCode: 0 as number,
    headers: {} as Record<string, string>,
    body: "" as string,
    writeHead(code: number, hdrs?: Record<string, string>) {
      res.statusCode = code;
      if (hdrs) Object.assign(res.headers, hdrs);
    },
    end(data?: string | Buffer) {
      res.body = data ? data.toString() : "";
    },
  };
  return res;
}

describe("serveManifest – fixed manifest path map", () => {
  it("MANIFEST_PATHS contains exactly ios and android", () => {
    expect(Object.keys(MANIFEST_PATHS).sort()).toEqual(["android", "ios"]);
  });

  it("MANIFEST_PATHS.ios resolves inside STATIC_ROOT", () => {
    expect(MANIFEST_PATHS.ios.startsWith(STATIC_ROOT + path.sep)).toBe(true);
  });

  it("MANIFEST_PATHS.android resolves inside STATIC_ROOT", () => {
    expect(MANIFEST_PATHS.android.startsWith(STATIC_ROOT + path.sep)).toBe(true);
  });

  it("returns 400 for an unknown platform string", () => {
    const res = makeFakeRes();
    serveManifest("web", res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: "Unsupported platform" });
  });

  it("returns 400 for an empty platform string", () => {
    const res = makeFakeRes();
    serveManifest("", res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a traversal payload in the platform header (../ios)", () => {
    const res = makeFakeRes();
    serveManifest("../ios", res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for %2e%2e%2fios traversal in platform header", () => {
    const res = makeFakeRes();
    serveManifest("%2e%2e%2fios", res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a NUL-injected platform value", () => {
    const res = makeFakeRes();
    serveManifest("ios\x00evil", res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a platform with path separators (ios/../../etc)", () => {
    const res = makeFakeRes();
    serveManifest("ios/../../etc", res);
    expect(res.statusCode).toBe(400);
  });

  it("serves ios manifest with correct headers when file exists", () => {
    const res = makeFakeRes();
    // The real manifest.json for ios exists in static-build/ios/manifest.json.
    serveManifest("ios", res);
    // File exists in the repo so we expect 200, not 404.
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(res.headers["expo-protocol-version"]).toBe("1");
    expect(res.headers["expo-sfv-version"]).toBe("0");
  });

  it("serves android manifest with correct headers when file exists", () => {
    const res = makeFakeRes();
    serveManifest("android", res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
  });
});
