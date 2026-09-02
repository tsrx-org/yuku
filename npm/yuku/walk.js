export function walk(root, visitors, state) {
  const visit = (value, parent) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, parent);
      return;
    }
    if (typeof value.type !== "string") return;
    const hooks = visitors[value.type];
    const enter = typeof hooks === "function" ? hooks : hooks?.enter;
    enter?.(value, { parent, state });
    visitors.enter?.(value, { parent, state });
    for (const [key, child] of Object.entries(value)) {
      if (key !== "comments") visit(child, value);
    }
    const leave = typeof hooks === "object" ? hooks?.leave : undefined;
    leave?.(value, { parent, state });
    visitors.leave?.(value, { parent, state });
  };
  visit(root, null);
  return root;
}
