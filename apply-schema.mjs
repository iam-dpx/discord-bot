/*
  apply-schema.mjs
  Runs schema.sql against the D1 database via Cloudflare's HTTP API —
  no wrangler CLI needed, so this works fine under plain Termux node.

  1. Create an API token: dash.cloudflare.com/profile/api-tokens →
     Create Token → "Edit Cloudflare Workers" template works, or a custom
     token with "D1: Edit" permission for your account.
  2. Run:
     CF_API_TOKEN=your_token \
     CF_ACCOUNT_ID=287c3741f2646a0b314156f21b143efd \
     CF_D1_DATABASE_ID=afd61810-aa2e-411d-ac6a-9b07984773e1 \
     node apply-schema.mjs
*/

import { readFileSync } from "node:fs";

const token = process.env.CF_API_TOKEN;
const accountId = process.env.CF_ACCOUNT_ID;
const databaseId = process.env.CF_D1_DATABASE_ID;

if (!token || !accountId || !databaseId) {
  console.error("Set CF_API_TOKEN, CF_ACCOUNT_ID, and CF_D1_DATABASE_ID environment variables first.");
  process.exit(1);
}

const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

// Strip -- comments, then split into individual statements. D1's HTTP API
// is happiest one statement per call, so we don't rely on multi-statement
// support.
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

for (const statement of statements) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ sql: statement }),
  });

  const body = await res.json();

  if (!res.ok || body.success === false) {
    console.error(`Failed on statement:\n${statement}\n`, JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log(`OK: ${statement.slice(0, 60).replace(/\s+/g, " ")}...`);
}

console.log("Schema applied successfully.");
