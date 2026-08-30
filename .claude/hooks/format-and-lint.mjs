#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const bunBin = process.env.BUN_BIN ?? `${process.env.HOME ?? ""}/.bun/bin/bun`;
const biomeBin = existsSync(bunBin) ? bunBin : "bun";

function collectStrings(value, acc = new Set()) {
  if (typeof value === "string") {
    acc.add(value);
    return acc;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, acc);
    }
    return acc;
  }

  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      collectStrings(entry, acc);
    }
  }

  return acc;
}

function resolveCandidate(candidate) {
  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim().split(String.fromCharCode(92)).join("/");
  if (!trimmed) {
    return null;
  }

  const absolutePath = path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
  return existsSync(absolutePath) ? absolutePath : null;
}

function runBiome(args, files) {
  if (files.length === 0) {
    return;
  }

  const result = spawnSync(biomeBin, ["x", "biome", ...args, ...files], {
    cwd,
    encoding: "utf8",
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

async function main() {
  try {
    const candidates = new Set(process.argv.slice(2));
    const stdin = (await readFile(0, "utf8").catch(() => "")).trim();

    if (stdin) {
      try {
        collectStrings(JSON.parse(stdin), candidates);
      } catch {
        // best-effort hook: ignore malformed payloads
      }
    }

    const files = [...candidates]
      .map(resolveCandidate)
      .filter(Boolean)
      .filter((filePath, index, array) => array.indexOf(filePath) === index);

    if (files.length === 0) {
      return;
    }

    runBiome(["format", "--write"], files);
    runBiome(["check", "--write"], files);
  } catch (error) {
    console.error(
      "[format-and-lint] best-effort hook failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

void main();
