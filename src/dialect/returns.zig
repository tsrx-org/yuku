//! Where a `return` in a template is a mistake, as `@tsrx/core` 0.5.2 reports
//! it (TSRX2001): a `@{ }` block that is no function's body, and the body of a
//! `@try`, `@pending` or `@catch`. Core finds every `return` under them, in
//! nested statements, directives, code blocks and JSX children, except one in
//! a function or a JavaScript loop, which returns from or ends that instead.
//! An `@for` body is a template, not a loop, and is searched.

pub const template_return_message = "`return` is invalid inside TSRX template blocks";
const template_return_help = "Use rendered output as the final expression instead.";

/// Deep enough for any template a person writes; past it the walk stops.
const max_depth = 128;

/// Report every `return` core reports under `items`.
pub fn report(comptime Host: type, parser: anytype, items: []const Host.NodeIndex) Host.ErrorType!void {
    for (items) |item| try visit(Host, parser, item, 0);
}

fn visitList(comptime Host: type, parser: anytype, range: Host.IndexRange, depth: u32) Host.ErrorType!void {
    for (Host.extra(parser, range)) |item| try visit(Host, parser, item, depth);
}

fn visit(comptime Host: type, parser: anytype, node: Host.NodeIndex, depth: u32) Host.ErrorType!void {
    if (node == .null or depth >= max_depth) return;
    const next = depth + 1;
    if (Host.record(parser, node)) |value| return visitRecord(Host, parser, value, next);
    switch (Host.data(parser, node)) {
        .return_statement => try Host.reportWithHelp(parser, Host.nodeSpan(parser, node), template_return_message, template_return_help),
        .block_statement => |data| try visitList(Host, parser, data.body, next),
        .if_statement => |data| {
            try visit(Host, parser, data.consequent, next);
            try visit(Host, parser, data.alternate, next);
        },
        .try_statement => |data| {
            try visit(Host, parser, data.block, next);
            try visit(Host, parser, data.handler, next);
            try visit(Host, parser, data.finalizer, next);
        },
        .catch_clause => |data| try visit(Host, parser, data.body, next),
        .switch_statement => |data| try visitList(Host, parser, data.cases, next),
        .switch_case => |data| try visitList(Host, parser, data.consequent, next),
        .labeled_statement => |data| try visit(Host, parser, data.body, next),
        .with_statement => |data| try visit(Host, parser, data.body, next),
        .expression_statement => |data| try visit(Host, parser, data.expression, next),
        .variable_declaration => |data| try visitList(Host, parser, data.declarators, next),
        .variable_declarator => |data| try visit(Host, parser, data.init, next),
        .jsx_element => |data| try visitList(Host, parser, data.children, next),
        .jsx_fragment => |data| try visitList(Host, parser, data.children, next),
        .jsx_expression_container => |data| try visit(Host, parser, data.expression, next),
        .conditional_expression => |data| {
            try visit(Host, parser, data.consequent, next);
            try visit(Host, parser, data.alternate, next);
        },
        .logical_expression => |data| {
            try visit(Host, parser, data.left, next);
            try visit(Host, parser, data.right, next);
        },
        .parenthesized_expression => |data| try visit(Host, parser, data.expression, next),
        // a function or a loop, whose `return` is its own, or no statement
        else => {},
    }
}

fn visitRecord(comptime Host: type, parser: anytype, value: anytype, depth: u32) Host.ErrorType!void {
    switch (value) {
        .jsx_if_expression => |data| {
            try visit(Host, parser, ref(Host, data.consequent.raw), depth);
            try visit(Host, parser, ref(Host, data.alternate.raw), depth);
        },
        .jsx_for_expression => |data| {
            // the loop's body is the directive's template
            const loop = ref(Host, data.statement.raw);
            switch (Host.data(parser, loop)) {
                inline .for_of_statement, .for_in_statement, .for_statement => |statement| try visit(Host, parser, statement.body, depth),
                else => {},
            }
            try visit(Host, parser, ref(Host, data.empty.raw), depth);
        },
        .jsx_switch_expression => |data| try visit(Host, parser, ref(Host, data.statement.raw), depth),
        .jsx_try_expression => |data| {
            try visit(Host, parser, ref(Host, data.statement.raw), depth);
            try visit(Host, parser, ref(Host, data.pending.raw), depth);
        },
        .jsx_code_block => |data| {
            try visitList(Host, parser, .{ .start = data.body.start, .len = data.body.len }, depth);
            try visit(Host, parser, ref(Host, data.render.raw), depth);
        },
        else => {},
    }
}

fn ref(comptime Host: type, raw: u32) Host.NodeIndex {
    return @enumFromInt(raw);
}
