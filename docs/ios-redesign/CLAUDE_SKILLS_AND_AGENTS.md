# Autexa — Claude Code skills и agents

Дата: 2026-05-06.

Эта итерация ввела набор project-level **skills** и **subagents** под `.claude/`. Это позволяет дальнейшие задачи делать как командой специалистов: каждое решение принимает соответствующий агент со своим скиллом.

## Skills (`.claude/skills/`)

| Skill                      | Назначение                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ios-liquid-glass-ui`      | Edge-to-edge iOS layout, floating Liquid Glass tab bar, Safe Area / Dynamic Island / Home Indicator, SF Symbols, motion. |
| `swift-native-module`      | Swift / UIKit / SwiftUI inside local Expo Modules + prebuild/pod install/xcodebuild pipeline.                            |
| `rn-performance`           | Cache, prefetch, stale-while-revalidate, FlashList/FlatList, memoization, UI-thread scroll handlers.                     |
| `schedule-ios-redesign`    | ScheduleScreen — sticky names column / day grid sync, owners hidden, smooth scroll, month controls.                      |
| `plate-cash-ux`            | License plate input/badge, RU vs INT, selected-client card, X clear.                                                     |
| `warehouse-product-picker` | Product picker inside cash mirroring warehouse screen, cache-first speed.                                                |
| `suppliers-ui-ux`          | Suppliers list redesign + swipe-to-delete with permission gating.                                                        |
| `journal-documents-ux`     | Journal — remove paid/unpaid where it doesn't belong (warehouse docs).                                                   |
| `autexa-visual-system`     | Unified Apple-like visual system across all screens.                                                                     |
| `ios-qa-build`             | Final QA pipeline: typecheck/lint/jest/prebuild/pod/xcodebuild.                                                          |

## Subagents (`.claude/agents/`)

| Agent                               | Role                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| `ios-native-engineer`               | Author Swift code under `mobile/modules/*/ios/`.         |
| `ios-ux-designer`                   | Apply HIG and Autexa visual system to RN screens.        |
| `rn-performance-engineer`           | Diagnose and fix RN perf issues.                         |
| `schedule-engineer`                 | Owner of ScheduleScreen UX & sync.                       |
| `cash-plate-engineer`               | Owner of cash + plate logic.                             |
| `warehouse-product-picker-engineer` | Owner of in-cash product picker.                         |
| `suppliers-engineer`                | Owner of SuppliersScreen redesign + swipe delete.        |
| `journal-documents-engineer`        | Owner of ChecksScreen / journal warehouse-doc rendering. |
| `autexa-visual-system-designer`     | Mass screen unification.                                 |
| `qa-build-engineer`                 | Final build gate.                                        |

## Как использовать в дальнейшем

- Когда пользователь формулирует задачу, она автоматически попадает на подходящий skill (например, "плата зажата" → `plate-cash-ux`; "лагает скролл" → `rn-performance`).
- Каждый агент знает, какие файлы читать первыми, какой workflow применять и каких **forbidden** действий избегать (бэкенд, креды, файлы в `mobile/ios/`).
- QA-агент гарантирует, что никакая итерация не уйдёт без полного прогона проверок и подтверждения сборки.

## Применение в текущей итерации (iter #5)

Phase 1 (edge-to-edge layout) → `ios-liquid-glass-ui` + `ios-ux-designer`.
Phase 2 (plate refinement) → `plate-cash-ux` + `cash-plate-engineer`.
Phase 3 (product picker) → `warehouse-product-picker` + соответствующий агент.
Phase 4 (journal warehouse docs) → `journal-documents-ux` + `journal-documents-engineer`.
Phase 5 (suppliers swipe delete) → `suppliers-ui-ux` + `suppliers-engineer`.
Phase 6 (schedule month controls) → `schedule-ios-redesign` + `schedule-engineer`.
Phase 7 (visual unification) → `autexa-visual-system` + `autexa-visual-system-designer`.
Phase 8 (checks) → `ios-qa-build` + `qa-build-engineer`.

## Технический статус

Project skills/subagents активированы автоматически Claude Code, если runtime поддерживает `.claude/skills/` и `.claude/agents/` (новая фича CLI). Если нет — файлы по-прежнему служат живой документацией процесса и используются вручную.
