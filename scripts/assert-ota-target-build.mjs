#!/usr/bin/env node
/**
 * Refuse to publish an OTA update that no installed binary can receive.
 *
 * WHY THIS EXISTS
 * ---------------
 * An update is only ever delivered to a build whose `runtimeVersion` is byte-identical to
 * the one the update is published under. Nothing in `eas update` checks that such a build
 * exists — it happily publishes into a runtimeVersion nobody runs, prints a green summary,
 * and the job succeeds. The update then reaches zero devices, silently.
 *
 * That is not hypothetical. The driver app's runtimeVersion was bumped "2" -> "3" on
 * 2026-08-29 when background location (a native change) landed. The build that would have
 * produced a runtimeVersion "3" binary failed the same day — the Expo free plan had run out
 * of Android builds for the month — and was never re-run. Every driver OTA published
 * afterwards succeeded and reached nobody, for days, with no signal anywhere.
 *
 * So: before publishing, prove that at least one finished Android build on the target
 * channel carries this exact runtimeVersion.
 *
 * WHAT THIS DOES NOT PROVE
 * ------------------------
 * That users actually run that build. A finished Play Store build may not be rolled out
 * yet, and drivers on an older binary stay on their old runtimeVersion no matter what.
 * This guard catches "the update can reach nobody", not "the update reaches everybody".
 *
 * Usage (from inside the app directory, e.g. sarix-go-driver):
 *   node ../scripts/assert-ota-target-build.mjs <channel>
 */
import { execFileSync } from 'node:child_process';

const BUILD_LIST_LIMIT = 50;

const channel = process.argv[2];
if (!channel) {
  fail('Usage: node ../scripts/assert-ota-target-build.mjs <channel>');
}

function fail(message) {
  // ::error:: makes this land in the GitHub Actions job summary rather than only the log.
  console.error(`::error::${message}`);
  process.exit(1);
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    fail(`\`${command} ${args.join(' ')}\` failed.\n${detail || error.message}`);
  }
}

/**
 * eas-cli prefixes --json output with human-readable notices often enough that parsing the
 * raw stdout is unreliable (see expo/eas-cli#1636). Fall back to the outermost bracket pair.
 */
function parseJsonLoosely(raw, what) {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end <= start) {
      fail(`Could not parse ${what} as JSON. Raw output:\n${raw.slice(0, 2000)}`);
    }
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      fail(`Could not parse ${what} as JSON. Raw output:\n${raw.slice(0, 2000)}`);
    }
  }
}

// 1. The runtimeVersion this update will be published under — read from the resolved config,
//    not from app.json, so app.config.js has had its say.
const configRaw = run('npx', ['expo', 'config', '--type', 'public', '--json']);
let config;
try {
  config = JSON.parse(configRaw);
} catch {
  const start = configRaw.indexOf('{');
  const end = configRaw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    fail(`Could not parse \`expo config\` output as JSON:\n${configRaw.slice(0, 2000)}`);
  }
  config = JSON.parse(configRaw.slice(start, end + 1));
}

const runtimeVersion = config.runtimeVersion;
if (typeof runtimeVersion !== 'string') {
  // A policy object (e.g. `fingerprint`) resolves per-build, so "does a build carry it" is
  // not a question this guard can answer by string comparison. This project sets an explicit
  // string on purpose (see app.config.js); if that ever changes, this guard must change too.
  fail(
    'Expected an explicit string `runtimeVersion` in the resolved app config, got ' +
      `${JSON.stringify(runtimeVersion)}. This guard only understands explicit ` +
      'runtimeVersions — update it before switching back to a policy.'
  );
}

// 2. Finished Android builds on the channel this update targets.
const buildsRaw = run('eas', [
  'build:list',
  '--platform',
  'android',
  '--channel',
  channel,
  '--status',
  'finished',
  '--limit',
  String(BUILD_LIST_LIMIT),
  '--non-interactive',
  '--json',
]);
const builds = parseJsonLoosely(buildsRaw, '`eas build:list` output');

if (!Array.isArray(builds)) {
  fail(`Expected \`eas build:list --json\` to return an array, got ${typeof builds}.`);
}

if (builds.length === 0) {
  fail(
    `No finished Android build exists on channel "${channel}", so an update published ` +
      'here cannot reach any device. Build first, then publish the update.'
  );
}

// 3. Distinguish "no matching build" from "this guard has gone stale". If not a single build
//    reports a runtimeVersion, the CLI's JSON shape changed and the comparison below would
//    silently reject everything — that needs a different fix from "run a build".
const withRuntime = builds.filter((build) => typeof build?.runtimeVersion === 'string');
if (withRuntime.length === 0) {
  fail(
    `None of the ${builds.length} builds returned by \`eas build:list --json\` carry a ` +
      'string `runtimeVersion` field. The CLI output shape has changed — fix ' +
      'scripts/assert-ota-target-build.mjs rather than assuming no build matches.'
  );
}

const matching = withRuntime.filter((build) => build.runtimeVersion === runtimeVersion);

if (matching.length === 0) {
  const seen = [...new Set(withRuntime.map((build) => build.runtimeVersion))].sort();
  fail(
    `No finished Android build on channel "${channel}" has runtimeVersion ` +
      `"${runtimeVersion}", so this update would reach zero devices.\n` +
      `runtimeVersions present on this channel (newest ${withRuntime.length} builds): ` +
      `${seen.join(', ')}\n` +
      'Either the runtimeVersion was bumped without a matching build (run the build ' +
      'workflow for this app and wait for it to finish), or this update belongs on a ' +
      'different channel.'
  );
}

const newest = matching[0];
console.log(
  `runtimeVersion "${runtimeVersion}" on channel "${channel}": ${matching.length} ` +
    `matching finished build(s). Newest: ${newest.id ?? 'unknown id'}` +
    `${newest.appVersion ? ` (app version ${newest.appVersion})` : ''}.`
);
