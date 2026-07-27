import '@testing-library/jest-dom/vitest';

// jsdom does not implement scrollIntoView — the Jobs page auto-scrolls its
// log panel, which would otherwise throw during tests.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
