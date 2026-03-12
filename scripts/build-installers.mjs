#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPackageJsonPath = path.join(rootDir, "packages", "cli", "package.json");
const cliPackage = JSON.parse(fs.readFileSync(cliPackageJsonPath, "utf8"));
const packageVersion = String(cliPackage.version ?? "").trim();

function parseReleaseVersion() {
  const args = process.argv.slice(2);
  const inlineVersionArgIndex = args.findIndex((arg) => arg === "--version");
  const inlineVersionArg =
    inlineVersionArgIndex >= 0 && args[inlineVersionArgIndex + 1] ? args[inlineVersionArgIndex + 1] : null;
  const fallbackArg = args.find((arg) => arg.startsWith("--version="));
  const envVersion = process.env.STORYFORGE_RELEASE_VERSION?.trim() || null;
  const raw =
    inlineVersionArg ||
    (fallbackArg ? fallbackArg.replace(/^--version=/, "").trim() : null) ||
    envVersion ||
    packageVersion;

  const normalized = String(raw ?? "").trim().replace(/^v/, "");
  if (!normalized) {
    throw new Error("Release version is empty. Use --version <semver>.");
  }

  return normalized;
}

const version = parseReleaseVersion();
const versionTag = `v${version}`;
const bundledNodeVersion = String(process.env.STORYFORGE_BUNDLED_NODE_VERSION ?? "20.19.0")
  .trim()
  .replace(/^v/, "");
const nodeDistBaseUrl = (process.env.STORYFORGE_NODE_DIST_BASE_URL ?? "https://nodejs.org/dist").trim().replace(/\/$/, "");

if (!version) {
  throw new Error(`Invalid version in ${cliPackageJsonPath}`);
}

if (!/^\d+\.\d+\.\d+$/.test(bundledNodeVersion)) {
  throw new Error(
    `Invalid bundled Node version "${bundledNodeVersion}". Use semver like 20.19.0.`
  );
}

const installersDir = path.join(rootDir, "installers", versionTag);
const tempDir = path.join(rootDir, ".release-tmp", `${versionTag}-${Date.now()}`);
const runtimeDir = path.join(tempDir, "runtime");
const nodeDistDir = path.join(tempDir, "node-dist");
const extractedNodeDir = path.join(tempDir, "node-runtime");
const portableRoot = path.join(tempDir, "portable");
const builtArtifacts = [];
const extractedNodeCache = new Map();

const portableTargets = [
  { platform: "macos", arch: "universal" },
  { platform: "linux", arch: "universal" }
];

const nodeRuntimeTargetsByPlatform = {
  macos: ["darwin-arm64", "darwin-x64"],
  linux: ["linux-arm64", "linux-x64"]
};

function run(command, args, cwd = rootDir) {
  const rendered = `${command} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`;
  console.log(`\n> ${rendered}`);

  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function hasCommand(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command} >/dev/null 2>&1`], {
    cwd: rootDir,
    stdio: "ignore"
  });
  return result.status === 0;
}

function ensureExecutable(filePath) {
  fs.chmodSync(filePath, 0o755);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createLauncherScript(targetRoot) {
  const binDir = path.join(targetRoot, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const launcherPath = path.join(binDir, "storyforge");
  const launcher = `#!/usr/bin/env sh
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
STORYFORGE_HOME="\${STORYFORGE_HOME:-$SCRIPT_DIR/../lib/storyforge}"
resolve_bundled_node() {
  OS_NAME="$(uname -s 2>/dev/null || echo unknown)"
  ARCH_NAME="$(uname -m 2>/dev/null || echo unknown)"

  case "$OS_NAME:$ARCH_NAME" in
    Darwin:arm64|Darwin:aarch64)
      echo "$STORYFORGE_HOME/runtime/node/darwin-arm64/bin/node"
      ;;
    Darwin:x86_64)
      echo "$STORYFORGE_HOME/runtime/node/darwin-x64/bin/node"
      ;;
    Linux:x86_64)
      echo "$STORYFORGE_HOME/runtime/node/linux-x64/bin/node"
      ;;
    Linux:arm64|Linux:aarch64)
      echo "$STORYFORGE_HOME/runtime/node/linux-arm64/bin/node"
      ;;
    *)
      return 1
      ;;
  esac
}

