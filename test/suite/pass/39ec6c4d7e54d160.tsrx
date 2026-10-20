function App(condition) {
				return condition ? (
					<Item />
				) : (
					[<Item />]
				);
			}