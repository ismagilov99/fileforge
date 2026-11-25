# Accessibility verification

The interface uses semantic landmarks, native labels, tab/tabpanel roles, keyboard arrow navigation, visible focus styles, polite live status regions, progress semantics, descriptive remove/reorder labels, a skip link, touch-sized controls, reduced-motion handling and forced-colors overrides.

`e2e/accessibility.spec.ts` runs axe-core against the initial view and checks keyboard tab navigation. The current automation is a baseline, not an accessibility certification.

## Manual release checklist

- Complete every workflow using keyboard only; confirm there are no keyboard traps.
- Check focus order and focus restoration after tab changes, errors, cancellation and asynchronous completion.
- Confirm screen-reader announcement of operation status, progress, validation messages and download fallback links using NVDA/VoiceOver/TalkBack where available.
- Check 200% browser zoom and 320 CSS-pixel viewport width without loss of functionality.
- Verify light and dark contrast with rendered colors, not only source tokens.
- Verify forced-colors/high-contrast mode and `prefers-reduced-motion`.
- Check that every input has a programmatic label and errors are associated with the relevant control.
- Review axe findings; document any accepted exception and rationale rather than silently disabling a rule.
