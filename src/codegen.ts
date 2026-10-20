import type { BlockStatement, IfStatement, Node, SwitchCase } from "yuku/types";
import {
  generate as generateYuku,
  type GenerateOptions,
  type GenerateResult,
  type Printer,
  type Printers,
} from "yuku/codegen";
import type { JSXIfExpression } from "./ast";

/** Prints a TSRX program, or any node in one, back to source. */
export function generate(node: Node, options: Omit<GenerateOptions, "print"> = {}): GenerateResult {
  return generateYuku(node, { ...options, print });
}

const print = {
  JSXCodeBlock(node, p) {
    p.write("@");
    p.block(node.render === null ? node.body : [...node.body, node.render]);
  },
  JSXIfExpression(node, p) {
    printIf("@if", node, p);
  },
  JSXForExpression(node, p) {
    p.write(node.await ? "@for await" : "@for");
    p.space();
    p.write("(");
    if (node.left.type === "VariableDeclaration") {
      p.write(node.left.kind + " ");
      p.node(node.left.declarations[0]!);
    } else {
      p.node(node.left);
    }
    p.write(" of ");
    p.node(node.right);
    if (node.index !== null) {
      p.write("; index ");
      p.node(node.index);
    }
    if (node.key !== null) {
      p.write("; key ");
      p.node(node.key);
    }
    p.write(")");
    p.space();
    p.node(node.body);
    printClause("@empty", node.empty, p);
  },
  JSXSwitchExpression(node, p) {
    p.write("@switch");
    printHead(node.discriminant, p);
    // a case is a standard SwitchCase, so it prints through a TSRX case printer
    p.block(node.cases.map((c) => ({ ...c, type: "TSRXSwitchCase" }) as unknown as Node));
  },
  TSRXSwitchCase(node: SwitchCase, p: Printer) {
    if (node.test === null) {
      p.write("@default:");
    } else {
      p.write("@case ");
      p.node(node.test);
      p.write(":");
    }
    p.space();
    p.node(node.consequent[0]!);
  },
  JSXTryExpression(node, p) {
    p.write("@try");
    p.space();
    p.node(node.block);
    printClause("@pending", node.pending, p);
    if (node.handler === null) return;
    p.space();
    p.write("@catch");
    p.space();
    if (node.handler.param !== null) {
      p.write("(");
      p.node(node.handler.param);
      if (node.handler.resetParam !== null) {
        p.write(",");
        p.space();
        p.node(node.handler.resetParam);
      }
      p.write(")");
      p.space();
    }
    p.node(node.handler.body);
  },
  JSXStyleElement(node, p) {
    p.node(node.openingElement);
    for (const child of node.children) p.node(child);
    p.node(node.closingElement);
  },
} satisfies Printers & Record<"TSRXSwitchCase", (node: SwitchCase, p: Printer) => void>;

function printIf(keyword: string, node: JSXIfExpression | IfStatement, p: Printer): void {
  p.write(keyword);
  printHead(node.test, p);
  p.node(node.consequent);
  if (node.alternate === null) return;
  p.space();
  p.write("@else");
  p.space();
  if (node.alternate.type === "IfStatement") printIf("if", node.alternate, p);
  else p.node(node.alternate);
}

function printHead(head: Node, p: Printer): void {
  p.space();
  p.write("(");
  p.node(head);
  p.write(")");
  p.space();
}

function printClause(keyword: string, block: BlockStatement | null, p: Printer): void {
  if (block === null) return;
  p.space();
  p.write(keyword);
  p.space();
  p.node(block);
}
