function App() {
			return <main>@{
				const hey = 10;
				@{
					const foo = props.foo();
					<span>{foo} {hey}</span>
				}
			}</main>;
		}