NODE_BIN="$(resolve_bundled_node)" || {
  echo "Storyforge does not include a bundled Node runtime for this platform/arch: $(uname -s)/$(uname -m)" >&2
  exit 1
}

if [ ! -x "$NODE_BIN" ]; then
  echo "Bundled Node runtime is missing: $NODE_BIN" >&2
  exit 1
fi

exec "$NODE_BIN" "$STORYFORGE_HOME/dist/index.js" "$@"
`;
  fs.writeFileSync(launcherPath, launcher, "utf8");
  ensureExecutable(launcherPath);
}

function prepareRuntimeBundle() {
  const runtimePackageJson = {
    name: "storyforge-runtime",
    version,
    private: true,
    type: "module",
    engines: cliPackage.engines ?? { node: ">=20" },
    dependencies: cliPackage.dependencies ?? {}
  };

  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.cpSync(path.join(rootDir, "packages", "cli", "dist"), path.join(runtimeDir, "dist"), {
    recursive: true
  });
  fs.copyFileSync(path.join(rootDir, "packages", "cli", "story_agent.py"), path.join(runtimeDir, "story_agent.py"));
  fs.writeFileSync(path.join(runtimeDir, "package.json"), `${JSON.stringify(runtimePackageJson, null, 2)}\n`, "utf8");

  run("npm", ["install", "--omit=dev", "--no-fund", "--no-audit"], runtimeDir);
}

async function downloadIfMissing(url, destinationPath) {
  if (fs.existsSync(destinationPath)) {
    return;
  }

  console.log(`\n> download ${JSON.stringify(url)}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url} (status ${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, Buffer.from(arrayBuffer));
}

async function ensureExtractedNodeRuntime(runtimeTarget) {
  const cached = extractedNodeCache.get(runtimeTarget);

  if (cached && fs.existsSync(path.join(cached, "bin", "node"))) {
    return cached;
  }

  const archiveName = `node-v${bundledNodeVersion}-${runtimeTarget}.tar.gz`;
  const archiveUrl = `${nodeDistBaseUrl}/v${bundledNodeVersion}/${archiveName}`;
  const archivePath = path.join(nodeDistDir, archiveName);
  const extractPath = path.join(extractedNodeDir, runtimeTarget);

  await downloadIfMissing(archiveUrl, archivePath);
  fs.rmSync(extractPath, { recursive: true, force: true });
  fs.mkdirSync(extractPath, { recursive: true });
  run("tar", ["-xzf", archivePath, "--strip-components=1", "-C", extractPath]);

  const nodeBin = path.join(extractPath, "bin", "node");

  if (!fs.existsSync(nodeBin)) {
    throw new Error(`Bundled runtime ${runtimeTarget} is missing bin/node after extraction.`);
  }

  ensureExecutable(nodeBin);
  extractedNodeCache.set(runtimeTarget, extractPath);
  return extractPath;
}

async function stageBundledNodeRuntimes(platform, libRoot) {
  const runtimeTargets = nodeRuntimeTargetsByPlatform[platform];

  if (!runtimeTargets || runtimeTargets.length === 0) {
    throw new Error(`No bundled runtime mapping found for platform ${platform}.`);
  }

  const nodeRoot = path.join(libRoot, "runtime", "node");

  for (const runtimeTarget of runtimeTargets) {
    const extracted = await ensureExtractedNodeRuntime(runtimeTarget);
    const sourceNode = path.join(extracted, "bin", "node");
    const destinationRoot = path.join(nodeRoot, runtimeTarget);
    const destinationNode = path.join(destinationRoot, "bin", "node");

    fs.mkdirSync(path.dirname(destinationNode), { recursive: true });
    fs.copyFileSync(sourceNode, destinationNode);
    ensureExecutable(destinationNode);

    const sourceLicense = path.join(extracted, "LICENSE");

    if (fs.existsSync(sourceLicense)) {
      fs.copyFileSync(sourceLicense, path.join(destinationRoot, "LICENSE"));
    }
  }
}

