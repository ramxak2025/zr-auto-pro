---
name: ios-qa-build
description: Run the full QA pipeline for an iOS-impacting change — git status, typecheck, lint, jest, plate-mask jest, prebuild, pod install, xcodebuild iPhone Simulator Debug, native autolinking check. Use as the final gate before reporting.
---

# ios-qa-build

## When to use

- After any non-trivial iOS or shared change.
- Before producing the final report to the user.

## Files / docs to read first

- `CLAUDE.md` (root) — section H "Реальные команды для проверок"
- `mobile/CLAUDE.md` — checks chapter
- `.github/workflows/ci.yml` — confirm what CI actually runs

## Workflow

```bash
git -C <repo> status --short

cd mobile
npm run typecheck
npm run lint
npx jest
npx jest src/utils/__tests__/plateMask

# Native rebuild only when iOS code, app.json plugins, or modules/*/ios changed:
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
xcodebuild -workspace ios/Autexa.xcworkspace -scheme Autexa \
  -configuration Debug -sdk iphonesimulator \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro" \
  -derivedDataPath ./build/DerivedData build

# Confirm autolinking:
grep -E "AutexaLiquidGlass|AutexaKassaButton|AutexaScheduleGrid" ios/Pods/Pods.xcodeproj/project.pbxproj | head
```

If the build fails:

1. Read the first `error:` line; ignore later cascading errors.
2. Fix the cause; re-run.
3. Common: `cannot override with stored property` collisions on UIView built-ins (`focused`, `cellWidth` reserved by some subclasses). Rename.

## Acceptance criteria

- `BUILD SUCCEEDED` shows in xcodebuild output.
- `xcrun simctl install booted` returns success.
- jest counts unchanged.

## Risks

- Stale `mobile/ios/` after prebuild from a previous SDK — always use `--clean`.
- npm version drift causing `npm ci` lockfile mismatch — use `npx -y npm@10` for installs.

## Forbidden

- Skipping any step in the pipeline before declaring "ready to ship".
- Editing files under `mobile/ios/` to silence build errors.

## Final report format

Each command run with its result. Native autolinking confirmation. App-install confirmation.
