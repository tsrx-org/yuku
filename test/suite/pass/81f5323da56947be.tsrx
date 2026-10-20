if (import.meta.env.platform['web']) consume('computed');
			if (!import.meta.env.platform.web) consume('negated');