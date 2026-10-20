import type {
  BaseNode,
  BindingPattern,
  BlockStatement,
  CatchClause,
  Expression,
  Identifier,
  IfStatement,
  JSXClosingElement,
  JSXElement,
  JSXFragment,
  JSXOpeningElement,
  JSXText,
  Statement,
  SwitchCase,
  VariableDeclaration,
} from "yuku/types";

declare module "yuku/types" {
  interface DialectNodes {
    JSXCodeBlock: JSXCodeBlock;
    JSXIfExpression: JSXIfExpression;
    JSXForExpression: JSXForExpression;
    JSXSwitchExpression: JSXSwitchExpression;
    JSXTryExpression: JSXTryExpression;
    JSXStyleElement: JSXStyleElement;
  }
}

/** What a template renders. */
export type TemplateOutput =
  | JSXElement
  | JSXFragment
  | JSXStyleElement
  | JSXCodeBlock
  | JSXIfExpression
  | JSXForExpression
  | JSXSwitchExpression
  | JSXTryExpression;

/** `@{ statements output }`, a template with the code that sets it up. */
export interface JSXCodeBlock extends BaseNode {
  type: "JSXCodeBlock";
  body: Statement[];
  render: TemplateOutput | null;
}

/** `@if (test) { } @else { }`, an `@else if` being an `IfStatement`. */
export interface JSXIfExpression extends BaseNode {
  type: "JSXIfExpression";
  statementType: "IfStatement";
  test: Expression;
  consequent: BlockStatement;
  alternate: BlockStatement | IfStatement | null;
}

/** `@for (left of right; index i; key k) { } @empty { }`. */
export interface JSXForExpression extends BaseNode {
  type: "JSXForExpression";
  statementType: "ForOfStatement";
  await: boolean;
  left: VariableDeclaration | Expression;
  right: Expression;
  index: Identifier | null;
  key: Expression | null;
  body: BlockStatement;
  empty: BlockStatement | null;
}

/** `@switch (discriminant) { @case test: { } @default: { } }`. */
export interface JSXSwitchExpression extends BaseNode {
  type: "JSXSwitchExpression";
  statementType: "SwitchStatement";
  discriminant: Expression;
  cases: SwitchCase[];
}

/** `@try { } @pending { } @catch (error, reset) { }`. */
export interface JSXTryExpression extends BaseNode {
  type: "JSXTryExpression";
  statementType: "TryStatement";
  block: BlockStatement;
  pending: BlockStatement | null;
  handler: (CatchClause & { resetParam: BindingPattern | null }) | null;
  finalizer: null;
}

/** `<style>`, its CSS kept as written. */
export interface JSXStyleElement extends BaseNode {
  type: "JSXStyleElement";
  openingElement: JSXOpeningElement;
  /** The CSS, or nothing for `<style />`. */
  children: JSXText[];
  closingElement: JSXClosingElement | null;
}
