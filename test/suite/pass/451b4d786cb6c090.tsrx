
				interface Props {
					className: string;
					onClick(): void;
				}

				const props: Props = { className: 'a', onClick() {} };
				const normalized = normalize_spread_props(props);
				const forAttr = normalize_spread_props_for_ref_attr(props);
			