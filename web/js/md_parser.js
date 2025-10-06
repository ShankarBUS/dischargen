// Shared Markdown parser producing a simple AST used by both PDF and UI renderers.
// Supported features:
// - Paragraphs
// - Inline **bold** and *italic*
// - Nested ordered/unordered lists (mixed) based on indentation (4 spaces = 1 indentation)
// - List item continuation lines (indented more than the item's marker indentation)
// AST shape:
//   Block = { type:'paragraph', runs: InlineRun[] } | { type:'list', ordered:boolean, items: ListItem[] }
//   ListItem = { blocks: Block[] }
//   InlineRun = { text:string, bold?:boolean, italic?:boolean }

export function parseMarkdown(md) {
  const text = String(md || "").replace(/\r\n?/g, "\n");
  const rawLines = text.split("\n");

  const blocks = [];
  let paraRuns = [];

  const listItemRe = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;

  // Stack of active lists: [{level, type:'ul'|'ol', node}]
  const listStack = [];

  function pushParagraph() {
    if (!paraRuns.length) return;
    blocks.push({ type: "paragraph", runs: paraRuns });
    paraRuns = [];
  }

  function closeLists(toLevel = -1) {
    while (
      listStack.length &&
      listStack[listStack.length - 1].level > toLevel
    ) {
      listStack.pop();
    }
  }

  function currentList() {
    return listStack[listStack.length - 1];
  }

  function attachList(level, type) {
    const top = currentList();
    if (!top || level > top.level) {
      // New deeper list
      const listNode = { type: "list", ordered: type === "ol", items: [] };
      if (top) {
        // Attach inside last item's blocks of parent list
        const parentItems = top.node.items;
        if (!parentItems.length) {
          // Create empty list item host if parent had none yet
          parentItems.push({ blocks: [] });
        }
        parentItems[parentItems.length - 1].blocks.push(listNode);
      } else {
        blocks.push(listNode);
      }
      listStack.push({ level, type, node: listNode });
      return listNode;
    }

    // Same or shallower level: unwind first
    if (top.level > level) closeLists(level);
    let after = currentList();
    if (!after || after.level !== level || after.type !== type) {
      // Need a sibling list of different type
      const listNode = { type: "list", ordered: type === "ol", items: [] };
      if (after && after.level === level) {
        // Replace sibling at same level (different type)
        // Attach to parent (one above)
        closeLists(level - 1);
        const parent = currentList();
        if (parent) {
          const parentItems = parent.node.items;
          if (!parentItems.length) parentItems.push({ blocks: [] });
          parentItems[parentItems.length - 1].blocks.push(listNode);
        } else {
          blocks.push(listNode);
        }
        listStack.push({ level, type, node: listNode });
        return listNode;
      } else {
        // Fresh list at this level
        const parent = currentList();
        if (parent) {
          const parentItems = parent.node.items;
          if (!parentItems.length) parentItems.push({ blocks: [] });
          parentItems[parentItems.length - 1].blocks.push(listNode);
        } else {
          blocks.push(listNode);
        }
        listStack.push({ level, type, node: listNode });
        return listNode;
      }
    }
    return currentList().node;
  }

  function paragraphRunsFromText(txt) {
    return parseInline(txt);
  }

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i];
    if (/^\s*$/.test(line)) {
      // Blank line
      pushParagraph();
      closeLists(-1); // allow new top-level constructs after blank
      continue;
    }
    const m = line.match(listItemRe);
    if (m) {
      // List item
      pushParagraph();
      const indent = m[1].replace(/\t/g, "    "); // tabs => 4 spaces
      const indentSpaces = indent.length;
      const level = Math.floor(indentSpaces / 4); // 4-space indent unit
      const marker = m[2];
      let textPart = m[3];
      // Collect continuation lines
      let j = i + 1;
      while (j < rawLines.length) {
        const next = rawLines[j];
        if (/^\s*$/.test(next)) break; // blank ends
        if (listItemRe.test(next)) break; // new list item
        const contIndent = next
          .match(/^(\s*)/)[1]
          .replace(/\t/g, "    ").length;
        if (contIndent <= indentSpaces) break; // not continuation
        textPart += " " + next.trim();
        j++;
      }
      i = j - 1;
      const type = /\d+\./.test(marker) ? "ol" : "ul";
      const listNode = attachList(level, type);
      const item = { blocks: [] };
      listNode.items.push(item);
      if (textPart.trim())
        item.blocks.push({
          type: "paragraph",
          runs: paragraphRunsFromText(textPart.trim()),
        });
      continue;
    }

    // Plain paragraph line (allow soft breaks via \n join)
    if (paraRuns.length) paraRuns.push({ text: "\n" });
    paraRuns.push(...paragraphRunsFromText(line));
  }

  pushParagraph();
  closeLists(-1);
  return blocks;
}

// Inline markdown parser producing runs with bold/italic flags.
export function parseInline(text) {
  const runs = [];
  let i = 0;
  let bold = false;
  let italic = false;
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      bold = !bold;
      i += 2;
      continue;
    }
    if (text[i] === "*") {
      italic = !italic;
      i += 1;
      continue;
    }
    let j = i;
    while (j < text.length && !text.startsWith("**", j) && text[j] !== "*") j++;
    const chunk = text.slice(i, j);
    if (chunk) runs.push({ text: chunk, bold, italic });
    i = j;
  }

  return runs;
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
