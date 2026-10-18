import { bundleWorkflowCode } from "@temporalio/worker";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
// Compile the two pure workflow modules before the official SDK bundles them.
// This keeps build-time transpilation independent of SWC native binary support.
const output = path.resolve("dist-temporal-worker");
await mkdir(output, { recursive: true });
for (const name of ["hosted-workflows", "hosted-contracts"]) {
  const source = await readFile(path.resolve(`temporal/${name}.ts`), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  await writeFile(path.join(output, `${name}.js`), js.outputText);
}
const bundle = await bundleWorkflowCode({
  workflowsPath: path.join(output, "hosted-workflows.js"),
});
await writeFile(path.join(output, "workflow-bundle.js"), bundle.code);
