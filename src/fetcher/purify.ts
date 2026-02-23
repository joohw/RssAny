// 基于 node-html-parser 的 HTML 净化：移除与 RSS 内容无关的标签、属性、注释

import { parse, NodeType } from "node-html-parser";
import type { HTMLElement, Node } from "node-html-parser";


const TAGS_TO_REMOVE = [
  "script", "style", "svg", "symbol", "link", "meta",
  "input", "embed", "button", "select", "textarea",
  "nav", "iframe", "noscript", "template", "object", "canvas",
];


const BASE64_IMG_PATTERN = /^data:image\/[^;"'\s]+;base64,/i;


function collectCommentNodes(node: Node, out: Node[]): void {
  if (node.nodeType === NodeType.COMMENT_NODE) {
    out.push(node);
    return;
  }
  if ("childNodes" in node && Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) {
      collectCommentNodes(child, out);
    }
  }
}


function stripRssIrrelevantAttributes(root: HTMLElement): void {
  const toProcess: HTMLElement[] = [root];
  const all = root.querySelectorAll("*");
  for (const el of all) {
    if (el.nodeType === NodeType.ELEMENT_NODE) toProcess.push(el as HTMLElement);
  }
  for (const elem of toProcess) {
    elem.removeAttribute("class");
    elem.removeAttribute("style");
    const src = elem.getAttribute("src");
    if (src && BASE64_IMG_PATTERN.test(src)) {
      elem.removeAttribute("src");
    }
  }
}


/** 使用 node-html-parser 解析并净化 HTML，剥离与 RSS 内容无关的部分（默认开启） */
export function applyPurify(html: string, purify: boolean | undefined): string {
  if (purify === false) return html;
  const root = parse(html, { comment: true });
  for (const tag of TAGS_TO_REMOVE) {
    const list = root.querySelectorAll(tag);
    for (const el of list) {
      el.remove();
    }
  }
  const commentNodes: Node[] = [];
  collectCommentNodes(root, commentNodes);
  for (const node of commentNodes) {
    node.remove();
  }
  stripRssIrrelevantAttributes(root);
  return root.toString();
}
