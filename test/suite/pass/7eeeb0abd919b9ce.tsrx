function read(o, xs) {
				if (import.meta.env.platform.web) {
					for (var i = 0; i < 1; i++) { var in_for; }
					for (var key in o) {}
					for (var { x, y: [z = 1, ...rest] } of xs) {}
					while (o) { var in_while; }
					do { var in_do; } while (o);
					label: { var in_label; }
					try { var in_try; } catch (e) { var in_catch; } finally { var in_finally; }
					switch (o) { case 1: var in_case; default: { var in_default; } }
					if (o) var in_if; else var in_else;
					let not_let;
					const not_const = 1;
					function not_function() { var in_function; }
					class NotClass { static { var in_static; } method() { var in_method; } }
					const not_arrow = () => { var in_arrow; };
				}
			}