// Local production-test server. HTTPS exercises the exported CSP in WebKit too.
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const root = path.resolve("out");
const port = Number(process.env.PORT ?? 3000);
if (!fs.existsSync(path.join(root, "index.html"))) {
    throw new Error("Run npm run build before serving the production export.");
}
// A throwaway certificate. The key is deleted as soon as it is loaded, so
// nothing is left behind even if the server is killed rather than stopped.
const certificateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "privacypack-test-tls-"),
);
let tls;
try {
    const key = path.join(certificateDir, "key.pem");
    const cert = path.join(certificateDir, "cert.pem");
    execFileSync(
        "openssl",
        [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            key,
            "-out",
            cert,
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
            "-addext",
            "subjectAltName=DNS:localhost,IP:127.0.0.1",
        ],
        { stdio: "ignore" },
    );
    tls = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
} finally {
    fs.rmSync(certificateDir, { recursive: true, force: true });
}

const rules = [];
for (const line of fs
    .readFileSync(path.join(root, "_headers"), "utf8")
    .split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!/^\s/.test(line)) {
        const pattern = line
            .trim()
            .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
            .replaceAll("*", ".*");
        rules.push({ pattern: new RegExp(`^${pattern}$`), headers: {} });
    } else {
        const separator = line.indexOf(":");
        if (separator > 0)
            rules.at(-1).headers[line.slice(0, separator).trim()] = line
                .slice(separator + 1)
                .trim();
    }
}
const types = {
    ".html": "text/html; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".js": "application/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
};
const server = https.createServer(tls, (request, response) => {
    let pathname;
    try {
        pathname = decodeURIComponent(
            new URL(request.url, "https://localhost").pathname,
        );
    } catch {
        response.writeHead(400).end();
        return;
    }
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const candidates = [
        relative,
        `${relative}.html`,
        `${relative}/index.html`,
    ].map((p) => path.resolve(root, p));
    // Cloudflare Pages never serves its configuration files.
    const file = candidates.find(
        (p) =>
            !["_headers", "_redirects"].includes(path.basename(p)) &&
            p.startsWith(root + path.sep) &&
            fs.existsSync(p) &&
            fs.statSync(p).isFile(),
    );
    // Like Cloudflare Pages, apply every matching rule and join repeated
    // header names with commas, so overlapping rules show up in tests.
    const headers = {};
    for (const rule of rules.filter((rule) => rule.pattern.test(pathname))) {
        for (const [name, value] of Object.entries(rule.headers)) {
            const key = name.toLowerCase();
            headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
        }
    }
    const target = file ?? path.join(root, "404.html");
    response.writeHead(file ? 200 : 404, {
        ...headers,
        "Content-Type":
            types[path.extname(target)] ?? "application/octet-stream",
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(target).pipe(response);
});
server.listen(port, "127.0.0.1", () =>
    console.log(`Production export: https://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit()));
}
