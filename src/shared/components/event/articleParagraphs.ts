import {RuleType, type MarkdownToJSX} from "markdown-to-jsx/react"

// Collect only prose from the Markdown tree. URLs, images, inline code and
// fenced blocks remain in the original tree, including their attributes.
export function articleParagraphs(nodes: MarkdownToJSX.ASTNode[]) {
  const groups: string[][] = []
  function visit(nodes: MarkdownToJSX.ASTNode[], group: string[]) {
    for (const node of nodes) {
      switch (node.type) {
        case RuleType.text:
          group.push(node.text)
          break
        case RuleType.textFormatted:
        case RuleType.link:
          visit(node.children, group)
          break
        case RuleType.heading:
        case RuleType.paragraph:
        case RuleType.blockQuote:
          block(node.children)
          break
        case RuleType.orderedList:
        case RuleType.unorderedList:
          node.items.forEach(block)
          break
        case RuleType.table:
          node.header.forEach(block)
          node.cells.forEach((row) => row.forEach(block))
          break
      }
    }
  }
  function block(children: MarkdownToJSX.ASTNode[]) {
    const group: string[] = []
    visit(children, group)
    if (group.length) groups.push(group)
  }
  block(nodes)
  return groups
}
