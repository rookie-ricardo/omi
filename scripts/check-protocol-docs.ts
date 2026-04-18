import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { commandMap } from "../packages/core/src/index";

const docPath = resolve(process.cwd(), "docs/claude-first-runtime-architecture.md");
const doc = readFileSync(docPath, "utf8");

const commandNames = Object.keys(commandMap).sort();
const sectionStart = doc.indexOf("## Supported Runner Command Surface");
if (sectionStart < 0) {
  console.error("Missing section: ## Supported Runner Command Surface");
  process.exit(1);
}
const nextSectionOffset = doc.slice(sectionStart + 1).indexOf("\n## ");
const sectionEnd = nextSectionOffset < 0
  ? doc.length
  : sectionStart + 1 + nextSectionOffset;
const commandSection = doc.slice(sectionStart, sectionEnd);

const missingInDoc = commandNames.filter((name) => !commandSection.includes(`- \`${name}\``));

const docCommands = [...commandSection.matchAll(/- `([a-z0-9.]+)`/g)].map((match) => match[1]).sort();
const unknownInDoc = docCommands.filter((name) => !commandNames.includes(name));

if (missingInDoc.length > 0 || unknownInDoc.length > 0) {
  if (missingInDoc.length > 0) {
    console.error("Missing command entries in docs:");
    for (const name of missingInDoc) {
      console.error(`- ${name}`);
    }
  }

  if (unknownInDoc.length > 0) {
    console.error("Unknown command entries in docs:");
    for (const name of unknownInDoc) {
      console.error(`- ${name}`);
    }
  }

  process.exit(1);
}

console.log(`Protocol docs check passed (${commandNames.length} commands).`);
