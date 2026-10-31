import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { constants as osConstants } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const MAX_PACKAGES = 100_000;
const CACHE_SEEDS = new Set(["seed_used", "seed_unavailable", "seed_lockfile_mismatch", "decision_unavailable", "not_applicable"]);
const STORE_STATES = new Set(["created", "seeded", "reused", "unavailable"]);
// The caller may use operational status only for
// initial-setup fallback; an established project always retains pnpm. Broad
// fetch failures can include TLS/auth errors and stay fatal.
const OPERATIONAL_FAILURE_CODES = new Set([
  "ERR_PNPM_UNEXPECTED_STORE",
  "ERR_PNPM_UNEXPECTED_VIRTUAL_STORE",
  "ERR_PNPM_OUTDATED_LOCKFILE",
  "ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE",
  "ERR_PNPM_NO_LOCKFILE",
  "ERR_PNPM_FETCH_408",
  "ERR_PNPM_FETCH_429",
  "ERR_PNPM_FETCH_500",
  "ERR_PNPM_FETCH_502",
  "ERR_PNPM_FETCH_503",
  "ERR_PNPM_FETCH_504",
]);

// These are pnpm-reported package IDs, not an assertion about network bytes or
// image-cache provenance. Do not interpret an installed-tree no-op as 100% reuse.
export class InstallProgress {
  constructor(project) {
    this.project = path.resolve(project);
    this.reused = new Set();
    this.downloaded = new Set();
    this.complete = false;
    this.added = undefined;
    this.invalid = false;
  }

  accept(event) {
    if (event?.name === "pnpm:stats" && event.prefix === this.project &&
        Number.isSafeInteger(event.added) && event.added >= 0) this.added = event.added;
    if (event?.name === "pnpm:stage" && event.stage === "importing_done" &&
        event.prefix === this.project) this.complete = true;
    if (event?.name !== "pnpm:progress" || event.requester !== this.project ||
        !["fetched", "found_in_store"].includes(event.status)) return;
    if (typeof event.packageId !== "string" || !event.packageId || event.packageId.length > 4096 ||
        this.reused.size + this.downloaded.size >= MAX_PACKAGES) {
      this.invalid = true;
      return;
    }
    if (event.status === "fetched") {
      this.reused.delete(event.packageId);
      this.downloaded.add(event.packageId);
    } else if (!this.downloaded.has(event.packageId)) {
      this.reused.add(event.packageId);
    }
  }

  counts(success) {
    if (!success || !this.complete || !(this.added > 0) || this.invalid ||
        this.reused.size + this.downloaded.size === 0) return {};
    return { packages_reused: this.reused.size, packages_downloaded: this.downloaded.size };
  }
}

function openReport() {
  const report = process.env.SITES_INSTALL_REPORT_PATH;
  if (!report || !constants.O_NOFOLLOW) return undefined;
  let fd;
  try {
    fd = openSync(report, constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (fstatSync(fd).isFile()) return fd;
  } catch {}
  if (fd !== undefined) closeSync(fd);
  return undefined;
}

function writeReport(fd, report) {
  if (fd === undefined) return;
  try {
    const body = `${JSON.stringify(report)}\n`;
    writeSync(fd, body, 0, "utf8");
    ftruncateSync(fd, Buffer.byteLength(body));
  } catch {
    // Optional telemetry must not change installation behavior or expose its path.
  }
}

function showLine(line, progress, failure) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    process.stdout.write(`${line}\n`);
    return;
  }
  progress.accept(event);
  if (event?.level === "error" && failure.code !== 65) {
    failure.code = event.name === "pnpm" && OPERATIONAL_FAILURE_CODES.has(event.err?.code)
      ? 70 : 65;
  }
  const message = event?.message ?? event?.err?.message;
  if (event?.name === "pnpm:lifecycle" && typeof event.line === "string") {
    process.stdout.write(`${event.line}\n`);
  } else if (typeof message === "string" && ["warn", "error", "info"].includes(event.level)) {
    const output = event.level === "error" ? process.stderr : process.stdout;
    output.write(`${message}\n`);
  }
}

