# Security exceptions

These are explicit temporary risk decisions, not fixes or audit suppression. Re-evaluate on dependency, import, build configuration or input-boundary changes.

## SEC-2026-001 — temporary dev-tooling risk

Decision date: 2026-10-03. Governance: SDD STRICT; authorized by TASK-RELEASE-01A.3's accepted-risk path. Exposure: DEV/BUILD ONLY for application-controlled code. Owner: site operator / repository maintainer. Decision: temporary accepted dev-tooling risk for V1 preflight, not a V1 release authorization.

### Advisory and exact scope

[GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), High, CWE-674: deeply nested brace expressions can exhaust recursive parser/AST traversal stack and cause denial of service. Authoritative GitHub advisory verified 2026-10-03: affected braces <=3.0.3; patched release **NONE**. Registry latest braces is 3.0.3. The audit has one underlying advisory and four propagated dependency findings, not five independent CVEs.

| Audit package | Installed | Audit affected range | Relationship / exact path from root | Patched compatible path |
|---|---|---|---|---|
| braces | 3.0.3 | Advisory <=3.0.3; package finding `*` | Transitive: tailwindcss → chokidar → braces; tailwindcss → micromatch → braces; tailwindcss → fast-glob → micromatch → braces | NONE |
| chokidar | 3.6.0 | 2.0.0–3.6.0 | Transitive: tailwindcss → chokidar; via braces | NONE in 3.x |
| micromatch | 4.0.8 | >=0.2.0 | Transitive: tailwindcss → micromatch; tailwindcss → fast-glob → micromatch; via braces | NONE in 4.x |
| fast-glob | 3.3.3 | `*` | Transitive: tailwindcss → fast-glob; via micromatch | NONE in 3.x |
| tailwindcss | 3.4.19 | <=0.0.0-oxide-insiders.ff2c25f OR 2.1.0-canary.1–3.4.19 | Direct devDependency; via chokidar, fast-glob, micromatch | NONE in 3.x |

All five are High and have `dev: true` in the lockfile. Nodes are exactly `node_modules/<package>` for the five rows. None is physically installed in the verified production-only dependency set, emitted as a browser module, or reachable from an application API entry point. The runtime qualifications below apply to every row.

### Boundary evidence

1. Full audit JSON: exactly five high, zero critical/moderate/low/info. Production-only audit: **0 vulnerabilities**.
2. Disposable directory containing only package.json and package-lock.json: `npm ci --omit=dev --ignore-scripts` installed 49 packages and audited 50; `npm ls braces` returned `(empty)`; production audit again returned 0. Install scripts disabled to avoid unrelated execution; root has no install lifecycle scripts. This checks physical package presence, not labels alone.
3. Vite production build with `write:false` and a `generateBundle` module inventory: 468 emitted JavaScript module records, zero module paths for all five packages. Generated Tailwind CSS remains; the compiler is not browser code. Source and dist secret-boundary scans pass.
4. All 11 `api/**/*.ts` entry points bundled in memory with installed esbuild (`bundle:true`, `platform:'node'`, `format:'esm'`, `write:false`, `metafile:true`): 44 unique input files, zero five-package inputs; only external import is `node:crypto`. No unresolved application dynamic import or package import remained. This is a local complete application dependency-closure check, **not a downloaded Vercel function artifact**.
5. Current Vercel deployment 846c464 is Ready; Source/Output view was inspected. It exposes API/static output but not a complete per-function internal package inventory in the inspected view. Remote artifact byte-for-byte package absence is **NOT VERIFIED**. Do not claim otherwise. Criterion 4 uses its explicitly permitted alternative: no application runtime dependency/input path reaches the vulnerable packages, established by all API entry-point closure and source inspection. Vercel platform internals are outside this repository audit scope.
6. Source search of api/server/shared/src found no glob library, brace parser, computed dynamic imports, eval, Function constructor or child-process execution. Literal React lazy imports are included in the browser graph. Migration file enumeration uses fixed local directory names and native fs operations; it is build/operator code, not an HTTP glob endpoint.
7. Tailwind content patterns are fixed repository configuration: `./index.html`, `./src/**/*.{js,ts,jsx,tsx}`. PostCSS invokes Tailwind at build time. Riot identifiers, network/database/provider data flow into validation, encoded provider URLs, parameterized SQL, normalization and presentation, never these build patterns. API validation bounds identifiers/UUIDs/limits; it does not call a glob compiler. No production endpoint accepts a glob/brace expression into the affected code.

