# Open-source release checklist

Use this checklist before making the repository public and before each tagged release. Record the reviewer, date, commit SHA, and evidence links in the release issue or pull request. A checked box means the item was verified for the exact commit being released.

## 1. Scope and ownership

- [ ] The release matches the supported product scope in [the product plan](product-plan.md) and [open-source scope](open-source-scope.md).
- [ ] Every included source file, dependency, icon, screenshot, font, and other asset may be redistributed under its applicable terms.
- [ ] Generated files and vendored code identify their source and license when required.
- [ ] The `LICENSE`, copyright notice, package metadata, and README license badge agree.
- [ ] Experimental or unsupported paths are clearly labeled and are not presented as supported onboarding.

## 2. Privacy and secrets

- [ ] The full clone includes complete Git history and all remote branches needed for the audit.
- [ ] `npm run audit:oss` passes from that full clone.
- [ ] No commit, branch, tag, issue, pull request, Actions log, attachment, release artifact, or npm package contains credentials or private user data.
- [ ] No Apple Health export, real health value, pairing QR, onboarding URL, token, private key, database, provisioning profile, signing certificate, or unredacted log is present.
- [ ] Historical commit author names and email addresses have been reviewed and are acceptable to publish.
- [ ] Example configuration contains obvious placeholders only.

If a secret was ever committed, rotating it is mandatory. Deleting it from the current tree is not sufficient; decide whether history rewriting and coordinated force-pushes are also required before publication.

## 3. Documentation and community health

- [ ] `README.md` and `README.zh-CN.md` use the release version and describe the same supported flow.
- [ ] Install commands use an intentional pinned version and succeed in a clean environment.
- [ ] `CHANGELOG.md` describes user-visible, privacy, security, and migration changes.
- [ ] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `SUPPORT.md` are current.
- [ ] Issue forms, the pull request template, `CODEOWNERS`, and Dependabot configuration point to valid owners, labels, and URLs.
- [ ] Medical, privacy, local-storage, model-provider, background-sync, and support boundaries are stated without unsupported claims.

## 4. Build and package gates

- [ ] `npm ci` succeeds with the committed lockfile.
- [ ] `npm run typecheck`, `npm run test:local`, and `npm run build:local` pass.
- [ ] `npm run test:ios` passes, and HealthKit behavior is smoke-tested on a physical iPhone when iOS behavior changed.
- [ ] Relevant dependency, package, container, adapter, transport, and interoperability audits pass.
- [ ] Development-only advisories are reviewed individually; any temporary exception is documented with its deployment boundary and removal condition.
- [ ] `npm run pack:check --workspace vitalmcp` contains only intended runtime files and public documentation.
- [ ] `npm run release:npm-preflight` passes immediately before npm publication; the script does not publish automatically.

## 5. GitHub repository settings

- [ ] The repository description, homepage, topics, default branch, visibility, and license detection are correct.
- [ ] Issues and Discussions are enabled if the README links to them.
- [ ] Private vulnerability reporting is enabled and the `SECURITY.md` link works without exposing a report publicly.
- [ ] Branch protection or rulesets require the intended CI checks and prevent accidental force-pushes to `main`.
- [ ] GitHub Actions have read-only default permissions unless a workflow documents a narrower write need.
- [ ] Release, package, environment, webhook, deploy key, collaborator, and third-party app permissions have been reviewed.

## 6. Clean-clone acceptance

- [ ] Clone the public candidate into a new directory without local caches, ignored files, or maintainer credentials.
- [ ] Follow the README exactly for the active product phase.
- [ ] Verify setup consent, MCP approval, QR privacy, pairing, first sync, status, doctor, and removal behavior.
- [ ] Confirm diagnostics and failure paths remain redacted and do not suggest uploading private artifacts.

## 7. Publish and verify

- [ ] Merge the reviewed release commit into `main` and wait for required checks.
- [ ] Create the intended signed tag and GitHub release from that exact commit.
- [ ] Publish npm only after the local artifact and registry version checks pass.
- [ ] Verify the GitHub source archive, release assets, npm provenance/metadata, README links, badges, and install command from the public endpoints.
- [ ] Keep a rollback plan: deprecate a bad npm version, remove unsafe release assets, rotate exposed credentials, and publish a security notice when required.

Do not mark the release complete until the public artifacts—not only the local checkout—have been inspected.
