function App() {
			return <main>
				@if (props.foo()) {
					const a = 5;
					<>
						<span>{props.foo()} {a}</span>
						@if (props.bar()) {
							const b = 6;
							<span>{props.bar()} {b}</span>
						}
					</>
				}
			</main>;
		}