async function createPortableArchive(target) {
  const packageFolderName = `storyforge-${version}-${target.platform}-${target.arch}`;
  const packageRoot = path.join(portableRoot, packageFolderName);
  const libRoot = path.join(packageRoot, "lib", "storyforge");

  fs.mkdirSync(libRoot, { recursive: true });
  fs.cpSync(runtimeDir, libRoot, { recursive: true, dereference: true });
  await stageBundledNodeRuntimes(target.platform, libRoot);
  createLauncherScript(packageRoot);
  fs.copyFileSync(path.join(rootDir, "LICENSE"), path.join(packageRoot, "LICENSE"));

  const installNote = `Storyforge ${version} (${target.platform}-${target.arch})

Requires:
  Python 3.10+
  opencode in PATH

Install:
  sudo mkdir -p /usr/local/lib/storyforge
  sudo cp -R ./lib/storyforge/. /usr/local/lib/storyforge/
  sudo install -m 0755 ./bin/storyforge /usr/local/bin/storyforge
`;
  fs.writeFileSync(path.join(packageRoot, "INSTALL.txt"), installNote, "utf8");

  const archivePath = path.join(installersDir, `${packageFolderName}.tar.gz`);
  run("tar", ["-czf", archivePath, "-C", portableRoot, packageFolderName]);
  builtArtifacts.push(archivePath);

  return packageRoot;
}

function createMacPkg(macosPackageRoot) {
  if (!macosPackageRoot) {
    return null;
  }

  if (!hasCommand("pkgbuild")) {
    console.warn("pkgbuild not found, skipping macOS .pkg generation.");
    return null;
  }

  const pkgRoot = path.join(tempDir, "pkgroot", "usr", "local");
  const pkgBinDir = path.join(pkgRoot, "bin");
  const pkgLibDir = path.join(pkgRoot, "lib", "storyforge");
  fs.mkdirSync(pkgBinDir, { recursive: true });
  fs.mkdirSync(pkgLibDir, { recursive: true });

  fs.copyFileSync(path.join(macosPackageRoot, "bin", "storyforge"), path.join(pkgBinDir, "storyforge"));
  fs.cpSync(path.join(macosPackageRoot, "lib", "storyforge"), pkgLibDir, {
    recursive: true,
    dereference: true
  });
  ensureExecutable(path.join(pkgBinDir, "storyforge"));

  const pkgPath = path.join(installersDir, `storyforge-${version}-macos-universal.pkg`);
  run("pkgbuild", [
    "--identifier",
    "com.storyforge.cli",
    "--version",
    version,
    "--root",
    path.join(tempDir, "pkgroot"),
    pkgPath
  ]);

  builtArtifacts.push(pkgPath);
  return pkgPath;
}

function createMacDmg(macosPkgPath, macosPackageRoot) {
  if (process.platform !== "darwin") {
    return null;
  }

  if (!hasCommand("hdiutil")) {
    console.warn("hdiutil not found, skipping macOS .dmg generation.");
    return null;
  }

  const dmgSourceDir = path.join(tempDir, "dmg-source", `storyforge-${version}-macos`);
  fs.mkdirSync(dmgSourceDir, { recursive: true });

  if (macosPkgPath && fs.existsSync(macosPkgPath)) {
    fs.copyFileSync(macosPkgPath, path.join(dmgSourceDir, path.basename(macosPkgPath)));
  } else if (macosPackageRoot) {
    const fallbackPayloadDir = path.join(dmgSourceDir, path.basename(macosPackageRoot));
    fs.cpSync(macosPackageRoot, fallbackPayloadDir, {
      recursive: true,
      dereference: true
    });
  } else {
    return null;
  }

  const readme = `Storyforge ${version} macOS installer

1. Open this disk image.
2. Run the .pkg installer.
3. Launch in terminal with: storyforge
`;
  fs.writeFileSync(path.join(dmgSourceDir, "README.txt"), readme, "utf8");

  const dmgPath = path.join(installersDir, `storyforge-${version}-macos-universal.dmg`);
  run("hdiutil", [
    "create",
    "-volname",
    `Storyforge ${version}`,
    "-srcfolder",
    dmgSourceDir,
    "-ov",
    "-format",
    "UDZO",
    dmgPath
  ]);

  builtArtifacts.push(dmgPath);
  return dmgPath;
}

