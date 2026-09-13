#!/usr/bin/env node
// Injects the LAN-networking permissions and cleartext-traffic flag that
// `tauri android init` does not (and cannot, via tauri.conf.json) generate on
// its own. Without these, the generated APK builds and installs fine, but
// local multiplayer discovery/connection silently fails at runtime — see
// src-tauri/mobile/README.md for the underlying requirements. This script is
// the automated form of the manual edit documented there, run in CI (and
// usable locally) right after `tauri android init` regenerates `gen/android`.
//
// Plain Node ESM, no dependencies, safe to run repeatedly (idempotent).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MANIFEST_PATH = resolve(
  "src-tauri/gen/android/app/src/main/AndroidManifest.xml",
);

const REQUIRED_PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.ACCESS_WIFI_STATE",
  "android.permission.CHANGE_WIFI_MULTICAST_STATE",
];

function fail(message) {
  console.error(`\nERROR: ${message}\n`);
  console.error(
    "The Android manifest patch (required for LAN multiplayer to work) did " +
      "not apply. Fix the underlying issue and re-run this script — do not " +
      "ignore this failure, it produces a build that silently can't find " +
      "other players.",
  );
  process.exit(1);
}

if (!existsSync(MANIFEST_PATH)) {
  fail(
    `Manifest not found at ${MANIFEST_PATH}. Did "tauri android init" run ` +
      "before this script?",
  );
}

let xml = readFileSync(MANIFEST_PATH, "utf8");
const changes = [];
const alreadyPresent = [];

for (const permission of REQUIRED_PERMISSIONS) {
  const alreadyHasIt = new RegExp(
    `<uses-permission\\s+android:name="${permission}"\\s*/>`,
  ).test(xml);

  if (alreadyHasIt) {
    alreadyPresent.push(permission);
    continue;
  }

  const applicationIndex = xml.indexOf("<application");
  if (applicationIndex === -1) {
    fail(
      `Could not find an <application> tag in ${MANIFEST_PATH}. The ` +
        "manifest is present but not in the shape this script expects — " +
        "refusing to guess where to insert permissions.",
    );
  }

  const permissionLine = `    <uses-permission android:name="${permission}" />\n`;
  xml = xml.slice(0, applicationIndex) + permissionLine + xml.slice(applicationIndex);
  changes.push(`added <uses-permission android:name="${permission}" />`);
}

// android:usesCleartextTraffic="true" on <application> — LAN peers talk
// plain TCP, and Android 9+ (API 28+) blocks cleartext traffic by default.
const applicationTagMatch = xml.match(/<application\b[^>]*>/);
if (!applicationTagMatch) {
  fail(
    `Could not find an <application> tag in ${MANIFEST_PATH} to add ` +
      "android:usesCleartextTraffic to.",
  );
}
const applicationTag = applicationTagMatch[0];

if (/android:usesCleartextTraffic\s*=/.test(applicationTag)) {
  alreadyPresent.push('android:usesCleartextTraffic="true" on <application>');
} else {
  const patchedTag = applicationTag.replace(
    /<application\b/,
    '<application android:usesCleartextTraffic="true"',
  );
  xml = xml.replace(applicationTag, patchedTag);
  changes.push('added android:usesCleartextTraffic="true" to <application>');
}

if (changes.length > 0) {
  writeFileSync(MANIFEST_PATH, xml, "utf8");
}

console.log(`Manifest: ${MANIFEST_PATH}`);
if (changes.length > 0) {
  console.log("Changed:");
  for (const change of changes) console.log(`  - ${change}`);
} else {
  console.log("Changed: nothing (all edits already present)");
}
if (alreadyPresent.length > 0) {
  console.log("Already present:");
  for (const item of alreadyPresent) console.log(`  - ${item}`);
}