async function openLock(filename, waitSeconds) {
  let fd;
  try {
    if (!filename || !constants.O_NOFOLLOW || !constants.O_NONBLOCK) throw new Error("Unsupported lock");
    fd = openSync(filename, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    if (!fstatSync(fd).isFile()) throw new Error("Expected a regular lock file");
    const child = spawn("flock", ["-w", waitSeconds, "3"], { stdio: ["ignore", "ignore", "ignore", fd] });
    const code = await new Promise((resolve) => {
      child.once("error", () => resolve(undefined));
      child.once("close", resolve);
    });
    if (code === 0) return { status: "locked", fd };
    closeSync(fd);
    return { status: code === undefined ? "unavailable" : "busy" };
  } catch {
    if (fd !== undefined) closeSync(fd);
    return { status: "unavailable" };
  }
}

async function holdInstallLocks(projectLock, sharedLock, waitSeconds) {
  // The shell holds both leases through stdin. EOF (including caller exit)
  // releases the same open file descriptions that flock locked in its child.
  const requests = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const project = await openLock(projectLock, "0");
  let shared;
  try {
    process.stdout.write(`${project.status}\n`);
    for await (const request of requests) {
      if (request === "shared" && project.fd !== undefined) {
        shared ??= await openLock(sharedLock, waitSeconds);
        process.stdout.write(`${shared.status}\n`);
      } else if (request === "release-shared") {
        if (shared?.fd !== undefined) closeSync(shared.fd);
        shared = undefined;
        process.stdout.write("released\n");
      } else {
        process.stdout.write("unavailable\n");
      }
    }
  } finally {
    if (shared?.fd !== undefined) closeSync(shared.fd);
    if (project.fd !== undefined) closeSync(project.fd);
    requests.close();
  }
}

async function main() {
  const argsIn = process.argv.slice(2);
  if (argsIn[0] === "--hold-install-locks") {
    await holdInstallLocks(argsIn[1], argsIn[2], argsIn[3]);
    return;
  }
  if (argsIn[0] === "--report-store") {
    const [, cacheSeed, storeScope, storeState, stdout] = argsIn;
    if (!CACHE_SEEDS.has(cacheSeed) || !["project", "workspace", "unknown"].includes(storeScope) ||
        !STORE_STATES.has(storeState)) { process.exitCode = 64; return; }
    const report = { version: 1, cache_seed: cacheSeed, store_scope: storeScope, store_state: storeState };
    const fd = openReport();
    writeReport(fd, report);
    if (fd !== undefined) closeSync(fd);
    if (stdout === "1") process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  const [cacheSeed, storeScope, storeState, store, executable, ...prefix] = argsIn;
  if (!CACHE_SEEDS.has(cacheSeed) || !["project", "workspace"].includes(storeScope) ||
      !STORE_STATES.has(storeState) || storeState === "unavailable" ||
      !store || !path.isAbsolute(store) || !executable) {
    process.stderr.write("Invalid pnpm installation arguments.\n");
    process.exitCode = 64;
    return;
  }
  const fd = openReport();
  const report = { version: 1, cache_seed: cacheSeed, store_scope: storeScope, store_state: storeState };
  writeReport(fd, report);
  const progress = new InstallProgress(process.cwd());
  const failure = {};
  const env = { ...process.env };
  delete env.SITES_INSTALL_REPORT_PATH;
  const args = [...prefix, "install", "--prod=false", "--ignore-scripts=false",
    "--frozen-lockfile", "--prefer-offline", "--store-dir", store,
    "--cache-dir", path.join(store, "policy-cache"), "--fetch-retries=0",
    "--fetch-timeout=30000", "--network-concurrency=1", "--reporter=ndjson",
    "--package-import-method=auto"];
  let result = { code: 1, signal: null };
  let receivedSignal;
  try {
    const child = spawn(executable, args, { env, stdio: ["inherit", "pipe", "inherit"] });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => showLine(line, progress, failure));
    // timeout/exec owns the inherited group. Relaying would deliver signals twice.
    const signalHandlers = ["SIGINT", "SIGHUP", "SIGTERM"].map((signal) => {
      const handler = () => { receivedSignal ??= signal; };
      process.on(signal, handler);
      return [signal, handler];
    });
    let spawnError;
    child.once("error", (error) => { spawnError = error; });
    result = await new Promise((resolve) => child.once("close", (code, signal) => {
      resolve({ code: spawnError ? (spawnError.code === "ENOENT" ? 127 : 1) : code, signal });
    }));
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    lines.close();
    result.signal ??= receivedSignal;
    if (spawnError) {
      process.stderr.write("Unable to start pnpm.\n");
      result.code = spawnError.code === "ENOENT" ? 127 : 65;
    } else if (result.code !== 0 && !result.signal) {
      result.code = failure.code ?? 65;
    }
    if (result.code === 0 && !result.signal) {
      accessSync("node_modules/.bin/vinext", constants.X_OK);
      const lock = readFileSync("pnpm-lock.yaml");
      writeFileSync("node_modules/.sites-install.json", `${JSON.stringify({
        package_manager: "pnpm@11.25.0",
        lockfile_sha256: createHash("sha256").update(lock).digest("hex"),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
      }, null, 2)}\n`);
    }
  } catch {
    process.stderr.write("Dependency setup did not produce a usable Vinext installation.\n");
    result = { code: 65, signal: receivedSignal ?? null };
  } finally {
    Object.assign(report, progress.counts(result.code === 0 && !result.signal));
    writeReport(fd, report);
    if (fd !== undefined) closeSync(fd);
  }
  if (report.packages_reused !== undefined) {
    process.stdout.write(`[sites] pnpm reused ${report.packages_reused} packages and downloaded ${report.packages_downloaded}\n`);
  }
  if (result.code === 0 && !result.signal) process.stdout.write("[sites] dependency setup passed\n");
  process.exitCode = result.signal ? 128 + (osConstant…2087 tokens truncated…kie.slice(localCookieName.length + 1));
        const applicationCookies = cookies.filter(
          (cookie) => !cookie.startsWith(`${localCookieName}=`),
        );
        if (applicationCookies.length !== cookies.length) {
          removeHeader(request, "cookie");
          if (applicationCookies.length) {
            setHeader(request, "cookie", applicationCookies.join("; "));
          }
        }

        if (url.pathname === "/callback") {
          respond(response, 501);
          return;
        }

        const signIn = url.pathname === "/signin-with-chatgpt";
        const signOut = url.pathname === "/signout-with-chatgpt";
        if (!signIn && !signOut) {
          if (signInCookies.length === 1 && signInCookies[0] === "1") {
            setHeader(request, "oai-authenticated-user-id", localUserId);
            setHeader(request, "oai-authenticated-user-email", localEmail);
            setHeader(
              request,
              "oai-authenticated-user-full-name",
              localFullName,
            );
            setHeader(
              request,
              "oai-authenticated-user-full-name-encoding",
              "percent-encoded-utf-8",
            );
          }
          next();
          return;
        }

        if (
          (request.headers.origin && request.headers.origin !== url.origin) ||
          request.headers["sec-fetch-site"] === "cross-site"
        ) {
          respond(response, 403);
          return;
        }

        if (
          request.headers["next-router-prefetch"] !== undefined ||
          request.headers["x-middleware-prefetch"] === "1" ||
          [request.headers.purpose, request.headers["sec-purpose"]].some(
            (value) =>
              typeof value === "string" &&
              value
                .split(/[;,]/)
                .some((part) => part.trim().toLowerCase() === "prefetch"),
          )
        ) {
          respond(response, 204);
          return;
        }

        if (
          request.method !== "GET" &&
          (!signOut || request.method !== "POST")
        ) {
          response.setHeader("Allow", signIn ? "GET" : "GET, POST");
          respond(response, 405);
          return;
        }

        response.statusCode = request.method === "POST" ? 303 : 302;
        response.setHeader("Cache-Control", "private, no-store");
        response.setHeader(
          "Location",
          safeReturn(url.searchParams.get("return_to")),
        );
        response.setHeader(
          "Set-Cookie",
          `${localCookieName}=${signIn ? "1" : ""}; Path=/; ${
            signOut ? "Max-Age=0; " : ""
          }HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
        );
        response.end();
      });
    },
    async closeBundle() {
      if (command !== "build") return;

      const outputDirectory = resolve(root, "dist", ".openai");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "drizzle");

      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });

      await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(outputDirectory, "drizzle"), {
          recursive: true,
        });
      }
    },
  };
}

function removeHeader(request: IncomingMessage, name: string): void {
  delete request.headers[name];
  for (let index = request.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      request.rawHeaders.splice(index, 2);
    }
  }
}

function setHeader(
  request: IncomingMessage,
  name: string,
  value: string,
): void {
  removeHeader(request, name);
  request.headers[name] = value;
  request.rawHeaders.push(name, value);
}

function respond(response: ServerResponse, status: number): void {
  response.statusCode = status;
  response.setHeader("Cache-Control", "private, no-store");
  response.end();
}

function safeReturn(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost" || authPaths.has(url.pathname)) {
      return "/";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
