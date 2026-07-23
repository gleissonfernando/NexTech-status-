import fs from "node:fs";

const serverEntry = new URL("./dist/server/index.js", import.meta.url);

if (!fs.existsSync(serverEntry)) {
  console.error(
    "Build output not found. Run `npm run build` before starting the application."
  );
  process.exit(1);
}

await import(serverEntry.href);
