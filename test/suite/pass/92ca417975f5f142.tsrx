function MyApp() {
				if (ready) {
					return "Ready";
				}
				if (empty) {
					return null;
				}
				return <div />;
			}