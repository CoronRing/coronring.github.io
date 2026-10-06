/**
 * Rehype plugin for Markdown tables.
 *
 * Two things CSS cannot do on its own:
 *
 * - **Scroll without shrinking.** A table set to `display: block` scrolls
 *   sideways on a phone, but it also stops filling its column, and its
 *   narrowest column wraps "34 of 67" onto two lines. Wrapping the table in a
 *   `div.table-scroll` lets the wrapper scroll while the table stays a real
 *   full-width table.
 * - **Keep figures on one line.** Short cells (a number, "0 of 29", "0.76") get
 *   `cell-tight`, which the stylesheet sets to `white-space: nowrap`, so only
 *   the prose cells wrap.
 *
 * Dependency-free on purpose: a small recursive walk over the hast tree, rather
 * than a transitive `unist-util-visit` that could disappear in an upgrade.
 */

/** Cells at or under this many characters are kept on one line. */
const SHORT_CELL_CHARS = 14;

/** @param {any} node */
function textOf(node) {
  if (node.type === 'text') return node.value;
  return (node.children ?? []).map(textOf).join('');
}

/** @param {any} node */
function tightenShortCells(node) {
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue;
    if (
      (child.tagName === 'td' || child.tagName === 'th') &&
      textOf(child).trim().length <= SHORT_CELL_CHARS
    ) {
      const props = (child.properties ??= {});
      props.className = [...(props.className ?? []), 'cell-tight'];
    }
    tightenShortCells(child);
  }
}

/** @param {any} node */
function wrapTables(node) {
  if (!node.children) return;
  node.children = node.children.map((/** @type {any} */ child) => {
    if (child.type === 'element' && child.tagName === 'table') {
      tightenShortCells(child);
      return {
        type: 'element',
        tagName: 'div',
        properties: { className: ['table-scroll'] },
        children: [child],
      };
    }
    wrapTables(child);
    return child;
  });
}

export function rehypeTableScroll() {
  return (/** @type {any} */ tree) => {
    wrapTables(tree);
  };
}
