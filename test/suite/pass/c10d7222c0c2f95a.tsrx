function App() {
			return <main>
				@{
					const foo = props.foo();
					<span>{foo}</span>
				}
				@{
					const bar = props.bar();
					<span>{bar}</span>
				}
			</main>;
		}