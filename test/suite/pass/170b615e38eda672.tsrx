
				interface Props {
					className: string;
				}

				declare const props: Props;
				declare const loose: Record<string, string>;
				declare const enabled: boolean;
				const ref = normalize_spread_props_for_ref_attr(props)?.ref;
				const looseRef = normalize_spread_props_for_ref_attr(loose)?.ref;
				const conditionalRef = normalize_spread_props_for_ref_attr(enabled && props)?.ref;
				const merged = mergeRefs(ref, (node: HTMLInputElement | null) => {});
			