Production user input cannot reach the affected application code. This is not a general claim that braces is safe: malicious repository/build configuration, dependency supply-chain compromise or untrusted code executed by a developer/CI can still attack tooling. Keep configuration review and existing secret scans; do not run attacker-supplied patterns through Tailwind/watch tooling. Builds operate on reviewed repository files, not production request bodies or provider responses. PR code execution remains a separate build trust risk; do not expose privileged production credentials to untrusted PR builds.

Reproduce the in-memory graph checks from the repository root (neither writes artifacts nor invokes API handlers):

```js
// node --input-type=module; installed Vite and esbuild only
import { build as browserBuild } from 'vite';
import { build as functionBuild } from 'esbuild';
import { readdirSync } from 'node:fs';
const affected = /node_modules[\\/](braces|micromatch|chokidar|fast-glob|tailwindcss)[\\/]/;
await browserBuild({
  logLevel: 'silent', build: { write: false },
  plugins: [{ name: 'security-module-inventory', generateBundle(_, bundle) {
    const ids = Object.values(bundle).flatMap(b => b.type === 'chunk' ? Object.keys(b.modules) : []);
    console.log({ moduleCount: ids.length, affected: ids.filter(p => affected.test(p)) });
  } }],
});
const entries = readdirSync('api', { recursive: true }).filter(p => p.endsWith('.ts')).map(p => 'api/' + p);
const result = await functionBuild({ entryPoints: entries, bundle: true, platform: 'node',
  format: 'esm', outdir: 'security-runtime-proof', write: false, metafile: true });
console.log({ entryCount: entries.length, affected: Object.keys(result.metafile.inputs).filter(p => affected.test(p)),
  externalImports: [...new Set(Object.values(result.metafile.outputs).flatMap(o => o.imports.filter(i => i.external).map(i => i.path)))] });
```

### Compatible fix search

Ran `npm outdated`, `npm update --dry-run` and registry metadata checks. Current wanted versions for the affected parents equal the installed versions. An isolated `npm update tailwindcss chokidar micromatch fast-glob --ignore-scripts` kept exactly 3.4.19 / 3.6.0 / 4.0.8 / 3.3.3 / braces 3.0.3 and reproduced the same five-high audit. Unrelated updates were not applied to this repository.

The audit's `fast-glob.fixAvailable:true` is not proof of an effective compatible fix: the actual compatible-parent trial remains vulnerable. npm suggests Tailwind 4.3.3 as a major change for other findings. No Tailwind 4 install/migration, force fix, override, fork, vendoring or node_modules patch was performed. A Tailwind 4/toolchain migration requires separate human approval and its own actual dependency-tree verification; metadata alone does not verify that the whole replacement tree is clean.

### Acceptance criteria and expiration

All nine authorized criteria are met: zero production audit; physically dev-only packages; browser graph absent; no untrusted production-input path into affected API code (remote artifact absence NOT VERIFIED); no glob endpoint; source/dist security scans pass; no patched upstream release; time-bounded record; named follow-up owner and review process.

Expires/review required **2026-11-03**, or immediately upon a patched braces release or safe parent removal, whichever comes first. An expired exception, new high/critical advisory, changed finding count/scope, runtime package promotion, new glob endpoint or changed import/build boundary invalidates this disposition and blocks release until reviewed. No automatic renewal.

TASK-SECURITY-01 is MONITORING / BLOCKED ON UPSTREAM. The maintainer must recheck the linked primary advisory and npm registry at each release/dependency change and no later than the review date, rerun both audits and all boundary checks, then validate a compatible patch or request separate migration approval. This is a documented manual mechanism, **not an automated scheduled monitor**.

### Security gate policy

Existing CI did not run npm audit; no audit was removed or suppressed. No new automated gate was added: this documentation-only task preserves application/dependency/CI behavior, and a custom network-sensitive exception parser is unnecessary for the currently passing CI. Full audit remains a mandatory manual release check with honest nonzero reporting, alongside release-blocking zero production audit. The only accepted scope is the exact five rows and the single GHSA above. Any new high/critical, scope/count change, prod promotion or expired exception fails the manual disposition gate; never use a blanket ignore-high rule.

Retain all application regression, secret-boundary and database-foundation gates. Full npm audit still exits nonzero: **5 high; NOT FIXED**. Production audit exits zero. No provider calls, production data writes or schema changes are authorized by this exception.
