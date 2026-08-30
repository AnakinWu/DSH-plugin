// Bundles client/src/index.jsx into client/client.js wrapped in
// window.__ModuleLoader__.load, the same shape the shipped client bundles use.
// Mirrors into the web profile copy so a server restart serves the fresh build.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const profilePluginDir = "/Users/anakinwu/.dsh/profiles/web/node_modules/dsh-archive-finder";
const srcInProfile = path.join(profilePluginDir, "client/src/index.jsx");
const entry = existsSync(srcInProfile) ? srcInProfile : path.join(root, "client/src/index.jsx");
const tmp = path.join(root, "client", ".tmp.cjs");
const out = path.join(root, "client", "client.js");

const esbuild = [
	"/Users/anakinwu/.hermes/hermes-agent/node_modules/.bin/esbuild",
	"/opt/homebrew/bin/esbuild"
].find((p) => existsSync(p));
if (!esbuild) {
	console.error("esbuild not found");
	process.exit(1);
}

execFileSync(esbuild, [
	entry,
	"--bundle",
	"--format=cjs",
	"--external:react",
	"--external:react-dom",
	"--external:react-dom/client",
	"--external:@deepseek-ai/dsh-client-ui-primitives",
	"--jsx=transform",
	"--jsx-factory=React.createElement",
	"--jsx-fragment=React.Fragment",
	"--outfile=" + tmp,
	"--log-level=warning"
], { stdio: "inherit" });

const head = 'window.__ModuleLoader__.load({\n  id: "dsh-archive-finder",\n  factory: function (require) {\n    var module = { exports: {} };\n    var exports = module.exports;\n';
const tail = '\n    return module.exports;\n  },\n});\n';
const body = readFileSync(tmp, "utf8");
writeFileSync(out, head + body + tail);
unlinkSync(tmp);
console.log("built", out, (head + body + tail).length, "bytes");

// Mirror into the profile copy so a server restart serves it even without a reinstall.
if (existsSync(path.dirname(path.join(profilePluginDir, "client", "client.js")))) {
	copyFileSync(out, path.join(profilePluginDir, "client", "client.js"));
	console.log("mirrored to", path.join(profilePluginDir, "client", "client.js"));
}
