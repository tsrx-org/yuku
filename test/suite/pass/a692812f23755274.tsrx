
				declare const enabled: boolean;
				declare const count: number;
				declare const label: string;
				const bool = normalize_spread_props(enabled && { disabled: true });
				const num = normalize_spread_props(count && { disabled: true });
				const str = normalize_spread_props(label && { disabled: true });
				const forAttr = normalize_spread_props_for_ref_attr(enabled && { disabled: true });
				const empty = normalize_spread_props_for_ref_attr(enabled ? { disabled: true } : null);
			