function createLinuxDeb(linuxPackageRoot) {
  if (!linuxPackageRoot) {
    return;
  }

  if (process.platform !== "linux") {
    return;
  }

  if (!hasCommand("dpkg-deb")) {
    console.warn("dpkg-deb not found, skipping Linux .deb generation.");
    return;
  }

  const archMap = {
    x64: "amd64",
    arm64: "arm64"
  };
  const debArch = archMap[process.arch] ?? "all";

  const debRoot = path.join(tempDir, "debroot");
  const debianDir = path.join(debRoot, "DEBIAN");
  const debBinDir = path.join(debRoot, "usr", "local", "bin");
  const debLibDir = path.join(debRoot, "usr", "local", "lib", "storyforge");
  fs.mkdirSync(debianDir, { recursive: true });
  fs.mkdirSync(debBinDir, { recursive: true });
  fs.mkdirSync(debLibDir, { recursive: true });

  fs.copyFileSync(path.join(linuxPackageRoot, "bin", "storyforge"), path.join(debBinDir, "storyforge"));
  fs.cpSync(path.join(linuxPackageRoot, "lib", "storyforge"), debLibDir, {
    recursive: true,
    dereference: true
  });
  ensureExecutable(path.join(debBinDir, "storyforge"));

  const control = `Package: storyforge
Version: ${version}
Section: utils
Priority: optional
Architecture: ${debArch}
Maintainer: Storyforge Team
Description: Storyforge terminal-first fiction workflow CLI
`;
  fs.writeFileSync(path.join(debianDir, "control"), control, "utf8");

  const debPath = path.join(installersDir, `storyforge_${version}_${debArch}.deb`);
  run("dpkg-deb", ["--build", debRoot, debPath]);
  builtArtifacts.push(debPath);
}

function writeChecksums() {
  const lines = builtArtifacts
    .map((artifactPath) => `${sha256(artifactPath)}  ${path.basename(artifactPath)}`)
    .sort((a, b) => a.localeCompare(b));
  fs.writeFileSync(path.join(installersDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
}

function writeHomebrewCaskTemplate(macosPkgPath) {
  if (!macosPkgPath) {
    return;
  }

  const caskDir = path.join(installersDir, "homebrew");
  fs.mkdirSync(caskDir, { recursive: true });

  const template = `cask "storyforge" do
  version "${version}"
  sha256 "${sha256(macosPkgPath)}"

  url "https://your-domain.example/storyforge-${version}-macos-universal.pkg"

  pkg "storyforge-#{version}-macos-universal.pkg"

  uninstall pkgutil: "com.storyforge.cli"
end
`;

  fs.writeFileSync(path.join(caskDir, "storyforge.rb"), template, "utf8");
}

async function main() {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(installersDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(nodeDistDir, { recursive: true });
  fs.mkdirSync(extractedNodeDir, { recursive: true });
  fs.mkdirSync(installersDir, { recursive: true });
  fs.mkdirSync(portableRoot, { recursive: true });

  run("pnpm", ["--filter", "@storyforge/cli", "run", "build"]);
  prepareRuntimeBundle();

  const packageRoots = new Map();
  for (const target of portableTargets) {
    packageRoots.set(target.platform, await createPortableArchive(target));
  }

  const macosPkgPath = createMacPkg(packageRoots.get("macos"));
  createMacDmg(macosPkgPath, packageRoots.get("macos"));
  createLinuxDeb(packageRoots.get("linux"));
  writeChecksums();
  writeHomebrewCaskTemplate(macosPkgPath);
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log(`\nInstallers are ready in: ${installersDir}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
