import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const files = ["README.md"];
async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (entry.name.endsWith(".md")) files.push(file);
  }
}
await collect("docs");
const local = [], remote = new Map(), developmentLinks = [];
function addRemote(target, file) {
  const url = new URL(target); url.hash = "";
  if (url.username || url.password)
    throw new Error("Credential-bearing documentation link rejected.");
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)) {
    developmentLinks.push({file,target,reason:"Local development example; no network request made"});
    return;
  }
  const key=url.href;
  remote.set(key,[...(remote.get(key)??[]),file]);
}
for (const file of files) {
  const source = (await fs.readFile(file, "utf8")).replace(/```[\s\S]*?```/g, "");
  const matches = [...source.matchAll(/\[[^\]\n]*\]\((<[^>\n]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)];
  for (const match of matches) {
    const target = match[1].replace(/^<|>$/g, "");
    if (/^https?:\/\//.test(target)) {
      addRemote(target,file);
    } else if (!/^(?:mailto:|#)/.test(target)) {
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(target.split("#")[0]));
      const exists = await fs.access(resolved).then(() => true, () => false);
      local.push({ file, target, exists });
    }
  }
  // GitHub also turns bare URLs and angle-bracket autolinks into links. Inline
  // code is example data, so do not request its sample targets or private URLs.
  const prose=source.replace(/`[^`\n]*`/g, "");
  for (const match of prose.matchAll(/https?:\/\/[^\s<>\])"`]+/g))
    addRemote(match[0].replace(/[.,;:]+$/, ""),file);
}
const receipt = { checkedAt: new Date().toISOString(), scope: "Markdown links and bare/autolinked public URLs outside code fences in README.md and all docs Markdown. Inline-code examples are excluded from bare URL discovery. Relative links checked on disk; remote GET responses cancel after headers. Local development URLs are recorded without requesting them. HTTP 200 does not establish authenticated dashboard access or artifact truth.", files: files.length, local, developmentLinks, remote: [] };
if (process.argv.includes("--network")) {
  const queue = [...remote.entries()];
  await Promise.all(Array.from({length:4}, async () => {
    while (queue.length) {
      const [url, references] = queue.shift();
      try {
        const response = await fetch(url, {redirect:"follow", signal:AbortSignal.timeout(20_000), headers:{"user-agent":"Briefstamp-document-link-check/1.0"}});
        // Cancellation is cleanup after the HTTP status is observed. A peer
        // closing its stream must not erase an already received 200 response.
        await response.body?.cancel().catch(() => {});
        receipt.remote.push({url, status:response.status, finalUrl:response.url, references:[...new Set(references)]});
      } catch(error) { receipt.remote.push({url,status:null,error:error.name,references:[...new Set(references)]}); }
    }
  }));
} else receipt.remote = [...remote.entries()].map(([url,references])=>({url,status:"not_checked",references:[...new Set(references)]}));
receipt.remote.sort((a,b)=>a.url.localeCompare(b.url));
await fs.mkdir("outputs", {recursive:true});
await fs.writeFile("outputs/document-link-check.json",JSON.stringify(receipt,null,2)+"\n");
const missing = local.filter(item=>!item.exists);
const failures = receipt.remote.filter(item=>item.status!==200&&item.status!=="not_checked");
console.log(JSON.stringify({files:files.length,localLinks:local.length,missing,remoteLinks:remote.size,failures},null,2));
if (missing.length || failures.length) process.exitCode=1;
